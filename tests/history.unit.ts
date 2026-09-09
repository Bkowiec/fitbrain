import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateRange, monday, previousRange, recordsBySport, similarSessions, totals, weeklyTotals, weeklyZones, zoneGroups } from '../src/history/aggregate';
import { HISTORY_VERSION, hasCurrentHistory, historyEntries, historySettingsKey, type HistoryEntry } from '../src/history/model';
import type { Activity } from '../src/library/model';
import type { ZoneSet } from '../src/fit/types';

function session(key: string, date: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { key, activityId: key, title: key, fileName: `${key}.fit`, tags: [], index: 0, startTime: `${date}T08:00:00.000Z`, localDate: date, sport: 'running', sportLabel: 'Running', speedMode: 'pace_km', distance: 5000, timerTime: 1500, avgSpeed: 10 / 3, zones: [], bestEfforts: [], peakPower: [], ...overrides };
}
function zone(high: number, seconds = 600): ZoneSet {
  return { id: 'hr_computed', title: 'Heart rate', source: 'computed', units: 'bpm', basis: `max HR ${high}`, buckets: [
    { zone: 1, label: 'Z1', high, seconds, pct: 100 }, { zone: 2, label: 'Z2', low: high, seconds: 0, pct: 0 },
  ] };
}

test('weeks use Mondays across year boundaries and include empty weeks', () => {
  assert.equal(monday('2026-01-04'), '2025-12-29');
  assert.equal(monday('2026-01-05'), '2026-01-05');
  const weeks = weeklyTotals([session('a', '2026-01-04'), session('b', '2026-01-19'), session('outside', '2026-02-01')], { from: '2026-01-01', to: '2026-01-25' });
  assert.deepEqual(weeks.map((w) => [w.start, w.sessions, w.distance, w.partial]), [
    ['2025-12-29', 1, 5000, true], ['2026-01-05', 0, 0, false], ['2026-01-12', 0, 0, false], ['2026-01-19', 1, 5000, false],
  ]);
});

test('periods end at the newest matching local date and previous periods have equal lengths', () => {
  const range = dateRange([session('a', '2024-02-29'), session('b', '2024-01-01')], '4w', { from: '', to: '' })!;
  assert.deepEqual(range, { from: '2024-02-02', to: '2024-02-29' });
  assert.deepEqual(previousRange(range), { from: '2024-01-05', to: '2024-02-01' });
  assert.equal(dateRange([], 'all', { from: '', to: '' }), undefined);
  assert.equal(dateRange([], 'custom', { from: '2026-09-01', to: '2026-08-01' }), undefined);
  assert.equal(dateRange([], 'custom', { from: '2026-02-30', to: '2026-03-01' }), undefined);
});

test('unknown distance is distinguishable from a recorded zero distance', () => {
  assert.deepEqual(totals([session('missing', '2026-01-01', { distance: undefined }), session('zero', '2026-01-02', { distance: 0 })]), { sessions: 2, distance: 0, distanceSessions: 1, timerTime: 3000 });
});

test('zone totals combine identical boundaries but keep different definitions separate', () => {
  const entries = [session('a', '2026-01-05', { zones: [zone(120)] }), session('b', '2026-01-06', { zones: [{ ...zone(120, 300), basis: 'same threshold from file' }] }), session('c', '2026-01-12', { zones: [zone(130, 1000)] })];
  const groups = zoneGroups(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].entries.length, 2);
  const weeks = weeklyTotals(entries, { from: '2026-01-05', to: '2026-01-18' });
  assert.deepEqual(weeklyZones(groups[0], weeks), [[900, 0], [0, 0]]);
  assert.deepEqual(weeklyZones(groups[1], weeks), [[0, 1000], [0, 0]]);
});

test('effort and power records are separated by sport and retain their source session', () => {
  const effort = { name: '1 km', distance: 1000, time: 300, speed: 10 / 3, startDist: 500, startTimer: 150 };
  const power = { windowSec: 60, label: '1 min', watts: 200, startTimer: 100 };
  const groups = recordsBySport([
    session('slow', '2026-01-01', { bestEfforts: [effort], peakPower: [power] }),
    session('fast', '2026-01-02', { index: 1, bestEfforts: [{ ...effort, time: 280 }], peakPower: [{ ...power, watts: 210 }] }),
    session('bike', '2026-01-03', { sport: 'cycling', bestEfforts: [{ ...effort, time: 100 }], peakPower: [{ ...power, watts: 500 }] }),
  ]);
  const run = groups.find((g) => g.sport === 'running')!;
  assert.equal(run.efforts[0].entry.key, 'fast');
  assert.equal(run.efforts[0].entry.index, 1);
  assert.equal(run.powers[0].power.watts, 210);
  assert.equal(groups.find((g) => g.sport === 'cycling')!.powers[0].power.watts, 500);
});

test('similar sessions respect sport, subtype and inclusive distance tolerance', () => {
  const reference = session('ref', '2026-01-01');
  const entries = [reference, session('edge', '2026-01-02', { distance: 5500 }), session('far', '2026-01-03', { distance: 5501 }), session('bike', '2026-01-04', { sport: 'cycling' }), session('trail', '2026-01-05', { subSport: 'trail' })];
  assert.deepEqual(similarSessions(entries, reference).map((s) => s.key), ['edge', 'ref']);
});

test('legacy entries and caches from other settings are excluded until reanalyzed', () => {
  const s = session('a', '2026-01-01');
  const activity: Activity = { id: 'a', title: 'Morning run', fileName: 'a.fit', fileSize: 10, addedAt: s.startTime, tags: ['easy'], notes: 'Keep this', startTime: s.startTime, localDate: s.localDate, localTime: '08:00:00', sports: ['running'], sportLabels: ['Running'], sessionCount: 1, timerTime: 1500 };
  assert.equal(hasCurrentHistory(activity, {}), false);
  activity.history = { version: HISTORY_VERSION, settingsKey: historySettingsKey({ maxHr: 190 }), sessions: [s] };
  assert.equal(hasCurrentHistory(activity, { maxHr: 190 }), true);
  assert.equal(hasCurrentHistory(activity, { maxHr: 195 }), false);
  assert.deepEqual(historyEntries([activity], {}), []);
  const entries = historyEntries([activity], { maxHr: 190 });
  assert.equal(entries[0].title, 'Morning run');
  assert.deepEqual(entries[0].tags, ['easy']);
});

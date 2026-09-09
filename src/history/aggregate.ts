import type { BestEffort, PeakPower, ZoneSet } from '../fit/types';
import type { HistoryEntry } from './model';
import { isNum } from '../fit/format';

export type Period = '4w' | '12w' | '52w' | 'all' | 'custom';
export interface DateRange { from: string; to: string }
export interface Totals { sessions: number; distance: number; distanceSessions: number; timerTime: number }
export interface Week extends Totals { start: string; end: string; partial: boolean }
const DAY = 86400000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function monday(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
export function dateRange(entries: HistoryEntry[], period: Period, custom: DateRange): DateRange | undefined {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (period === 'custom') return validDate(custom.from) && validDate(custom.to) && custom.from <= custom.to ? custom : undefined;
  const dates = entries.map((s) => s.localDate).sort();
  const to = dates[dates.length - 1];
  if (!to) return undefined;
  return { to, from: period === 'all' ? dates[0] : addDays(to, -(Number.parseInt(period) * 7 - 1)) };
}
export function inRange(entries: HistoryEntry[], range: DateRange): HistoryEntry[] {
  return entries.filter((s) => s.localDate >= range.from && s.localDate <= range.to);
}
export function totals(entries: HistoryEntry[]): Totals {
  return entries.reduce((out, s) => ({
    sessions: out.sessions + 1, distance: out.distance + (isNum(s.distance) ? s.distance : 0),
    distanceSessions: out.distanceSessions + (isNum(s.distance) ? 1 : 0), timerTime: out.timerTime + s.timerTime,
  }), { sessions: 0, distance: 0, distanceSessions: 0, timerTime: 0 });
}
export function previousRange(range: DateRange): DateRange {
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}
export function weeklyTotals(entries: HistoryEntry[], range: DateRange): Week[] {
  const grouped = new Map<string, HistoryEntry[]>();
  for (const s of inRange(entries, range)) {
    const key = monday(s.localDate);
    const group = grouped.get(key) ?? [];
    group.push(s); grouped.set(key, group);
  }
  const weeks: Week[] = [];
  for (let start = monday(range.from); start <= range.to; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    weeks.push({ start, end, partial: start < range.from || end > range.to, ...totals(grouped.get(start) ?? []) });
  }
  return weeks;
}

export interface ZoneGroup { key: string; zone: ZoneSet; entries: { session: HistoryEntry; zone: ZoneSet }[] }
/** Only equal definitions can share a historical total, even when thresholds came from different FIT files. */
export function zoneGroups(entries: HistoryEntry[]): ZoneGroup[] {
  const groups = new Map<string, ZoneGroup>();
  for (const session of entries) for (const zone of session.zones) {
    const key = JSON.stringify([zone.id, zone.units, zone.buckets.map((b) => [b.zone, b.label, b.low ?? null, b.high ?? null])]);
    const group = groups.get(key) ?? { key, zone, entries: [] };
    group.entries.push({ session, zone }); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.entries.length - a.entries.length || a.zone.id.localeCompare(b.zone.id));
}
export function weeklyZones(group: ZoneGroup, weeks: Week[]): number[][] {
  const indices = new Map(weeks.map((w, i) => [w.start, i]));
  const values = group.zone.buckets.map(() => weeks.map(() => 0));
  for (const { session, zone } of group.entries) {
    const index = indices.get(monday(session.localDate));
    if (index !== undefined) zone.buckets.forEach((b, i) => { values[i][index] += b.seconds; });
  }
  return values;
}

export interface EffortRecord { entry: HistoryEntry; effort: BestEffort }
export interface PowerRecord { entry: HistoryEntry; power: PeakPower }
export interface SportRecords { sport: string; efforts: EffortRecord[]; powers: PowerRecord[] }
export function recordsBySport(entries: HistoryEntry[]): SportRecords[] {
  const sports = [...new Set(entries.map((s) => s.sport))].sort();
  return sports.map((sport) => {
    const efforts = new Map<number, EffortRecord>();
    const powers = new Map<number, PowerRecord>();
    for (const entry of entries.filter((s) => s.sport === sport)) {
      for (const effort of entry.bestEfforts) {
        if (isNum(effort.time) && effort.time > 0 && (!efforts.has(effort.distance) || effort.time < efforts.get(effort.distance)!.effort.time)) efforts.set(effort.distance, { entry, effort });
      }
      for (const power of entry.peakPower) {
        if (isNum(power.watts) && power.watts > 0 && (!powers.has(power.windowSec) || power.watts > powers.get(power.windowSec)!.power.watts)) powers.set(power.windowSec, { entry, power });
      }
    }
    return { sport, efforts: [...efforts.values()].sort((a, b) => a.effort.distance - b.effort.distance), powers: [...powers.values()].sort((a, b) => a.power.windowSec - b.power.windowSec) };
  }).filter((s) => s.efforts.length || s.powers.length);
}

export function similarSessions(entries: HistoryEntry[], reference: HistoryEntry): HistoryEntry[] {
  if (!reference.distance || reference.distance <= 0) return [];
  return entries.filter((s) => s.sport === reference.sport && s.subSport === reference.subSport && isNum(s.distance) &&
    Math.abs(s.distance - reference.distance!) / reference.distance! <= 0.100000001).sort((a, b) => b.startTime.localeCompare(a.startTime));
}

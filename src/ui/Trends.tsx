import { useEffect, useMemo, useRef, useState } from 'react';
import type { AthleteSettings, ZoneSet } from '../fit/types';
import type { LibraryState } from '../library/useLibrary';
import { hasCurrentHistory, historyEntries, historySettingsKey, type HistoryEntry } from '../history/model';
import { dateRange, inRange, previousRange, recordsBySport, similarSessions, totals, weeklyTotals, weeklyZones, zoneGroups, type Period, type Week, type ZoneGroup } from '../history/aggregate';
import { fmtDuration, fmtKm, fmtNum, fmtSpeed, humanize, isNum } from '../fit/format';
import { Empty, Tag } from './common';
import { HistoryChart } from './HistoryChart';

const ZONE_COLORS = ['--series-aqua', '--zone-aerobic', '--series-cadence', '--zone-heavy', '--series-orange', '--zone-severe', '--series-violet', '--series-magenta'];
type VolumeMetric = 'distance' | 'timerTime' | 'sessions';
const METRICS: { id: VolumeMetric; label: string; units: string; scale: number; color: string }[] = [
  { id: 'distance', label: 'Distance', units: 'km', scale: 1000, color: '--series-pace' },
  { id: 'timerTime', label: 'Time', units: 'hours', scale: 3600, color: '--series-aqua' },
  { id: 'sessions', label: 'Sessions', units: 'sessions', scale: 1, color: '--series-violet' },
];

function zoneLabel(zone: ZoneSet): string {
  const threshold = zone.basis?.match(/\d+(?:\.\d+)?/)?.[0];
  const definition = zone.id === 'hr_computed' ? 'Heart rate · HRmax' : zone.id === 'hr_lthr' ? 'Heart rate · LTHR' : zone.id === 'power_computed' ? 'Power · FTP' : zone.title;
  return `${definition}${threshold ? ` ${threshold}` : ''}`;
}

function WeeklyVolume({ weeks }: { weeks: Week[] }) {
  const [metric, setMetric] = useState<VolumeMetric>('distance');
  const selected = METRICS.find((m) => m.id === metric)!;
  const labels = useMemo(() => weeks.map((w) => w.start), [weeks]);
  const datasets = useMemo(() => [{ label: selected.label, values: weeks.map((w) => metric === 'distance' && w.sessions > 0 && !w.distanceSessions ? null : w[metric] / selected.scale), color: selected.color }], [weeks, metric, selected]);
  return <section className="card">
    <div className="card-head"><h3>Weekly volume<Tag kind="computed" /></h3><div className="segmented" role="group" aria-label="Weekly metric">{METRICS.map((m) => <button key={m.id} aria-pressed={metric === m.id} className={metric === m.id ? 'active' : ''} onClick={() => setMetric(m.id)}>{m.label}</button>)}</div></div>
    <HistoryChart labels={labels} datasets={datasets} units={selected.units} label={`Weekly ${selected.label.toLowerCase()}`} />
    <p className="muted small">Weeks start on Monday. Empty weeks are included; boundary weeks may cover only part of the selected period.</p>
    <details className="details"><summary>Weekly totals</summary><div className="table-wrap"><table className="data" aria-label="Weekly totals"><thead><tr><th>Week of</th><th>Sessions</th><th>Distance</th><th>Timer time</th></tr></thead><tbody>{weeks.map((w) => <tr key={w.start}><td>{w.start}{w.partial ? ' · partial' : ''}</td><td className="num">{w.sessions}</td><td className="num">{w.sessions && !w.distanceSessions ? '–' : fmtKm(w.distance)}</td><td className="num">{fmtDuration(w.timerTime)}</td></tr>)}</tbody></table></div></details>
  </section>;
}

function Intensity({ groups, weeks, count, onSettings }: { groups: ZoneGroup[]; weeks: Week[]; count: number; onSettings: () => void }) {
  const [selectedKey, setSelectedKey] = useState('');
  const group = groups.find((g) => g.key === selectedKey) ?? groups[0];
  const values = useMemo(() => group ? weeklyZones(group, weeks) : [], [group, weeks]);
  const labels = useMemo(() => weeks.map((w) => w.start), [weeks]);
  const datasets = useMemo(() => group ? values.map((v, i) => ({ label: group.zone.buckets[i].label, values: v.map((s) => s / 60), color: ZONE_COLORS[i % ZONE_COLORS.length] })) : [], [values, group]);
  const seconds = values.map((v) => v.reduce((sum, n) => sum + n, 0));
  const total = seconds.reduce((sum, n) => sum + n, 0);
  return <section className="card">
    <h3>Time in zones<Tag kind="computed" /></h3>
    {!group ? <><Empty text="No computed zones in this selection. Set max HR, LTHR or FTP to enable zones for recordings with heart-rate or power data." /><button className="btn" onClick={onSettings}>Athlete settings</button></> : <>
      <label className="field history-zone-select"><span className="field-label">Zone definition</span><select className="select" value={group.key} onChange={(e) => setSelectedKey(e.target.value)}>{groups.map((g) => <option value={g.key} key={g.key}>{zoneLabel(g.zone)}</option>)}</select></label>
      <p className="muted small">{group.entries.length} of {count} sessions share this definition · {fmtDuration(total)} of classified time.</p>
      <details className="details"><summary>About these zones</summary><p>{group.zone.title.replace(/, computed/g, '')}. Basis: {group.zone.basis?.replace(/zones_target in file/g, 'the FIT file')}.</p><p>Only sessions with the same zone boundaries are combined. Missing readings are excluded. HRmax is maximum heart rate, LTHR is lactate threshold heart rate, and FTP is functional threshold power.</p></details>
      <HistoryChart labels={labels} datasets={datasets} units="min" label="Weekly time in zones" stacked />
      <details className="details"><summary>Zone totals</summary><div className="table-wrap"><table className="data" aria-label="Zone totals"><thead><tr><th>Zone</th><th>Time</th><th>Share</th></tr></thead><tbody>{group.zone.buckets.map((b, i) => <tr key={b.zone}><td>{b.label}</td><td className="num">{fmtDuration(seconds[i])}</td><td className="num">{fmtNum(total > 0 ? seconds[i] / total * 100 : 0, 1)}%</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}

function ActivityLink({ entry, library }: { entry: HistoryEntry; library: LibraryState }) {
  return <button className="history-activity-link" disabled={library.busy} onClick={() => void library.open(entry.activityId, entry.index)} title={`${entry.fileName} · session ${entry.index + 1}`}>{entry.title}<span>{entry.localDate} · {entry.sportLabel} · session {entry.index + 1}</span></button>;
}

function Records({ entries, library }: { entries: HistoryEntry[]; library: LibraryState }) {
  const groups = useMemo(() => recordsBySport(entries), [entries]);
  return <section className="card">
    <h3>Records in this period<Tag kind="computed" /></h3>
    <p className="muted small">Best recorded efforts in the selected history, grouped by sport. Effort times use timer time and exclude pauses. Open a source activity to inspect the recording.</p>
    {!groups.length && <Empty text="No distance efforts or power records are available in this selection." />}
    {groups.map((group) => <div className="history-sport-records" key={group.sport}><h4>{humanize(group.sport)}</h4><div className="history-record-grid">
      {group.efforts.length > 0 && <div className="table-wrap history-record-table"><table className="data" aria-label={`${humanize(group.sport)} fastest efforts`}><thead><tr><th>Distance</th><th>Best time</th><th>Pace / speed</th><th>Source activity</th></tr></thead><tbody>{group.efforts.map(({ entry, effort }) => <tr key={effort.distance}><td>{effort.name}</td><td className="num">{fmtDuration(effort.time)}</td><td className="num">{fmtSpeed(effort.speed, entry.speedMode)}</td><td><ActivityLink entry={entry} library={library} /><span className="history-effort-start muted small">From {fmtKm(effort.startDist)} · timer {fmtDuration(effort.startTimer)}</span></td></tr>)}</tbody></table></div>}
      {group.powers.length > 0 && <div className="table-wrap history-record-table"><table className="data" aria-label={`${humanize(group.sport)} peak power`}><thead><tr><th>Duration</th><th>Peak average</th><th>Source activity</th></tr></thead><tbody>{group.powers.map(({ entry, power }) => <tr key={power.windowSec}><td>{power.label}</td><td className="num">{fmtNum(power.watts, 0)} W</td><td><ActivityLink entry={entry} library={library} /><span className="history-effort-start muted small">From timer {fmtDuration(power.startTimer)}</span></td></tr>)}</tbody></table></div>}
    </div>
      <div className="history-record-cards">
        {group.efforts.length > 0 && <h4 className="record-type">Fastest efforts</h4>}
        {group.efforts.map(({ entry, effort }) => <article className="history-record-card" key={`effort-${effort.distance}`}>
          <div className="record-result"><span>{effort.name}</span><strong className="num">{fmtDuration(effort.time)}</strong></div>
          <p className="muted small">{fmtSpeed(effort.speed, entry.speedMode)}</p>
          <ActivityLink entry={entry} library={library} />
          <details className="details"><summary>Effort details</summary><p className="small">From {fmtKm(effort.startDist)} · timer {fmtDuration(effort.startTimer)}</p></details>
        </article>)}
        {group.powers.length > 0 && <h4 className="record-type">Peak average power</h4>}
        {group.powers.map(({ entry, power }) => <article className="history-record-card" key={`power-${power.windowSec}`}>
          <div className="record-result"><span>{power.label}</span><strong className="num">{fmtNum(power.watts, 0)} W</strong></div>
          <ActivityLink entry={entry} library={library} />
          <details className="details"><summary>Effort details</summary><p className="small">From timer {fmtDuration(power.startTimer)}</p></details>
        </article>)}
      </div>
    </div>)}
  </section>;
}

function SimilarActivities({ entries, library }: { entries: HistoryEntry[]; library: LibraryState }) {
  const [referenceKey, setReferenceKey] = useState('');
  const candidates = useMemo(() => entries.filter((s) => isNum(s.distance) && s.distance > 0).slice().reverse(), [entries]);
  const reference = candidates.find((s) => s.key === referenceKey) ?? candidates[0];
  const similar = useMemo(() => reference ? similarSessions(entries, reference) : [], [entries, reference]);
  return <section className="card">
    <h3>Similar activities<Tag kind="computed" /></h3>
    {!reference ? <Empty text="Import activities with distance data to compare similar sessions." /> : <>
      <label className="field history-reference"><span className="field-label">Reference session</span><select className="select" value={reference.key} onChange={(e) => setReferenceKey(e.target.value)}>{candidates.map((s) => <option key={s.key} value={s.key}>{s.localDate} · {s.title} · {s.sportLabel} · {fmtKm(s.distance)} · session {s.index + 1}</option>)}</select></label>
      <p className="muted small">Same sport and activity type, within 10% of the reference distance. Use a shared route tag to narrow the comparison. Terrain and weather are not matched.</p>
      {similar.length < 2 ? <Empty text="No other similar sessions in this period. Try a wider period or another reference." /> : <><div className="table-wrap history-comparison-table"><table className="data" aria-label="Similar activities"><thead><tr><th>Activity</th><th>Distance</th><th>Timer time</th><th>Avg pace / speed</th><th>Avg HR</th><th>Avg power</th><th>Ascent</th></tr></thead><tbody>{similar.map((s) => <tr key={s.key} className={s.key === reference.key ? 'history-reference-row' : undefined}><td><ActivityLink entry={s} library={library} />{s.key === reference.key && <span className="tag">reference</span>}</td><td className="num">{fmtKm(s.distance)}</td><td className="num">{fmtDuration(s.timerTime)}</td><td className="num">{fmtSpeed(s.avgSpeed, s.speedMode)}</td><td className="num">{isNum(s.avgHr) ? `${fmtNum(s.avgHr, 0)} bpm` : '–'}</td><td className="num">{isNum(s.avgPower) ? `${fmtNum(s.avgPower, 0)} W` : '–'}</td><td className="num">{isNum(s.ascent) ? `${fmtNum(s.ascent, 0)} m` : '–'}</td></tr>)}</tbody></table></div>
        <div className="history-comparison-cards">
          {similar.map((s) => <article key={s.key} className={`history-record-card${s.key === reference.key ? ' history-reference-row' : ''}`}>
            {s.key === reference.key && <span className="tag">reference</span>}
            <ActivityLink entry={s} library={library} />
            <dl className="comparison-stats">
              <div><dt>Distance</dt><dd>{fmtKm(s.distance)}</dd></div>
              <div><dt>Timer time</dt><dd>{fmtDuration(s.timerTime)}</dd></div>
              <div><dt>Avg pace / speed</dt><dd>{fmtSpeed(s.avgSpeed, s.speedMode)}</dd></div>
            </dl>
            <details className="details"><summary>More metrics</summary><dl className="comparison-stats">
              <div><dt>Avg HR</dt><dd>{isNum(s.avgHr) ? `${fmtNum(s.avgHr, 0)} bpm` : '–'}</dd></div>
              <div><dt>Avg power</dt><dd>{isNum(s.avgPower) ? `${fmtNum(s.avgPower, 0)} W` : '–'}</dd></div>
              <div><dt>Ascent</dt><dd>{isNum(s.ascent) ? `${fmtNum(s.ascent, 0)} m` : '–'}</dd></div>
            </dl></details>
          </article>)}
        </div>
      </>}
    </>}
  </section>;
}

function change(current: number, previous: number, previousCount: number): string {
  if (!previousCount) return 'No sessions in the previous period';
  if (previous <= 0) return 'No comparable previous value';
  const delta = (current / previous - 1) * 100;
  return `${delta > 0 ? '+' : ''}${fmtNum(delta, 1)}% vs previous period`;
}

export function Trends({ library, settings, active, onLibrary, onSettings }: { library: LibraryState; settings: AthleteSettings; active: boolean; onLibrary: () => void; onSettings: () => void }) {
  const [sport, setSport] = useState('');
  const [tag, setTag] = useState('');
  const [period, setPeriod] = useState<Period>('12w');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const attempted = useRef('');
  const entries = useMemo(() => historyEntries(library.activities, settings), [library.activities, settings]);
  const missing = library.activities.filter((a) => !hasCurrentHistory(a, settings)).length;
  const generation = `${historySettingsKey(settings)}:${library.activities.map((a) => a.id).sort().join(',')}`;
  useEffect(() => {
    if (active && !library.loading && !library.busy && missing && attempted.current !== generation) {
      attempted.current = generation;
      void library.prepareHistory();
    }
  }, [active, library.loading, library.busy, missing, generation, library.prepareHistory]);
  const sports = useMemo(() => [...new Set(entries.map((s) => s.sport))].sort(), [entries]);
  const tags = useMemo(() => [...new Set(entries.flatMap((s) => s.tags))].sort(), [entries]);
  const matching = useMemo(() => entries.filter((s) => (!sport || s.sport === sport) && (!tag || s.tags.includes(tag))), [entries, sport, tag]);
  const range = useMemo(() => dateRange(matching, period, custom), [matching, period, custom]);
  const selected = useMemo(() => range ? inRange(matching, range) : [], [matching, range]);
  const previous = useMemo(() => range ? previousRange(range) : undefined, [range]);
  const prevTotals = useMemo(() => totals(previous ? inRange(matching, previous) : []), [matching, previous]);
  const current = useMemo(() => totals(selected), [selected]);
  const weeks = useMemo(() => range ? weeklyTotals(selected, range) : [], [selected, range]);
  const zones = useMemo(() => zoneGroups(selected), [selected]);
  const reset = () => { setSport(''); setTag(''); setPeriod('12w'); };
  return <div className="stack history" hidden={!active} aria-busy={library.busy || library.loading}>
    <div className="page-head"><div className="titles"><h2>Trends and records</h2><p className="muted">Your training over time, from the activities saved in your library.</p></div></div>
    {!library.activities.length && !library.loading ? <section className="card history-empty"><h3>Your history starts with an activity.</h3><p className="muted">Add FIT files to see weekly volume, time in zones and your best recorded efforts.</p><button className="btn primary" onClick={onLibrary}>Go to activity library</button></section> : <>
      {missing > 0 && <div className="card history-preparing" role="status"><span>{missing} {missing === 1 ? 'activity needs' : 'activities need'} analysis before appearing in these totals.</span>{!library.busy && <button className="btn" onClick={() => void library.prepareHistory()}>Update history</button>}</div>}
      {entries.length > 0 && <>
        <section className="card" aria-label="History filters"><div className="history-filters">
          <label className="field"><span className="field-label">Sport</span><select className="select" value={sport} onChange={(e) => setSport(e.target.value)}><option value="">All sports</option>{sports.map((s) => <option value={s} key={s}>{humanize(s)}</option>)}</select></label>
          <label className="field"><span className="field-label">Tag</span><select className="select" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">All tags</option>{tags.map((t) => <option value={t} key={t}>{t}</option>)}</select></label>
          <label className="field"><span className="field-label">Period</span><select className="select" value={period} onChange={(e) => { const next = e.target.value as Period; if (next === 'custom' && range) setCustom(range); setPeriod(next); }}><option value="4w">4 weeks to latest activity</option><option value="12w">12 weeks to latest activity</option><option value="52w">52 weeks to latest activity</option><option value="all">All history</option><option value="custom">Custom dates</option></select></label>
          {period === 'custom' && <><label className="field"><span className="field-label">From date</span><input type="date" className="input" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label><label className="field"><span className="field-label">To date</span><input type="date" className="input" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label></>}
        </div><div className="history-filter-summary"><span className="muted small">{range ? `${range.from} — ${range.to}` : 'Choose a valid date range.'}{period !== 'custom' && period !== 'all' && ' · ending at the latest matching session'}</span><button className="btn" onClick={reset}>Reset filters</button></div></section>
        {!selected.length ? <section className="card"><Empty text="No sessions match this period and these filters." /></section> : <>
          <div className="tiles history-tiles">
            <div className="tile" data-testid="history-sessions"><div className="tile-head"><span className="tile-label">Sessions</span></div><div className="tile-value">{current.sessions}</div><div className="tile-sub">{period === 'all' ? 'Across your saved history' : change(current.sessions, prevTotals.sessions, prevTotals.sessions)}</div></div>
            <div className="tile" data-testid="history-distance"><div className="tile-head"><span className="tile-label">Distance</span></div><div className="tile-value">{current.distanceSessions ? fmtNum(current.distance / 1000, 1) : '–'}<span className="tile-unit">km</span></div><div className="tile-sub">{current.distanceSessions < current.sessions ? `${current.distanceSessions} of ${current.sessions} sessions have distance` : period === 'all' ? 'Total recorded distance' : change(current.distance, prevTotals.distance, prevTotals.sessions)}</div></div>
            <div className="tile" data-testid="history-time"><div className="tile-head"><span className="tile-label">Timer time</span></div><div className="tile-value">{fmtDuration(current.timerTime)}</div><div className="tile-sub">{period === 'all' ? 'Excludes pauses' : change(current.timerTime, prevTotals.timerTime, prevTotals.sessions)}</div></div>
            <div className="tile"><div className="tile-head"><span className="tile-label">Active weeks</span></div><div className="tile-value">{weeks.filter((w) => w.sessions > 0).length}<span className="tile-unit">/ {weeks.length}</span></div><div className="tile-sub">At least one selected session</div></div>
          </div>
          {period !== 'all' && previous && <p className="muted small">Previous period: {previous.from} — {previous.to}. All totals use session start dates and timer time; multi-sport files contribute only their matching sessions.</p>}
          <div className="history-charts"><WeeklyVolume weeks={weeks} /><Intensity groups={zones} weeks={weeks} count={selected.length} onSettings={onSettings} /></div>
          <Records entries={selected} library={library} />
          <SimilarActivities entries={selected} library={library} />
          <p className="muted small">Totals are calculated from imported sessions and their local start dates. Multi-sport files contribute each matching session separately. Computed zones use your current athlete settings, falling back to parameters in each FIT file. Different zone definitions are kept separate.</p>
        </>}
      </>}
    </>}
  </div>;
}

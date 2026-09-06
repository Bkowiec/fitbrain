import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, type ChartConfiguration } from 'chart.js';
import type { PredictionBasis, SessionAnalysis } from '../fit/types';
import { fmtDuration, fmtFixed, fmtNum, fmtPaceSeconds, isNum, parseDuration } from '../fit/format';
import { predictionRows, timeForVdot, trainingPaces } from '../fit/predict';
import { courseFromSamples, parseGpx, type Course } from '../course/gpx';
import { buildPlan, type PacingPlan } from '../course/pacing';
import { buildFitCourse, buildGpxCourse, planMarkdown } from '../course/exportCourse';
import { Empty, Table, Tag } from './common';
import { usePrefersDark } from './Charts';

const SPLIT_OPTIONS = [{ label: '1 km', m: 1000 }, { label: '1 mile', m: 1609.34 }, { label: '2 km', m: 2000 }, { label: '5 km', m: 5000 }];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function download(name: string, data: string | Uint8Array, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = name;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PlanChart({ plan, dark }: { plan: PacingPlan; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const grid = cssVar('--grid');
    const ink = cssVar('--text-muted');
    const eleColor = cssVar('--series-alt');
    const paceColor = cssVar('--series-pace');
    const step = Math.max(1, Math.ceil(plan.points.length / 800));
    const pts = plan.points.filter((_, i) => i % step === 0 || i === plan.points.length - 1);
    const ele = plan.hasElevation ? pts.map((p) => ({ x: p.dist / 1000, y: p.ele ?? 0 })) : [];
    const pace = pts.slice(1).map((p) => ({ x: p.dist / 1000, y: p.pace / 60 }));
    const cfg: ChartConfiguration<'line', { x: number; y: number }[]> = {
      type: 'line',
      data: {
        datasets: [
          { label: 'Target pace', data: pace, borderColor: paceColor, backgroundColor: paceColor + '1a', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, stepped: false, tension: 0.1, yAxisID: 'pace', fill: false },
          ...(plan.hasElevation ? [{ label: 'Elevation', data: ele, borderColor: eleColor, backgroundColor: eleColor + '33', borderWidth: 1, pointRadius: 0, pointHoverRadius: 0, tension: 0.1, yAxisID: 'ele', fill: 'origin' as const }] : []),
        ],
      },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: ink, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: (items) => (isNum(items[0]?.parsed.x) ? `${fmtNum(items[0].parsed.x, 2)} km` : ''),
              label: (item) => {
                const y = item.parsed.y;
                if (!isNum(y)) return '';
                return item.dataset.yAxisID === 'pace' ? `Target pace: ${fmtPaceSeconds(y * 60)} min/km` : `Elevation: ${fmtNum(y, 0)} m`;
              },
            },
          },
        },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Distance (km)', color: ink }, grid: { color: grid }, ticks: { color: ink, maxTicksLimit: 14 } },
          pace: { position: 'left', reverse: true, title: { display: true, text: 'min/km', color: ink }, grid: { color: grid }, ticks: { color: ink, callback: (v) => fmtPaceSeconds(Number(v) * 60) } },
          ...(plan.hasElevation ? { ele: { position: 'right' as const, title: { display: true, text: 'm', color: ink }, grid: { display: false }, ticks: { color: ink } } } : {}),
        },
      },
    };
    const chart = new Chart(canvas, cfg);
    return () => chart.destroy();
  }, [plan, dark]);
  return (
    <section className="card chart-card">
      <h3>Target pace along the course <span className="muted">(even effort, grade adjusted)</span></h3>
      <div className="chart-box" style={{ height: 280 }}><canvas ref={ref} role="img" aria-label="Pacing plan chart" /></div>
    </section>
  );
}

function Predictions({ s }: { s: SessionAnalysis }) {
  const p = s.predictions;
  const [basisIdx, setBasisIdx] = useState(() => (p ? Math.max(0, p.bases.indexOf(p.basis)) : 0));
  if (!p) return null;
  const basis: PredictionBasis = p.bases[Math.min(basisIdx, p.bases.length - 1)];
  const rows = predictionRows(basis);
  const paces = trainingPaces(basis.vdot);
  const pace = (sec: number, d: number) => fmtPaceSeconds(sec / (d / 1000));
  return (
    <section className="card">
      <div className="card-head">
        <h3>Race predictions<Tag kind="computed" /></h3>
        <label className="inline muted small">Basis
          <select className="select" value={basisIdx} onChange={(e) => setBasisIdx(Number(e.target.value))}>
            {p.bases.map((b, i) => <option key={i} value={i}>{b.name} · {fmtDuration(b.time)} · {b.source === 'race' ? 'recent race' : 'fastest effort here'} · VDOT {fmtNum(b.vdot, 1)}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">
        Riegel scales the basis time by (distance ratio)^{p.riegelExponent}; the VDOT method (Daniels &amp; Gilbert) turns the basis into a pseudo-VO2max and solves it for each distance.
        {basis.source === 'effort' ? ' Efforts inside a training run are slower than a race, so treat these as conservative. Enter a real race in Athlete settings for a better basis.' : ''}
      </p>
      <div className="tiles">
        <div className="tile"><div className="tile-label">VDOT</div><div className="tile-value">{fmtNum(basis.vdot, 1)}</div><div className="tile-sub">{basis.name} in {fmtDuration(basis.time)}</div></div>
        {rows.map((r) => <div className="tile" key={r.name}><div className="tile-label">{r.name}</div><div className="tile-value">{fmtDuration(r.vdot)}</div><div className="tile-sub">{pace(r.vdot, r.distance)} min/km · Riegel {fmtDuration(r.riegel)}</div></div>)}
      </div>
      <Table headers={['Distance', 'Riegel', 'VDOT', 'Pace (VDOT)']} rows={rows.map((r) => [r.name, fmtDuration(r.riegel), fmtDuration(r.vdot), `${pace(r.vdot, r.distance)} min/km`])} />
      <h4 className="subhead">Daniels training paces at VDOT {fmtNum(basis.vdot, 1)}</h4>
      <Table headers={['Zone', '% VO2max', 'Pace range (min/km)']} rows={paces.map((t) => [`${t.name} · ${t.label}`, `${fmtNum(t.pctLow, 0)}–${fmtNum(t.pctHigh, 0)} %`, `${fmtPaceSeconds(t.paceSlow)}–${fmtPaceSeconds(t.paceFast)}`])} />
    </section>
  );
}

export function RacePacing({ s }: { s: SessionAnalysis }) {
  const dark = usePrefersDark();
  const [course, setCourse] = useState<Course | null>(null);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [goalText, setGoalText] = useState('');
  const [splitMeters, setSplitMeters] = useState(1000);
  const [copied, setCopied] = useState(false);
  const ownRoute = useMemo(() => courseFromSamples(s.samples, `${s.sportLabel} route`), [s]);

  const basis = s.predictions?.basis;
  const defaultGoal = (c: Course): number => {
    if (basis) return Math.round(timeForVdot(c.distance, basis.vdot) / 30) * 30;
    if (isNum(s.distance) && s.distance > 0 && s.timerTime > 0) return Math.round(((c.distance / s.distance) * s.timerTime) / 30) * 30;
    return Math.round((c.distance / 1000) * 330);
  };
  const loadCourse = (c: Course) => { setCourse(c); setCourseError(null); setGoalText(fmtDuration(defaultGoal(c))); setCopied(false); };
  const onGpx = async (file: File) => {
    try { loadCourse(parseGpx(await file.text(), file.name.replace(/\.gpx$/i, ''))); }
    catch (e) { setCourseError(e instanceof Error ? e.message : String(e)); setCourse(null); }
  };
  // Dev convenience: `&course=own` loads the activity's own route, `&course=/path.gpx` fetches a GPX served by Vite.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const c = new URLSearchParams(window.location.search).get('course');
    if (!c) return;
    if (c === 'own') { if (ownRoute) loadCourse(ownRoute); return; }
    fetch(c).then(async (r) => { if (!r.ok) throw new Error(`Could not fetch ${c}: ${r.status}`); loadCourse(parseGpx(await r.text(), c.split('/').pop()?.replace(/\.gpx$/i, '') ?? 'course')); }).catch((e) => setCourseError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownRoute]);
  const goalSec = parseDuration(goalText);
  const plan = useMemo(() => {
    if (!course || !goalSec || goalSec < 60) return null;
    try { return buildPlan(course, { goalTimeSec: goalSec, splitMeters }); } catch { return null; }
  }, [course, goalSec, splitMeters]);

  const safeName = (plan?.name ?? 'course').replace(/[^\w\-. ]+/g, '_').trim() || 'course';
  const exportFit = () => plan && download(`${safeName}.fit`, buildFitCourse(plan, { name: plan.name, sport: 'running' }), 'application/octet-stream');
  const exportGpx = () => plan && download(`${safeName}-plan.gpx`, buildGpxCourse(plan, { name: plan.name }), 'application/gpx+xml');
  const copyMd = async () => {
    if (!plan) return;
    try { await navigator.clipboard.writeText(planMarkdown(plan)); setCopied(true); } catch { /* clipboard unavailable */ }
  };

  if (!s.predictions && !ownRoute) return <Empty text="Race predictions need at least a 1 km effort with distance data; the pacing plan needs a GPX course. Load a GPX below once the activity has distance." />;

  return (
    <div className="stack">
      <Predictions s={s} />

      <section className="card">
        <div className="card-head">
          <h3>Pacing plan <span className="muted">(even effort over the course profile)</span><Tag kind="computed" /></h3>
          <div className="inline">
            {ownRoute && <button className="btn" onClick={() => loadCourse(ownRoute)}>Use this activity's route</button>}
            <label className="btn">Load GPX course<input type="file" accept=".gpx,application/gpx+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onGpx(f); e.target.value = ''; }} /></label>
          </div>
        </div>
        <p className="muted small">
          Load a course (GPX from any route planner, or this activity's own track), set a goal time and get a split-by-split target pace that keeps the effort even on climbs and descents.
          Grade cost follows Minetti et al.; downhill gains are damped to what runners actually realise. Export the plan as a FIT course (Garmin: Virtual Partner follows the planned times and each split appears as a course point with its target pace) or as GPX with waypoints (Suunto, COROS, phone apps).
        </p>
        {courseError && <div className="alert" role="alert">{courseError}</div>}
        {course && (
          <>
            <div className="form-grid">
              <label className="field"><span className="field-label">Course</span><span>{course.name} · {fmtFixed(course.distance / 1000, 2)} km{course.hasElevation ? '' : ' · no elevation data, flat plan'}</span></label>
              <label className="field"><span className="field-label">Goal time <span className="muted">(h:mm:ss)</span></span>
                <input className="input" type="text" inputMode="numeric" value={goalText} onChange={(e) => { setGoalText(e.target.value); setCopied(false); }} />
                <span className="muted small">{goalSec ? `${fmtPaceSeconds(goalSec / (course.distance / 1000))} min/km average` : 'enter a time like 45:30 or 3:29:59'}{basis ? ` · VDOT ${fmtNum(basis.vdot, 1)} suggests ${fmtDuration(timeForVdot(course.distance, basis.vdot))}` : ''}</span>
              </label>
              <label className="field"><span className="field-label">Splits</span>
                <select className="select" value={splitMeters} onChange={(e) => setSplitMeters(Number(e.target.value))}>{SPLIT_OPTIONS.map((o) => <option key={o.m} value={o.m}>{o.label}</option>)}</select>
              </label>
            </div>
            {plan && (
              <>
                <div className="tiles">
                  <div className="tile"><div className="tile-label">Distance</div><div className="tile-value">{fmtFixed(plan.distance / 1000, 2)}</div><div className="tile-sub">km · effort-equivalent {fmtFixed(plan.effortDistance / 1000, 2)} km</div></div>
                  <div className="tile"><div className="tile-label">Ascent / descent</div><div className="tile-value">+{fmtNum(plan.gain, 0)}</div><div className="tile-sub">−{fmtNum(plan.loss, 0)} m</div></div>
                  <div className="tile"><div className="tile-label">Goal</div><div className="tile-value">{fmtDuration(plan.goalTime)}</div><div className="tile-sub">{fmtPaceSeconds(plan.avgPace)} min/km average</div></div>
                  <div className="tile"><div className="tile-label">Flat-equivalent pace</div><div className="tile-value">{fmtPaceSeconds(plan.flatPace)}</div><div className="tile-sub">min/km at constant effort</div></div>
                  <div className="tile"><div className="tile-label">Pace range</div><div className="tile-value">{fmtPaceSeconds(plan.minPace)}–{fmtPaceSeconds(plan.maxPace)}</div><div className="tile-sub">min/km, steepest descent to steepest climb</div></div>
                </div>
                <div className="inline" style={{ marginBottom: 12 }}>
                  <button className="btn primary" onClick={exportFit}>Download FIT course</button>
                  <button className="btn" onClick={exportGpx}>Download GPX with split waypoints</button>
                  <button className="btn" onClick={copyMd}>{copied ? 'Copied ✓' : 'Copy plan as Markdown'}</button>
                </div>
              </>
            )}
          </>
        )}
        {!course && <Empty text="No course loaded yet." />}
      </section>

      {plan && <PlanChart plan={plan} dark={dark} />}

      {plan && (
        <section className="card">
          <h3>Splits every {plan.splitMeters >= 1000 ? `${fmtNum(plan.splitMeters / 1000, plan.splitMeters % 1000 ? 2 : 0)} km` : `${plan.splitMeters} m`}</h3>
          <Table
            headers={['#', 'At km', 'Target pace (min/km)', 'Split time', 'Elapsed', 'Asc / Desc m', 'Avg grade', 'Altitude at end']}
            rows={plan.splits.map((sp) => [sp.index, fmtFixed(sp.endDist / 1000, 2), fmtPaceSeconds(sp.pace), fmtDuration(sp.time), fmtDuration(sp.cumTime), `+${fmtNum(sp.gain, 0)} / −${fmtNum(sp.loss, 0)}`, `${fmtFixed(sp.avgGrade, 1)} %`, isNum(sp.eleEnd) ? `${fmtNum(sp.eleEnd, 0)} m` : undefined])}
          />
          <p className="muted small">On the watch: Garmin shows each split as a course point named like “12k 4:35 55:02” (distance, target pace, planned elapsed time) and the Virtual Partner runs the planned schedule. In GPX the same labels are waypoints.</p>
        </section>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables, type ChartConfiguration, type ChartDataset } from 'chart.js';
import type { SeriesPoint, SessionAnalysis } from '../fit/types';
import { fmtNum, fmtPaceSeconds, isNum } from '../fit/format';
import { DFA_AEROBIC, DFA_ANAEROBIC, DFA_FIELD_KEY } from '../fit/dfa';
import { ZONESENSE_AEROBIC, ZONESENSE_ANAEROBIC, ZONESENSE_FIELD_KEY } from '../fit/zonesense';
import { Empty } from './common';
import { isDarkNow, subscribeTheme } from './theme';

Chart.register(...registerables);

export type XMode = 'time' | 'distance';

export interface MetricDef {
  id: string;
  title: string;
  units: string;
  get: (p: SeriesPoint) => number | undefined;
  reverse?: boolean;
  fmt?: (v: number) => string;
  cssVar: string;
  fill?: boolean;
  refLines?: { y: number; label: string }[];
}

/** Effective dark mode: the explicit theme choice on <html data-theme>, otherwise the system preference. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => isDarkNow());
  useEffect(() => subscribeTheme(() => setDark(isDarkNow())), []);
  return dark;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const fontUi = () => ({ family: cssVar('--font-ui') || 'system-ui', size: 11 });
const fontNum = () => ({ family: cssVar('--font-num') || 'monospace', size: 10.5 });

export function LineChart({ def, series, xMode, dark, height = 240 }: { def: MetricDef; series: SeriesPoint[]; xMode: XMode; dark: boolean; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const color = cssVar(def.cssVar);
    const grid = cssVar('--grid');
    const ink = cssVar('--text-muted');
    const points = series
      .map((p) => ({ x: xMode === 'time' ? p.x : p.km, y: def.get(p) }))
      .filter((p): p is { x: number; y: number } => isNum(p.x) && isNum(p.y));
    const fmt = def.fmt ?? ((v: number) => fmtNum(v, 0));
    const xs = points.map((p) => p.x);
    const xMin = xs.length ? Math.min(...xs) : 0;
    const xMax = xs.length ? Math.max(...xs) : 1;
    const datasets: ChartDataset<'line', { x: number; y: number }[]>[] = [{
      data: points, borderColor: color, backgroundColor: color + '1a', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4,
      pointHoverBackgroundColor: color, tension: 0.15, fill: def.fill ? 'origin' : false, spanGaps: false,
    }];
    for (const r of def.refLines ?? []) {
      datasets.push({ data: [{ x: xMin, y: r.y }, { x: xMax, y: r.y }], borderColor: ink, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0, fill: false });
    }
    const cfg: ChartConfiguration<'line', { x: number; y: number }[]> = {
      type: 'line',
      data: { datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: fontNum(), bodyFont: fontNum(),
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => {
                const x = items[0]?.parsed.x;
                if (!isNum(x)) return '';
                if (xMode === 'time') { const m = Math.floor(x); const s = Math.round((x - m) * 60); return `${m}:${String(s).padStart(2, '0')} min`; }
                return `${fmtNum(x, 2)} km`;
              },
              label: (item) => `${def.title}: ${isNum(item.parsed.y) ? fmt(item.parsed.y) : '–'} ${def.units}`,
            },
          },
        },
        scales: {
          x: { type: 'linear', title: { display: true, text: xMode === 'time' ? 'Timer time (min)' : 'Distance (km)', color: ink, font: fontUi() }, grid: { color: grid }, ticks: { color: ink, maxTicksLimit: 12, font: fontNum() } },
          y: { reverse: !!def.reverse, title: { display: true, text: def.units, color: ink, font: fontUi() }, grid: { color: grid }, ticks: { color: ink, callback: (v) => fmt(Number(v)), font: fontNum() } },
        },
      },
    };
    const chart = new Chart(canvas, cfg);
    return () => chart.destroy();
  }, [def, series, xMode, dark]);
  return (
    <section className="card chart-card">
      <h3>{def.title} <span className="muted">({def.units})</span>{def.refLines?.length ? <span className="muted small"> · dashed: {def.refLines.map((r) => r.label).join(', ')}</span> : null}</h3>
      <div className="chart-box" style={{ height }}><canvas ref={ref} role="img" aria-label={`${def.title} over ${xMode}`} /></div>
    </section>
  );
}

const DEV_COLORS = ['--series-violet', '--series-magenta', '--series-yellow', '--series-aqua', '--series-blue', '--series-orange'];

export function standardMetricDefs(s: SessionAnalysis): MetricDef[] {
  const has = (f: string) => s.streams.some((st) => st.field === f && st.coverage > 0.02);
  const out: MetricDef[] = [];
  if (has('hr')) out.push({ id: 'hr', title: 'Heart rate', units: 'bpm', get: (p) => p.hr, cssVar: '--series-hr' });
  if (has('speed')) {
    if (s.speedMode === 'pace_km') out.push({ id: 'pace', title: 'Pace', units: 'min/km', get: (p) => p.pace, reverse: true, fmt: (v) => fmtPaceSeconds(v * 60), cssVar: '--series-pace' });
    else out.push({ id: 'speed', title: 'Speed', units: 'km/h', get: (p) => p.speed, fmt: (v) => fmtNum(v, 1), cssVar: '--series-pace' });
  }
  if (has('power')) out.push({ id: 'power', title: 'Power', units: 'W', get: (p) => p.power, cssVar: '--series-power' });
  if (has('cadence')) out.push({ id: 'cadence', title: s.isRunLike ? 'Cadence (steps/min)' : 'Cadence', units: s.isRunLike ? 'spm' : 'rpm', get: (p) => (isNum(p.cadence) ? (s.isRunLike ? p.cadence * 2 : p.cadence) : undefined), cssVar: '--series-cadence' });
  if (has('alt')) out.push({ id: 'alt', title: 'Altitude', units: 'm', get: (p) => p.alt, cssVar: '--series-alt', fill: true });
  if (has('temp')) out.push({ id: 'temp', title: 'Temperature', units: '°C', get: (p) => p.temp, cssVar: '--series-temp' });
  return out;
}

const REF_LINES: Record<string, { y: number; label: string }[]> = {
  [ZONESENSE_FIELD_KEY]: [{ y: ZONESENSE_AEROBIC, label: `aerobic threshold ${ZONESENSE_AEROBIC}` }, { y: ZONESENSE_ANAEROBIC, label: `anaerobic threshold ${ZONESENSE_ANAEROBIC}` }, { y: 0, label: 'baseline 0' }],
  [DFA_FIELD_KEY]: [{ y: DFA_AEROBIC, label: `aerobic threshold ${DFA_AEROBIC}` }, { y: DFA_ANAEROBIC, label: `anaerobic threshold ${DFA_ANAEROBIC}` }],
};
const UNIT_FALLBACK: Record<string, string> = { [ZONESENSE_FIELD_KEY]: 'index', [DFA_FIELD_KEY]: 'α1' };

export function devMetricDefs(s: SessionAnalysis): MetricDef[] {
  return s.devStreams.map((d, i) => {
    const st = s.streams.find((x) => x.field === d.key);
    const small = st ? Math.abs(st.max - st.min) < 10 : false;
    return {
      id: d.key, title: d.label, units: d.units || UNIT_FALLBACK[d.key] || '–', get: (p) => p.extra?.[d.key], cssVar: DEV_COLORS[i % DEV_COLORS.length],
      fmt: (v) => fmtNum(v, small ? 2 : 0),
      refLines: REF_LINES[d.key],
    };
  });
}

export function XModeToggle({ s, xMode, setXMode }: { s: SessionAnalysis; xMode: XMode; setXMode: (m: XMode) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      <button role="radio" aria-checked={xMode === 'time'} className={xMode === 'time' ? 'active' : ''} onClick={() => setXMode('time')}>Timer time</button>
      <button role="radio" aria-checked={xMode === 'distance'} className={xMode === 'distance' ? 'active' : ''} onClick={() => setXMode('distance')} disabled={!s.streams.some((st) => st.field === 'dist')}>Distance</button>
    </div>
  );
}

export function defaultXMode(s: SessionAnalysis): XMode {
  return s.streams.some((st) => st.field === 'dist' && st.coverage > 0.5) ? 'distance' : 'time';
}

export function Charts({ s }: { s: SessionAnalysis }) {
  const [xMode, setXMode] = useState<XMode>(() => defaultXMode(s));
  const dark = usePrefersDark();
  const defs = useMemo(() => standardMetricDefs(s), [s]);
  const devDefs = useMemo(() => devMetricDefs(s), [s]);
  if (!defs.length && !devDefs.length) return <Empty text="No record streams to chart." />;
  return (
    <div className="stack">
      <div className="toolbar">
        <span className="muted">X axis</span>
        <XModeToggle s={s} xMode={xMode} setXMode={setXMode} />
        <span className="muted small">{s.series.length} points (downsampled from {s.samples.length} records). Table view: Performance → digest, Laps & splits.</span>
      </div>
      <div className="charts">
        {defs.map((d) => <LineChart key={d.id} def={d} series={s.series} xMode={xMode} dark={dark} />)}
      </div>
      {devDefs.length > 0 && (
        <>
          <h3 className="subhead">Developer, non-standard and computed streams</h3>
          <div className="charts">
            {devDefs.map((d) => <LineChart key={d.id} def={d} series={s.series} xMode={xMode} dark={dark} />)}
          </div>
        </>
      )}
    </div>
  );
}

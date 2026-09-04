import { useMemo, useState } from 'react';
import type { SessionAnalysis, ZoneSenseCrossing } from '../fit/types';
import { fmtDuration, fmtFixed, fmtNum, fmtPct, fmtSpeed, isNum, speedUnitsLabel } from '../fit/format';
import { Empty, Table } from './common';
import { LineChart, XModeToggle, defaultXMode, devMetricDefs, standardMetricDefs, usePrefersDark, type XMode } from './Charts';

export function ZoneSenseView({ s }: { s: SessionAnalysis }) {
  const z = s.zoneSense;
  const [xMode, setXMode] = useState<XMode>(() => defaultXMode(s));
  const dark = usePrefersDark();
  const defs = useMemo(() => {
    if (!z) return [];
    const ddfa = devMetricDefs(s).find((d) => d.id === z.fieldKey);
    const std = standardMetricDefs(s).filter((d) => ['hr', 'pace', 'speed', 'power'].includes(d.id));
    return ddfa ? [ddfa, ...std] : std;
  }, [s, z]);
  if (!z) return <Empty text="No Suunto ZoneSense (DDFA) stream in this file." />;

  const total = z.computedTimes.aerobic + z.computedTimes.anaerobic + z.computedTimes.vo2max;
  const pct = (v: number) => (total > 0 ? fmtPct((v / total) * 100, 1) : '–');
  const dev = (v?: number) => (isNum(v) ? fmtDuration(v) : '–');
  const cross = (c?: ZoneSenseCrossing) => (c ? `${fmtDuration(c.timer)}${isNum(c.dist) ? ` · km ${fmtFixed(c.dist / 1000, 2)}` : ''}${isNum(c.hr) ? ` · HR ${fmtNum(c.hr, 0)}` : ''}` : 'never');
  const spd = (v?: number) => (isNum(v) ? fmtSpeed(v, s.speedMode, false) : undefined);
  const n0 = (v?: number) => (isNum(v) ? fmtNum(v, 0) : undefined);

  return (
    <div className="stack">
      <section className="card">
        <h3>Suunto ZoneSense <span className="muted">(DDFA index from the record stream)</span></h3>
        <p className="muted small">
          The DDFA index is an HRV-based intensity measure relative to the athlete's aerobic baseline (0). Suunto places the aerobic threshold at −0.2 and the anaerobic threshold at −0.5;
          values below them mean the anaerobic and VO2max zones. The device does not compute it during the first 10 minutes. Coverage {fmtPct(z.coveragePct, 0)} of samples, first value at {fmtDuration(z.startsAtTimer)}.
        </p>
        <div className="tiles">
          <div className="tile"><div className="tile-label">Aerobic zone</div><div className="tile-value">{fmtDuration(z.computedTimes.aerobic)}</div><div className="tile-sub">{pct(z.computedTimes.aerobic)} · device {dev(z.deviceTimes?.aerobic)}</div></div>
          <div className="tile"><div className="tile-label">Anaerobic zone</div><div className="tile-value">{fmtDuration(z.computedTimes.anaerobic)}</div><div className="tile-sub">{pct(z.computedTimes.anaerobic)} · device {dev(z.deviceTimes?.anaerobic)}</div></div>
          <div className="tile"><div className="tile-label">VO2max zone</div><div className="tile-value">{fmtDuration(z.computedTimes.vo2max)}</div><div className="tile-sub">{pct(z.computedTimes.vo2max)} · device {dev(z.deviceTimes?.vo2max)}</div></div>
          {isNum(z.aerobicThresholdHr) && <div className="tile"><div className="tile-label">Aerobic threshold HR (device)</div><div className="tile-value">{fmtNum(z.aerobicThresholdHr, 1)}</div><div className="tile-sub">bpm</div></div>}
          {isNum(z.anaerobicThresholdHr) && <div className="tile"><div className="tile-label">Anaerobic threshold HR (device)</div><div className="tile-value">{fmtNum(z.anaerobicThresholdHr, 1)}</div><div className="tile-sub">bpm</div></div>}
          <div className="tile"><div className="tile-label">Median index</div><div className="tile-value">{fmtFixed(z.stats.median, 2)}</div><div className="tile-sub">p10 {fmtFixed(z.stats.p10, 2)} · p90 {fmtFixed(z.stats.p90, 2)}</div></div>
        </div>
        <Table headers={['Item', 'Value']} rows={[
          ['First sample below the aerobic threshold (−0.2)', cross(z.firstBelowAerobic)],
          [`First time the ${z.sustainedWindowSec}-s moving average dropped below the aerobic threshold`, cross(z.firstSustainedBelowAerobic)],
          ['First sample below the anaerobic threshold (−0.5)', cross(z.firstBelowAnaerobic)],
          ['Mean HR when the index was near −0.2', isNum(z.hrAtAerobicCrossing) ? `${fmtNum(z.hrAtAerobicCrossing, 0)} bpm` : '–'],
          ['Mean HR in aerobic vs anaerobic samples', isNum(z.hrMeanAerobic) && isNum(z.hrMeanAnaerobic) ? `${fmtNum(z.hrMeanAerobic, 0)} vs ${fmtNum(z.hrMeanAnaerobic, 0)} bpm` : '–'],
          ['Correlation of the index with HR', isNum(z.corrWithHr) ? `${fmtFixed(z.corrWithHr, 2)} (near 0: independent of HR)` : '–'],
          ['Mean index, first half → second half', z.halves ? `${fmtFixed(z.halves.first, 3)} → ${fmtFixed(z.halves.second, 3)}` : '–'],
          ['Index range', `${fmtFixed(z.stats.min, 2)} … ${fmtFixed(z.stats.max, 2)} (mean ${fmtFixed(z.stats.mean, 3)})`],
          ['Baselines written by the device', `aerobic ${isNum(z.aerobicBaseline) ? fmtFixed(z.aerobicBaseline, 4) : '–'}, cumulative ${isNum(z.cumulativeBaseline) ? fmtFixed(z.cumulativeBaseline, 4) : '–'}`],
        ]} />
      </section>

      <div className="toolbar">
        <span className="muted">X axis</span>
        <XModeToggle s={s} xMode={xMode} setXMode={setXMode} />
        <span className="muted small">Same axis on every chart so the index can be read against HR, pace and power.</span>
      </div>
      <div className="charts">
        {defs.map((d) => <LineChart key={d.id} def={d} series={s.series} xMode={xMode} dark={dark} height={220} />)}
      </div>

      {z.perSplit.length > 0 && (
        <section className="card">
          <h3>Per {z.splitDistance >= 1000 ? `${z.splitDistance / 1000} km` : `${z.splitDistance} m`}</h3>
          <Table
            headers={['#', 'At km', 'Mean index', '% anaerobic', '% VO2max', 'Avg HR', s.speedMode === 'kmh' ? `Speed (${speedUnitsLabel(s.speedMode)})` : `Pace (${speedUnitsLabel(s.speedMode)})`, 'Avg W']}
            rows={z.perSplit.map((p) => [p.index, fmtFixed(p.endDist / 1000, 2), fmtFixed(p.mean, 3), fmtPct(p.anaerobicPct, 0), fmtPct(p.vo2maxPct, 0), n0(p.avgHr), spd(p.avgSpeed), n0(p.avgPower)])}
          />
        </section>
      )}
    </div>
  );
}

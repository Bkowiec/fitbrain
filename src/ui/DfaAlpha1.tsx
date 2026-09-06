import { useMemo, useState } from 'react';
import type { DfaCrossing, DfaThreshold, SessionAnalysis } from '../fit/types';
import { fmtDuration, fmtFixed, fmtNum, fmtPct, fmtSpeed, isNum, speedUnitsLabel } from '../fit/format';
import { Empty, Table, Tag } from './common';
import { LineChart, XModeToggle, defaultXMode, devMetricDefs, standardMetricDefs, usePrefersDark, type XMode } from './Charts';

export function DfaAlpha1View({ s }: { s: SessionAnalysis }) {
  const d = s.dfa;
  const [xMode, setXMode] = useState<XMode>(() => defaultXMode(s));
  const dark = usePrefersDark();
  const defs = useMemo(() => {
    if (!d) return [];
    const dev = devMetricDefs(s);
    const a1 = dev.find((x) => x.id === d.fieldKey);
    const ddfa = dev.find((x) => x.id === 'dev:ddfa');
    const std = standardMetricDefs(s).filter((x) => ['hr', 'pace', 'speed', 'power'].includes(x.id));
    return [a1, ddfa, ...std].filter((x): x is NonNullable<typeof x> => !!x);
  }, [s, d]);
  if (!d) return <Empty text="No RR intervals in this file, so DFA α1 cannot be computed." />;

  const total = d.times.aerobic + d.times.heavy + d.times.severe;
  const pct = (v: number) => (total > 0 ? fmtPct((v / total) * 100, 1) : '–');
  const cross = (c?: DfaCrossing) => (c ? `${fmtDuration(c.timer)}${isNum(c.dist) ? ` · km ${fmtFixed(c.dist / 1000, 2)}` : ''}${isNum(c.hr) ? ` · HR ${fmtNum(c.hr, 0)}` : ''}` : 'never');
  const spd = (v?: number) => (isNum(v) ? fmtSpeed(v, s.speedMode, false) : undefined);
  const n0 = (v?: number) => (isNum(v) ? fmtNum(v, 0) : undefined);
  const thr = (t: DfaThreshold | undefined, name: string) => {
    if (!t) return [name, 'not estimable: no sustained reliable data on both sides of this intensity, or an implausible candidate HR'];
    const parts: string[] = [];
    if (isNum(t.hr)) parts.push(`${fmtNum(t.hr, 0)} bpm by regression of HR on α1 (r ${fmtFixed(t.r, 2)}, n ${t.n} windows)`);
    if (isNum(t.hrNear)) parts.push(`${fmtNum(t.hrNear, 0)} bpm as the median HR of windows within ±0.05 of ${t.alpha1}`);
    if (isNum(t.speed)) parts.push(`${spd(t.speed)} ${speedUnitsLabel(s.speedMode)}`);
    if (isNum(t.power)) parts.push(`${fmtNum(t.power, 0)} W`);
    return [name, parts.join(' · ')];
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>DFA α1 <span className="muted">(from the RR intervals in the file)</span><Tag kind="computed" /></h3>
        <p className="muted small">
          Short-term detrended fluctuation analysis of beat-to-beat intervals: {d.windowSec}-s windows recomputed every {d.stepSec} s, box sizes {d.boxRange[0]}–{d.boxRange[1]} beats.
          α1 near 1.0 means well-correlated, low-intensity beating; it falls with intensity. Published thresholds: aerobic threshold (HRVT1) at α1 ≈ {d.thresholds.aerobic}, anaerobic threshold (HRVT2) at α1 ≈ {d.thresholds.anaerobic}.
          {' '}{d.rrCount} RR intervals, {fmtPct(d.artefactPct, 1)} corrected as artefacts; {d.reliableWindows} of {d.windows.length} windows reliable (≤ 5 % corrected beats and no strap jitter); a reliable value covers {fmtPct(d.coveragePct, 0)} of timer time. First value at {fmtDuration(d.startsAtTimer)}. Heart rate here is {d.hrSource === 'device' ? 'the device HR stream, as everywhere else in the analysis' : 'derived from RR intervals because the file has no HR stream'}.
        </p>
        <div className="tiles">
          <div className="tile"><div className="tile-label">α1 &gt; {d.thresholds.aerobic} · aerobic</div><div className="tile-value">{fmtDuration(d.times.aerobic)}</div><div className="tile-sub">{pct(d.times.aerobic)}{isNum(d.hrMeanAerobic) ? ` · mean HR ${fmtNum(d.hrMeanAerobic, 0)}` : ''}</div></div>
          <div className="tile"><div className="tile-label">{d.thresholds.anaerobic}–{d.thresholds.aerobic} · heavy</div><div className="tile-value">{fmtDuration(d.times.heavy)}</div><div className="tile-sub">{pct(d.times.heavy)}{isNum(d.hrMeanHeavy) ? ` · mean HR ${fmtNum(d.hrMeanHeavy, 0)}` : ''}</div></div>
          <div className="tile"><div className="tile-label">α1 &lt; {d.thresholds.anaerobic} · severe</div><div className="tile-value">{fmtDuration(d.times.severe)}</div><div className="tile-sub">{pct(d.times.severe)}{isNum(d.hrMeanSevere) ? ` · mean HR ${fmtNum(d.hrMeanSevere, 0)}` : ''}</div></div>
          {d.hrvt1 && isNum(d.hrvt1.hr ?? d.hrvt1.hrNear) && <div className="tile"><div className="tile-label">Aerobic threshold HR (HRVT1)</div><div className="tile-value">{fmtNum(d.hrvt1.hr ?? d.hrvt1.hrNear, 0)}</div><div className="tile-sub">bpm</div></div>}
          {d.hrvt2 && isNum(d.hrvt2.hr ?? d.hrvt2.hrNear) && <div className="tile"><div className="tile-label">Anaerobic threshold HR (HRVT2)</div><div className="tile-value">{fmtNum(d.hrvt2.hr ?? d.hrvt2.hrNear, 0)}</div><div className="tile-sub">bpm</div></div>}
          <div className="tile"><div className="tile-label">Median α1</div><div className="tile-value">{fmtFixed(d.stats.median, 2)}</div><div className="tile-sub">p10 {fmtFixed(d.stats.p10, 2)} · p90 {fmtFixed(d.stats.p90, 2)}</div></div>
        </div>
        <Table headers={['Item', 'Value']} rows={[
          thr(d.hrvt1, `Aerobic threshold estimate (α1 = ${d.thresholds.aerobic})`),
          thr(d.hrvt2, `Anaerobic threshold estimate (α1 = ${d.thresholds.anaerobic})`),
          [`First reliable window below ${d.thresholds.aerobic}`, cross(d.firstBelowAerobic)],
          [`First ${d.sustainedWindowSec} s continuously below ${d.thresholds.aerobic}`, cross(d.firstSustainedBelowAerobic)],
          [`First reliable window below ${d.thresholds.anaerobic}`, cross(d.firstBelowAnaerobic)],
          ['Correlation of α1 with HR', isNum(d.corrWithHr) ? `${fmtFixed(d.corrWithHr, 2)} (negative expected; far from −1 means α1 carries information HR does not)` : '–'],
          ['Mean α1, first half → second half', d.halves ? `${fmtFixed(d.halves.first, 3)} → ${fmtFixed(d.halves.second, 3)}` : '–'],
          ['α1 range', `${fmtFixed(d.stats.min, 2)} … ${fmtFixed(d.stats.max, 2)} (mean ${fmtFixed(d.stats.mean, 3)})`],
          ['RR timing', d.timingSource],
          ...(d.ddfa ? [['Agreement with Suunto ZoneSense (DDFA)', `correlation ${fmtFixed(d.ddfa.corr, 2)} over ${d.ddfa.n} samples${isNum(d.ddfa.deviceAerobicTimer) ? `; device first below its aerobic threshold at ${fmtDuration(d.ddfa.deviceAerobicTimer)}` : ''}`]] : []),
        ]} />
      </section>

      <div className="toolbar">
        <span className="muted">X axis</span>
        <XModeToggle s={s} xMode={xMode} setXMode={setXMode} />
        <span className="muted small">Same axis on every chart so α1 can be read against HR, pace and power{d.ddfa ? ' and against the device’s DDFA index' : ''}.</span>
      </div>
      <div className="charts">
        {defs.map((m) => <LineChart key={m.id} def={m} series={s.series} xMode={xMode} dark={dark} height={220} />)}
      </div>

      {d.perSplit.length > 0 && (
        <section className="card">
          <h3>Per {d.splitDistance >= 1000 ? `${d.splitDistance / 1000} km` : `${d.splitDistance} m`}<Tag kind="computed" /></h3>
          <Table
            headers={['#', 'At km', 'Mean α1', '% heavy', '% severe', 'Avg HR', s.speedMode === 'kmh' ? `Speed (${speedUnitsLabel(s.speedMode)})` : `Pace (${speedUnitsLabel(s.speedMode)})`, 'Avg W']}
            rows={d.perSplit.map((p) => [p.index, fmtFixed(p.endDist / 1000, 2), fmtFixed(p.mean, 3), fmtPct(p.heavyPct, 0), fmtPct(p.severePct, 0), n0(p.avgHr), spd(p.avgSpeed), n0(p.avgPower)])}
          />
        </section>
      )}

      <section className="card">
        <h3>How to read it</h3>
        <ul className="plain small muted">
          <li>The method needs beat-to-beat (RR) recording: Garmin with HRV logging enabled, Suunto, Polar H10, COROS with a compatible strap. Optical wrist sensors rarely give clean RR data; watch the artefact percentage.</li>
          <li>Threshold estimates follow the HRVT approach (linear regression of HR on α1 across the session). They are most trustworthy on a gradual ramp or a session that spends time on both sides of the threshold; on a steady easy run they are only indicative or missing.</li>
          <li>α1 responds with a lag of about one window ({d.windowSec} s), so during short intervals it will not fully track the effort.</li>
          <li>Reliability: a window is dropped when more than 5 % of its beats were corrected by the shared RR filter (RR outside 0.3–2.0 s or more than 20 % off the running median, replaced by interpolation) or when more than 0.75 % of successive differences exceed both 50 ms and 10 % of the interval. The second rule catches the alternating short–long pattern of a dry or loose strap that otherwise drags α1 down; it can also exclude very slow walking, where breathing-driven variability is genuinely large.</li>
          <li>Time in zones and the per-km shares are time-weighted over the record stream with the same helper the computed zones and ZoneSense use; the per-km mean is the same number as the α1 column in Laps &amp; splits.</li>
          <li>Threshold estimates require sustained reliable data on both sides of the threshold and a heart rate above that of clearly easier windows; an anaerobic estimate below the aerobic one is discarded.</li>
        </ul>
      </section>
    </div>
  );
}

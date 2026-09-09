import type { Analysis, SessionAnalysis } from '../fit/types';
import { fmtDuration, fmtKm, fmtNum, fmtSpeed, isNum, speedUnitsLabel } from '../fit/format';
import { KvCard, KvList, balancedCols, type Provenance } from './common';

interface Tile { label: string; value: string; unit?: string; sub?: string; prov: Provenance; series?: 'hr' | 'pace' | 'power' | 'cadence' }

export function Overview({ s, a }: { s: SessionAnalysis; a: Analysis }) {
  const raw = s.raw;
  const tiles: Tile[] = [];
  if (isNum(s.distance)) tiles.push({ label: 'Distance', value: fmtKm(s.distance).replace(' km', ''), unit: 'km', prov: 'device' });
  tiles.push({ label: 'Timer time', value: fmtDuration(s.timerTime), sub: s.pausedTime > 1 ? `elapsed ${fmtDuration(s.elapsedTime)}` : undefined, prov: 'device' });
  if (isNum(s.distance) && s.timerTime > 0) {
    tiles.push({ label: s.speedMode === 'kmh' ? 'Avg speed' : 'Avg pace', value: fmtSpeed(s.distance / s.timerTime, s.speedMode, false), unit: speedUnitsLabel(s.speedMode), prov: 'computed', series: 'pace' });
  }
  if (isNum(raw.avgHeartRate)) tiles.push({ label: 'Avg HR', value: fmtNum(raw.avgHeartRate, 0), unit: 'bpm', sub: isNum(raw.maxHeartRate) ? `max ${fmtNum(raw.maxHeartRate, 0)}` : undefined, prov: 'device', series: 'hr' });
  if (isNum(raw.avgPower)) tiles.push({ label: 'Avg power', value: fmtNum(raw.avgPower, 0), unit: 'W', sub: isNum(raw.normalizedPower) ? `NP ${fmtNum(raw.normalizedPower, 0)} W` : undefined, prov: 'device', series: 'power' });
  if (isNum(raw.avgRunningCadence ?? raw.avgCadence)) {
    const c = raw.avgRunningCadence ?? raw.avgCadence;
    tiles.push({ label: 'Avg cadence', value: s.isRunLike ? fmtNum(c * 2, 0) : fmtNum(c, 0), unit: s.isRunLike ? 'spm' : 'rpm', prov: 'device', series: 'cadence' });
  }
  if (isNum(raw.totalCalories)) tiles.push({ label: 'Calories', value: fmtNum(raw.totalCalories, 0), unit: 'kcal', prov: 'device' });
  if (isNum(raw.totalAscent)) tiles.push({ label: 'Ascent', value: fmtNum(raw.totalAscent, 0), unit: 'm', sub: isNum(raw.totalDescent) ? `descent ${fmtNum(raw.totalDescent, 0)} m` : undefined, prov: 'device' });
  if (isNum(raw.totalTrainingEffect)) tiles.push({ label: 'Training effect', value: fmtNum(raw.totalTrainingEffect, 1), sub: isNum(raw.totalAnaerobicTrainingEffect) ? `anaerobic ${fmtNum(raw.totalAnaerobicTrainingEffect, 1)}` : 'aerobic, 0–5', prov: 'device' });
  if (isNum(raw.trainingStressScore)) tiles.push({ label: 'TSS', value: fmtNum(raw.trainingStressScore, 0), prov: 'device' });
  const a1 = s.dfa;
  if (a1) tiles.push({ label: 'DFA α1', value: a1.stats.median.toFixed(2), sub: `median · ${fmtNum(a1.reliableWindows, 0)} windows`, prov: 'computed' });
  const vdot = s.predictions?.basis.vdot;
  if (isNum(vdot)) tiles.push({ label: 'VDOT', value: fmtNum(vdot, 1), sub: `from ${s.predictions!.basis.name}`, prov: 'computed' });

  const priority = ['Distance', 'Timer time', 'Avg pace', 'Avg speed', 'Avg HR', 'Avg power', 'Ascent'];
  const headline = tiles.filter((t) => priority.includes(t.label)).slice(0, 6);
  const secondary = tiles.filter((t) => !headline.includes(t));
  const renderTile = (t: Tile) => <div className={`tile${t.series ? ` series-${t.series}` : ''}`} key={t.label}>
    <div className="tile-head"><span className="tile-label">{t.label}</span></div>
    <div className={t.prov === 'computed' ? 'tile-value derived' : 'tile-value'}>{t.value}{t.unit && <span className="tile-unit">{t.unit}</span>}</div>
    {t.sub && <div className="tile-sub">{t.sub}</div>}
  </div>;

  return (
    <div className="overview stack">
      <div className="tiles overview-headline" aria-label="Key activity metrics" style={{ '--overview-cols': balancedCols(headline.length, 3) } as React.CSSProperties}>{headline.map(renderTile)}</div>
      <details className="details source-explanation"><summary>How to read these numbers</summary>
        <p>Timer time excludes pauses. Average pace and speed are calculated from distance and timer time. Dotted underlines identify calculated values.</p>
        <p>In the details below, “device” means a recorded value and “computed” means a value calculated by FitBrain.</p>
      </details>
      <details className="card disclosure"><summary><span>Training details</span><span className="muted small">Recorded metrics, cadence, elevation and training load</span></summary>
        <div className="disclosure-body">
          {secondary.length > 0 && <div className="tiles">{secondary.map(renderTile)}</div>}
          <div className="grid">{s.groups.map((g) => <KvCard key={g.title} group={g} prov="device" />)}</div>
        </div>
      </details>
      {s.computed.length > 0 && <details className="card disclosure"><summary><span>Advanced metrics</span><span className="muted small">Calculated efficiency, intensity and performance</span></summary><div className="disclosure-body"><KvCard group={{ title: 'Computed metrics', items: s.computed }} prov="computed" /></div></details>}
      <details className="card disclosure"><summary><span>Data quality and methods</span><span className="muted small">Recording checks, file information and calculation details</span></summary><div className="disclosure-body grid">
        <section className="card"><h3>Data quality</h3><KvList items={s.quality} /></section>
        <KvCard group={a.file} prov="device" />
        {s.devFields.length > 0 && <KvCard group={{ title: 'Developer / vendor fields (session)', items: s.devFields }} prov="device" />}
        <KvCard group={{ title: 'Methods and assumptions', items: a.methods }} />
      </div></details>
    </div>
  );
}

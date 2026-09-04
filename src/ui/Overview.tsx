import type { Analysis, SessionAnalysis } from '../fit/types';
import { fmtDuration, fmtKm, fmtLocal, fmtNum, fmtSpeed, fmtTz, isNum, speedUnitsLabel } from '../fit/format';
import { KvCard, KvList } from './common';

interface Tile { label: string; value: string; sub?: string }

export function Overview({ s, a }: { s: SessionAnalysis; a: Analysis }) {
  const raw = s.raw;
  const tiles: Tile[] = [];
  if (isNum(s.distance)) tiles.push({ label: 'Distance', value: fmtKm(s.distance) });
  tiles.push({ label: 'Timer time', value: fmtDuration(s.timerTime), sub: s.pausedTime > 1 ? `elapsed ${fmtDuration(s.elapsedTime)}` : undefined });
  if (isNum(s.distance) && s.timerTime > 0) {
    tiles.push({ label: s.speedMode === 'kmh' ? 'Avg speed' : 'Avg pace', value: fmtSpeed(s.distance / s.timerTime, s.speedMode, false), sub: speedUnitsLabel(s.speedMode) });
  }
  if (isNum(raw.avgHeartRate)) tiles.push({ label: 'Avg HR', value: `${fmtNum(raw.avgHeartRate, 0)}`, sub: isNum(raw.maxHeartRate) ? `max ${fmtNum(raw.maxHeartRate, 0)} bpm` : 'bpm' });
  if (isNum(raw.avgPower)) tiles.push({ label: 'Avg power', value: `${fmtNum(raw.avgPower, 0)} W`, sub: isNum(raw.normalizedPower) ? `NP ${fmtNum(raw.normalizedPower, 0)} W` : undefined });
  if (isNum(raw.avgRunningCadence ?? raw.avgCadence)) {
    const c = raw.avgRunningCadence ?? raw.avgCadence;
    tiles.push({ label: 'Avg cadence', value: s.isRunLike ? `${fmtNum(c * 2, 0)}` : `${fmtNum(c, 0)}`, sub: s.isRunLike ? 'steps/min' : 'rpm' });
  }
  if (isNum(raw.totalCalories)) tiles.push({ label: 'Calories', value: `${fmtNum(raw.totalCalories, 0)}`, sub: 'kcal' });
  if (isNum(raw.totalAscent)) tiles.push({ label: 'Ascent', value: `${fmtNum(raw.totalAscent, 0)} m`, sub: isNum(raw.totalDescent) ? `descent ${fmtNum(raw.totalDescent, 0)} m` : undefined });
  if (isNum(raw.totalTrainingEffect)) tiles.push({ label: 'Training effect', value: fmtNum(raw.totalTrainingEffect, 1), sub: isNum(raw.totalAnaerobicTrainingEffect) ? `anaerobic ${fmtNum(raw.totalAnaerobicTrainingEffect, 1)}` : 'aerobic, 0–5' });
  if (isNum(raw.trainingStressScore)) tiles.push({ label: 'TSS', value: fmtNum(raw.trainingStressScore, 0), sub: 'device' });

  return (
    <div className="overview">
      <div className="headline">
        <h2>{s.sportLabel}</h2>
        <p className="muted">
          {fmtLocal(s.startTime, s.tzOffsetMin)} – {fmtLocal(s.endTime, s.tzOffsetMin, false)} ({fmtTz(s.tzOffsetMin)}) · {a.file.items.find((i) => i.key === 'product')?.value}
        </p>
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="tile" key={t.label}>
            <div className="tile-label">{t.label}</div>
            <div className="tile-value">{t.value}</div>
            {t.sub && <div className="tile-sub">{t.sub}</div>}
          </div>
        ))}
      </div>
      <div className="grid">
        {s.groups.map((g) => <KvCard key={g.title} group={g} />)}
        {s.computed.length > 0 && <KvCard group={{ title: 'Computed metrics', items: s.computed }} />}
        {s.devFields.length > 0 && <KvCard group={{ title: 'Developer / vendor fields (session)', items: s.devFields }} />}
        <section className="card">
          <h3>Data quality</h3>
          <KvList items={s.quality} />
        </section>
        <KvCard group={a.file} />
      </div>
    </div>
  );
}

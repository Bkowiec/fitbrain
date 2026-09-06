import { useMemo, useState } from 'react';
import type { SessionAnalysis } from '../fit/types';
import { computeSplits } from '../fit/metrics';
import { fmtDuration, fmtFixed, fmtNum, fmtSpeed, isNum, speedUnitsLabel } from '../fit/format';
import { Empty, Table, Tag } from './common';

const SPLIT_OPTIONS = [
  { m: 100, label: '100 m' }, { m: 200, label: '200 m' }, { m: 400, label: '400 m' }, { m: 500, label: '500 m' },
  { m: 1000, label: '1 km' }, { m: 1609.34, label: '1 mile' }, { m: 2000, label: '2 km' }, { m: 5000, label: '5 km' }, { m: 10000, label: '10 km' },
];

export function LapsSplits({ s }: { s: SessionAnalysis }) {
  const [splitM, setSplitM] = useState(s.splitDistance);
  const splits = useMemo(() => (splitM === s.splitDistance ? s.splits : computeSplits(s.samples, splitM)), [s, splitM]);
  const paceHdr = s.speedMode === 'kmh' ? `Speed (${speedUnitsLabel(s.speedMode)})` : `Pace (${speedUnitsLabel(s.speedMode)})`;
  const cadHdr = s.isRunLike ? 'Cadence (spm)' : 'Cadence (rpm)';
  const spd = (v?: number) => (isNum(v) ? fmtSpeed(v, s.speedMode, false) : undefined);
  const cad = (v?: number) => (isNum(v) ? fmtNum(s.isRunLike ? v * 2 : v, 0) : undefined);
  const n0 = (v?: number) => (isNum(v) ? fmtNum(v, 0) : undefined);
  const hasDist = s.streams.some((st) => st.field === 'dist' && st.coverage > 0.02);
  const devCols = s.devStreams.filter((d) => d.coverage > 0.2).slice(0, 4);
  const devVal = (v?: number) => (isNum(v) ? fmtNum(v, Math.abs(v) < 10 ? 2 : 1) : undefined);

  return (
    <div className="stack">
      <section className="card">
        <h3>Laps <span className="muted">({s.laps.length})</span><Tag kind="device" /></h3>
        {s.laps.length ? (
          <Table
            headers={['#', 'Start (timer)', 'Time', 'Distance km', paceHdr, 'Max ' + (s.speedMode === 'kmh' ? 'km/h' : 'pace'), 'Avg HR', 'Max HR', 'Avg W', 'Max W', cadHdr, 'Asc / Desc m', 'kcal', 'Trigger']}
            rows={s.laps.map((l) => [
              l.index, fmtDuration(l.startTimer), isNum(l.timerTime) ? fmtDuration(l.timerTime) : undefined, isNum(l.distance) ? fmtFixed(l.distance / 1000, 2) : undefined,
              spd(l.avgSpeed), spd(l.maxSpeed), n0(l.avgHr), n0(l.maxHr), n0(l.avgPower), n0(l.maxPower), cad(l.avgCadence),
              isNum(l.ascent) || isNum(l.descent) ? `+${n0(l.ascent) ?? 0} / −${n0(l.descent) ?? 0}` : undefined, n0(l.calories), l.trigger,
            ])}
          />
        ) : <Empty text="No lap messages in this file." />}
        {s.laps.some((l) => l.extra.length > 0) && (
          <details className="details">
            <summary>Additional lap fields</summary>
            <ul className="plain">
              {s.laps.filter((l) => l.extra.length).map((l) => (
                <li key={l.index}><strong>Lap {l.index}:</strong> {l.extra.map((e) => `${e.label} ${e.value}`).join(' · ')}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Splits <span className="muted">(from the record stream, timer time)</span><Tag kind="computed" /></h3>
          <label className="inline">
            Every
            <select className="select" value={splitM} onChange={(e) => setSplitM(Number(e.target.value))}>
              {SPLIT_OPTIONS.map((o) => <option key={o.m} value={o.m}>{o.label}</option>)}
            </select>
          </label>
        </div>
        {!hasDist ? <Empty text="No distance stream, so distance splits cannot be computed." /> : splits.length ? (
          <Table
            headers={['#', 'At km', 'Split time', paceHdr, 'Avg HR', 'Max HR', 'Avg W', cadHdr, 'Asc / Desc m', ...devCols.map((d) => (d.units ? `${d.label} (${d.units})` : d.label))]}
            rows={splits.map((p) => [
              p.index, fmtFixed(p.endDist / 1000, 2), fmtDuration(p.time), spd(p.speed), n0(p.avgHr), n0(p.maxHr), n0(p.avgPower), cad(p.avgCadence),
              `+${n0(p.ascent) ?? 0} / −${n0(p.descent) ?? 0}`, ...devCols.map((d) => devVal(p.extra?.[d.key])),
            ])}
          />
        ) : <Empty text="Activity is shorter than one split." />}
      </section>
    </div>
  );
}

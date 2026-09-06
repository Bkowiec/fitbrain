import type { SessionAnalysis } from '../fit/types';
import { fmtDuration, fmtFixed, fmtNum, fmtSpeed, isNum, signed, speedUnitsLabel } from '../fit/format';
import { Empty, Table, Tag } from './common';

export function Performance({ s }: { s: SessionAnalysis }) {
  const paceHdr = s.speedMode === 'kmh' ? `Speed (${speedUnitsLabel(s.speedMode)})` : `Pace (${speedUnitsLabel(s.speedMode)})`;
  const spd = (v?: number) => (isNum(v) ? fmtSpeed(v, s.speedMode, false) : undefined);
  const n0 = (v?: number) => (isNum(v) ? fmtNum(v, 0) : undefined);
  const cad = (v?: number) => (isNum(v) ? fmtNum(s.isRunLike ? v * 2 : v, 0) : undefined);
  const cadHdr = s.isRunLike ? 'Cadence (spm)' : 'Cadence (rpm)';
  const d = s.drift;
  const devCols = s.devStreams.filter((x) => x.coverage > 0.2).slice(0, 4);
  const devVal = (v?: number) => (isNum(v) ? fmtNum(v, Math.abs(v) < 10 ? 2 : 1) : undefined);
  const nothing = !s.bestEfforts.length && !s.peakPower.length && !d && !s.digest.length;
  if (nothing) return <Empty text="Not enough stream data for performance analysis." />;
  return (
    <div className="stack">
      {s.bestEfforts.length > 0 && (
        <section className="card">
          <h3>Fastest efforts <span className="muted">(best continuous segment for each distance, timer time)</span><Tag kind="computed" /></h3>
          <Table headers={['Distance', 'Time', paceHdr, 'Started at km', 'Started at timer']} rows={s.bestEfforts.map((e) => [e.name, fmtDuration(e.time), spd(e.speed), fmtFixed(e.startDist / 1000, 2), fmtDuration(e.startTimer)])} />
        </section>
      )}
      {s.peakPower.length > 0 && (
        <section className="card">
          <h3>Peak power <span className="muted">(best average over window)</span><Tag kind="computed" /></h3>
          <Table headers={['Window', 'Watts', 'Started at timer']} rows={s.peakPower.map((p) => [p.label, n0(p.watts), fmtDuration(p.startTimer)])} />
        </section>
      )}
      {d && (
        <section className="card">
          <h3>First half vs second half<Tag kind="computed" /></h3>
          <Table
            headers={['Half', 'Time', 'km', paceHdr, 'Avg HR', 'Avg W', cadHdr, 'EF (m/min per bpm)', 'EF (W per bpm)']}
            rows={[d.first, d.second].map((h) => [h.label, fmtDuration(h.time), isNum(h.distance) ? fmtFixed(h.distance / 1000, 2) : undefined, spd(h.avgSpeed), n0(h.avgHr), n0(h.avgPower), cad(h.avgCadence), isNum(h.efPace) ? fmtFixed(h.efPace, 3) : undefined, isNum(h.efPower) ? fmtFixed(h.efPower, 3) : undefined])}
          />
          <ul className="plain">
            {isNum(d.hrDriftPct) && <li>Cardiac drift: <strong>{signed(d.hrDriftPct, 1, ' %')}</strong> (average HR, second half vs first)</li>}
            {isNum(d.paceChangePct) && <li>Pace change: <strong>{signed(d.paceChangePct, 1, ' %')}</strong> (positive = slower second half)</li>}
            {isNum(d.powerChangePct) && <li>Power change: <strong>{signed(d.powerChangePct, 1, ' %')}</strong></li>}
            {isNum(d.paceDecouplingPct) && <li>Aerobic decoupling Pa:HR: <strong>{signed(d.paceDecouplingPct, 1, ' %')}</strong> (under ~5 % is usually considered well coupled)</li>}
            {isNum(d.powerDecouplingPct) && <li>Aerobic decoupling Pw:HR: <strong>{signed(d.powerDecouplingPct, 1, ' %')}</strong></li>}
          </ul>
        </section>
      )}
      {s.digest.length > 0 && (
        <section className="card">
          <h3>Time-series digest <span className="muted">({s.digestBucketSec / 60}-minute buckets of timer time)</span><Tag kind="computed" /></h3>
          <Table
            headers={['Timer window', 'At km', paceHdr, 'Avg HR', 'Avg W', cadHdr, 'Altitude m', 'Asc / Desc m', '°C', ...devCols.map((x) => (x.units ? `${x.label} (${x.units})` : x.label))]}
            rows={s.digest.map((r) => [
              `${fmtDuration(r.timerStart)}–${fmtDuration(r.timerEnd)}`, isNum(r.distEnd) ? fmtFixed(r.distEnd / 1000, 2) : undefined, spd(r.avgSpeed), n0(r.avgHr), n0(r.avgPower), cad(r.avgCadence),
              isNum(r.altStart) ? `${n0(r.altStart)} → ${n0(r.altEnd)}` : undefined, `+${n0(r.ascent) ?? 0} / −${n0(r.descent) ?? 0}`, n0(r.avgTemp), ...devCols.map((x) => devVal(r.extra?.[x.key])),
            ])}
          />
        </section>
      )}
      <section className="card">
        <h3>Record streams <span className="muted">(per-sample statistics)</span><Tag kind="device" /></h3>
        <Table headers={['Stream', 'Units', 'Samples', 'Coverage', 'Min', 'Avg', 'Max']} rows={s.streams.filter((st) => !st.field.startsWith('calc:')).map((st) => [st.label, st.units, st.count, `${Math.round(st.coverage * 100)}%`, fmtNum(st.min, 1), fmtNum(st.avg, 1), fmtNum(st.max, 1)])} />
        {s.streams.some((st) => st.field.startsWith('calc:')) && (
          <>
            <h4 className="subhead">Streams computed by the analyzer <span className="muted small">(not recorded by the device)</span></h4>
            <Table headers={['Stream', 'Samples', 'Coverage', 'Min', 'Avg', 'Max']} rows={s.streams.filter((st) => st.field.startsWith('calc:')).map((st) => [st.label, st.count, `${Math.round(st.coverage * 100)}%`, fmtNum(st.min, 2), fmtNum(st.avg, 2), fmtNum(st.max, 2)])} />
          </>
        )}
      </section>
    </div>
  );
}

import type { Analysis, SessionAnalysis } from '../fit/types';
import { fmtDuration, fmtLocal, fmtNum, fmtPct, fmtCoord } from '../fit/format';
import { Empty, KvCard, Table } from './common';

export function EventsDevices({ s, a }: { s: SessionAnalysis; a: Analysis }) {
  const tz = s.tzOffsetMin;
  return (
    <div className="stack">
      <section className="card">
        <h3>Pauses <span className="muted">({s.pauses.length}, total {fmtDuration(s.pauses.reduce((x, p) => x + p.seconds, 0))})</span></h3>
        {s.pauses.length ? (
          <Table headers={['#', 'At timer', 'Local time', 'Duration', 'Trigger']} rows={s.pauses.map((p, i) => [i + 1, fmtDuration(p.startTimer), fmtLocal(p.start, tz, false), fmtDuration(p.seconds), p.trigger])} />
        ) : <Empty text="No pauses detected." />}
      </section>

      <section className="card">
        <h3>Events <span className="muted">({a.events.length})</span></h3>
        {a.events.length ? (
          <Table headers={['Local time', 'Elapsed', 'Event', 'Type', 'Details']} rows={a.events.map((e) => [fmtLocal(e.time, tz, false), fmtDuration(e.elapsed), e.event, e.eventType, e.details])} />
        ) : <Empty text="No event messages." />}
      </section>

      <section className="card">
        <h3>Devices &amp; sensors <span className="muted">({a.devices.length})</span></h3>
        {a.devices.length ? (
          <>
            <Table headers={['Role', 'Manufacturer', 'Product', 'Serial', 'Software', 'Hardware', 'Battery', 'Source / ANT+ type']} rows={a.devices.map((d) => [d.role, d.manufacturer, d.product, d.serial, d.software, d.hardware, d.battery, [d.source, d.antDeviceType].filter(Boolean).join(' / ')])} />
            {a.devices.some((d) => d.extra.length) && (
              <details className="details">
                <summary>Additional device fields</summary>
                <ul className="plain">{a.devices.filter((d) => d.extra.length).map((d) => <li key={d.id}><strong>{d.role} ({d.product ?? d.id}):</strong> {d.extra.map((e) => `${e.label} ${e.value}`).join(' · ')}</li>)}</ul>
              </details>
            )}
          </>
        ) : <Empty text="No device_info messages." />}
      </section>

      {a.hrv && (
        <section className="card">
          <h3>Heart rate variability <span className="muted">(RR intervals during the activity)</span></h3>
          <Table headers={['Metric', 'Value']} rows={[
            ['RR intervals recorded', a.hrv.count], ['Used after artefact filter', `${a.hrv.valid} (${fmtPct(a.hrv.artefactPct, 1)} rejected)`],
            ['Mean RR', `${fmtNum(a.hrv.meanRR, 0)} ms (≈ ${fmtNum(a.hrv.meanHr, 0)} bpm)`], ['SDNN', `${fmtNum(a.hrv.sdnn, 1)} ms`], ['RMSSD', `${fmtNum(a.hrv.rmssd, 1)} ms`],
            ['pNN50', fmtPct(a.hrv.pnn50, 1)], ['RR range', `${fmtNum(a.hrv.minRR, 0)}–${fmtNum(a.hrv.maxRR, 0)} ms`],
          ]} />
          <p className="muted small">In-exercise HRV mostly reflects intensity. Compare only with other in-exercise values.</p>
        </section>
      )}

      {s.gps && (
        <section className="card">
          <h3>GPS</h3>
          <Table headers={['Item', 'Value']} rows={[
            ['Start', s.gps.start ? fmtCoord(s.gps.start[0], s.gps.start[1]) : undefined],
            ['End', s.gps.end ? fmtCoord(s.gps.end[0], s.gps.end[1]) : undefined],
            ['Bounding box (SW → NE)', s.gps.bbox ? `${fmtCoord(s.gps.bbox[0], s.gps.bbox[1])} → ${fmtCoord(s.gps.bbox[2], s.gps.bbox[3])}` : undefined],
            ['Coverage', fmtPct(s.gps.coveragePct, 0)],
          ]} />
        </section>
      )}

      {a.profile.length > 0 && (
        <div className="grid">
          {a.profile.map((g) => <KvCard key={g.title} group={g} />)}
        </div>
      )}
    </div>
  );
}

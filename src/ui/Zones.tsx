import type { Histogram, SessionAnalysis, ZoneSet } from '../fit/types';
import { fmtDuration, fmtNum, fmtPct } from '../fit/format';
import { Empty } from './common';

const RAMP = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];

function ZoneBars({ z }: { z: ZoneSet }) {
  const max = Math.max(...z.buckets.map((b) => b.pct), 1);
  return (
    <section className="card">
      <h3>{z.title}</h3>
      <p className="muted small">{z.source === 'device' ? 'As reported by the device.' : 'Computed from the record stream.'}{z.basis ? ` Basis: ${z.basis}.` : ''}</p>
      <div className="bars" role="table">
        {z.buckets.map((b, i) => {
          const range = b.low !== undefined || b.high !== undefined
            ? `${b.low !== undefined ? fmtNum(b.low, 0) : '<'}${b.low !== undefined && b.high !== undefined ? '–' : b.low !== undefined ? '+' : ''}${b.high !== undefined ? fmtNum(b.high, 0) : ''} ${z.units}`
            : '';
          return (
            <div className="bar-row" key={i} role="row">
              <div className="bar-label" role="cell"><strong>{b.label}</strong>{range && <span className="muted"> {range}</span>}</div>
              <div className="bar-track" role="cell" title={`${fmtDuration(b.seconds)} · ${fmtPct(b.pct, 1)}`}>
                <div className="bar-fill" style={{ width: `${(b.pct / max) * 100}%`, background: RAMP[Math.min(RAMP.length - 1, i + 1)] }} />
              </div>
              <div className="bar-value" role="cell">{fmtDuration(b.seconds)} <span className="muted">{fmtPct(b.pct, 1)}</span></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HistBars({ h }: { h: Histogram }) {
  const bins = h.bins;
  const max = Math.max(...bins.map((b) => b.pct), 1);
  const dec = h.binSize < 1 ? 1 : 0;
  return (
    <section className="card">
      <h3>{h.title}</h3>
      <p className="muted small">Time-weighted share of the activity per {h.binSize} {h.units} bin.</p>
      <div className="hist" role="img" aria-label={`${h.title} histogram`}>
        {bins.map((b, i) => (
          <div className="hist-col" key={i} title={`${fmtNum(b.from, dec)}–${fmtNum(b.to, dec)} ${h.units}: ${fmtDuration(b.seconds)} (${fmtPct(b.pct, 1)})`}>
            <div className="hist-bar" style={{ height: `${(b.pct / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="hist-axis">
        <span>{fmtNum(bins[0].from, dec)} {h.units}</span>
        <span>{fmtNum(bins[bins.length - 1].to, dec)} {h.units}</span>
      </div>
      <details className="details">
        <summary>Table</summary>
        <table className="data compact">
          <thead><tr><th>Bin</th><th>Time</th><th>Share</th></tr></thead>
          <tbody>
            {bins.filter((b) => b.seconds > 0).map((b, i) => (
              <tr key={i}><td>{fmtNum(b.from, dec)}–{fmtNum(b.to, dec)} {h.units}</td><td>{fmtDuration(b.seconds)}</td><td>{fmtPct(b.pct, 1)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function Zones({ s }: { s: SessionAnalysis }) {
  if (!s.zones.length && !s.histograms.length) return <Empty text="No zone data or streams suitable for distributions in this file." />;
  return (
    <div className="grid">
      {s.zones.map((z) => <ZoneBars key={z.id} z={z} />)}
      {s.histograms.map((h) => <HistBars key={h.id} h={h} />)}
    </div>
  );
}

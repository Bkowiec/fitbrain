import type { KV, KVGroup } from '../fit/types';

export type Provenance = 'device' | 'computed';

/** Provenance tag: recorded values wear a filled tag, derived values a dashed one. */
export function Tag({ kind, label }: { kind: Provenance | 'ok'; label?: string }) {
  return <span className={`tag ${kind}`}>{label ?? kind}</span>;
}

export function KvCard({ group, prov }: { group: KVGroup; prov?: Provenance }) {
  if (!group.items.length) return null;
  return (
    <section className="card">
      <h3>{group.title}{prov && <Tag kind={prov} />}</h3>
      <KvList items={group.items} />
    </section>
  );
}

/** Columns for a tile grid so rows come out equally filled (10 tiles -> 2 rows of 5 rather than 7 + 3). */
export function balancedCols(n: number, maxPerRow = 7): number {
  if (n <= maxPerRow) return Math.max(1, n);
  return Math.ceil(n / Math.ceil(n / maxPerRow));
}

/** Cells that read as a number (with an optional short unit) are set in the numeric face and right-aligned. */
const NUM_RE = /^[+\-−–]?\d[\d\s.,:+\-−–%/×→]*(?:\s?[A-Za-zµ°%/²]{1,10})?(?:\s\(.*\))?$/u;
export function isNumeric(c: string | number | undefined): boolean {
  if (typeof c === 'number') return true;
  if (!c) return false;
  return NUM_RE.test(c.trim());
}

export function KvList({ items }: { items: KV[] }) {
  return (
    <dl className="kv">
      {items.map((i) => (
        <div key={i.key} className={i.value.length > 60 ? 'kv-row wide' : 'kv-row'}>
          <dt>{i.label}{i.note ? <span className="note">{i.note}</span> : null}</dt>
          <dd className={i.value.length <= 60 && isNumeric(i.value) ? 'num' : undefined}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="muted empty">{text}</p>;
}

export function Table({ headers, rows, caption }: { headers: string[]; rows: (string | number | undefined)[][]; caption?: string }) {
  // A column is numeric when every non-empty cell in it is numeric.
  const numeric = headers.map((_, j) => rows.some((r) => r[j] !== undefined && r[j] !== '') && rows.every((r) => r[j] === undefined || r[j] === '' || isNumeric(r[j])));
  return (
    <div className="table-wrap">
      <table className="data">
        {caption && <caption>{caption}</caption>}
        <thead><tr>{headers.map((h, i) => <th key={i} className={numeric[i] ? 'num' : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={numeric[j] ? 'num' : undefined}>{c === undefined || c === '' ? '–' : c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import type { KV, KVGroup } from '../fit/types';

export function KvCard({ group }: { group: KVGroup }) {
  if (!group.items.length) return null;
  return (
    <section className="card">
      <h3>{group.title}</h3>
      <KvList items={group.items} />
    </section>
  );
}

export function KvList({ items }: { items: KV[] }) {
  return (
    <dl className="kv">
      {items.map((i) => (
        <div key={i.key} className="kv-row">
          <dt>{i.label}{i.note ? <span className="note"> · {i.note}</span> : null}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="muted empty">{text}</p>;
}

export function Table({ headers, rows, caption }: { headers: string[]; rows: (string | number | undefined)[][]; caption?: string }) {
  return (
    <div className="table-wrap">
      <table className="data">
        {caption && <caption>{caption}</caption>}
        <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c === undefined || c === '' ? '–' : c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

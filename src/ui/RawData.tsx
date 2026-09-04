import { useMemo, useState } from 'react';
import type { Analysis, DecodedFit } from '../fit/types';
import { Empty, Table } from './common';

const PAGE = 50;

function download(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RawData({ fit, a }: { fit: DecodedFit; a: Analysis }) {
  const [key, setKey] = useState(fit.messageCounts[0]?.key ?? '');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('');
  const msgs = fit.messages[key] ?? [];
  const pages = Math.max(1, Math.ceil(msgs.length / PAGE));
  const slice = useMemo(() => msgs.slice(page * PAGE, page * PAGE + PAGE), [msgs, page]);
  const shown = useMemo(() => {
    if (!filter.trim()) return slice;
    const f = filter.toLowerCase();
    return slice.filter((m) => JSON.stringify(m).toLowerCase().includes(f));
  }, [slice, filter]);

  return (
    <div className="raw">
      <aside className="raw-side card">
        <h3>Message types</h3>
        <ul className="msglist">
          {fit.messageCounts.map((c) => (
            <li key={c.key}>
              <button className={c.key === key ? 'active' : ''} onClick={() => { setKey(c.key); setPage(0); }}>
                <span>{c.name}</span><span className="count">{c.count}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="stack small-gap">
          <button className="btn" onClick={() => download(fit.fileName.replace(/\.fit$/i, '') + '.messages.json', JSON.stringify(fit.messages, null, 1))}>Download all messages (JSON)</button>
        </div>
      </aside>
      <div className="raw-main stack">
        {fit.devFields.length > 0 && (
          <section className="card">
            <h3>Developer field definitions <span className="muted">({fit.devFields.length})</span></h3>
            <Table headers={['Key', 'Dev index', 'Field #', 'Name', 'Units', 'Native msg/field', 'Application']} rows={fit.devFields.map((d) => [d.key, d.developerDataIndex, d.fieldDefinitionNumber, d.name, d.units, d.nativeMesgNum !== undefined ? `${d.nativeMesgNum}/${d.nativeFieldNum ?? ''}` : undefined, d.appId])} />
            <p className="muted small">Developer fields appear in messages under <code>developerFields</code>, keyed by the "Key" column.</p>
          </section>
        )}
        {(a.unknown.messages.length > 0 || a.unknown.fieldsByMessage.length > 0) && (
          <section className="card">
            <h3>Undocumented data</h3>
            <ul className="plain">
              <li><strong>Unknown message types:</strong> {a.unknown.messages.length ? a.unknown.messages.map((m) => `#${m.num} ×${m.count}`).join(', ') : 'none'}</li>
              <li><strong>Unknown fields in known messages:</strong> {a.unknown.fieldsByMessage.length ? a.unknown.fieldsByMessage.map((f) => `${f.message} [${f.fields.join(', ')}]`).join('; ') : 'none'}</li>
            </ul>
          </section>
        )}
        <section className="card">
          <div className="card-head">
            <h3>{fit.messageCounts.find((c) => c.key === key)?.name ?? key} <span className="muted">({msgs.length})</span></h3>
            <div className="inline">
              <input className="input" placeholder="filter this page…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
              <span className="muted small">page {page + 1} / {pages}</span>
              <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
            </div>
          </div>
          {shown.length ? (
            <ol className="msgs" start={page * PAGE + 1}>
              {shown.map((m, i) => <li key={i}><pre>{JSON.stringify(m, null, 1)}</pre></li>)}
            </ol>
          ) : <Empty text="Nothing to show." />}
        </section>
      </div>
    </div>
  );
}

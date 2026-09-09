import { useId, useMemo, useRef, useState } from 'react';
import type { Activity, ActivityEdits, LibraryFilters } from '../library/model';
import { EMPTY_FILTERS, filterActivities } from '../library/model';
import type { LibraryState } from '../library/useLibrary';
import { fmtDuration, fmtKm, humanize } from '../fit/format';
import { DropZone } from './DropZone';
import { Tag } from './common';
import { ActionMenu } from './ActionMenu';

const PAGE_SIZE = 25;

export function LibraryFeedback({ library }: { library: LibraryState }) {
  const { error, progress, result } = library;
  return <>
    {error && <div className="alert library-feedback" role="alert"><span>{error}</span><button className="btn" disabled={library.busy} onClick={() => void library.retry()}>Refresh library</button></div>}
    {progress && <div className="card library-progress" role="status" aria-live="polite">
      <span>{progress.label}</span><span className="num">{Math.min(progress.current + 1, progress.total)} / {progress.total}</span>
      <progress max={progress.total} value={progress.current} aria-label="Library operation progress" />
    </div>}
    {result && <div className="card library-result" role="status">
      <div className="card-head"><span><strong>{result.added}</strong> {result.restored ? 'restored' : 'imported'} · <strong>{result.duplicates}</strong> duplicates skipped{result.failures.length > 0 && <> · <strong>{result.failures.length}</strong> failed</>}</span>
        <button className="btn" onClick={library.dismissResult}>Dismiss</button></div>
      {result.failures.length > 0 && <details open><summary>Files that could not be imported</summary><ul className="plain">{result.failures.map((failure, i) => <li key={i}>{failure}</li>)}</ul></details>}
    </div>}
  </>;
}

function ActivityEditor({ activity, busy, onSave, onCancel }: { activity: Activity; busy: boolean; onSave: (edits: ActivityEdits) => Promise<boolean>; onCancel: () => void }) {
  const tagsHelp = useId();
  const [title, setTitle] = useState(activity.title);
  const [tags, setTags] = useState(activity.tags.join(', '));
  const [notes, setNotes] = useState(activity.notes);
  return <form className="library-editor" aria-label={`Edit ${activity.title}`} onSubmit={async (event) => {
    event.preventDefault();
    if (await onSave({ title, tags: tags.split(','), notes })) onCancel();
  }}>
    <div className="form-grid">
      <label className="field"><span className="field-label">Activity title</span><input autoFocus className="input" value={title} required onChange={(e) => setTitle(e.target.value)} disabled={busy} /></label>
      <div className="field"><label className="field"><span className="field-label">Tags</span><input className="input" placeholder="easy, trail, race" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} aria-describedby={tagsHelp} /></label><span id={tagsHelp} className="muted small">Separate tags with commas.</span></div>
    </div>
    <label className="field"><span className="field-label">Notes</span><textarea className="input library-notes-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} placeholder="How did the activity feel?" /></label>
    <div className="toolbar"><button className="btn primary" type="submit" disabled={busy || !title.trim()}>Save changes</button><button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
  </form>;
}

function ActivityRow({ activity: a, library, currentId }: { activity: Activity; library: LibraryState; currentId?: string }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  return <article className={`library-activity${currentId === a.id ? ' current' : ''}`} data-testid="activity-row">
    <div className="library-row">
      <div className="library-identity">
        <div className="library-date num"><time dateTime={a.startTime}>{a.localDate} · {a.localTime.slice(0, 5)}</time>{currentId === a.id && <span className="tag">open</span>}</div>
        <button className="library-title" disabled={library.busy} onClick={() => void library.open(a.id)}>{a.title || a.fileName}</button>
        <div className="muted small">{a.sportLabels.join(' / ')}{a.sessionCount > 1 ? ` · ${a.sessionCount} sessions` : ''}</div>
        <div className="library-filename muted small" title={a.fileName}>{a.fileName}</div>
        {a.tags.length > 0 && <div className="library-tags">{a.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
        {a.notes && !editing && <p className="library-note">{a.notes}</p>}
      </div>
      <div className="library-metrics">
        <div><span className="field-label">Distance</span><span className="num">{fmtKm(a.distance)}</span></div>
        <div><span className="field-label">Timer time</span><span className="num">{fmtDuration(a.timerTime)}</span></div>
      </div>
      <div className="library-row-actions">
        <ActionMenu label={`Actions for ${a.title || a.fileName}`} compact disabled={library.busy} actions={[
          { label: 'Edit', onSelect: () => { setEditing(true); setRemoving(false); } },
          { label: 'Remove', danger: true, onSelect: () => { setRemoving(true); setEditing(false); } },
        ]} />
      </div>
    </div>
    {editing && <ActivityEditor activity={a} busy={library.busy} onSave={(edits) => library.edit(a.id, edits)} onCancel={() => setEditing(false)} />}
    {removing && <div className="library-remove">
      <p>Remove “{a.title || a.fileName}” and its notes from this library?</p>
      <div className="toolbar"><button className="btn danger" disabled={library.busy} onClick={() => void library.remove(a.id)}>Remove activity</button><button className="btn" disabled={library.busy} onClick={() => setRemoving(false)}>Cancel</button></div>
    </div>}
  </article>;
}

export function Library({ library, onImport, currentId }: { library: LibraryState; onImport: (files: File[]) => void; currentId?: string }) {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [moreFilters, setMoreFilters] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const { activities, busy, loading } = library;
  const sports = useMemo(() => [...new Set(activities.flatMap((a) => a.sports))].sort(), [activities]);
  const tags = useMemo(() => [...new Set(activities.flatMap((a) => a.tags))].sort(), [activities]);
  const filtered = useMemo(() => filterActivities(activities, filters), [activities, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const update = (key: keyof LibraryFilters, value: string) => { setFilters((prev) => ({ ...prev, [key]: value })); setPage(0); };
  const reset = () => { setFilters(EMPTY_FILTERS); setPage(0); };
  const extraCount = [filters.tag, filters.from, filters.to, filters.sort !== 'newest' ? filters.sort : ''].filter(Boolean).length;
  const filteredBy = [filters.query, filters.sport, filters.tag, filters.from, filters.to].filter(Boolean).length;
  return <div className="library stack" aria-busy={busy || loading}>
    <div className="page-head">
      <div className="titles"><h2>Activity library</h2><p className="muted">Your FIT files, tags and notes, saved in this browser.</p></div>
      {activities.length > 0 && <div className="toolbar">
        <button className="btn primary" disabled={busy || loading} onClick={() => importInput.current?.click()}>Import FIT files</button>
        <ActionMenu label="Backup" disabled={busy || loading} actions={[
          { label: 'Export backup', onSelect: () => void library.backup() },
          { label: 'Restore backup', onSelect: () => restoreInput.current?.click() },
        ]} />
      </div>}
      <input ref={importInput} type="file" hidden multiple accept=".fit,application/octet-stream" aria-label="Import FIT files" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) onImport(files); }} />
      <input ref={restoreInput} type="file" hidden accept=".json,application/json" aria-label="Restore library backup" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void library.restore(file); }} />
    </div>

    {loading ? <p className="empty" role="status">Opening your library…</p> : !activities.length ? <section className="library-empty">
      <DropZone onFiles={onImport} onChoose={() => importInput.current?.click()} busy={busy} />
      <p className="library-empty-footer"><span>Already have a library?</span> <button className="text-button" disabled={busy} onClick={() => restoreInput.current?.click()}>Restore backup</button></p>
    </section> : <>
      <section className="card" aria-label="Library filters">
        <div className="library-filters library-primary-filters">
          <label className="field library-search"><span className="field-label">Search</span><input type="search" className="input" placeholder="Title, file, tag or note" value={filters.query} onChange={(e) => update('query', e.target.value)} /></label>
          <label className="field"><span className="field-label">Sport</span><select className="select" value={filters.sport} onChange={(e) => update('sport', e.target.value)}><option value="">All sports</option>{sports.map((sport) => <option key={sport} value={sport}>{humanize(sport)}</option>)}</select></label>
          <button className="btn filter-toggle" aria-expanded={moreFilters} aria-controls="library-extra-filters" onClick={() => setMoreFilters(!moreFilters)}>More filters{extraCount > 0 && <span className="filter-count">{extraCount}</span>}<span aria-hidden="true">{moreFilters ? '−' : '+'}</span></button>
        </div>
        <div className="library-filters library-extra-filters" id="library-extra-filters" hidden={!moreFilters}>
          <label className="field"><span className="field-label">Tag</span><select className="select" value={filters.tag} onChange={(e) => update('tag', e.target.value)}><option value="">All tags</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
          <label className="field"><span className="field-label">From date</span><input type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={(e) => update('from', e.target.value)} /></label>
          <label className="field"><span className="field-label">To date</span><input type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={(e) => update('to', e.target.value)} /></label>
          <label className="field"><span className="field-label">Sort by</span><select className="select" value={filters.sort} onChange={(e) => update('sort', e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="distance">Longest distance</option><option value="duration">Longest duration</option></select></label>
        </div>
        <div className="library-filter-summary"><span className="muted small" role="status">{filtered.length} of {activities.length} activities</span>{(filteredBy > 0 || extraCount > 0) && <button className="text-button" onClick={reset}>Reset filters</button>}</div>
        {filteredBy > 0 && <div className="filter-chips" aria-label="Active library filters">{([
          ['query', filters.query && `Search: ${filters.query}`], ['sport', filters.sport && humanize(filters.sport)], ['tag', filters.tag && `Tag: ${filters.tag}`], ['from', filters.from && `From: ${filters.from}`], ['to', filters.to && `To: ${filters.to}`],
        ] as const).filter(([, value]) => value).map(([key, label]) => <button className="filter-chip" key={key} aria-label={`Remove filter ${label}`} onClick={() => update(key, '')}>{label}<span aria-hidden="true">×</span></button>)}</div>}
      </section>
      <section className="card library-list" aria-label="Saved activities">
        <div className="card-head"><h3>Saved activities</h3><span className="muted small">Totals across sessions <Tag kind="computed" /></span></div>
        {filtered.length ? filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((a) => <ActivityRow key={a.id} activity={a} library={library} currentId={currentId} />)
          : <div className="empty"><p>No activities match these filters.</p><button className="btn" onClick={reset}>Show all activities</button></div>}
        {pages > 1 && <nav className="library-pagination" aria-label="Library pages"><button className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pages}</span><button className="btn" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
      </section>
    </>}
    {activities.length > 0 && <p className="muted small library-storage-note">Files stay on this device. Export a backup to move your library or keep a copy before clearing browser data. Backups include original FIT files, titles, tags and notes. Restoring adds missing files and keeps existing notes and tags.</p>}
  </div>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AthleteSettings } from '../fit/types';
import type { Activity, ActivityEdits, LoadedActivity, StoredActivity } from './model';
import { fileId } from './model';
import { addActivities, getActivity, librarySnapshot, listActivities, removeActivity, saveHistory, updateActivity } from './store';
import { analyzeFile } from './workerClient';
import { createBackup, downloadBlob, parseBackup } from './backup';
import { hasCurrentHistory } from '../history/model';

export interface LibraryProgress { label: string; current: number; total: number }
export interface ImportResult { added: number; duplicates: number; failures: string[]; restored?: boolean }
const errorMessage = (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError'
  ? 'Browser storage is full. Export a backup and remove activities to free space, then retry.'
  : error instanceof Error ? error.message : String(error);

export function useLibrary(settings: AthleteSettings, onOpen: (loaded: LoadedActivity, id: string, sessionIndex?: number) => void, onRemove: (id: string) => void) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LibraryProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const lock = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => { setActivities(await listActivities()); }, []);
  useEffect(() => {
    let active = true;
    const reload = () => listActivities().then((items) => { if (active) { setActivities(items); setError(null); } })
      .catch((e) => { if (active) setError(`Could not open the library: ${errorMessage(e)}`); })
      .finally(() => { if (active) setLoading(false); });
    void reload();
    const onFocus = () => { if (!lock.current) void reload(); };
    window.addEventListener('focus', onFocus);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('fitbrain-library');
      channel.current.onmessage = onFocus;
    }
    return () => { active = false; window.removeEventListener('focus', onFocus); channel.current?.close(); channel.current = null; };
  }, []);

  const run = async (task: () => Promise<void>): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true); setError(null); setResult(null);
    try { await task(); return true; }
    catch (e) { setError(errorMessage(e)); return false; }
    finally { lock.current = false; setBusy(false); setProgress(null); }
  };
  const changed = async () => { await refresh(); channel.current?.postMessage('changed'); };
  const readStored = async (id: string) => {
    const entry = await getActivity(id);
    if (!entry) throw new Error('This activity is no longer in the library. Refresh the list and try again.');
    setProgress({ label: `Opening ${entry.activity.title}`, current: 0, total: 1 });
    const parsed = await analyzeFile(entry.data, entry.activity.fileName, settings, true);
    return parsed.loaded!;
  };
  const openStored = async (id: string, sessionIndex = 0) => onOpen(await readStored(id), id, sessionIndex);

  const importFiles = (files: File[]) => run(async () => {
    if (!files.length) return;
    const counts: ImportResult = { added: 0, duplicates: 0, failures: [] };
    let single: { loaded: LoadedActivity; id: string } | undefined;
    const known = new Set((await listActivities()).map((a) => a.id));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress({ label: `Importing ${file.name}`, current: i, total: files.length });
      try {
        const data = await file.arrayBuffer();
        const id = await fileId(data);
        if (known.has(id)) {
          counts.duplicates++;
          if (files.length === 1) await openStored(id);
          continue;
        }
        const parsed = await analyzeFile(data, file.name, settings, files.length === 1);
        const activity: Activity = {
          ...parsed.summary, history: parsed.history, id, fileName: file.name, fileSize: data.byteLength, addedAt: new Date().toISOString(),
          title: `${parsed.summary.sportLabels.join(' / ')} · ${parsed.summary.localDate}`, tags: [], notes: '',
        };
        const added = await addActivities([{ activity, data }]);
        counts.added += added.added; counts.duplicates += added.duplicates; known.add(id);
        if (parsed.loaded) single = { loaded: parsed.loaded, id };
      } catch (e) { counts.failures.push(`${file.name}: ${errorMessage(e)}`); }
    }
    await changed();
    setResult(counts);
    if (single) onOpen(single.loaded, single.id);
  });

  const restore = (file: File) => run(async () => {
    setProgress({ label: 'Reading backup', current: 0, total: 1 });
    const files = parseBackup(await file.text());
    const entries: StoredActivity[] = [];
    const known = new Set((await listActivities()).map((a) => a.id));
    let duplicates = 0;
    // Validate hashes and decode every new file before committing the restore as one transaction.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress({ label: `Checking ${file.fileName}`, current: i, total: files.length });
      if (await fileId(file.data) !== file.id) throw new Error(`Backup file ${file.fileName} failed its integrity check. No activities were restored.`);
      if (known.has(file.id)) { duplicates++; continue; }
      const parsed = await analyzeFile(file.data, file.fileName, settings);
      const { data, ...metadata } = file;
      entries.push({ activity: { ...metadata, ...parsed.summary, history: parsed.history, fileSize: data.byteLength }, data });
      known.add(file.id);
    }
    setProgress({ label: 'Saving restored activities', current: files.length, total: files.length || 1 });
    const counts = await addActivities(entries);
    await changed();
    setResult({ added: counts.added, duplicates: counts.duplicates + duplicates, failures: [], restored: true });
  });

  return {
    activities, loading, busy, error, progress, result, importFiles, restore,
    dismissResult: () => setResult(null),
    retry: () => run(refresh),
    open: (id: string, sessionIndex = 0) => run(() => openStored(id, sessionIndex)),
    load: async (id: string) => {
      let loaded: LoadedActivity | undefined;
      await run(async () => { loaded = await readStored(id); });
      return loaded;
    },
    prepareHistory: () => run(async () => {
      const missing = (await listActivities()).filter((a) => !hasCurrentHistory(a, settings));
      const failures: string[] = [];
      for (let i = 0; i < missing.length; i++) {
        const activity = missing[i];
        setProgress({ label: `Preparing trends: ${activity.title}`, current: i, total: missing.length });
        try {
          const entry = await getActivity(activity.id);
          if (!entry) continue;
          const parsed = await analyzeFile(entry.data, activity.fileName, settings);
          await saveHistory(activity.id, parsed.summary, parsed.history);
        } catch (e) { failures.push(`${activity.fileName}: ${errorMessage(e)}`); }
      }
      await changed();
      if (failures.length) throw new Error(`Could not prepare ${failures.length} activities for trends. ${failures.join(' · ')}`);
    }),
    edit: (id: string, edits: ActivityEdits) => run(async () => { await updateActivity(id, edits); await changed(); }),
    remove: (id: string) => run(async () => { await removeActivity(id); await changed(); onRemove(id); }),
    backup: () => run(async () => {
      setProgress({ label: 'Preparing library backup', current: 0, total: 1 });
      downloadBlob(createBackup(await librarySnapshot()), `fitbrain-library-${new Date().toISOString().slice(0, 10)}.json`);
    }),
  };
}

export type LibraryState = ReturnType<typeof useLibrary>;

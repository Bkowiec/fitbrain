import type { Activity, ActivityEdits, StoredActivity } from './model';
import { normalizeTags } from './model';
import type { ActivitySummary } from './model';
import type { ActivityHistory } from '../history/model';

const DB_NAME = 'fitbrain-library';
const ACTIVITIES = 'activities';
const FILES = 'files';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(ACTIVITIES, { keyPath: 'id' });
      db.createObjectStore(FILES, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Close other FitBrain tabs, then retry opening the library.')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

// Resolve writes only after commit; metadata and original bytes always change together.
async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('The library operation was interrupted. Please retry.'));
      tx.onerror = () => { /* onabort reports failed requests after rollback */ };
      try { work(tx, (v) => { value = v; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}

export function listActivities(): Promise<Activity[]> {
  return transaction([ACTIVITIES], 'readonly', (tx, result) => {
    const request = tx.objectStore(ACTIVITIES).getAll();
    request.onsuccess = () => result(request.result);
  });
}

export function getActivity(id: string): Promise<StoredActivity | undefined> {
  return transaction([ACTIVITIES, FILES], 'readonly', (tx, result) => {
    let activity: Activity | undefined;
    const meta = tx.objectStore(ACTIVITIES).get(id);
    meta.onsuccess = () => { activity = meta.result; };
    const file = tx.objectStore(FILES).get(id);
    file.onsuccess = () => result(activity && file.result ? { activity, data: file.result.data } : undefined);
  });
}

/** Add missing files atomically. Existing activities, including their notes, remain untouched. */
export function addActivities(entries: StoredActivity[]): Promise<{ added: number; duplicates: number }> {
  return transaction([ACTIVITIES, FILES], 'readwrite', (tx, result) => {
    const counts = { added: 0, duplicates: 0 };
    result(counts);
    const seen = new Set<string>();
    for (const { activity, data } of entries) {
      if (seen.has(activity.id)) { counts.duplicates++; continue; }
      seen.add(activity.id);
      const store = tx.objectStore(ACTIVITIES);
      const request = store.getKey(activity.id);
      request.onsuccess = () => {
        if (request.result !== undefined) { counts.duplicates++; return; }
        store.add(activity);
        tx.objectStore(FILES).add({ id: activity.id, data });
        counts.added++;
      };
    }
  });
}

export function updateActivity(id: string, edits: ActivityEdits): Promise<void> {
  return transaction([ACTIVITIES], 'readwrite', (tx, result) => {
    const store = tx.objectStore(ACTIVITIES);
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) { tx.abort(); return; }
      store.put({ ...request.result, title: edits.title.trim(), notes: edits.notes, tags: normalizeTags(edits.tags) });
      result(undefined);
    };
  });
}

/** Refresh derived data without replacing user edits or recreating a concurrently removed activity. */
export function saveHistory(id: string, summary: ActivitySummary, history: ActivityHistory): Promise<void> {
  return transaction([ACTIVITIES], 'readwrite', (tx, result) => {
    const store = tx.objectStore(ACTIVITIES);
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...summary, history });
      result(undefined);
    };
  });
}

export function removeActivity(id: string): Promise<void> {
  return transaction([ACTIVITIES, FILES], 'readwrite', (tx, result) => {
    tx.objectStore(ACTIVITIES).delete(id);
    tx.objectStore(FILES).delete(id);
    result(undefined);
  });
}

/** Read one consistent snapshot, including edits made in another browser tab. */
export function librarySnapshot(): Promise<StoredActivity[]> {
  return transaction([ACTIVITIES, FILES], 'readonly', (tx, result) => {
    let activities: Activity[] = [];
    const meta = tx.objectStore(ACTIVITIES).getAll();
    meta.onsuccess = () => { activities = meta.result; };
    const files = tx.objectStore(FILES).getAll();
    files.onsuccess = () => {
      const bytes = new Map<string, ArrayBuffer>(files.result.map((f) => [f.id, f.data]));
      if (activities.some((a) => !bytes.has(a.id))) { tx.abort(); return; }
      result(activities.map((activity) => ({ activity, data: bytes.get(activity.id)! })));
    };
  });
}

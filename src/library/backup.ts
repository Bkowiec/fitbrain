import type { ActivityEdits, StoredActivity } from './model';
import { normalizeTags } from './model';

interface BackupEntry extends ActivityEdits { id: string; fileName: string; addedAt: string; fit: string }
interface Backup { format: 'fitbrain-library'; version: 1; exportedAt: string; activities: BackupEntry[] }
export interface RestoredFile extends ActivityEdits { id: string; fileName: string; addedAt: string; data: ArrayBuffer }

function base64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(''));
}

export function createBackup(entries: StoredActivity[]): Blob {
  const backup: Backup = {
    format: 'fitbrain-library', version: 1, exportedAt: new Date().toISOString(),
    activities: entries.map(({ activity: a, data }) => ({
      id: a.id, fileName: a.fileName, addedAt: a.addedAt, title: a.title, tags: a.tags, notes: a.notes, fit: base64(data),
    })),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Validate the whole manifest before callers start any writes. FIT bytes are verified during restore. */
export function parseBackup(text: string): RestoredFile[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This is not a valid library backup (invalid JSON).'); }
  if (!value || typeof value !== 'object') throw new Error('This is not a FitBrain library backup.');
  const backup = value as Record<string, unknown>;
  if (backup.format !== 'fitbrain-library') throw new Error('Choose a FitBrain library backup, not an activity report.');
  if (backup.version !== 1) throw new Error('This backup version is not supported. Update FitBrain before restoring it.');
  if (!Array.isArray(backup.activities)) throw new Error('The backup is missing its activities.');
  return backup.activities.map((entry: unknown, index) => {
    const invalid = () => new Error(`Backup activity ${index + 1} is invalid. No activities were restored.`);
    if (!entry || typeof entry !== 'object') throw invalid();
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !/^[a-f0-9]{64}$/.test(e.id) || typeof e.fileName !== 'string' || !e.fileName.trim() ||
      typeof e.addedAt !== 'string' || !Number.isFinite(Date.parse(e.addedAt)) || typeof e.title !== 'string' ||
      typeof e.notes !== 'string' || !Array.isArray(e.tags) || !e.tags.every((tag) => typeof tag === 'string') || typeof e.fit !== 'string') throw invalid();
    let raw: string;
    try { raw = atob(e.fit); } catch { throw invalid(); }
    const data = Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
    return { id: e.id, fileName: e.fileName, addedAt: e.addedAt, title: e.title.trim(), notes: e.notes, tags: normalizeTags(e.tags), data };
  });
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import type { Analysis, DecodedFit } from '../fit/types';
import { fmtLocal, isNum } from '../fit/format';
import type { ActivityHistory } from '../history/model';

export interface ActivitySummary {
  startTime: string;
  localDate: string;
  localTime: string;
  sports: string[];
  sportLabels: string[];
  sessionCount: number;
  distance?: number;
  timerTime: number;
}

export interface Activity extends ActivitySummary {
  id: string;
  fileName: string;
  fileSize: number;
  addedAt: string;
  title: string;
  tags: string[];
  notes: string;
  history?: ActivityHistory;
}

export type ActivityEdits = Pick<Activity, 'title' | 'tags' | 'notes'>;
export interface StoredActivity { activity: Activity; data: ArrayBuffer }
export interface LoadedActivity { fit: DecodedFit; analysis: Analysis }

export function summarizeActivity(a: Analysis): ActivitySummary {
  if (!a.sessions.length) throw new Error('The file contains no activity sessions or records.');
  const first = a.sessions.reduce((earliest, s) => s.startTime < earliest.startTime ? s : earliest);
  const distances = a.sessions.map((s) => s.distance).filter(isNum);
  const local = fmtLocal(first.startTime, first.tzOffsetMin);
  return {
    startTime: first.startTime.toISOString(), localDate: local.slice(0, 10), localTime: local.slice(11),
    sports: [...new Set(a.sessions.map((s) => s.sport))],
    sportLabels: [...new Set(a.sessions.map((s) => s.sportLabel))],
    sessionCount: a.sessions.length,
    distance: distances.length ? distances.reduce((sum, d) => sum + d, 0) : undefined,
    timerTime: a.sessions.reduce((sum, s) => sum + s.timerTime, 0),
  };
}

export async function fileId(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export interface LibraryFilters { query: string; sport: string; tag: string; from: string; to: string; sort: 'newest' | 'oldest' | 'distance' | 'duration' }
export const EMPTY_FILTERS: LibraryFilters = { query: '', sport: '', tag: '', from: '', to: '', sort: 'newest' };

export function filterActivities(activities: Activity[], filters: LibraryFilters): Activity[] {
  const query = filters.query.trim().toLowerCase();
  return activities.filter((a) =>
    (!query || [a.title, a.fileName, a.notes, ...a.tags, ...a.sportLabels].join(' ').toLowerCase().includes(query)) &&
    (!filters.sport || a.sports.includes(filters.sport)) &&
    (!filters.tag || a.tags.includes(filters.tag)) &&
    (!filters.from || a.localDate >= filters.from) && (!filters.to || a.localDate <= filters.to)
  ).sort((a, b) => {
    if (filters.sort === 'oldest') return a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id);
    if (filters.sort === 'distance') return (b.distance ?? -1) - (a.distance ?? -1) || b.startTime.localeCompare(a.startTime);
    if (filters.sort === 'duration') return b.timerTime - a.timerTime || b.startTime.localeCompare(a.startTime);
    return b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id);
  });
}

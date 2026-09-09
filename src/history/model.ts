import type { Analysis, AthleteSettings, BestEffort, PeakPower, SpeedMode, ZoneSet } from '../fit/types';
import type { Activity } from '../library/model';
import { fmtLocal, isNum } from '../fit/format';

export const HISTORY_VERSION = 1;
export interface HistorySession {
  index: number;
  startTime: string;
  localDate: string;
  sport: string;
  subSport?: string;
  sportLabel: string;
  speedMode: SpeedMode;
  distance?: number;
  timerTime: number;
  avgSpeed?: number;
  avgHr?: number;
  avgPower?: number;
  ascent?: number;
  decoupling?: number;
  zones: ZoneSet[];
  bestEfforts: BestEffort[];
  peakPower: PeakPower[];
}
export interface ActivityHistory { version: number; settingsKey: string; sessions: HistorySession[] }
export interface HistoryEntry extends HistorySession { activityId: string; title: string; fileName: string; tags: string[]; key: string }

export function historySettingsKey(settings: AthleteSettings): string {
  return JSON.stringify([settings.maxHr, settings.restingHr, settings.lthr, settings.ftp, settings.weightKg, settings.raceDistanceM, settings.raceTimeSec].map((n) => isNum(n) ? n : null));
}

export function hasCurrentHistory(activity: Activity, settings: AthleteSettings): boolean {
  return activity.history?.version === HISTORY_VERSION && activity.history.settingsKey === historySettingsKey(settings);
}

export function summarizeHistory(a: Analysis): ActivityHistory {
  return {
    version: HISTORY_VERSION, settingsKey: historySettingsKey(a.settings),
    sessions: a.sessions.map((s) => ({
      index: s.index, startTime: s.startTime.toISOString(), localDate: fmtLocal(s.startTime, s.tzOffsetMin).slice(0, 10),
      sport: s.sport, subSport: s.subSport, sportLabel: s.sportLabel, speedMode: s.speedMode,
      distance: s.distance, timerTime: s.timerTime,
      avgSpeed: isNum(s.distance) && s.timerTime > 0 ? s.distance / s.timerTime : undefined,
      avgHr: isNum(s.raw.avgHeartRate) ? s.raw.avgHeartRate : s.streams.find((st) => st.field === 'hr')?.avg,
      avgPower: isNum(s.raw.avgPower) ? s.raw.avgPower : s.streams.find((st) => st.field === 'power')?.avg,
      ascent: isNum(s.raw.totalAscent) ? s.raw.totalAscent : undefined,
      decoupling: s.drift?.paceDecouplingPct,
      zones: s.zones.filter((z) => z.source === 'computed'),
      bestEfforts: s.bestEfforts, peakPower: s.peakPower,
    })),
  };
}

export function historyEntries(activities: Activity[], settings: AthleteSettings): HistoryEntry[] {
  return activities.filter((a) => hasCurrentHistory(a, settings)).flatMap((a) => a.history!.sessions.map((s) => ({
    ...s, activityId: a.id, title: a.title || a.fileName, fileName: a.fileName, tags: a.tags, key: `${a.id}:${s.index}`,
  }))).sort((a, b) => a.startTime.localeCompare(b.startTime) || a.key.localeCompare(b.key));
}

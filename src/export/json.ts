import type { Analysis, KV } from '../fit/types';
import { fmtLocal, speedUnitsLabel } from '../fit/format';

const kvObj = (items: KV[]) => Object.fromEntries(items.map((i) => [i.key, { label: i.label, value: i.value, raw: i.raw, units: i.units, note: i.note }]));

export function buildJson(a: Analysis) {
  return {
    generator: 'FitBrain',
    generatedAt: new Date().toISOString(),
    file: kvObj(a.file.items),
    devices: a.devices.map((d) => ({ ...d, extra: kvObj(d.extra) })),
    sessions: a.sessions.map((s) => ({
      index: s.index,
      sport: s.sport,
      subSport: s.subSport,
      sportLabel: s.sportLabel,
      speedUnits: speedUnitsLabel(s.speedMode),
      isRunLike: s.isRunLike,
      startTimeUtc: s.startTime.toISOString(),
      startTimeLocal: fmtLocal(s.startTime, s.tzOffsetMin),
      endTimeUtc: s.endTime.toISOString(),
      tzOffsetMinutes: s.tzOffsetMin,
      timerTimeSec: s.timerTime,
      elapsedTimeSec: s.elapsedTime,
      pausedTimeSec: s.pausedTime,
      distanceM: s.distance,
      summary: Object.fromEntries(s.groups.map((g) => [g.title, kvObj(g.items)])),
      computed: kvObj(s.computed),
      developerFields: kvObj(s.devFields),
      laps: s.laps.map((l) => ({
        index: l.index, startTimeUtc: l.startTime.toISOString(), startTimerSec: l.startTimer, timerTimeSec: l.timerTime, elapsedTimeSec: l.elapsedTime, distanceM: l.distance,
        avgSpeedMps: l.avgSpeed, maxSpeedMps: l.maxSpeed, avgHr: l.avgHr, maxHr: l.maxHr, avgPowerW: l.avgPower, maxPowerW: l.maxPower, normalizedPowerW: l.normalizedPower,
        avgCadence: l.avgCadence, maxCadence: l.maxCadence, ascentM: l.ascent, descentM: l.descent, calories: l.calories, trigger: l.trigger, intensity: l.intensity,
        extra: Object.fromEntries(l.extra.map((e) => [e.key, e.raw ?? e.value])),
      })),
      splits: { everyM: s.splitDistance, rows: s.splits },
      zones: s.zones,
      zoneSense: s.zoneSense,
      developerStreams: s.devStreams,
      histograms: s.histograms,
      streams: s.streams,
      bestEfforts: s.bestEfforts,
      peakPower: s.peakPower,
      halves: s.drift,
      digest: { bucketSec: s.digestBucketSec, rows: s.digest },
      pauses: s.pauses.map((p) => ({ startUtc: p.start.toISOString(), endUtc: p.end.toISOString(), seconds: p.seconds, atTimerSec: p.startTimer, trigger: p.trigger })),
      gps: s.gps,
      quality: kvObj(s.quality),
    })),
    events: a.events.map((e) => ({ timeUtc: e.time.toISOString(), elapsedSec: e.elapsed, event: e.event, type: e.eventType, details: e.details })),
    hrv: a.hrv,
    profile: Object.fromEntries(a.profile.map((g) => [g.title, kvObj(g.items)])),
    unknown: a.unknown,
    messageCounts: a.messageCounts,
    athleteSettings: a.settings,
    athleteParametersUsed: kvObj(a.settingsUsed),
  };
}

export function toJson(a: Analysis): string {
  return JSON.stringify(buildJson(a), (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2);
}

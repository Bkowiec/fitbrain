import type {
  Analysis, AthleteSettings, DecodedFit, DeviceRow, DevStreamDef, EventRow, GpsInfo, KV, KVGroup, LapRow, Msg, Pause, Sample,
  SessionAnalysis, SpeedMode, StreamStat, ZoneSet, Histogram,
} from './types';
import { computeZoneSense } from './zonesense';
import { fieldUnits, messageDisplayName } from './decode';
import {
  fmtCoord, fmtDuration, fmtFixed, fmtKm, fmtLocal, fmtNum, fmtSpeed, fmtTz, humanize, isNum, median,
  semicirclesToDeg, speedModeForSport, toDate, fmtPct, signed,
} from './format';
import {
  bestEfforts, buildTimerMapper, chooseBucketSeconds, computedZoneSet, computeDigest, computeDrift,
  computeSplits, detectGaps, deviceZoneSet, elevationGain, histogram, hrvStats, normalizedPower,
  peakPowers, toGrid, toSeries, type Interval,
} from './metrics';

const G = {
  time: 'Time & distance',
  hr: 'Heart rate',
  speed: 'Speed & pace',
  power: 'Power',
  cad: 'Cadence & running dynamics',
  elev: 'Elevation & environment',
  load: 'Training load & physiology',
  swim: 'Swimming',
  other: 'Other session fields',
};

type Fmt = 'duration' | 'distance' | 'speed' | 'int' | 'num1' | 'num2' | 'date' | 'temp' | 'text' | 'pct' | 'mm' | 'ms'
  | 'cadence' | 'kcal' | 'm' | 'w' | 'bpm' | 'strides' | 'kj' | 'brpm' | 'grade' | 'mps' | 'kg';

interface Spec { label: string; fmt: Fmt; group: string }
const S = (label: string, fmt: Fmt, group: string): Spec => ({ label, fmt, group });

const SESSION_SPECS: Record<string, Spec> = {
  sport: S('Sport', 'text', G.time), subSport: S('Sub-sport', 'text', G.time), sportProfileName: S('Sport profile', 'text', G.time),
  startTime: S('Start time', 'date', G.time), timestamp: S('End time', 'date', G.time),
  totalElapsedTime: S('Elapsed time', 'duration', G.time), totalTimerTime: S('Timer (moving) time', 'duration', G.time),
  totalMovingTime: S('Moving time', 'duration', G.time), totalStandTime: S('Standing time', 'duration', G.time), standCount: S('Stand count', 'int', G.time),
  totalDistance: S('Distance', 'distance', G.time), totalCalories: S('Calories', 'kcal', G.time), totalFatCalories: S('Fat calories', 'kcal', G.time),
  numLaps: S('Laps', 'int', G.time), totalCycles: S('Total cycles', 'int', G.time), totalStrides: S('Total strides', 'strides', G.time),
  totalStrokes: S('Total strokes', 'int', G.swim),
  enhancedAvgSpeed: S('Average speed', 'speed', G.speed), enhancedMaxSpeed: S('Max speed', 'speed', G.speed),
  avgSpeed: S('Average speed', 'speed', G.speed), maxSpeed: S('Max speed', 'speed', G.speed),
  avgHeartRate: S('Average HR', 'bpm', G.hr), maxHeartRate: S('Max HR', 'bpm', G.hr), minHeartRate: S('Min HR', 'bpm', G.hr),
  avgCadence: S('Average cadence', 'cadence', G.cad), maxCadence: S('Max cadence', 'cadence', G.cad),
  avgRunningCadence: S('Average running cadence', 'cadence', G.cad), maxRunningCadence: S('Max running cadence', 'cadence', G.cad),
  avgPower: S('Average power', 'w', G.power), maxPower: S('Max power', 'w', G.power), normalizedPower: S('Normalized Power (device)', 'w', G.power),
  thresholdPower: S('Threshold power (FTP)', 'w', G.power), totalWork: S('Total work', 'kj', G.power), leftRightBalance: S('L/R balance', 'text', G.power),
  avgLeftTorqueEffectiveness: S('Avg left torque effectiveness', 'pct', G.power), avgRightTorqueEffectiveness: S('Avg right torque effectiveness', 'pct', G.power),
  avgLeftPedalSmoothness: S('Avg left pedal smoothness', 'pct', G.power), avgRightPedalSmoothness: S('Avg right pedal smoothness', 'pct', G.power),
  avgCombinedPedalSmoothness: S('Avg combined pedal smoothness', 'pct', G.power), avgLeftPco: S('Avg left platform center offset', 'mm', G.power), avgRightPco: S('Avg right platform center offset', 'mm', G.power),
  totalAscent: S('Total ascent', 'm', G.elev), totalDescent: S('Total descent', 'm', G.elev),
  enhancedMinAltitude: S('Min altitude', 'm', G.elev), enhancedMaxAltitude: S('Max altitude', 'm', G.elev), enhancedAvgAltitude: S('Average altitude', 'm', G.elev),
  minAltitude: S('Min altitude', 'm', G.elev), maxAltitude: S('Max altitude', 'm', G.elev), avgAltitude: S('Average altitude', 'm', G.elev),
  avgGrade: S('Average grade', 'grade', G.elev), avgPosGrade: S('Average positive grade', 'grade', G.elev), avgNegGrade: S('Average negative grade', 'grade', G.elev),
  maxPosGrade: S('Max positive grade', 'grade', G.elev), maxNegGrade: S('Max negative grade', 'grade', G.elev),
  avgPosVerticalSpeed: S('Avg positive vertical speed', 'mps', G.elev), avgNegVerticalSpeed: S('Avg negative vertical speed', 'mps', G.elev),
  maxPosVerticalSpeed: S('Max positive vertical speed', 'mps', G.elev), maxNegVerticalSpeed: S('Max negative vertical speed', 'mps', G.elev),
  avgTemperature: S('Average temperature', 'temp', G.elev), maxTemperature: S('Max temperature', 'temp', G.elev), minTemperature: S('Min temperature', 'temp', G.elev),
  trainingStressScore: S('Training Stress Score (TSS, device)', 'num1', G.load), intensityFactor: S('Intensity Factor (IF, device)', 'num2', G.load),
  totalTrainingEffect: S('Aerobic training effect (0-5)', 'num1', G.load), totalAnaerobicTrainingEffect: S('Anaerobic training effect (0-5)', 'num1', G.load),
  trainingLoadPeak: S('Training load peak', 'num1', G.load),
  enhancedAvgRespirationRate: S('Average respiration rate', 'brpm', G.load), enhancedMaxRespirationRate: S('Max respiration rate', 'brpm', G.load),
  enhancedMinRespirationRate: S('Min respiration rate', 'brpm', G.load), avgRespirationRate: S('Average respiration rate', 'brpm', G.load),
  maxRespirationRate: S('Max respiration rate', 'brpm', G.load), minRespirationRate: S('Min respiration rate', 'brpm', G.load),
  avgVerticalOscillation: S('Average vertical oscillation', 'mm', G.cad), avgStanceTime: S('Average ground contact time', 'ms', G.cad),
  avgStanceTimePercent: S('Ground contact time share', 'pct', G.cad), avgStanceTimeBalance: S('Ground contact balance (left)', 'pct', G.cad),
  avgStepLength: S('Average step length', 'mm', G.cad), avgVerticalRatio: S('Average vertical ratio', 'pct', G.cad),
  poolLength: S('Pool length', 'm', G.swim), poolLengthUnit: S('Pool length unit', 'text', G.swim), numLengths: S('Lengths', 'int', G.swim),
  numActiveLengths: S('Active lengths', 'int', G.swim), avgStrokeDistance: S('Avg distance per stroke', 'm', G.swim), avgStrokeCount: S('Avg strokes per length', 'num1', G.swim),
  swimStroke: S('Swim stroke', 'text', G.swim),
};

const SKIP_SESSION = new Set([
  'messageIndex', 'event', 'eventType', 'eventGroup', 'developerFields', 'firstLapIndex', 'sportIndex',
  'timeInHrZone', 'timeInSpeedZone', 'timeInCadenceZone', 'timeInPowerZone',
  'avgFractionalCadence', 'maxFractionalCadence', 'totalFractionalCycles', 'totalFractionalAscent', 'totalFractionalDescent',
  'startPositionLat', 'startPositionLong', 'endPositionLat', 'endPositionLong', 'necLat', 'necLong', 'swcLat', 'swcLong',
]);

const LAP_MAPPED = new Set([
  'startTime', 'timestamp', 'totalTimerTime', 'totalElapsedTime', 'totalDistance', 'enhancedAvgSpeed', 'avgSpeed', 'enhancedMaxSpeed', 'maxSpeed',
  'avgHeartRate', 'maxHeartRate', 'avgPower', 'maxPower', 'normalizedPower', 'avgCadence', 'avgRunningCadence', 'maxCadence', 'maxRunningCadence',
  'totalAscent', 'totalDescent', 'totalCalories', 'lapTrigger', 'intensity', 'messageIndex', 'event', 'eventType', 'eventGroup', 'sport', 'subSport',
  'developerFields', 'timeInHrZone', 'timeInSpeedZone', 'timeInCadenceZone', 'timeInPowerZone', 'avgFractionalCadence', 'maxFractionalCadence',
  'startPositionLat', 'startPositionLong', 'endPositionLat', 'endPositionLong',
]);

interface Ctx { speedMode: SpeedMode; isRunLike: boolean; tz?: number }

function fmtValue(fmt: Fmt, v: unknown, ctx: Ctx): { value: string; units?: string } {
  if (v === undefined || v === null) return { value: '–' };
  const n = typeof v === 'number' ? v : NaN;
  switch (fmt) {
    case 'duration': return { value: fmtDuration(n), units: 's' };
    case 'distance': return { value: fmtKm(n), units: 'm' };
    case 'speed': return { value: fmtSpeed(n, ctx.speedMode) + (ctx.speedMode !== 'kmh' ? ` (${fmtNum(n * 3.6, 1)} km/h)` : ''), units: 'm/s' };
    case 'mps': return { value: `${fmtNum(n, 2)} m/s`, units: 'm/s' };
    case 'int': return { value: fmtNum(n, 0) };
    case 'num1': return { value: fmtNum(n, 1) };
    case 'num2': return { value: fmtNum(n, 2) };
    case 'date': return { value: fmtLocal(toDate(v), ctx.tz), units: 'local time' };
    case 'temp': return { value: `${fmtNum(n, 0)} °C`, units: '°C' };
    case 'pct': return { value: `${fmtNum(n, 1)} %`, units: '%' };
    case 'grade': return { value: `${fmtNum(n, 1)} %`, units: '%' };
    case 'mm': return { value: `${fmtNum(n, 1)} mm`, units: 'mm' };
    case 'ms': return { value: `${fmtNum(n, 0)} ms`, units: 'ms' };
    case 'kcal': return { value: `${fmtNum(n, 0)} kcal`, units: 'kcal' };
    case 'kj': return { value: `${fmtNum(n / 1000, 0)} kJ`, units: 'J' };
    case 'm': return { value: `${fmtNum(n, 0)} m`, units: 'm' };
    case 'w': return { value: `${fmtNum(n, 0)} W`, units: 'W' };
    case 'bpm': return { value: `${fmtNum(n, 0)} bpm`, units: 'bpm' };
    case 'brpm': return { value: `${fmtNum(n, 1)} breaths/min`, units: 'breaths/min' };
    case 'kg': return { value: `${fmtNum(n, 1)} kg`, units: 'kg' };
    case 'cadence':
      return ctx.isRunLike
        ? { value: `${fmtNum(n, 0)} strides/min (≈${fmtNum(n * 2, 0)} steps/min)`, units: 'strides/min' }
        : { value: `${fmtNum(n, 0)} rpm`, units: 'rpm' };
    case 'strides':
      return ctx.isRunLike
        ? { value: `${fmtNum(n, 0)} strides (≈${fmtNum(n * 2, 0)} steps)`, units: 'strides' }
        : { value: `${fmtNum(n, 0)} cycles`, units: 'cycles' };
    case 'text':
    default:
      return { value: typeof v === 'string' ? humanize(v) : String(v) };
  }
}

/** Generic formatting for fields without a spec. */
export function fmtGeneric(v: unknown, units: string, tz?: number): string {
  if (v === undefined || v === null) return '–';
  if (v instanceof Date) return fmtLocal(v, tz);
  if (typeof v === 'number') return units ? `${fmtNum(v, 3)} ${units}` : fmtNum(v, 3);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? fmtNum(x, 3) : String(x))).join(', ') + (units ? ` ${units}` : '');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') return /^[a-z][A-Za-z0-9]*$/.test(v) ? humanize(v) : v;
  return String(v);
}

function genericItems(msg: Msg, messagesKey: string, skip: Set<string>, tz?: number): KV[] {
  const items: KV[] = [];
  for (const [k, v] of Object.entries(msg)) {
    if (skip.has(k) || v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    const units = fieldUnits(messagesKey, k);
    const label = /^\d+$/.test(k) ? `Unknown field #${k}` : humanize(k);
    items.push({ key: k, label, value: fmtGeneric(v, units, tz), units: units || undefined, raw: v });
  }
  return items;
}

function pausesFromEvents(events: Msg[], startMs: number, endMs: number, timerAt: (ts: number) => number): Pause[] {
  const out: Pause[] = [];
  let open: { ts: number; trigger?: string } | undefined;
  const sorted = events
    .filter((e) => e.event === 'timer' && toDate(e.timestamp))
    .sort((a, b) => toDate(a.timestamp)!.getTime() - toDate(b.timestamp)!.getTime());
  for (const e of sorted) {
    const ts = toDate(e.timestamp)!.getTime();
    if (ts < startMs - 1000 || ts > endMs + 1000) continue;
    const t = String(e.eventType ?? '');
    if (t.startsWith('stop')) {
      if (!open) open = { ts, trigger: e.timerTrigger ? String(e.timerTrigger) : undefined };
    } else if (t === 'start' && open) {
      if (ts - open.ts > 500) {
        out.push({ start: new Date(open.ts), end: new Date(ts), seconds: (ts - open.ts) / 1000, startTimer: 0, trigger: open.trigger ? humanize(open.trigger) : undefined });
      }
      open = undefined;
    }
  }
  // A trailing stop is the end of the session, not a pause.
  for (const p of out) p.startTimer = timerAt(p.start.getTime());
  return out;
}

function toSample(r: Msg, startMs: number, timerAt: (ts: number) => number, devNames: Record<string, string>): Sample | undefined {
  const d = toDate(r.timestamp);
  if (!d) return undefined;
  const ts = d.getTime();
  const s: Sample = { ts, elapsed: (ts - startMs) / 1000, timer: timerAt(ts) };
  const num = (v: unknown) => (isNum(v) ? v : undefined);
  s.dist = num(r.distance);
  s.speed = num(r.enhancedSpeed) ?? num(r.speed);
  s.hr = num(r.heartRate);
  s.power = num(r.power);
  s.cadence = num(r.cadence);
  if (isNum(s.cadence) && isNum(r.fractionalCadence)) s.cadence += r.fractionalCadence;
  s.alt = num(r.enhancedAltitude) ?? num(r.altitude);
  s.temp = num(r.temperature);
  if (isNum(r.positionLat) && isNum(r.positionLong)) {
    s.lat = semicirclesToDeg(r.positionLat);
    s.lon = semicirclesToDeg(r.positionLong);
  }
  s.vo = num(r.verticalOscillation);
  s.stance = num(r.stanceTime);
  s.stanceBalance = num(r.stanceTimeBalance);
  s.stepLength = num(r.stepLength);
  s.vratio = num(r.verticalRatio);
  s.lrBalance = num(r.leftRightBalance);
  s.grade = num(r.grade);
  s.respiration = num(r.enhancedRespirationRate) ?? num(r.respirationRate);
  const known = new Set(['timestamp', 'distance', 'enhancedSpeed', 'speed', 'heartRate', 'power', 'cadence', 'fractionalCadence', 'enhancedAltitude', 'altitude',
    'temperature', 'positionLat', 'positionLong', 'verticalOscillation', 'stanceTime', 'stanceTimeBalance', 'stepLength', 'verticalRatio', 'leftRightBalance',
    'grade', 'enhancedRespirationRate', 'respirationRate', 'developerFields']);
  for (const [k, v] of Object.entries(r)) {
    if (known.has(k) || !isNum(v)) continue;
    (s.extra ??= {})[k] = v;
  }
  if (r.developerFields && typeof r.developerFields === 'object') {
    for (const [k, v] of Object.entries(r.developerFields)) {
      if (!isNum(v)) continue;
      (s.extra ??= {})[`dev:${devNames[k] ?? k}`] = v;
    }
  }
  return s;
}

interface StreamDef { field: string; label: string; units: string; get: (s: Sample) => number | undefined }

function streamStats(samples: Sample[], defs: StreamDef[]): StreamStat[] {
  const out: StreamStat[] = [];
  for (const d of defs) {
    let count = 0; let min = Infinity; let max = -Infinity; let sum = 0;
    for (const s of samples) {
      const v = d.get(s);
      if (!isNum(v)) continue;
      count++; sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!count) continue;
    out.push({ field: d.field, label: d.label, units: d.units, count, coverage: count / Math.max(1, samples.length), min, avg: sum / count, max });
  }
  return out;
}

function lapRow(l: Msg, i: number, timerAt: (ts: number) => number, tz?: number): LapRow {
  const st = toDate(l.startTime) ?? toDate(l.timestamp) ?? new Date(0);
  const num = (v: unknown) => (isNum(v) ? v : undefined);
  return {
    index: i + 1,
    startTime: st,
    startTimer: timerAt(st.getTime()),
    timerTime: num(l.totalTimerTime), elapsedTime: num(l.totalElapsedTime), distance: num(l.totalDistance),
    avgSpeed: num(l.enhancedAvgSpeed) ?? num(l.avgSpeed), maxSpeed: num(l.enhancedMaxSpeed) ?? num(l.maxSpeed),
    avgHr: num(l.avgHeartRate), maxHr: num(l.maxHeartRate), avgPower: num(l.avgPower), maxPower: num(l.maxPower), normalizedPower: num(l.normalizedPower),
    avgCadence: num(l.avgRunningCadence) ?? num(l.avgCadence), maxCadence: num(l.maxRunningCadence) ?? num(l.maxCadence),
    ascent: num(l.totalAscent), descent: num(l.totalDescent), calories: num(l.totalCalories),
    trigger: l.lapTrigger !== undefined ? humanize(String(l.lapTrigger)) : undefined, intensity: l.intensity !== undefined ? humanize(String(l.intensity)) : undefined,
    extra: genericItems(l, 'lapMesgs', LAP_MAPPED, tz),
    raw: l,
  };
}

function deviceRows(infos: Msg[], fileId: Msg, tz?: number): DeviceRow[] {
  const groups = new Map<string, Msg[]>();
  for (const m of infos) {
    const key = m.deviceIndex !== undefined ? `idx:${m.deviceIndex}` : m.serialNumber !== undefined ? `sn:${m.serialNumber}` : `mp:${m.manufacturer}/${m.product}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const rows: DeviceRow[] = [];
  const mapped = new Set(['timestamp', 'deviceIndex', 'manufacturer', 'product', 'productName', 'garminProduct', 'faveroProduct', 'serialNumber', 'softwareVersion',
    'hardwareVersion', 'batteryLevel', 'batteryStatus', 'batteryVoltage', 'deviceType', 'antplusDeviceType', 'antDeviceType', 'sourceType', 'developerFields']);
  for (const [id, msgs] of groups) {
    const first = msgs[0];
    const last = msgs[msgs.length - 1];
    const idx = first.deviceIndex;
    const sameAsCreator = fileId.manufacturer !== undefined && String(first.manufacturer) === String(fileId.manufacturer)
      && (fileId.product === undefined || String(first.product ?? first.productName) === String(fileId.product ?? fileId.productName));
    const role = idx === 0 || idx === 'creator' || (idx === undefined && sameAsCreator) ? 'Primary device (creator)'
      : humanize(String(first.antplusDeviceType ?? first.deviceType ?? first.antDeviceType ?? first.sourceType ?? 'sensor'));
    const product = first.productName ?? first.garminProduct ?? first.faveroProduct ?? first.product;
    const battParts: string[] = [];
    if (isNum(first.batteryLevel) && isNum(last.batteryLevel)) battParts.push(first.batteryLevel === last.batteryLevel ? `${last.batteryLevel}%` : `${first.batteryLevel}% → ${last.batteryLevel}% (-${first.batteryLevel - last.batteryLevel} pp)`);
    else if (isNum(last.batteryLevel)) battParts.push(`${last.batteryLevel}%`);
    if (last.batteryStatus !== undefined) battParts.push(humanize(String(last.batteryStatus)));
    if (isNum(last.batteryVoltage)) battParts.push(`${fmtNum(last.batteryVoltage, 2)} V`);
    rows.push({
      id, role,
      manufacturer: first.manufacturer !== undefined ? humanize(String(first.manufacturer)) : undefined,
      product: product !== undefined ? String(product) : undefined,
      serial: first.serialNumber !== undefined ? String(first.serialNumber) : undefined,
      software: isNum(first.softwareVersion) ? String(first.softwareVersion) : undefined,
      hardware: first.hardwareVersion !== undefined ? String(first.hardwareVersion) : undefined,
      battery: battParts.length ? battParts.join(', ') : undefined,
      source: first.sourceType !== undefined ? humanize(String(first.sourceType)) : undefined,
      antDeviceType: first.antplusDeviceType !== undefined ? humanize(String(first.antplusDeviceType)) : undefined,
      extra: genericItems(last, 'deviceInfoMesgs', mapped, tz),
    });
  }
  return rows;
}

function eventRows(events: Msg[], startMs: number): EventRow[] {
  const skip = new Set(['timestamp', 'event', 'eventType', 'eventGroup', 'developerFields']);
  return events
    .filter((e) => toDate(e.timestamp))
    .map((e) => {
      const t = toDate(e.timestamp)!;
      const details = Object.entries(e)
        .filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null)
        .map(([k, v]) => `${humanize(k)}: ${fmtGeneric(v, fieldUnits('eventMesgs', k))}`)
        .join('; ');
      return { time: t, elapsed: (t.getTime() - startMs) / 1000, event: humanize(String(e.event ?? 'unknown')), eventType: humanize(String(e.eventType ?? '')), details };
    })
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}

function tzOffsetMinutes(activity: Msg | undefined): number | undefined {
  if (!activity) return undefined;
  const ts = toDate(activity.timestamp);
  const local = toDate(activity.localTimestamp);
  if (!ts || !local) return undefined;
  const off = Math.round((local.getTime() - ts.getTime()) / 60000);
  return Math.abs(off) <= 16 * 60 ? off : undefined;
}

const PROFILE_KEYS = [
  'fileCreatorMesgs', 'userProfileMesgs', 'zonesTargetMesgs', 'sportMesgs', 'hrZoneMesgs', 'powerZoneMesgs', 'speedZoneMesgs', 'cadenceZoneMesgs',
  'timeInZoneMesgs', 'trainingFileMesgs', 'workoutMesgs', 'workoutStepMesgs', 'deviceSettingsMesgs', 'splitSummaryMesgs', 'splitMesgs', 'bikeProfileMesgs',
  'trainingSettingsMesgs', 'softwareMesgs',
];

function profileGroups(fit: DecodedFit, tz?: number): KVGroup[] {
  const groups: KVGroup[] = [];
  for (const key of PROFILE_KEYS) {
    const msgs = fit.messages[key];
    if (!msgs?.length) continue;
    const title = messageDisplayName(key);
    if (msgs.length === 1) {
      const items = genericItems(msgs[0], key, new Set(['developerFields']), tz);
      if (items.length) groups.push({ title, items });
    } else {
      const items: KV[] = msgs.slice(0, 60).map((m, i) => ({
        key: String(i),
        label: `#${i + 1}`,
        value: genericItems(m, key, new Set(['developerFields', 'messageIndex']), tz).map((kv) => `${kv.label}: ${kv.value}`).join('; '),
        raw: m,
      }));
      if (msgs.length > 60) items.push({ key: 'more', label: '…', value: `${msgs.length - 60} more messages (see raw data)` });
      groups.push({ title: `${title} (${msgs.length})`, items });
    }
  }
  return groups;
}

function analyzeSession(fit: DecodedFit, s: Msg, index: number, ctxIn: {
  records: Msg[]; laps: Msg[]; events: Msg[]; tz?: number; single: boolean; total: number; settings: AthleteSettings;
}): SessionAnalysis {
  const settings = ctxIn.settings;
  const sport = String(s.sport ?? 'generic');
  const subSport = s.subSport !== undefined && String(s.subSport) !== 'generic' ? String(s.subSport) : undefined;
  const speedMode = speedModeForSport(sport, subSport);
  const isRunLike = speedMode === 'pace_km';
  const ctx: Ctx = { speedMode, isRunLike, tz: ctxIn.tz };
  const sportLabel = humanize(sport) + (subSport ? ` / ${humanize(subSport)}` : '');

  const start = toDate(s.startTime) ?? toDate(ctxIn.records[0]?.timestamp) ?? new Date(0);
  const startMs = start.getTime();
  const elapsedField = isNum(s.totalElapsedTime) ? s.totalElapsedTime : undefined;
  const end = toDate(s.timestamp) ?? new Date(startMs + (elapsedField ?? 0) * 1000);
  const endMs = Math.max(end.getTime(), startMs);
  const inRange = (m: Msg, field: string) => {
    const d = toDate(m[field]);
    return !!d && d.getTime() >= startMs - 2000 && d.getTime() <= endMs + 2000;
  };
  const records = ctxIn.single ? ctxIn.records : ctxIn.records.filter((r) => inRange(r, 'timestamp'));
  const laps = ctxIn.single ? ctxIn.laps : ctxIn.laps.filter((l) => inRange(l, 'startTime'));
  const events = ctxIn.single ? ctxIn.events : ctxIn.events.filter((e) => inRange(e, 'timestamp'));

  // Pauses & timer mapping
  const tsList = records.map((r) => toDate(r.timestamp)!.getTime()).sort((a, b) => a - b);
  let pauseIntervals: Interval[] = [];
  let pausesSource = 'timer events';
  const identity = (ts: number) => Math.max(0, (ts - startMs) / 1000);
  let pauses = pausesFromEvents(events, startMs, endMs, identity);
  if (pauses.length) {
    pauseIntervals = pauses.map((p) => ({ startMs: p.start.getTime(), endMs: p.end.getTime() }));
  } else {
    const dts: number[] = [];
    for (let i = 1; i < tsList.length; i++) dts.push((tsList[i] - tsList[i - 1]) / 1000);
    const med = median(dts) ?? 1;
    const timerField = isNum(s.totalTimerTime) ? s.totalTimerTime : undefined;
    if (elapsedField !== undefined && timerField !== undefined && elapsedField - timerField > 5) {
      pauseIntervals = detectGaps(tsList, Math.max(15, med * 5));
      pausesSource = pauseIntervals.length ? 'record gaps (no timer events in file)' : 'none detected';
      pauses = pauseIntervals.map((g) => ({ start: new Date(g.startMs), end: new Date(g.endMs), seconds: (g.endMs - g.startMs) / 1000, startTimer: 0, trigger: 'gap' }));
    }
  }
  const timerAt = buildTimerMapper(startMs, pauseIntervals);
  for (const p of pauses) p.startTimer = timerAt(p.start.getTime());

  const devNames: Record<string, string> = {};
  for (const d of fit.devFields) devNames[String(d.key)] = d.name;

  const samples = records
    .map((r) => toSample(r, startMs, timerAt, devNames))
    .filter((x): x is Sample => !!x)
    .sort((a, b) => a.ts - b.ts);
  for (let i = 1; i < samples.length; i++) if (samples[i].timer < samples[i - 1].timer) samples[i].timer = samples[i - 1].timer;

  const timerTime = isNum(s.totalTimerTime) ? s.totalTimerTime : samples.length ? samples[samples.length - 1].timer : 0;
  const elapsedTime = elapsedField ?? (endMs - startMs) / 1000;
  const pausedTime = Math.max(0, elapsedTime - timerTime);
  const distance = isNum(s.totalDistance) ? s.totalDistance : samples.length ? samples[samples.length - 1].dist : undefined;

  // Streams
  const defs: StreamDef[] = [
    { field: 'hr', label: 'Heart rate', units: 'bpm', get: (x) => x.hr },
    { field: 'speed', label: 'Speed', units: 'm/s', get: (x) => x.speed },
    { field: 'power', label: 'Power', units: 'W', get: (x) => x.power },
    { field: 'cadence', label: isRunLike ? 'Cadence (strides/min)' : 'Cadence', units: isRunLike ? 'strides/min' : 'rpm', get: (x) => x.cadence },
    { field: 'alt', label: 'Altitude', units: 'm', get: (x) => x.alt },
    { field: 'temp', label: 'Temperature', units: '°C', get: (x) => x.temp },
    { field: 'dist', label: 'Distance', units: 'm', get: (x) => x.dist },
    { field: 'vo', label: 'Vertical oscillation', units: 'mm', get: (x) => x.vo },
    { field: 'stance', label: 'Ground contact time', units: 'ms', get: (x) => x.stance },
    { field: 'stanceBalance', label: 'Ground contact balance', units: '%', get: (x) => x.stanceBalance },
    { field: 'stepLength', label: 'Step length', units: 'mm', get: (x) => x.stepLength },
    { field: 'vratio', label: 'Vertical ratio', units: '%', get: (x) => x.vratio },
    { field: 'lrBalance', label: 'L/R balance', units: '', get: (x) => x.lrBalance },
    { field: 'grade', label: 'Grade', units: '%', get: (x) => x.grade },
    { field: 'respiration', label: 'Respiration rate', units: 'breaths/min', get: (x) => x.respiration },
  ];
  const extraKeys = new Set<string>();
  for (const smp of samples) if (smp.extra) for (const k of Object.keys(smp.extra)) extraKeys.add(k);
  const DEV_LABELS: Record<string, string> = { ddfa: 'DDFA index (ZoneSense)' };
  for (const k of extraKeys) {
    const isDev = k.startsWith('dev:');
    const name = isDev ? k.slice(4) : k;
    const units = isDev ? (fit.devFields.find((d) => d.name === name)?.units ?? '') : fieldUnits('recordMesgs', k);
    defs.push({ field: k, label: isDev ? (DEV_LABELS[name] ?? `${humanize(name)} (developer)`) : humanize(name), units, get: (x) => x.extra?.[k] });
  }
  const streams = streamStats(samples, defs);
  const has = (f: string) => streams.some((st) => st.field === f && st.coverage > 0.02);
  const streamOf = (f: string) => streams.find((st) => st.field === f);
  const devStreams: DevStreamDef[] = streams
    .filter((st) => extraKeys.has(st.field) && st.coverage > 0.02)
    .map((st) => ({ key: st.field, label: st.label, units: st.units, coverage: st.coverage, isDeveloper: st.field.startsWith('dev:') }));

  // Splits
  const splitDistance = speedMode === 'pace_100m' ? 100 : speedMode === 'kmh' ? 5000 : 1000;
  const splits = has('dist') ? computeSplits(samples, splitDistance) : [];

  // Zones & histograms
  const zones: ZoneSet[] = [];
  const histograms: Histogram[] = [];
  const hrZoneHighs = (fit.messages.hrZoneMesgs ?? []).map((z) => z.highBpm).filter(isNum) as number[];
  const pwrZoneHighs = (fit.messages.powerZoneMesgs ?? []).map((z) => z.highValue).filter(isNum) as number[];
  const spdZoneHighs = (fit.messages.speedZoneMesgs ?? []).map((z) => z.highValue).filter(isNum) as number[];
  const dz = (id: string, title: string, arr: unknown, units: string, highs?: number[]) => {
    const z = deviceZoneSet(id, title, arr, units, highs && highs.length ? highs : undefined);
    if (z) zones.push(z);
  };
  dz('hr_device', 'Heart rate zones (device)', s.timeInHrZone, 'bpm', hrZoneHighs);
  dz('power_device', 'Power zones (device)', s.timeInPowerZone, 'W', pwrZoneHighs);
  dz('speed_device', 'Speed zones (device)', s.timeInSpeedZone, 'm/s', spdZoneHighs);
  dz('cadence_device', 'Cadence zones (device)', s.timeInCadenceZone, 'rpm');

  const zonesTarget = fit.messages.zonesTargetMesgs?.[0];
  const userProfile = fit.messages.userProfileMesgs?.[0];
  // Basis for % max HR: athlete settings, then values stored in the file. Never the activity's own peak HR,
  // because zones relative to the observed maximum are physiologically meaningless.
  let maxHrBasis: number | undefined;
  let maxHrBasisLabel = '';
  if (isNum(settings.maxHr) && settings.maxHr > 0) { maxHrBasis = settings.maxHr; maxHrBasisLabel = 'max HR from athlete settings'; }
  else if (isNum(zonesTarget?.maxHeartRate)) { maxHrBasis = zonesTarget!.maxHeartRate; maxHrBasisLabel = 'max HR from zones_target in file'; }
  else if (isNum(userProfile?.defaultMaxHeartRate)) { maxHrBasis = userProfile!.defaultMaxHeartRate; maxHrBasisLabel = 'max HR from user profile in file'; }
  const lthr = isNum(settings.lthr) && settings.lthr > 0 ? settings.lthr : isNum(zonesTarget?.thresholdHeartRate) ? zonesTarget!.thresholdHeartRate : undefined;
  const lthrLabel = isNum(settings.lthr) ? 'athlete settings' : 'zones_target in file';
  const restingHr = isNum(settings.restingHr) && settings.restingHr > 0 ? settings.restingHr : isNum(userProfile?.restingHeartRate) ? userProfile!.restingHeartRate : undefined;
  const weightKg = isNum(settings.weightKg) && settings.weightKg > 0 ? settings.weightKg : isNum(userProfile?.weight) ? userProfile!.weight : undefined;
  if (has('hr') && isNum(maxHrBasis)) {
    const pcts = [50, 60, 70, 80, 90];
    const bounds = [
      { label: 'Z1 (50-60%)', low: maxHrBasis * pcts[0] / 100, high: maxHrBasis * pcts[1] / 100 },
      { label: 'Z2 (60-70%)', low: maxHrBasis * pcts[1] / 100, high: maxHrBasis * pcts[2] / 100 },
      { label: 'Z3 (70-80%)', low: maxHrBasis * pcts[2] / 100, high: maxHrBasis * pcts[3] / 100 },
      { label: 'Z4 (80-90%)', low: maxHrBasis * pcts[3] / 100, high: maxHrBasis * pcts[4] / 100 },
      { label: 'Z5 (90-100%+)', low: maxHrBasis * pcts[4] / 100 },
    ];
    const below = { label: 'below Z1 (<50%)', high: maxHrBasis * 0.5 };
    const z = computedZoneSet('hr_computed', 'Heart rate zones (% of max HR, computed)', samples, (x) => x.hr, [below, ...bounds], 'bpm', `${Math.round(maxHrBasis)} bpm = ${maxHrBasisLabel}`);
    if (z) zones.push(z);
  }
  if (has('hr') && isNum(lthr) && lthr > 0) {
    const b = (label: string, lo?: number, hi?: number) => ({ label, low: lo !== undefined ? lthr * lo : undefined, high: hi !== undefined ? lthr * hi : undefined });
    const z = computedZoneSet('hr_lthr', 'Heart rate zones (% of LTHR, Coggan, computed)', samples, (x) => x.hr, [
      b('Z1 Recovery (<68%)', undefined, 0.68), b('Z2 Aerobic (68-83%)', 0.68, 0.83), b('Z3 Tempo (83-94%)', 0.83, 0.94),
      b('Z4 Threshold (94-105%)', 0.94, 1.05), b('Z5 Anaerobic (>105%)', 1.05),
    ], 'bpm', `LTHR ${Math.round(lthr)} bpm (${lthrLabel})`);
    if (z) zones.push(z);
  }
  const ftp = isNum(settings.ftp) && settings.ftp > 0 ? settings.ftp : isNum(zonesTarget?.functionalThresholdPower) ? zonesTarget!.functionalThresholdPower : isNum(s.thresholdPower) ? s.thresholdPower : undefined;
  const ftpLabel = isNum(settings.ftp) ? 'athlete settings' : 'file';
  if (has('power') && isNum(ftp) && ftp > 0) {
    const b = (label: string, lo?: number, hi?: number) => ({ label, low: lo !== undefined ? ftp * lo : undefined, high: hi !== undefined ? ftp * hi : undefined });
    const z = computedZoneSet('power_computed', 'Power zones (Coggan, % of FTP, computed)', samples, (x) => x.power, [
      b('Z1 Active recovery (<55%)', undefined, 0.55), b('Z2 Endurance (55-75%)', 0.55, 0.75), b('Z3 Tempo (75-90%)', 0.75, 0.9),
      b('Z4 Threshold (90-105%)', 0.9, 1.05), b('Z5 VO2max (105-120%)', 1.05, 1.2), b('Z6 Anaerobic (120-150%)', 1.2, 1.5), b('Z7 Neuromuscular (>150%)', 1.5),
    ], 'W', `FTP ${Math.round(ftp)} W (${ftpLabel})`);
    if (z) zones.push(z);
  }
  const hHr = has('hr') ? histogram('hr_hist', 'Heart rate distribution', samples, (x) => x.hr, 10, 'bpm') : undefined;
  if (hHr) histograms.push(hHr);
  const hPw = has('power') ? histogram('power_hist', 'Power distribution', samples, (x) => x.power, 25, 'W') : undefined;
  if (hPw) histograms.push(hPw);
  if (has('speed')) {
    const hSp = speedMode === 'kmh'
      ? histogram('speed_hist', 'Speed distribution', samples, (x) => (isNum(x.speed) ? x.speed * 3.6 : undefined), 2, 'km/h')
      : histogram('pace_hist', 'Pace distribution', samples, (x) => (isNum(x.speed) && x.speed > 0.3 ? (speedMode === 'pace_km' ? 1000 : speedMode === 'pace_100m' ? 100 : 500) / x.speed / 60 : undefined), 0.5, speedMode === 'pace_km' ? 'min/km' : speedMode === 'pace_100m' ? 'min/100m' : 'min/500m');
    if (hSp) histograms.push(hSp);
  }
  if (has('cadence')) {
    const hC = histogram('cadence_hist', 'Cadence distribution', samples, (x) => x.cadence, 5, isRunLike ? 'strides/min' : 'rpm');
    if (hC) histograms.push(hC);
  }

  // Efforts & power
  const efforts = has('dist') && isNum(distance) && distance >= 400 ? bestEfforts(samples) : [];
  const grid = has('power') ? toGrid(samples, (x) => x.power) : undefined;
  const peaks = grid ? peakPowers(grid) : [];
  const npComputed = grid ? normalizedPower(grid) : undefined;

  // Drift, digest, series, gps
  const drift = computeDrift(samples);
  const digestBucketSec = chooseBucketSeconds(timerTime || (samples.length ? samples[samples.length - 1].timer : 0));
  const digest = computeDigest(samples, digestBucketSec);
  const series = toSeries(samples);
  const gpsPts = samples.filter((x) => isNum(x.lat) && isNum(x.lon));
  let gps: GpsInfo | undefined;
  if (gpsPts.length) {
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const p of gpsPts) { minLat = Math.min(minLat, p.lat!); maxLat = Math.max(maxLat, p.lat!); minLon = Math.min(minLon, p.lon!); maxLon = Math.max(maxLon, p.lon!); }
    gps = { start: [gpsPts[0].lat!, gpsPts[0].lon!], end: [gpsPts[gpsPts.length - 1].lat!, gpsPts[gpsPts.length - 1].lon!], bbox: [minLat, minLon, maxLat, maxLon], coveragePct: (gpsPts.length / samples.length) * 100 };
  }

  const zoneSense = computeZoneSense(samples, splits, splitDistance, s, devNames);

  // Summary groups from session fields
  const groupMap = new Map<string, KV[]>();
  const push = (group: string, kv: KV) => groupMap.set(group, [...(groupMap.get(group) ?? []), kv]);
  const hasEnhanced = (k: string) => s[`enhanced${k.charAt(0).toUpperCase()}${k.slice(1)}`] !== undefined;
  for (const [k, v] of Object.entries(s)) {
    if (SKIP_SESSION.has(k) || v === undefined || v === null) continue;
    if (['avgSpeed', 'maxSpeed', 'minAltitude', 'maxAltitude', 'avgAltitude', 'avgRespirationRate', 'maxRespirationRate', 'minRespirationRate'].includes(k) && hasEnhanced(k)) continue;
    if ((k === 'avgCadence' && s.avgRunningCadence !== undefined) || (k === 'maxCadence' && s.maxRunningCadence !== undefined)) continue;
    if (k === 'totalCycles' && (s.totalStrides !== undefined || s.totalStrokes !== undefined)) continue;
    const spec = SESSION_SPECS[k];
    if (spec) {
      const f = fmtValue(spec.fmt, v, ctx);
      push(spec.group, { key: k, label: spec.label, value: f.value, units: f.units ?? (fieldUnits('sessionMesgs', k) || undefined), raw: v });
    } else {
      const units = fieldUnits('sessionMesgs', k);
      push(G.other, { key: k, label: /^\d+$/.test(k) ? `Unknown field #${k}` : humanize(k), value: fmtGeneric(v, units, ctx.tz), units: units || undefined, raw: v });
    }
  }
  if (isNum(s.startPositionLat) && isNum(s.startPositionLong)) push(G.elev, { key: 'startPosition', label: 'Start position (lat, lon)', value: fmtCoord(semicirclesToDeg(s.startPositionLat), semicirclesToDeg(s.startPositionLong)), raw: [semicirclesToDeg(s.startPositionLat), semicirclesToDeg(s.startPositionLong)] });
  if (isNum(s.endPositionLat) && isNum(s.endPositionLong)) push(G.elev, { key: 'endPosition', label: 'End position (lat, lon)', value: fmtCoord(semicirclesToDeg(s.endPositionLat), semicirclesToDeg(s.endPositionLong)), raw: [semicirclesToDeg(s.endPositionLat), semicirclesToDeg(s.endPositionLong)] });
  if (isNum(s.necLat) && isNum(s.necLong) && isNum(s.swcLat) && isNum(s.swcLong)) push(G.elev, { key: 'bbox', label: 'Bounding box (SW → NE)', value: `${fmtCoord(semicirclesToDeg(s.swcLat), semicirclesToDeg(s.swcLong))} → ${fmtCoord(semicirclesToDeg(s.necLat), semicirclesToDeg(s.necLong))}` });
  push(G.time, { key: 'pausedTime', label: 'Paused time (elapsed − timer)', value: `${fmtDuration(pausedTime)} in ${pauses.length} pause(s)`, units: 's', raw: pausedTime, note: `pauses from ${pausesSource}` });
  if (ctx.tz !== undefined) push(G.time, { key: 'tz', label: 'Time zone of device', value: fmtTz(ctx.tz), raw: ctx.tz });
  const order = [G.time, G.speed, G.hr, G.power, G.cad, G.elev, G.load, G.swim, G.other];
  const specOrder = Object.keys(SESSION_SPECS);
  const rank = (k: string) => { const i = specOrder.indexOf(k); return i < 0 ? 1000 : i; };
  const groups: KVGroup[] = order.filter((g) => groupMap.has(g)).map((g) => ({ title: g, items: [...groupMap.get(g)!].sort((x, y) => rank(x.key) - rank(y.key)) }));

  // Cross-check device averages against the record stream and flag gross inconsistencies (vendor export bugs).
  const CHECKS: Record<string, string> = {
    avgVerticalOscillation: 'vo', avgStanceTime: 'stance', avgStepLength: 'stepLength', avgVerticalRatio: 'vratio', avgStanceTimeBalance: 'stanceBalance',
    avgHeartRate: 'hr', avgPower: 'power', avgTemperature: 'temp', avgRunningCadence: 'cadence', avgCadence: 'cadence',
  };
  for (const g of groups) {
    for (const kv of g.items) {
      const f = CHECKS[kv.key];
      if (!f || !isNum(kv.raw)) continue;
      const st = streamOf(f);
      if (!st || st.coverage < 0.2 || st.avg === 0) continue;
      const ratio = kv.raw / st.avg;
      if (ratio < 0.5 || ratio > 2) kv.note = `inconsistent with the record stream (avg ${fmtNum(st.avg, 1)} ${st.units}); likely a device export bug, prefer the stream value`;
    }
  }

  // Computed metrics
  const computed: KV[] = [];
  const avgHr = isNum(s.avgHeartRate) ? s.avgHeartRate : streams.find((st) => st.field === 'hr')?.avg;
  const avgPower = isNum(s.avgPower) ? s.avgPower : streams.find((st) => st.field === 'power')?.avg;
  if (isNum(distance) && timerTime > 0) {
    const sp = distance / timerTime;
    computed.push({ key: 'avgSpeedTimer', label: `Average ${speedMode === 'kmh' ? 'speed' : 'pace'} (distance / timer time)`, value: fmtSpeed(sp, speedMode) + (speedMode !== 'kmh' ? ` (${fmtNum(sp * 3.6, 1)} km/h)` : ''), raw: sp, units: 'm/s' });
    if (elapsedTime > timerTime + 1) computed.push({ key: 'avgSpeedElapsed', label: `Average ${speedMode === 'kmh' ? 'speed' : 'pace'} (distance / elapsed time)`, value: fmtSpeed(distance / elapsedTime, speedMode), raw: distance / elapsedTime, units: 'm/s' });
  }
  if (isRunLike) {
    const strides = isNum(s.totalStrides) ? s.totalStrides : isNum(s.totalCycles) ? s.totalCycles : undefined;
    if (isNum(strides) && strides > 0) {
      computed.push({ key: 'steps', label: 'Total steps (2 × strides)', value: fmtNum(strides * 2, 0), raw: strides * 2 });
      if (isNum(distance)) computed.push({ key: 'stepLengthComputed', label: 'Average step length (distance / steps)', value: `${fmtNum(distance / (strides * 2), 2)} m`, raw: distance / (strides * 2), units: 'm' });
    }
    const cad = isNum(s.avgRunningCadence) ? s.avgRunningCadence : isNum(s.avgCadence) ? s.avgCadence : streams.find((st) => st.field === 'cadence')?.avg;
    if (isNum(cad)) computed.push({ key: 'stepsPerMin', label: 'Average cadence in steps/min', value: fmtNum(cad * 2, 0), raw: cad * 2, units: 'steps/min' });
  }
  const el = elevationGain(samples.map((x) => x.alt));
  if (has('alt')) computed.push({ key: 'elevComputed', label: 'Elevation gain / loss (computed from altitude stream, 2 m hysteresis)', value: `+${fmtNum(el.ascent, 0)} m / −${fmtNum(el.descent, 0)} m`, raw: [el.ascent, el.descent], units: 'm' });
  if (isNum(avgPower) && timerTime > 0) computed.push({ key: 'work', label: 'Mechanical work (avg power × timer time)', value: `${fmtNum(avgPower * timerTime / 1000, 0)} kJ`, raw: avgPower * timerTime / 1000, units: 'kJ' });
  if (isNum(npComputed)) {
    computed.push({ key: 'np', label: 'Normalized Power (computed, 30 s rolling)', value: `${fmtNum(npComputed, 0)} W`, raw: npComputed, units: 'W' });
    if (isNum(avgPower) && avgPower > 0) computed.push({ key: 'vi', label: 'Variability Index (NP / avg power)', value: fmtFixed(npComputed / avgPower, 2), raw: npComputed / avgPower });
    if (isNum(ftp) && ftp > 0) {
      const IF = npComputed / ftp;
      const tss = (timerTime * npComputed * IF) / (ftp * 3600) * 100;
      computed.push({ key: 'if', label: `Intensity Factor (NP / FTP ${Math.round(ftp)} W)`, value: fmtFixed(IF, 2), raw: IF });
      computed.push({ key: 'tss', label: 'Training Stress Score (computed)', value: fmtNum(tss, 0), raw: tss });
    }
  }
  if (isNum(avgPower) && isNum(weightKg) && weightKg > 0) {
    computed.push({ key: 'wkg', label: `Average power per kg (${fmtNum(weightKg, 1)} kg)`, value: `${fmtFixed(avgPower / weightKg, 2)} W/kg`, raw: avgPower / weightKg, units: 'W/kg' });
    if (isNum(npComputed)) computed.push({ key: 'npkg', label: 'Normalized Power per kg', value: `${fmtFixed(npComputed / weightKg, 2)} W/kg`, raw: npComputed / weightKg, units: 'W/kg' });
  }
  if (isRunLike) {
    const dyn: [string, string, string, number][] = [
      ['vo', 'voStream', 'Average vertical oscillation (record stream)', 1], ['stance', 'stanceStream', 'Average ground contact time (record stream)', 0],
      ['stepLength', 'stepLengthStream', 'Average step length (record stream)', 0], ['vratio', 'vratioStream', 'Average vertical ratio (record stream)', 1],
      ['stanceBalance', 'stanceBalanceStream', 'Average ground contact balance (record stream)', 1],
    ];
    for (const [f, key, label, digits] of dyn) {
      const st = streamOf(f);
      if (st && st.coverage > 0.2) computed.push({ key, label, value: `${fmtNum(st.avg, digits)} ${st.units}`, raw: st.avg, units: st.units });
    }
  }
  if (isNum(avgHr) && avgHr > 0) {
    if (isNum(maxHrBasis) && isNum(restingHr) && maxHrBasis > restingHr) computed.push({ key: 'hrr', label: `Average HR as % of heart rate reserve (rest ${Math.round(restingHr)} / max ${Math.round(maxHrBasis)} bpm)`, value: fmtPct(((avgHr - restingHr) / (maxHrBasis - restingHr)) * 100, 0), raw: ((avgHr - restingHr) / (maxHrBasis - restingHr)) * 100 });
    if (isNum(distance) && timerTime > 0) computed.push({ key: 'efPace', label: 'Efficiency factor (m/min per bpm)', value: fmtFixed((distance / timerTime) * 60 / avgHr, 3), raw: (distance / timerTime) * 60 / avgHr });
    if (isNum(avgPower)) computed.push({ key: 'efPower', label: 'Efficiency factor (W per bpm)', value: fmtFixed(avgPower / avgHr, 3), raw: avgPower / avgHr });
    if (isNum(maxHrBasis) && maxHrBasis > 0) computed.push({ key: 'avgHrPct', label: `Average HR as % of max HR (${Math.round(maxHrBasis)} bpm, ${maxHrBasisLabel})`, value: fmtPct((avgHr / maxHrBasis) * 100, 0), raw: (avgHr / maxHrBasis) * 100 });
    if (isNum(s.totalCalories) && timerTime > 0) computed.push({ key: 'kcalH', label: 'Calories per hour (timer time)', value: `${fmtNum(s.totalCalories / (timerTime / 3600), 0)} kcal/h`, raw: s.totalCalories / (timerTime / 3600) });
  }
  if (isNum(s.totalCalories) && isNum(distance) && distance > 0) computed.push({ key: 'kcalKm', label: 'Calories per km', value: `${fmtNum(s.totalCalories / (distance / 1000), 0)} kcal/km`, raw: s.totalCalories / (distance / 1000) });
  if (drift) {
    if (isNum(drift.hrDriftPct)) computed.push({ key: 'hrDrift', label: 'Cardiac drift (avg HR 2nd half vs 1st half)', value: signed(drift.hrDriftPct, 1, ' %'), raw: drift.hrDriftPct });
    if (isNum(drift.paceChangePct)) computed.push({ key: 'paceChange', label: 'Pace change 2nd half vs 1st half (positive = slower)', value: signed(drift.paceChangePct, 1, ' %'), raw: drift.paceChangePct });
    if (isNum(drift.paceDecouplingPct)) computed.push({ key: 'decoupling', label: 'Aerobic decoupling Pa:HR (positive = efficiency dropped)', value: signed(drift.paceDecouplingPct, 1, ' %'), raw: drift.paceDecouplingPct });
    if (isNum(drift.powerDecouplingPct)) computed.push({ key: 'decouplingPw', label: 'Aerobic decoupling Pw:HR', value: signed(drift.powerDecouplingPct, 1, ' %'), raw: drift.powerDecouplingPct });
  }
  if (isRunLike && has('vo') && has('stepLength')) {
    const vo = streams.find((st) => st.field === 'vo')!.avg;
    const sl = streams.find((st) => st.field === 'stepLength')!.avg;
    if (sl > 0) computed.push({ key: 'vratioComputed', label: 'Vertical ratio (VO / step length, computed)', value: fmtPct((vo / sl) * 100, 1), raw: (vo / sl) * 100 });
  }

  // Developer fields on the session
  const devFields: KV[] = [];
  if (s.developerFields && typeof s.developerFields === 'object') {
    for (const [k, v] of Object.entries(s.developerFields)) {
      const def = fit.devFields.find((d) => String(d.key) === k);
      const name = def?.name ?? `developer field ${k}`;
      const units = def?.units ?? '';
      const note = [def?.appId ? `app ${def.appId}` : undefined, def?.note].filter(Boolean).join('; ') || undefined;
      devFields.push({ key: `dev:${name}`, label: humanize(name), value: units === 's' && isNum(v) ? `${fmtDuration(v)} (${fmtNum(v, 0)} s)` : fmtGeneric(v, units), units: units || undefined, raw: v, note });
    }
  }

  // Data quality
  const quality: KV[] = [];
  const dts: number[] = [];
  for (let i = 1; i < samples.length; i++) dts.push(samples[i].timer - samples[i - 1].timer);
  const gapsWhileRunning = dts.filter((d) => d > 10);
  quality.push({ key: 'records', label: 'Record messages (samples)', value: fmtNum(samples.length, 0), raw: samples.length });
  quality.push({ key: 'interval', label: 'Median sampling interval', value: `${fmtNum(median(dts.filter((d) => d > 0)) ?? 0, 1)} s`, raw: median(dts) });
  quality.push({ key: 'gaps', label: 'Gaps > 10 s while timer running', value: gapsWhileRunning.length ? `${gapsWhileRunning.length} (total ${fmtDuration(gapsWhileRunning.reduce((a, b) => a + b, 0))})` : 'none', raw: gapsWhileRunning.length });
  quality.push({ key: 'pausesSource', label: 'Pause detection', value: pausesSource });
  quality.push({ key: 'streams', label: 'Streams present (coverage)', value: streams.filter((st) => st.coverage > 0.01).map((st) => `${st.label} ${Math.round(st.coverage * 100)}%`).join(', ') || 'none' });
  if (gps) quality.push({ key: 'gps', label: 'GPS coverage', value: fmtPct(gps.coveragePct, 0), raw: gps.coveragePct });
  if (devStreams.length) quality.push({ key: 'devStreams', label: 'Developer / non-standard record streams', value: devStreams.map((d) => `${d.label} ${Math.round(d.coverage * 100)}%`).join(', ') });
  if (!ctxIn.single) quality.push({ key: 'multi', label: 'Multi-session file', value: `session ${index + 1} of ${ctxIn.total}` });

  return {
    index, sport, subSport, sportLabel, speedMode, isRunLike,
    startTime: start, endTime: new Date(endMs), tzOffsetMin: ctx.tz,
    timerTime, elapsedTime, pausedTime, distance,
    groups, computed,
    laps: laps.map((l, i) => lapRow(l, i, timerAt, ctx.tz)),
    splits, splitDistance, zones, histograms, streams,
    bestEfforts: efforts, peakPower: peaks, drift, digest, digestBucketSec, series, samples, pauses, devFields, devStreams, zoneSense, gps, quality,
    raw: s,
  };
}

export function analyze(fit: DecodedFit, settings: AthleteSettings = {}): Analysis {
  const M = fit.messages;
  const records = (M.recordMesgs ?? []).filter((r) => toDate(r.timestamp));
  const laps = M.lapMesgs ?? [];
  const events = M.eventMesgs ?? [];
  const activity = M.activityMesgs?.[0];
  const tz = tzOffsetMinutes(activity);

  let sessions = (M.sessionMesgs ?? []).filter((s) => toDate(s.startTime) || toDate(s.timestamp));
  if (!sessions.length && records.length) {
    const first = toDate(records[0].timestamp)!;
    const last = toDate(records[records.length - 1].timestamp)!;
    sessions = [{
      sport: M.sportMesgs?.[0]?.sport ?? 'generic', subSport: M.sportMesgs?.[0]?.subSport,
      startTime: first, timestamp: last, totalElapsedTime: (last.getTime() - first.getTime()) / 1000,
      totalDistance: records[records.length - 1].distance, __synthesized: true,
    }];
  }
  const sessionAnalyses = sessions.map((s, i) => analyzeSession(fit, s, i, { records, laps, events, tz, single: sessions.length === 1, total: sessions.length, settings }));

  const zt = M.zonesTargetMesgs?.[0];
  const up = M.userProfileMesgs?.[0];
  const pick = (key: string, label: string, units: string, own: number | undefined, fromFile: number | undefined, fileSrc: string): KV => {
    if (isNum(own) && own > 0) return { key, label, value: `${fmtNum(own, 1)} ${units}`, raw: own, note: 'athlete settings' };
    if (isNum(fromFile)) return { key, label, value: `${fmtNum(fromFile, 1)} ${units}`, raw: fromFile, note: fileSrc };
    return { key, label, value: 'not set', note: 'enter it in Athlete settings to enable dependent metrics' };
  };
  const settingsUsed: KV[] = [
    pick('maxHr', 'Max heart rate', 'bpm', settings.maxHr, zt?.maxHeartRate ?? up?.defaultMaxHeartRate, 'from file'),
    pick('restingHr', 'Resting heart rate', 'bpm', settings.restingHr, up?.restingHeartRate, 'from file'),
    pick('lthr', 'Lactate threshold HR', 'bpm', settings.lthr, zt?.thresholdHeartRate, 'from file'),
    pick('ftp', 'Functional threshold power', 'W', settings.ftp, zt?.functionalThresholdPower, 'from file'),
    pick('weightKg', 'Body weight', 'kg', settings.weightKg, up?.weight, 'from file'),
  ];

  const fileId = M.fileIdMesgs?.[0] ?? {};
  const creator = M.fileCreatorMesgs?.[0];
  const fileItems: KV[] = [
    { key: 'fileName', label: 'File name', value: fit.fileName },
    { key: 'fileSize', label: 'File size', value: `${fmtNum(fit.fileSize / 1024, 1)} KB`, raw: fit.fileSize },
    { key: 'fitType', label: 'FIT file type', value: fileId.type !== undefined ? humanize(String(fileId.type)) : '–', raw: fileId.type },
    { key: 'manufacturer', label: 'Manufacturer', value: fileId.manufacturer !== undefined ? humanize(String(fileId.manufacturer)) : '–', raw: fileId.manufacturer },
    { key: 'product', label: 'Product', value: String(fileId.productName ?? fileId.garminProduct ?? fileId.product ?? '–'), raw: fileId.productName ?? fileId.product },
    { key: 'serial', label: 'Serial number', value: fileId.serialNumber !== undefined ? String(fileId.serialNumber) : '–', raw: fileId.serialNumber },
    { key: 'timeCreated', label: 'Time created (local)', value: fmtLocal(toDate(fileId.timeCreated), tz), raw: toDate(fileId.timeCreated) },
    { key: 'creatorSw', label: 'Creator software version', value: creator?.softwareVersion !== undefined ? String(creator.softwareVersion) : '–', raw: creator?.softwareVersion },
    { key: 'profileVersion', label: 'FIT SDK profile version', value: fit.profileVersion },
    { key: 'integrity', label: 'CRC integrity check', value: fit.integrityOk ? 'passed' : 'FAILED (file may be truncated or corrupted)', raw: fit.integrityOk },
    { key: 'errors', label: 'Decoder errors', value: fit.errors.length ? fit.errors.join(' | ') : 'none', raw: fit.errors },
    { key: 'sessions', label: 'Sessions', value: String(sessionAnalyses.length), raw: sessionAnalyses.length },
    { key: 'messages', label: 'Message types', value: fit.messageCounts.map((c) => `${c.name} ×${c.count}`).join(', ') },
  ];

  const startMs = sessionAnalyses[0]?.startTime.getTime() ?? 0;
  const unknownMessages = fit.messageCounts.filter((c) => !c.known).map((c) => ({ num: c.key, count: c.count }));
  const fieldsByMessage: { message: string; fields: string[] }[] = [];
  for (const c of fit.messageCounts) {
    if (!c.known) continue;
    const set = new Set<string>();
    for (const m of (M[c.key] ?? []).slice(0, 300)) for (const k of Object.keys(m)) if (/^\d+$/.test(k)) set.add(k);
    if (set.size) fieldsByMessage.push({ message: c.name, fields: [...set].sort((a, b) => Number(a) - Number(b)) });
  }

  return {
    fileName: fit.fileName,
    file: { title: 'File', items: fileItems },
    devices: deviceRows(M.deviceInfoMesgs ?? [], fileId, tz),
    sessions: sessionAnalyses,
    events: eventRows(events, startMs),
    hrv: hrvStats(M.hrvMesgs),
    profile: profileGroups(fit, tz),
    unknown: { messages: unknownMessages, fieldsByMessage },
    messageCounts: fit.messageCounts,
    settings,
    settingsUsed,
  };
}


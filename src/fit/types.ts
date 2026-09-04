// Shared types for decoded FIT data and derived analysis.
export type Msg = Record<string, any>;

export interface DevFieldDef {
  key: number;
  developerDataIndex: number;
  fieldDefinitionNumber: number;
  name: string;
  units?: string;
  unitsDeclared?: string; // units string as written in the file, when a known vendor quirk was corrected
  note?: string;
  nativeMesgNum?: number;
  nativeFieldNum?: number;
  appId?: string;
}

export interface MessageCount {
  key: string;
  name: string;
  count: number;
  known: boolean;
}

export interface DecodedFit {
  fileName: string;
  fileSize: number;
  integrityOk: boolean;
  profileVersion: string;
  errors: string[];
  messages: Record<string, Msg[]>;
  devFields: DevFieldDef[];
  messageCounts: MessageCount[];
}

export interface KV {
  key: string;
  label: string;
  value: string;
  units?: string;
  raw?: unknown;
  note?: string;
}
export interface KVGroup {
  title: string;
  items: KV[];
}

export interface Sample {
  ts: number; // epoch ms
  elapsed: number; // seconds since session start (wall clock)
  timer: number; // seconds of timer (moving) time
  dist?: number; // m
  speed?: number; // m/s
  hr?: number; // bpm
  power?: number; // W
  cadence?: number; // rpm (running: strides/min; steps/min = 2x)
  alt?: number; // m
  temp?: number; // °C
  lat?: number;
  lon?: number;
  vo?: number; // vertical oscillation mm
  stance?: number; // ground contact time ms
  stanceBalance?: number; // %
  stepLength?: number; // mm
  vratio?: number; // %
  lrBalance?: number;
  grade?: number; // %
  respiration?: number; // brpm
  extra?: Record<string, number>;
}

export interface StreamStat {
  field: string;
  label: string;
  units: string;
  count: number;
  coverage: number; // 0..1
  min: number;
  avg: number;
  max: number;
}

export interface Split {
  index: number;
  startDist: number;
  endDist: number;
  distance: number;
  time: number; // timer seconds
  startTimer: number;
  speed?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  avgCadence?: number;
  ascent?: number;
  descent?: number;
  extra?: Record<string, number>; // averages of developer / non-standard record streams
}

export interface LapRow {
  index: number;
  startTime: Date;
  startTimer: number;
  timerTime?: number;
  elapsedTime?: number;
  distance?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  avgCadence?: number;
  maxCadence?: number;
  ascent?: number;
  descent?: number;
  calories?: number;
  trigger?: string;
  intensity?: string;
  extra: KV[];
  raw: Msg;
}

export interface ZoneBucket {
  zone: number;
  label: string;
  low?: number;
  high?: number;
  seconds: number;
  pct: number;
}
export interface ZoneSet {
  id: string;
  title: string;
  source: 'device' | 'computed';
  basis?: string;
  units: string;
  buckets: ZoneBucket[];
}
export interface Histogram {
  id: string;
  title: string;
  units: string;
  binSize: number;
  bins: { from: number; to: number; seconds: number; pct: number }[];
}

export interface BestEffort {
  name: string;
  distance: number;
  time: number;
  speed: number;
  startDist: number;
  startTimer: number;
}
export interface PeakPower {
  windowSec: number;
  label: string;
  watts: number;
  startTimer: number;
}

export interface HalfStats {
  label: string;
  time: number;
  distance?: number;
  avgHr?: number;
  avgSpeed?: number;
  avgPower?: number;
  avgCadence?: number;
  efPace?: number; // (m/min) / bpm
  efPower?: number; // W / bpm
}
export interface Drift {
  first: HalfStats;
  second: HalfStats;
  hrDriftPct?: number;
  paceChangePct?: number; // positive = slower second half
  powerChangePct?: number;
  paceDecouplingPct?: number; // positive = efficiency dropped
  powerDecouplingPct?: number;
}

export interface Pause {
  start: Date;
  end: Date;
  seconds: number;
  startTimer: number;
  trigger?: string;
}
export interface EventRow {
  time: Date;
  elapsed: number;
  event: string;
  eventType: string;
  details: string;
}
export interface DeviceRow {
  id: string;
  role: string;
  manufacturer?: string;
  product?: string;
  serial?: string;
  software?: string;
  hardware?: string;
  battery?: string;
  source?: string;
  antDeviceType?: string;
  extra: KV[];
}

export interface DigestRow {
  timerStart: number;
  timerEnd: number;
  distStart?: number;
  distEnd?: number;
  avgHr?: number;
  avgSpeed?: number;
  avgPower?: number;
  avgCadence?: number;
  altStart?: number;
  altEnd?: number;
  ascent?: number;
  descent?: number;
  avgTemp?: number;
  extra?: Record<string, number>;
}

export interface HrvStats {
  count: number;
  valid: number;
  artefactPct: number;
  meanRR: number;
  meanHr: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  minRR: number;
  maxRR: number;
}

export interface SeriesPoint {
  x: number; // timer minutes
  km?: number;
  hr?: number;
  pace?: number; // min/km
  speed?: number; // km/h
  power?: number;
  cadence?: number;
  alt?: number;
  temp?: number;
  extra?: Record<string, number>;
}

export interface AthleteSettings {
  maxHr?: number;
  restingHr?: number;
  lthr?: number; // lactate threshold heart rate
  ftp?: number;
  weightKg?: number;
}

/** A non-standard record stream (developer field or field outside the core set). */
export interface DevStreamDef {
  key: string; // e.g. "dev:ddfa" or "verticalSpeed"
  label: string;
  units: string;
  coverage: number;
  isDeveloper: boolean;
}

export interface ZoneSenseSplit {
  index: number;
  endDist: number;
  mean: number;
  anaerobicPct: number;
  vo2maxPct: number;
  avgHr?: number;
  avgSpeed?: number;
  avgPower?: number;
}
export interface ZoneSenseCrossing {
  timer: number;
  dist?: number;
  hr?: number;
}
/** Suunto ZoneSense: DDFA index relative to the athlete's aerobic baseline (0). */
export interface ZoneSense {
  fieldKey: string;
  thresholds: { aerobic: number; anaerobic: number };
  samples: number;
  coveragePct: number;
  startsAtTimer: number;
  computedTimes: { aerobic: number; anaerobic: number; vo2max: number };
  deviceTimes?: { aerobic?: number; anaerobic?: number; vo2max?: number };
  aerobicThresholdHr?: number;
  anaerobicThresholdHr?: number;
  aerobicBaseline?: number;
  cumulativeBaseline?: number;
  stats: { min: number; max: number; mean: number; median: number; p10: number; p90: number };
  perSplit: ZoneSenseSplit[];
  splitDistance: number;
  firstBelowAerobic?: ZoneSenseCrossing;
  firstSustainedBelowAerobic?: ZoneSenseCrossing;
  firstBelowAnaerobic?: ZoneSenseCrossing;
  sustainedWindowSec: number;
  hrAtAerobicCrossing?: number;
  hrMeanAerobic?: number;
  hrMeanAnaerobic?: number;
  corrWithHr?: number;
  halves?: { first: number; second: number };
}

export interface GpsInfo {
  start?: [number, number];
  end?: [number, number];
  bbox?: [number, number, number, number]; // minLat, minLon, maxLat, maxLon
  coveragePct: number;
}

export interface SessionAnalysis {
  index: number;
  sport: string;
  subSport?: string;
  sportLabel: string;
  speedMode: SpeedMode;
  isRunLike: boolean;
  startTime: Date;
  endTime: Date;
  tzOffsetMin?: number;
  timerTime: number;
  elapsedTime: number;
  pausedTime: number;
  distance?: number;
  groups: KVGroup[];
  computed: KV[];
  laps: LapRow[];
  splits: Split[];
  splitDistance: number;
  zones: ZoneSet[];
  histograms: Histogram[];
  streams: StreamStat[];
  bestEfforts: BestEffort[];
  peakPower: PeakPower[];
  drift?: Drift;
  digest: DigestRow[];
  digestBucketSec: number;
  series: SeriesPoint[];
  samples: Sample[];
  pauses: Pause[];
  devFields: KV[];
  devStreams: DevStreamDef[];
  zoneSense?: ZoneSense;
  gps?: GpsInfo;
  quality: KV[];
  raw: Msg;
}

export type SpeedMode = 'pace_km' | 'pace_100m' | 'pace_500m' | 'kmh';

export interface Analysis {
  fileName: string;
  file: KVGroup;
  devices: DeviceRow[];
  sessions: SessionAnalysis[];
  events: EventRow[];
  hrv?: HrvStats;
  profile: KVGroup[];
  unknown: {
    messages: { num: string; count: number }[];
    fieldsByMessage: { message: string; fields: string[] }[];
  };
  messageCounts: MessageCount[];
  settings: AthleteSettings;
  settingsUsed: KV[];
}

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

/** One hrv message: its RR intervals (seconds) and the timestamp of the record message that preceded it in the file, when any. */
export interface RrBatch {
  anchorTs?: number; // epoch ms
  rr: number[];
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
  rr: RrBatch[];
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
  raceDistanceM?: number; // a recent race result used as the basis for predictions
  raceTimeSec?: number;
}

/** Reference performance for race predictions. */
export interface PredictionBasis {
  name: string;
  distance: number; // m
  time: number; // s
  source: 'effort' | 'race';
  vdot: number;
}
export interface PredictionRow {
  name: string;
  distance: number;
  riegel: number; // predicted seconds
  vdot: number; // predicted seconds
}
export interface TrainingPace {
  name: string; // E, M, T, I, R
  label: string;
  pctLow: number;
  pctHigh: number;
  paceSlow: number; // s/km
  paceFast: number; // s/km
}
export interface RacePredictions {
  bases: PredictionBasis[];
  basis: PredictionBasis;
  rows: PredictionRow[];
  riegelExponent: number;
  trainingPaces: TrainingPace[];
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

/** One DFA-α1 window (short-term detrended fluctuation analysis of RR intervals). */
export interface DfaWindow {
  timer: number; // timer seconds at the end of the window
  alpha1: number;
  beats: number;
  artefactPct: number;
  jitterPct: number; // share of successive differences too large for in-exercise HRV (strap noise)
  spanSec: number; // wall-clock span of the beats in the window
  reliable: boolean;
  hr?: number; // mean device HR in the window (bpm); RR-derived only when the file has no HR stream
}
export interface DfaCrossing {
  timer: number;
  dist?: number;
  hr?: number;
}
export interface DfaThreshold {
  alpha1: number; // 0.75 (HRVT1) or 0.5 (HRVT2)
  hr?: number; // regression estimate
  hrNear?: number; // median HR of windows within ±0.05 of the threshold
  speed?: number; // m/s, regression estimate
  power?: number; // W, regression estimate
  r: number; // correlation HR vs α1 used for the estimate
  n: number;
  reached: boolean; // the session had sustained reliable windows on both sides of the threshold (always true when present)
}
export interface DfaSplit {
  index: number;
  endDist: number;
  mean: number;
  heavyPct: number;
  severePct: number;
  avgHr?: number;
  avgSpeed?: number;
  avgPower?: number;
}
/** DFA-α1 analysis computed from RR intervals recorded by any device. */
export interface DfaAlpha1 {
  fieldKey: string; // key of the injected record stream ("calc:dfa_a1")
  windowSec: number;
  stepSec: number;
  boxRange: [number, number];
  thresholds: { aerobic: number; anaerobic: number };
  rrCount: number;
  rrUsed: number;
  artefactPct: number;
  timingSource: string;
  hrSource: 'device' | 'rr'; // HR used for threshold estimates: the record HR stream, or RR-derived when the file has none
  windows: DfaWindow[];
  reliableWindows: number;
  coveragePct: number; // share of timer time with a reliable α1 value (time-weighted over samples)
  startsAtTimer: number;
  times: { aerobic: number; heavy: number; severe: number }; // seconds, time-weighted over samples like every other zone table
  stats: { min: number; max: number; mean: number; median: number; p10: number; p90: number };
  hrvt1?: DfaThreshold;
  hrvt2?: DfaThreshold;
  firstBelowAerobic?: DfaCrossing;
  firstSustainedBelowAerobic?: DfaCrossing;
  firstBelowAnaerobic?: DfaCrossing;
  sustainedWindowSec: number;
  hrMeanAerobic?: number;
  hrMeanHeavy?: number;
  hrMeanSevere?: number;
  corrWithHr?: number;
  ddfa?: { corr: number; n: number; deviceAerobicTimer?: number }; // validation against Suunto ZoneSense when present
  perSplit: DfaSplit[];
  splitDistance: number;
  halves?: { first: number; second: number };
}

/** One heartbeat from the RR stream, placed on the session's timer axis. */
export interface RrBeat {
  timer: number; // seconds of timer time at the end of the interval
  rr: number; // seconds
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
  dfa?: DfaAlpha1;
  predictions?: RacePredictions;
  rrBeats?: RrBeat[];
  hrv?: HrvStats;
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
  profile: KVGroup[];
  methods: KV[]; // how derived numbers are computed and which constants they rely on
  unknown: {
    messages: { num: string; count: number }[];
    fieldsByMessage: { message: string; fields: string[] }[];
  };
  messageCounts: MessageCount[];
  settings: AthleteSettings;
  settingsUsed: KV[];
}

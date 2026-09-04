import type {
  Sample, Split, ZoneSet, ZoneBucket, Histogram, BestEffort, PeakPower, Drift, HalfStats,
  DigestRow, HrvStats, SeriesPoint,
} from './types';
import { isNum, mean } from './format';

export interface Interval { startMs: number; endMs: number }

/** Returns a function mapping an epoch-ms timestamp to timer (moving) seconds. */
export function buildTimerMapper(startMs: number, pauses: Interval[]): (ts: number) => number {
  const sorted = [...pauses].sort((a, b) => a.startMs - b.startMs);
  return (ts: number) => {
    let paused = 0;
    for (const p of sorted) {
      if (p.startMs >= ts) break;
      paused += Math.min(ts, p.endMs) - p.startMs;
    }
    return Math.max(0, (ts - startMs - paused) / 1000);
  };
}

/** Detect long gaps between consecutive timestamps (fallback when no timer events exist). */
export function detectGaps(tsList: number[], thresholdSec: number): Interval[] {
  const out: Interval[] = [];
  for (let i = 1; i < tsList.length; i++) {
    const dt = (tsList[i] - tsList[i - 1]) / 1000;
    if (dt > thresholdSec) out.push({ startMs: tsList[i - 1], endMs: tsList[i] });
  }
  return out;
}

/** Elevation gain/loss with light smoothing and hysteresis (m). */
export function elevationGain(alts: (number | undefined)[], threshold = 2): { ascent: number; descent: number } {
  const vals = alts.filter(isNum) as number[];
  if (vals.length < 2) return { ascent: 0, descent: 0 };
  const win = 5;
  const smooth: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    const a = Math.max(0, i - Math.floor(win / 2));
    const b = Math.min(vals.length, a + win);
    let s = 0;
    for (let j = a; j < b; j++) s += vals[j];
    smooth.push(s / (b - a));
  }
  let ascent = 0;
  let descent = 0;
  let anchor = smooth[0];
  for (const v of smooth) {
    const d = v - anchor;
    if (d >= threshold) { ascent += d; anchor = v; }
    else if (-d >= threshold) { descent += -d; anchor = v; }
  }
  return { ascent, descent };
}

/** Monotonic samples that carry a distance value. */
export function distanceSamples(samples: Sample[]): Sample[] {
  const out: Sample[] = [];
  let last = -Infinity;
  for (const s of samples) {
    if (!isNum(s.dist)) continue;
    if (s.dist < last) continue;
    last = s.dist;
    out.push(s);
  }
  return out;
}

/** Mean of every key in Sample.extra over a set of samples. */
export function meanExtras(part: Sample[]): Record<string, number> | undefined {
  const sums: Record<string, { s: number; n: number }> = {};
  for (const p of part) {
    if (!p.extra) continue;
    for (const [k, v] of Object.entries(p.extra)) {
      if (!isNum(v)) continue;
      const e = (sums[k] ??= { s: 0, n: 0 });
      e.s += v; e.n++;
    }
  }
  const keys = Object.keys(sums);
  if (!keys.length) return undefined;
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = sums[k].s / sums[k].n;
  return out;
}

interface Acc { hr: number[]; power: number[]; cad: number[]; alt: (number | undefined)[]; maxHr: number; pts: Sample[] }
const newAcc = (): Acc => ({ hr: [], power: [], cad: [], alt: [], maxHr: 0, pts: [] });
function addToAcc(acc: Acc, p: Sample) {
  if (isNum(p.hr)) { acc.hr.push(p.hr); if (p.hr > acc.maxHr) acc.maxHr = p.hr; }
  if (isNum(p.power)) acc.power.push(p.power);
  if (isNum(p.cadence)) acc.cad.push(p.cadence);
  acc.alt.push(p.alt);
  if (p.extra) acc.pts.push(p);
}

/** Distance-based splits (e.g. every 1000 m) with interpolated boundary times. */
export function computeSplits(samples: Sample[], meters: number): Split[] {
  const pts = distanceSamples(samples);
  if (pts.length < 2 || meters <= 0) return [];
  const total = pts[pts.length - 1].dist!;
  const splits: Split[] = [];
  let boundary = pts[0].dist! + meters;
  let startTimer = pts[0].timer;
  let startDist = pts[0].dist!;
  let acc = newAcc();
  const finish = (endDist: number, endTimer: number) => {
    const el = elevationGain(acc.alt);
    const time = endTimer - startTimer;
    const distance = endDist - startDist;
    splits.push({
      index: splits.length + 1,
      startDist, endDist, distance, time, startTimer,
      speed: time > 0 ? distance / time : undefined,
      avgHr: mean(acc.hr), maxHr: acc.maxHr || undefined,
      avgPower: mean(acc.power), avgCadence: mean(acc.cad),
      ascent: el.ascent, descent: el.descent,
      extra: meanExtras(acc.pts),
    });
    startTimer = endTimer;
    startDist = endDist;
    acc = newAcc();
  };
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    addToAcc(acc, p);
    while (p.dist! >= boundary && boundary <= total) {
      const frac = (boundary - prev.dist!) / Math.max(1e-9, p.dist! - prev.dist!);
      const tB = prev.timer + Math.max(0, Math.min(1, frac)) * (p.timer - prev.timer);
      finish(boundary, tB);
      boundary += meters;
    }
  }
  if (total - startDist > Math.max(20, meters * 0.02)) finish(total, pts[pts.length - 1].timer);
  return splits;
}

/** Time-weighted delta for a sample (seconds attributed to sample i). */
function dtAt(samples: Sample[], i: number): number {
  if (i === 0) return 0;
  const dt = samples[i].timer - samples[i - 1].timer;
  return Math.max(0, Math.min(30, dt));
}

export function deviceZoneSet(id: string, title: string, arr: unknown, units: string, highs?: number[]): ZoneSet | undefined {
  if (!Array.isArray(arr)) return undefined;
  const vals = arr.map((v) => (isNum(v) ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  const zeroBased = vals.length >= 6 && !(highs && highs.length === vals.length);
  const buckets: ZoneBucket[] = vals.map((sec, i) => {
    const zone = zeroBased ? i : i + 1;
    const low = highs ? (zone >= 2 ? highs[zone - 2] : undefined) : undefined;
    const high = highs ? highs[zone - 1] : undefined;
    return { zone, label: `Z${zone}`, low, high, seconds: sec, pct: (sec / total) * 100 };
  });
  return { id, title, source: 'device', units, buckets };
}

export interface ZoneBound { label: string; low?: number; high?: number }

export function computedZoneSet(
  id: string, title: string, samples: Sample[], get: (s: Sample) => number | undefined,
  bounds: ZoneBound[], units: string, basis: string,
): ZoneSet | undefined {
  const secs = new Array(bounds.length).fill(0);
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const v = get(samples[i]);
    if (!isNum(v)) continue;
    const dt = dtAt(samples, i);
    if (dt <= 0) continue;
    for (let z = 0; z < bounds.length; z++) {
      const b = bounds[z];
      const lowOk = b.low === undefined || v >= b.low;
      const highOk = b.high === undefined || v < b.high;
      if (lowOk && highOk) { secs[z] += dt; total += dt; break; }
    }
  }
  if (total <= 0) return undefined;
  return {
    id, title, source: 'computed', basis, units,
    buckets: bounds.map((b, i) => ({ zone: i + 1, label: b.label, low: b.low, high: b.high, seconds: secs[i], pct: (secs[i] / total) * 100 })),
  };
}

export function histogram(id: string, title: string, samples: Sample[], get: (s: Sample) => number | undefined, binSize: number, units: string): Histogram | undefined {
  const map = new Map<number, number>();
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const v = get(samples[i]);
    if (!isNum(v)) continue;
    const dt = dtAt(samples, i);
    if (dt <= 0) continue;
    const bin = Math.floor(v / binSize) * binSize;
    map.set(bin, (map.get(bin) ?? 0) + dt);
    total += dt;
  }
  if (total <= 0) return undefined;
  const keys = [...map.keys()].sort((a, b) => a - b);
  let bins: Histogram['bins'] = [];
  for (let k = keys[0]; k <= keys[keys.length - 1] + 1e-9; k = Math.round((k + binSize) * 1e6) / 1e6) {
    const sec = map.get(Math.floor(k / binSize) * binSize) ?? map.get(k) ?? 0;
    bins.push({ from: k, to: k + binSize, seconds: sec, pct: (sec / total) * 100 });
  }
  // Trim negligible tails (< 0.2 % of time) so outliers do not stretch the axis.
  while (bins.length > 1 && bins[0].pct < 0.2) bins = bins.slice(1);
  while (bins.length > 1 && bins[bins.length - 1].pct < 0.2) bins = bins.slice(0, -1);
  return { id, title, units, binSize, bins };
}

const EFFORT_TARGETS: { name: string; d: number }[] = [
  { name: '400 m', d: 400 }, { name: '1 km', d: 1000 }, { name: '1 mile', d: 1609.34 },
  { name: '5 km', d: 5000 }, { name: '10 km', d: 10000 }, { name: 'Half marathon', d: 21097.5 },
  { name: 'Marathon', d: 42195 }, { name: '50 km', d: 50000 }, { name: '100 km', d: 100000 },
];

/** Fastest continuous efforts over standard distances (based on timer time). */
export function bestEfforts(samples: Sample[]): BestEffort[] {
  const pts = distanceSamples(samples);
  if (pts.length < 2) return [];
  const total = pts[pts.length - 1].dist! - pts[0].dist!;
  const out: BestEffort[] = [];
  for (const t of EFFORT_TARGETS) {
    if (t.d > total * 1.001) continue;
    let best = Infinity;
    let bestStart = 0;
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      const target = pts[i].dist! + t.d;
      while (j < pts.length && pts[j].dist! < target) j++;
      if (j >= pts.length) break;
      const prev = pts[j - 1];
      const cur = pts[j];
      const span = cur.dist! - prev.dist!;
      const frac = span > 0 ? (target - prev.dist!) / span : 1;
      const tEnd = prev.timer + frac * (cur.timer - prev.timer);
      const dur = tEnd - pts[i].timer;
      if (dur > 0 && dur < best) { best = dur; bestStart = i; }
    }
    if (isFinite(best)) {
      out.push({ name: t.name, distance: t.d, time: best, speed: t.d / best, startDist: pts[bestStart].dist!, startTimer: pts[bestStart].timer });
    }
  }
  return out;
}

/** Resample a numeric stream onto a 1 Hz timer-time grid; NaN gaps forward-filled up to `hold` seconds, else 0. */
export function toGrid(samples: Sample[], get: (s: Sample) => number | undefined, hold = 5): Float64Array | undefined {
  if (!samples.length) return undefined;
  const T = Math.ceil(samples[samples.length - 1].timer);
  if (T < 5) return undefined;
  const grid = new Float64Array(T + 1).fill(NaN);
  let any = false;
  for (const s of samples) {
    const v = get(s);
    if (!isNum(v)) continue;
    const idx = Math.min(T, Math.max(0, Math.round(s.timer)));
    grid[idx] = v;
    any = true;
  }
  if (!any) return undefined;
  let last = NaN;
  let gap = 0;
  for (let i = 0; i <= T; i++) {
    if (isNaN(grid[i])) {
      gap++;
      grid[i] = gap <= hold && !isNaN(last) ? last : 0;
    } else {
      last = grid[i];
      gap = 0;
    }
  }
  return grid;
}

const POWER_WINDOWS: { s: number; label: string }[] = [
  { s: 5, label: '5 s' }, { s: 10, label: '10 s' }, { s: 30, label: '30 s' }, { s: 60, label: '1 min' },
  { s: 120, label: '2 min' }, { s: 300, label: '5 min' }, { s: 600, label: '10 min' }, { s: 1200, label: '20 min' },
  { s: 3600, label: '60 min' },
];

export function peakPowers(grid: Float64Array): PeakPower[] {
  const n = grid.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + grid[i];
  const out: PeakPower[] = [];
  for (const w of POWER_WINDOWS) {
    if (w.s > n) continue;
    let best = -1;
    let bestStart = 0;
    for (let i = 0; i + w.s <= n; i++) {
      const avg = (prefix[i + w.s] - prefix[i]) / w.s;
      if (avg > best) { best = avg; bestStart = i; }
    }
    if (best > 0) out.push({ windowSec: w.s, label: w.label, watts: best, startTimer: bestStart });
  }
  return out;
}

/** Normalized Power (30 s rolling average, 4th-power mean). */
export function normalizedPower(grid: Float64Array): number | undefined {
  const n = grid.length;
  if (n < 30) return undefined;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + grid[i];
  let sum4 = 0;
  let cnt = 0;
  for (let i = 0; i + 30 <= n; i++) {
    const avg = (prefix[i + 30] - prefix[i]) / 30;
    sum4 += avg ** 4;
    cnt++;
  }
  return cnt ? Math.pow(sum4 / cnt, 0.25) : undefined;
}

function halfStats(label: string, part: Sample[]): HalfStats | undefined {
  if (part.length < 2) return undefined;
  const time = part[part.length - 1].timer - part[0].timer;
  const ds = distanceSamples(part);
  const distance = ds.length >= 2 ? ds[ds.length - 1].dist! - ds[0].dist! : undefined;
  const avgHr = mean(part.map((s) => s.hr).filter(isNum) as number[]);
  const avgSpeed = isNum(distance) && time > 0 ? distance / time : mean(part.map((s) => s.speed).filter(isNum) as number[]);
  const avgPower = mean(part.map((s) => s.power).filter(isNum) as number[]);
  const avgCadence = mean(part.map((s) => s.cadence).filter(isNum) as number[]);
  return {
    label, time, distance, avgHr, avgSpeed, avgPower, avgCadence,
    efPace: isNum(avgSpeed) && isNum(avgHr) && avgHr > 0 ? (avgSpeed * 60) / avgHr : undefined,
    efPower: isNum(avgPower) && isNum(avgHr) && avgHr > 0 ? avgPower / avgHr : undefined,
  };
}

/** First-half vs second-half comparison: cardiac drift and aerobic decoupling. */
export function computeDrift(samples: Sample[]): Drift | undefined {
  if (samples.length < 20) return undefined;
  const T = samples[samples.length - 1].timer;
  if (T < 600) return undefined;
  const mid = T / 2;
  const first = halfStats('First half', samples.filter((s) => s.timer <= mid));
  const second = halfStats('Second half', samples.filter((s) => s.timer > mid));
  if (!first || !second) return undefined;
  const pct = (a?: number, b?: number) => (isNum(a) && isNum(b) && a !== 0 ? ((b - a) / a) * 100 : undefined);
  const paceChange = isNum(first.avgSpeed) && isNum(second.avgSpeed) && second.avgSpeed > 0
    ? ((1 / second.avgSpeed - 1 / first.avgSpeed) / (1 / first.avgSpeed)) * 100 : undefined;
  return {
    first, second,
    hrDriftPct: pct(first.avgHr, second.avgHr),
    paceChangePct: paceChange,
    powerChangePct: pct(first.avgPower, second.avgPower),
    paceDecouplingPct: isNum(first.efPace) && isNum(second.efPace) && first.efPace > 0 ? ((first.efPace - second.efPace) / first.efPace) * 100 : undefined,
    powerDecouplingPct: isNum(first.efPower) && isNum(second.efPower) && first.efPower > 0 ? ((first.efPower - second.efPower) / first.efPower) * 100 : undefined,
  };
}

export function chooseBucketSeconds(timerTotal: number, maxRows = 40): number {
  for (const b of [60, 120, 300, 600, 900, 1800, 3600]) {
    if (timerTotal / b <= maxRows) return b;
  }
  return 7200;
}

/** Time-bucketed digest of the whole activity (for LLM consumption). */
export function computeDigest(samples: Sample[], bucketSec: number): DigestRow[] {
  if (samples.length < 2) return [];
  const rows: DigestRow[] = [];
  const T = samples[samples.length - 1].timer;
  let i = 0;
  for (let start = 0; start < T; start += bucketSec) {
    const end = Math.min(T, start + bucketSec);
    const part: Sample[] = [];
    while (i < samples.length && samples[i].timer <= end) {
      if (samples[i].timer >= start) part.push(samples[i]);
      i++;
    }
    if (i < samples.length) i--; // let boundary sample seed the next bucket
    if (!part.length) continue;
    const ds = distanceSamples(part);
    const distStart = ds[0]?.dist;
    const distEnd = ds[ds.length - 1]?.dist;
    const alts = part.map((s) => s.alt).filter(isNum) as number[];
    const el = elevationGain(part.map((s) => s.alt));
    const dur = end - start;
    rows.push({
      timerStart: start, timerEnd: end, distStart, distEnd,
      avgHr: mean(part.map((s) => s.hr).filter(isNum) as number[]),
      avgSpeed: isNum(distStart) && isNum(distEnd) && dur > 0 ? (distEnd - distStart) / dur : mean(part.map((s) => s.speed).filter(isNum) as number[]),
      avgPower: mean(part.map((s) => s.power).filter(isNum) as number[]),
      avgCadence: mean(part.map((s) => s.cadence).filter(isNum) as number[]),
      altStart: alts[0], altEnd: alts[alts.length - 1],
      ascent: el.ascent, descent: el.descent,
      avgTemp: mean(part.map((s) => s.temp).filter(isNum) as number[]),
      extra: meanExtras(part),
    });
  }
  return rows;
}

/** Downsample to at most maxPoints by averaging consecutive chunks. */
export function toSeries(samples: Sample[], maxPoints = 900): SeriesPoint[] {
  if (!samples.length) return [];
  const step = Math.max(1, Math.ceil(samples.length / maxPoints));
  const out: SeriesPoint[] = [];
  for (let i = 0; i < samples.length; i += step) {
    const chunk = samples.slice(i, i + step);
    const m = (get: (s: Sample) => number | undefined) => mean(chunk.map(get).filter(isNum) as number[]);
    const speed = m((s) => s.speed);
    const dist = m((s) => s.dist);
    out.push({
      x: (m((s) => s.timer) ?? 0) / 60,
      km: isNum(dist) ? dist / 1000 : undefined,
      hr: m((s) => s.hr),
      speed: isNum(speed) ? speed * 3.6 : undefined,
      pace: isNum(speed) && speed > 0.5 ? 1000 / speed / 60 : undefined,
      power: m((s) => s.power),
      cadence: m((s) => s.cadence),
      alt: m((s) => s.alt),
      temp: m((s) => s.temp),
      extra: meanExtras(chunk),
    });
  }
  return out;
}

/** Basic HRV statistics from RR intervals (seconds). */
export function hrvStats(hrvMesgs: { time?: unknown }[] | undefined): HrvStats | undefined {
  if (!hrvMesgs?.length) return undefined;
  const rr: number[] = [];
  for (const m of hrvMesgs) {
    const t = m.time;
    const arr = Array.isArray(t) ? t : [t];
    for (const v of arr) if (isNum(v) && v > 0 && v < 65) rr.push(v);
  }
  if (rr.length < 10) return undefined;
  const valid: number[] = [];
  let prev: number | undefined;
  for (const v of rr) {
    const physiological = v >= 0.3 && v <= 2.0;
    const stable = prev === undefined || Math.abs(v - prev) / prev <= 0.2;
    if (physiological && stable) valid.push(v);
    if (physiological) prev = v;
  }
  if (valid.length < 10) return undefined;
  const meanRR = mean(valid)!;
  const sdnn = Math.sqrt(mean(valid.map((v) => (v - meanRR) ** 2))!);
  let sumSq = 0;
  let nn50 = 0;
  for (let i = 1; i < valid.length; i++) {
    const d = valid[i] - valid[i - 1];
    sumSq += d * d;
    if (Math.abs(d) > 0.05) nn50++;
  }
  const rmssd = Math.sqrt(sumSq / (valid.length - 1));
  return {
    count: rr.length, valid: valid.length, artefactPct: ((rr.length - valid.length) / rr.length) * 100,
    meanRR: meanRR * 1000, meanHr: 60 / meanRR, sdnn: sdnn * 1000, rmssd: rmssd * 1000,
    pnn50: (nn50 / (valid.length - 1)) * 100, minRR: Math.min(...valid) * 1000, maxRR: Math.max(...valid) * 1000,
  };
}

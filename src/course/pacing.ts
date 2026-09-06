import type { Course } from './gpx';
import { elevationGain } from '../fit/metrics';
import { isNum } from '../fit/format';

/**
 * Even-effort pacing plan over a course with elevation.
 *
 * Metabolic cost of running per metre as a function of grade follows Minetti et al. (2002):
 * C(i) = 155.4 i^5 − 30.4 i^4 − 43.3 i^3 + 46.3 i^2 + 19.5 i + 3.6 J/kg/m, with i the grade as a fraction and 3.6 the cost on
 * the flat. With constant metabolic power the speed on a segment is inversely proportional to its relative cost. Downhill the
 * energetic saving cannot be cashed in fully (braking, footing, cadence limits), so the downhill saving is damped to 30 % of
 * Minetti's value and capped at 12 %, which tracks empirical grade-adjusted-pace curves closely.
 */
export const STEP_M = 25;
export const SMOOTH_HALF = 3; // ±75 m moving average on elevation
export const MAX_GRADE = 0.35;
export const DOWNHILL_DAMPING = 0.3;
export const DOWNHILL_FLOOR = 0.88;

export interface PacingOptions { goalTimeSec: number; splitMeters: number }
export interface PlanSplit {
  index: number;
  startDist: number;
  endDist: number;
  distance: number;
  gain: number;
  loss: number;
  avgGrade: number; // %
  time: number; // seconds for the split
  pace: number; // s/km
  cumTime: number; // seconds at the end of the split
  eleEnd?: number;
  lat: number;
  lon: number;
}
export interface PlanPoint { dist: number; lat: number; lon: number; ele?: number; grade: number; cf: number; cumTime: number; pace: number }
export interface PacingPlan {
  name: string;
  distance: number;
  gain: number;
  loss: number;
  hasElevation: boolean;
  goalTime: number;
  flatPace: number; // s/km on flat ground at the chosen effort
  avgPace: number; // s/km over the whole course
  effortDistance: number; // grade-adjusted (flat-equivalent) metres
  minPace: number;
  maxPace: number;
  splitMeters: number;
  splits: PlanSplit[];
  points: PlanPoint[]; // resampled every STEP_M, with planned cumulative time
}

export function costFactor(grade: number): number {
  const i = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade));
  const c = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  const ratio = c / 3.6;
  if (i >= 0) return ratio;
  return Math.max(DOWNHILL_FLOOR, 1 - DOWNHILL_DAMPING * (1 - ratio));
}

function resample(course: Course): PlanPoint[] {
  const pts = course.points;
  const out: PlanPoint[] = [];
  let j = 0;
  for (let d = 0; d <= course.distance + 1e-9; d += STEP_M) {
    const target = Math.min(d, course.distance);
    while (j + 1 < pts.length && pts[j + 1].dist < target) j++;
    const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
    const span = b.dist - a.dist;
    const f = span > 0 ? Math.max(0, Math.min(1, (target - a.dist) / span)) : 0;
    const ele = isNum(a.ele) && isNum(b.ele) ? a.ele + f * (b.ele - a.ele) : a.ele ?? b.ele;
    out.push({ dist: target, lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon), ele, grade: 0, cf: 1, cumTime: 0, pace: 0 });
    if (target >= course.distance) break;
  }
  if (out.length && out[out.length - 1].dist < course.distance) {
    const last = pts[pts.length - 1];
    out.push({ dist: course.distance, lat: last.lat, lon: last.lon, ele: last.ele, grade: 0, cf: 1, cumTime: 0, pace: 0 });
  }
  return out;
}

export function buildPlan(course: Course, opts: PacingOptions): PacingPlan {
  const points = resample(course);
  if (points.length < 2) throw new Error('The course is too short to plan.');
  // Smooth elevation, derive grade per segment (segment i spans points i-1 .. i).
  if (course.hasElevation) {
    const raw = points.map((p) => p.ele);
    for (let i = 0; i < points.length; i++) {
      const lo = Math.max(0, i - SMOOTH_HALF), hi = Math.min(points.length - 1, i + SMOOTH_HALF);
      const vals = raw.slice(lo, hi + 1).filter(isNum) as number[];
      if (vals.length) points[i].ele = vals.reduce((a, v) => a + v, 0) / vals.length;
    }
  } else {
    for (const p of points) p.ele = undefined;
  }
  let effort = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].dist - points[i - 1].dist;
    const grade = course.hasElevation && isNum(points[i].ele) && isNum(points[i - 1].ele) && d > 0 ? (points[i].ele! - points[i - 1].ele!) / d : 0;
    points[i].grade = grade;
    points[i].cf = costFactor(grade);
    effort += d * points[i].cf;
  }
  const T = opts.goalTimeSec;
  const vFlat = effort / T; // m/s on the flat
  let cum = 0;
  points[0].cumTime = 0;
  points[0].pace = 1000 / vFlat;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].dist - points[i - 1].dist;
    cum += (d * points[i].cf) / vFlat;
    points[i].cumTime = cum;
    points[i].pace = (points[i].cf * 1000) / vFlat;
  }
  // Force the final time to the goal exactly (rounding).
  const scale = cum > 0 ? T / cum : 1;
  for (const p of points) p.cumTime *= scale;

  // Splits with exact interpolation at the boundaries.
  const splits: PlanSplit[] = [];
  const timeAt = (dist: number): number => {
    let k = 1;
    while (k < points.length - 1 && points[k].dist < dist) k++;
    const a = points[k - 1], b = points[k];
    const f = b.dist > a.dist ? (dist - a.dist) / (b.dist - a.dist) : 0;
    return a.cumTime + f * (b.cumTime - a.cumTime);
  };
  const eleAt = (dist: number): number | undefined => {
    let k = 1;
    while (k < points.length - 1 && points[k].dist < dist) k++;
    const a = points[k - 1], b = points[k];
    if (!isNum(a.ele) || !isNum(b.ele)) return a.ele ?? b.ele;
    const f = b.dist > a.dist ? (dist - a.dist) / (b.dist - a.dist) : 0;
    return a.ele + f * (b.ele - a.ele);
  };
  const posAt = (dist: number): { lat: number; lon: number } => {
    let k = 1;
    while (k < points.length - 1 && points[k].dist < dist) k++;
    const a = points[k - 1], b = points[k];
    const f = b.dist > a.dist ? (dist - a.dist) / (b.dist - a.dist) : 0;
    return { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) };
  };
  let start = 0, idx = 1;
  while (start < course.distance - 1) {
    const end = Math.min(course.distance, start + opts.splitMeters);
    const t0 = timeAt(start), t1 = timeAt(end);
    const inside = points.filter((p) => p.dist >= start - 1e-6 && p.dist <= end + 1e-6);
    const el = elevationGain(inside.map((p) => p.ele));
    const e0 = eleAt(start), e1 = eleAt(end);
    const pos = posAt(end);
    splits.push({
      index: idx++, startDist: start, endDist: end, distance: end - start, gain: el.ascent, loss: el.descent,
      avgGrade: isNum(e0) && isNum(e1) && end > start ? ((e1 - e0) / (end - start)) * 100 : 0,
      time: t1 - t0, pace: ((t1 - t0) / (end - start)) * 1000, cumTime: t1, eleEnd: e1, lat: pos.lat, lon: pos.lon,
    });
    start = end;
  }
  const total = elevationGain(points.map((p) => p.ele));
  const paces = points.slice(1).map((p) => p.pace);
  return {
    name: course.name, distance: course.distance, gain: total.ascent, loss: total.descent, hasElevation: course.hasElevation,
    goalTime: T, flatPace: 1000 / vFlat, avgPace: T / (course.distance / 1000), effortDistance: effort,
    minPace: Math.min(...paces), maxPace: Math.max(...paces), splitMeters: opts.splitMeters, splits, points,
  };
}

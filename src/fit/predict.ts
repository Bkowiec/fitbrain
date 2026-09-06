import type { BestEffort, PredictionBasis, PredictionRow, RacePredictions, TrainingPace } from './types';

/**
 * Race-time prediction from a reference performance.
 *
 * - Riegel (1981): T2 = T1 · (D2 / D1)^k with k = 1.06 for trained runners; endurance-limited runners drift towards 1.07–1.10.
 * - VDOT (Daniels & Gilbert): the reference performance is converted into a pseudo-VO2max ("VDOT") using the oxygen cost of
 *   running at a given velocity and the fraction of VO2max sustainable for the race duration; the same VDOT is then solved
 *   for the target distance. Training paces are derived from Daniels' %VO2max bands.
 */
export const RIEGEL_EXPONENT = 1.06;
export const RACE_DISTANCES: { name: string; d: number }[] = [
  { name: '5 km', d: 5000 },
  { name: '10 km', d: 10000 },
  { name: 'Half marathon', d: 21097.5 },
  { name: 'Marathon', d: 42195 },
];

export function riegel(d1: number, t1: number, d2: number, k = RIEGEL_EXPONENT): number {
  return t1 * Math.pow(d2 / d1, k);
}

/** Oxygen cost (ml/kg/min) of running at velocity v in m/min. */
const vo2AtVelocity = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;
/** Fraction of VO2max that can be sustained for a race lasting t minutes. */
const pctVo2max = (tMin: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

export function vdotFromPerformance(distanceM: number, timeSec: number): number {
  const tMin = timeSec / 60;
  return vo2AtVelocity(distanceM / tMin) / pctVo2max(tMin);
}

/** Race time (seconds) over distanceM for an athlete with the given VDOT (bisection on the Daniels equations). */
export function timeForVdot(distanceM: number, vdot: number): number {
  let lo = 0.5, hi = 48 * 60; // minutes
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const f = vo2AtVelocity(distanceM / mid) / pctVo2max(mid);
    if (f > vdot) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 60;
}

/** Velocity (m/min) at which running costs `vo2` ml/kg/min. */
export function velocityForVo2(vo2: number): number {
  const a = 0.000104, b = 0.182258, c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

const PACE_BANDS: { name: string; label: string; lo: number; hi: number }[] = [
  { name: 'E', label: 'Easy', lo: 0.59, hi: 0.74 },
  { name: 'M', label: 'Marathon', lo: 0.75, hi: 0.84 },
  { name: 'T', label: 'Threshold', lo: 0.83, hi: 0.88 },
  { name: 'I', label: 'Interval', lo: 0.95, hi: 1.0 },
  { name: 'R', label: 'Repetition', lo: 1.05, hi: 1.1 },
];

/** Daniels training paces (seconds per km) for a VDOT; paceFast is the upper end of the band. */
export function trainingPaces(vdot: number): TrainingPace[] {
  return PACE_BANDS.map((b) => ({
    name: b.name, label: b.label, pctLow: b.lo * 100, pctHigh: b.hi * 100,
    paceSlow: 60000 / velocityForVo2(vdot * b.lo),
    paceFast: 60000 / velocityForVo2(vdot * b.hi),
  }));
}

export function raceName(distanceM: number): string {
  const std = RACE_DISTANCES.find((r) => Math.abs(r.d - distanceM) / r.d < 0.01);
  if (std) return std.name;
  if (Math.abs(distanceM - 1609.34) < 20) return '1 mile';
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(distanceM % 1000 === 0 ? 0 : 1)} km` : `${Math.round(distanceM)} m`;
}

export function predictionRows(b: PredictionBasis): PredictionRow[] {
  return RACE_DISTANCES.map((r) => ({ name: r.name, distance: r.d, riegel: riegel(b.distance, b.time, r.d), vdot: timeForVdot(r.d, b.vdot) }));
}

/**
 * Candidate bases are the session's fastest efforts of at least 1 km plus an optional real race result. The default basis
 * is the race when given, otherwise the effort of at least 3 km with the highest VDOT, otherwise the longest effort.
 */
export function predictRaces(efforts: BestEffort[], race?: { distanceM: number; timeSec: number }): RacePredictions | undefined {
  const bases: PredictionBasis[] = [];
  if (race && race.distanceM >= 1000 && race.timeSec > 60) {
    bases.push({ name: raceName(race.distanceM), distance: race.distanceM, time: race.timeSec, source: 'race', vdot: vdotFromPerformance(race.distanceM, race.timeSec) });
  }
  for (const e of efforts) {
    if (e.distance < 1000 || e.time <= 0) continue;
    bases.push({ name: e.name, distance: e.distance, time: e.time, source: 'effort', vdot: vdotFromPerformance(e.distance, e.time) });
  }
  if (!bases.length) return undefined;
  const basis = bases.find((b) => b.source === 'race')
    ?? [...bases].filter((b) => b.distance >= 3000).sort((a, b) => b.vdot - a.vdot)[0]
    ?? [...bases].sort((a, b) => b.distance - a.distance)[0];
  return { bases, basis, rows: predictionRows(basis), riegelExponent: RIEGEL_EXPONENT, trainingPaces: trainingPaces(basis.vdot) };
}

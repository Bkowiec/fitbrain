import type { Msg, Sample, Split, ZoneSense, ZoneSenseCrossing, ZoneSenseSplit } from './types';
import { isNum, mean, median } from './format';
import { timeInBands } from './metrics';

/** Suunto ZoneSense: DDFA index, 0 = aerobic baseline; aerobic threshold at -0.2, anaerobic at -0.5 (Suunto FAQ). */
export const ZONESENSE_AEROBIC = -0.2;
export const ZONESENSE_ANAEROBIC = -0.5;
export const ZONESENSE_FIELD_KEY = 'dev:ddfa';
const SUSTAINED_SEC = 60; // window of the moving average used for the "sustained" crossing

const crossing = (s: Sample): ZoneSenseCrossing => ({ timer: s.timer, dist: s.dist, hr: s.hr });
const ddfaOf = (s: Sample) => s.extra?.[ZONESENSE_FIELD_KEY];
const BANDS = [(v: number) => v >= ZONESENSE_AEROBIC, (v: number) => v >= ZONESENSE_ANAEROBIC, () => true];

export function computeZoneSense(samples: Sample[], splits: Split[], splitDistance: number, session: Msg, devNames: Record<string, string>): ZoneSense | undefined {
  const pts: { i: number; v: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const v = ddfaOf(samples[i]);
    if (isNum(v)) pts.push({ i, v });
  }
  if (pts.length < 60) return undefined;
  const vals = pts.map((p) => p.v);
  const sorted = [...vals].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];

  // Time in zones, time-weighted with the same helper as the computed zones and DFA α1.
  const bands = timeInBands(samples, ddfaOf, BANDS);

  // Crossings.
  let firstBelowAerobic: ZoneSenseCrossing | undefined;
  let firstBelowAnaerobic: ZoneSenseCrossing | undefined;
  let firstSustained: ZoneSenseCrossing | undefined;
  let w0 = 0; // start of the moving-average window
  let wSum = 0;
  for (let k = 0; k < pts.length; k++) {
    const { i, v } = pts[k];
    const s = samples[i];
    if (v < ZONESENSE_AEROBIC && !firstBelowAerobic) firstBelowAerobic = crossing(s);
    if (v < ZONESENSE_ANAEROBIC && !firstBelowAnaerobic) firstBelowAnaerobic = crossing(s);
    // Moving average over the last SUSTAINED_SEC seconds of timer time.
    wSum += v;
    while (w0 < k && s.timer - samples[pts[w0].i].timer > SUSTAINED_SEC) { wSum -= pts[w0].v; w0++; }
    const span = s.timer - samples[pts[w0].i].timer;
    if (!firstSustained && span >= SUSTAINED_SEC * 0.8 && wSum / (k - w0 + 1) < ZONESENSE_AEROBIC) firstSustained = crossing(samples[pts[w0].i]);
  }

  // Relation to the device's heart rate stream.
  const withHr = pts.filter((p) => isNum(samples[p.i].hr)).map((p) => ({ v: p.v, hr: samples[p.i].hr! }));
  let corr: number | undefined;
  if (withHr.length > 30) {
    const mx = mean(withHr.map((p) => p.v))!;
    const my = mean(withHr.map((p) => p.hr))!;
    let sxy = 0, sxx = 0, syy = 0;
    for (const p of withHr) { sxy += (p.v - mx) * (p.hr - my); sxx += (p.v - mx) ** 2; syy += (p.hr - my) ** 2; }
    corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : undefined;
  }
  const hrAtCross = mean(withHr.filter((p) => Math.abs(p.v - ZONESENSE_AEROBIC) < 0.02).map((p) => p.hr));
  const hrAer = mean(withHr.filter((p) => p.v >= ZONESENSE_AEROBIC).map((p) => p.hr));
  const hrAna = mean(withHr.filter((p) => p.v < ZONESENSE_AEROBIC).map((p) => p.hr));

  // Per split: the mean is the same number as the DDFA column of the splits table; shares are time-weighted like the totals.
  const perSplit: ZoneSenseSplit[] = [];
  for (const sp of splits) {
    const m = sp.extra?.[ZONESENSE_FIELD_KEY];
    if (!isNum(m)) continue;
    const b = timeInBands(samples, ddfaOf, BANDS, sp.startTimer, sp.startTimer + sp.time);
    if (b.total < 15) continue;
    perSplit.push({
      index: sp.index, endDist: sp.endDist, mean: m,
      anaerobicPct: (b.seconds[1] / b.total) * 100, vo2maxPct: (b.seconds[2] / b.total) * 100,
      avgHr: sp.avgHr, avgSpeed: sp.speed, avgPower: sp.avgPower,
    });
  }

  // Halves.
  const midTimer = samples[samples.length - 1].timer / 2;
  const h1 = mean(pts.filter((p) => samples[p.i].timer <= midTimer).map((p) => p.v));
  const h2 = mean(pts.filter((p) => samples[p.i].timer > midTimer).map((p) => p.v));

  // Session-level Suunto fields.
  const dev = (name: string): number | undefined => {
    const key = Object.entries(devNames).find(([, n]) => n === name)?.[0];
    const v = key !== undefined ? session.developerFields?.[key] : undefined;
    return isNum(v) ? v : undefined;
  };
  const deviceTimes = { aerobic: dev('time_in_aerobic_zone'), anaerobic: dev('time_in_anaerobic_zone'), vo2max: dev('time_in_vo2max_zone') };
  const hasDevice = Object.values(deviceTimes).some(isNum);

  return {
    fieldKey: ZONESENSE_FIELD_KEY,
    thresholds: { aerobic: ZONESENSE_AEROBIC, anaerobic: ZONESENSE_ANAEROBIC },
    samples: pts.length,
    coveragePct: (pts.length / samples.length) * 100,
    startsAtTimer: samples[pts[0].i].timer,
    computedTimes: { aerobic: bands.seconds[0], anaerobic: bands.seconds[1], vo2max: bands.seconds[2] },
    deviceTimes: hasDevice ? deviceTimes : undefined,
    aerobicThresholdHr: dev('aerobic_threshold'),
    anaerobicThresholdHr: dev('anaerobic_threshold'),
    aerobicBaseline: dev('aerobic_baseline'),
    cumulativeBaseline: dev('cumulative_baseline'),
    stats: { min: sorted[0], max: sorted[sorted.length - 1], mean: mean(vals)!, median: median(vals)!, p10: q(0.1), p90: q(0.9) },
    perSplit, splitDistance,
    firstBelowAerobic, firstSustainedBelowAerobic: firstSustained, firstBelowAnaerobic, sustainedWindowSec: SUSTAINED_SEC,
    hrAtAerobicCrossing: hrAtCross, hrMeanAerobic: hrAer, hrMeanAnaerobic: hrAna, corrWithHr: corr,
    halves: isNum(h1) && isNum(h2) ? { first: h1, second: h2 } : undefined,
  };
}

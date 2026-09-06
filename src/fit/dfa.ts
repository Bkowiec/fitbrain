import type { DfaAlpha1, DfaCrossing, DfaSplit, DfaThreshold, DfaWindow, Sample, Split } from './types';
import { isNum, mean, median } from './format';
import { cleanRr } from './rr';
import { timeInBands } from './metrics';

/**
 * DFA-α1: short-term scaling exponent of detrended fluctuation analysis applied to RR intervals.
 *
 * During exercise α1 falls with intensity in a way that is largely independent of heart rate. Published thresholds
 * (Rogers, Gronwald et al. 2021): α1 ≈ 0.75 marks the aerobic threshold (HRVT1, ~VT1/LT1), α1 ≈ 0.5 the anaerobic
 * threshold (HRVT2, ~VT2/LT2). Values above ~1.0 indicate low intensity with strongly correlated (fractal) RR dynamics.
 * Suunto's ZoneSense is built on the same family of methods but reports a re-scaled index; the raw α1 below is
 * computed here from the RR intervals in the file, so it works for any device that records them.
 *
 * Heart rate used for the threshold estimates is the device's HR stream from the record messages, the same source the
 * rest of the analysis uses; HR derived from the RR intervals is only a fallback for files without an HR stream.
 */
export const DFA_AEROBIC = 0.75;
export const DFA_ANAEROBIC = 0.5;
export const DFA_FIELD_KEY = 'calc:dfa_a1';
export const DFA_WINDOW_SEC = 120;
export const DFA_STEP_SEC = 5;
export const DFA_BOX_MIN = 4;
export const DFA_BOX_MAX = 16;
export const DFA_ARTEFACT_LIMIT_PCT = 5; // windows with more corrected beats are flagged unreliable (Rogers et al. recommend ≤ 5 %)
export const DFA_JITTER_REL = 0.1; // a successive difference above 10 % of RR and above DFA_JITTER_ABS_S ...
export const DFA_JITTER_ABS_S = 0.05; // ... 50 ms counts as jitter; real in-exercise HRV is far smaller
export const DFA_JITTER_LIMIT_PCT = 0.75; // windows with more jittery beats are unreliable (dry strap, loose contact); clean in-exercise data sits at 0–0.5 %
export const DFA_SUSTAINED_SEC = 60;
export const HRVT_MIN_RUN_SEC = 30; // an excursion counts only when it lasts at least this long
export const HRVT_MIN_SIDE_SEC = 60; // sustained data required on each side of a threshold
export const HRVT_MIN_R = 0.5; // |r| of HR vs α1 needed for a regression estimate
export const HRVT_HR_MARGIN_BPM = 2; // threshold HR must exceed the HR of clearly easier windows by this much
const MIN_BEATS = 60; // a 2-minute window at 30 bpm; real windows have 150–400 beats
const SMOOTH_WINDOWS = 5; // rolling median used for crossings (25 s)

/** Detrended fluctuation analysis; returns the scaling exponent over box sizes [minBox, maxBox]. */
export function dfaAlpha(rr: number[], minBox = DFA_BOX_MIN, maxBox = DFA_BOX_MAX): number | undefined {
  const n = rr.length;
  if (n < maxBox * 4) return undefined;
  const m = rr.reduce((a, v) => a + v, 0) / n;
  const y = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += rr[i] - m; y[i] = acc; }
  const logN: number[] = [];
  const logF: number[] = [];
  for (let box = minBox; box <= maxBox; box++) {
    const boxes = Math.floor(n / box);
    if (boxes < 2) continue;
    // Closed-form least squares within each box: x = 0..box-1.
    const sx = (box * (box - 1)) / 2;
    const sxx = ((box - 1) * box * (2 * box - 1)) / 6;
    const det = box * sxx - sx * sx;
    let ss = 0;
    for (let b = 0; b < boxes; b++) {
      const off = b * box;
      let sy = 0, sxy = 0;
      for (let k = 0; k < box; k++) { const v = y[off + k]; sy += v; sxy += k * v; }
      const slope = (box * sxy - sx * sy) / det;
      const icpt = (sy - slope * sx) / box;
      for (let k = 0; k < box; k++) { const r = y[off + k] - (icpt + slope * k); ss += r * r; }
    }
    const f = Math.sqrt(ss / (boxes * box));
    if (f > 0) { logN.push(Math.log(box)); logF.push(Math.log(f)); }
  }
  if (logN.length < 3) return undefined;
  return linfit(logN, logF).slope;
}

function linfit(xs: number[], ys: number[]): { slope: number; intercept: number; r: number } {
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0 };
}

/**
 * Sliding-window α1 over a session: windows of `windowSec` timer seconds, re-evaluated every `stepSec`.
 * `beats` must already be limited to the session and carry timer seconds. `samples` supply the device HR per window.
 */
export function dfaWindows(
  beats: { timer: number; elapsed: number; rr: number }[], samples: Sample[],
  windowSec = DFA_WINDOW_SEC, stepSec = DFA_STEP_SEC,
): { windows: DfaWindow[]; rrUsed: number; artefactPct: number; hrSource: 'device' | 'rr' } {
  if (beats.length < MIN_BEATS) return { windows: [], rrUsed: 0, artefactPct: 0, hrSource: 'device' };
  const cleaned = cleanRr(beats.map((b) => b.rr));
  const artefacts = cleaned.artefacts.filter(Boolean).length;
  const windows: DfaWindow[] = [];
  const last = beats[beats.length - 1].timer;
  const hasDeviceHr = samples.some((s) => isNum(s.hr));
  let lo = 0, hi = 0, sLo = 0, sHi = 0;
  for (let end = Math.ceil(beats[0].timer + windowSec); end <= last + 1e-6; end += stepSec) {
    const start = end - windowSec;
    while (lo < beats.length && beats[lo].timer <= start) lo++;
    while (hi < beats.length && beats[hi].timer <= end) hi++;
    const count = hi - lo;
    if (count < MIN_BEATS) continue;
    const seg = cleaned.rr.slice(lo, hi);
    const a1 = dfaAlpha(seg);
    if (!isNum(a1) || !Number.isFinite(a1)) continue;
    let bad = 0;
    for (let i = lo; i < hi; i++) if (cleaned.artefacts[i]) bad++;
    const artefactPct = (bad / count) * 100;
    let jittery = 0;
    for (let i = 1; i < seg.length; i++) { const dd = Math.abs(seg[i] - seg[i - 1]); if (dd > DFA_JITTER_ABS_S && dd > DFA_JITTER_REL * seg[i - 1]) jittery++; }
    const jitterPct = (jittery / Math.max(1, seg.length - 1)) * 100;
    const spanSec = beats[hi - 1].elapsed - beats[lo].elapsed;
    // Device HR over the same window (same source as splits, zones and ZoneSense); RR-derived HR only as a fallback.
    while (sLo < samples.length && samples[sLo].timer <= start) sLo++;
    while (sHi < samples.length && samples[sHi].timer <= end) sHi++;
    let hrSum = 0, hrN = 0;
    for (let i = sLo; i < sHi; i++) { const h = samples[i].hr; if (isNum(h)) { hrSum += h; hrN++; } }
    const meanRr = seg.reduce((a, v) => a + v, 0) / seg.length;
    windows.push({
      timer: end, alpha1: a1, beats: count, artefactPct, jitterPct, spanSec,
      reliable: artefactPct <= DFA_ARTEFACT_LIMIT_PCT && jitterPct <= DFA_JITTER_LIMIT_PCT && spanSec <= windowSec * 1.5 && spanSec >= windowSec * 0.6,
      hr: hrN ? hrSum / hrN : hasDeviceHr ? undefined : 60 / meanRr,
    });
  }
  return { windows, rrUsed: beats.length - artefacts, artefactPct: (artefacts / beats.length) * 100, hrSource: hasDeviceHr ? 'device' : 'rr' };
}

/** Write the α1 of the most recent reliable window into each sample's extra map so it flows into splits, digest, series and charts. */
export function injectDfaStream(samples: Sample[], windows: DfaWindow[], key = DFA_FIELD_KEY): void {
  if (!windows.length) return;
  let w = 0;
  for (const s of samples) {
    while (w + 1 < windows.length && windows[w + 1].timer <= s.timer) w++;
    const win = windows[w];
    if (win.timer > s.timer || s.timer - win.timer > DFA_STEP_SEC * 3) continue;
    if (!win.reliable) continue;
    (s.extra ??= {})[key] = win.alpha1;
  }
}

function crossingAt(samples: Sample[], timer: number): DfaCrossing {
  // Nearest sample by timer for distance and device HR.
  let best: Sample | undefined;
  for (const s of samples) { if (!best || Math.abs(s.timer - timer) < Math.abs(best.timer - timer)) best = s; if (s.timer > timer + 5) break; }
  return { timer, dist: best?.dist, hr: best?.hr };
}

/** Number of windows that sit inside runs of at least `minRun` consecutive windows satisfying `pred` (isolated blips do not count). */
function sustainedCount(ws: DfaWindow[], pred: (w: DfaWindow) => boolean, minRun: number): number {
  let total = 0, run = 0;
  for (let i = 0; i <= ws.length; i++) {
    const ok = i < ws.length && pred(ws[i]) && (i === 0 || ws[i].timer - ws[i - 1].timer <= DFA_STEP_SEC * 2);
    if (ok) run++;
    else { if (run >= minRun) total += run; run = 0; }
  }
  return total;
}

function thresholdEstimate(ws: DfaWindow[], samples: Sample[], level: number): DfaThreshold | undefined {
  // Regression of HR (and pace/power) on α1 over the informative range, following the HRVT approach of Rogers et al.
  // Only sessions with sustained excursions on both sides of the threshold are used; a steady session gives nothing.
  const rel = ws.filter((w) => w.reliable && isNum(w.hr));
  const pts = rel.filter((w) => w.alpha1 >= 0.35 && w.alpha1 <= 1.15);
  if (pts.length < 12) return undefined;
  const minRun = Math.ceil(HRVT_MIN_RUN_SEC / DFA_STEP_SEC);
  const minSide = Math.ceil(HRVT_MIN_SIDE_SEC / DFA_STEP_SEC);
  const above = sustainedCount(rel, (w) => w.alpha1 > level + 0.05, minRun);
  const below = sustainedCount(rel, (w) => w.alpha1 < level - 0.05, minRun);
  const reached = above >= minSide && below >= minSide;
  if (!reached) return undefined;
  const fit = linfit(pts.map((w) => w.alpha1), pts.map((w) => w.hr!));
  const near = pts.filter((w) => Math.abs(w.alpha1 - level) <= 0.05).map((w) => w.hr!);
  // Physiological consistency: HR at the threshold has to exceed the HR of clearly easier windows, otherwise the low α1
  // came from noise rather than intensity.
  const easierHr = mean(rel.filter((w) => w.alpha1 > level + 0.1).map((w) => w.hr!));
  const plausible = (hr: number | undefined) => (isNum(hr) && (!isNum(easierHr) || hr > easierHr + HRVT_HR_MARGIN_BPM) ? hr : undefined);
  const hrNear = plausible(near.length >= 3 ? median(near) : undefined);
  const out: DfaThreshold = { alpha1: level, r: fit.r, n: pts.length, reached, hrNear };
  if (fit.r < -HRVT_MIN_R) out.hr = plausible(fit.intercept + fit.slope * level);
  if (isNum(out.hr) || isNum(out.hrNear)) {
    // Speed / power at the same windows (mean of samples in the window), regressed the same way.
    const byWin = (get: (s: Sample) => number | undefined) => {
      const xs: number[] = [], ys: number[] = [];
      let i = 0;
      for (const w of pts) {
        const vals: number[] = [];
        while (i < samples.length && samples[i].timer < w.timer - DFA_WINDOW_SEC) i++;
        for (let j = i; j < samples.length && samples[j].timer <= w.timer; j++) { const v = get(samples[j]); if (isNum(v)) vals.push(v); }
        const m = mean(vals);
        if (isNum(m)) { xs.push(w.alpha1); ys.push(m); }
      }
      if (xs.length < 12) return undefined;
      const f = linfit(xs, ys);
      return f.r < -HRVT_MIN_R ? f.intercept + f.slope * level : undefined;
    };
    const sp = byWin((s) => (isNum(s.speed) && s.speed > 0.3 ? s.speed : undefined));
    if (isNum(sp) && sp > 0) out.speed = sp;
    const pw = byWin((s) => (isNum(s.power) && s.power > 0 ? s.power : undefined));
    if (isNum(pw) && pw > 0) out.power = pw;
  }
  return isNum(out.hr) || isNum(out.hrNear) ? out : undefined;
}

const A1_BANDS = [(v: number) => v >= DFA_AEROBIC, (v: number) => v >= DFA_ANAEROBIC, () => true];
const a1Of = (s: Sample) => s.extra?.[DFA_FIELD_KEY];

export function summarizeDfa(
  windows: DfaWindow[], meta: { rrCount: number; rrUsed: number; artefactPct: number; timingSource: string; hrSource: 'device' | 'rr' },
  samples: Sample[], splits: Split[], splitDistance: number, deviceAerobicTimer?: number,
): DfaAlpha1 | undefined {
  const rel = windows.filter((w) => w.reliable);
  if (rel.length < 12) return undefined;
  const vals = rel.map((w) => w.alpha1);
  const sorted = [...vals].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const timerTotal = samples.length ? samples[samples.length - 1].timer : 0;

  // Time in zones: time-weighted over the injected sample stream, the same way ZoneSense and the computed zones are done.
  const bands = timeInBands(samples, a1Of, A1_BANDS);

  let firstBelowAerobic: DfaCrossing | undefined;
  let firstBelowAnaerobic: DfaCrossing | undefined;
  let firstSustained: DfaCrossing | undefined;
  const need = Math.max(1, Math.round(DFA_SUSTAINED_SEC / DFA_STEP_SEC));
  const half = Math.floor(SMOOTH_WINDOWS / 2);
  const smooth = (i: number) => median(rel.slice(Math.max(0, i - half), Math.min(rel.length, i + half + 1)).map((w) => w.alpha1))!;
  for (let i = 0; i < rel.length; i++) {
    const w = rel[i];
    const sm = smooth(i);
    if (!firstBelowAerobic && sm < DFA_AEROBIC) firstBelowAerobic = crossingAt(samples, w.timer);
    if (!firstBelowAnaerobic && sm < DFA_ANAEROBIC) firstBelowAnaerobic = crossingAt(samples, w.timer);
    if (!firstSustained && i >= need - 1) {
      let ok = true;
      for (let k = i - need + 1; k <= i; k++) if (rel[k].alpha1 >= DFA_AEROBIC || rel[k].timer - rel[i - need + 1].timer > DFA_SUSTAINED_SEC * 2) { ok = false; break; }
      if (ok) firstSustained = crossingAt(samples, rel[i - need + 1].timer);
    }
  }

  const withHr = rel.filter((w) => isNum(w.hr));
  const corr = withHr.length > 30 ? linfit(withHr.map((w) => w.alpha1), withHr.map((w) => w.hr!)).r : undefined;
  const hrMean = (f: (a: number) => boolean) => mean(withHr.filter((w) => f(w.alpha1)).map((w) => w.hr!));

  // Validation against Suunto's DDFA index when the file carries it (its crossing time comes from the ZoneSense analysis).
  let ddfa: DfaAlpha1['ddfa'];
  const both = samples.filter((s) => isNum(s.extra?.[DFA_FIELD_KEY]) && isNum(s.extra?.['dev:ddfa']));
  if (both.length > 60) {
    const f = linfit(both.map((s) => s.extra![DFA_FIELD_KEY]), both.map((s) => s.extra!['dev:ddfa']));
    ddfa = { corr: f.r, n: both.length, deviceAerobicTimer };
  }

  // Per split: the mean is the same number as the α1 column of the splits table; shares are time-weighted like the totals.
  const perSplit: DfaSplit[] = [];
  for (const sp of splits) {
    const m = sp.extra?.[DFA_FIELD_KEY];
    if (!isNum(m)) continue;
    const b = timeInBands(samples, a1Of, A1_BANDS, sp.startTimer, sp.startTimer + sp.time);
    if (b.total < 15) continue;
    perSplit.push({
      index: sp.index, endDist: sp.endDist, mean: m,
      heavyPct: (b.seconds[1] / b.total) * 100, severePct: (b.seconds[2] / b.total) * 100,
      avgHr: sp.avgHr, avgSpeed: sp.speed, avgPower: sp.avgPower,
    });
  }

  const mid = timerTotal / 2;
  const h1 = mean(rel.filter((w) => w.timer <= mid).map((w) => w.alpha1));
  const h2 = mean(rel.filter((w) => w.timer > mid).map((w) => w.alpha1));

  const hrvt1 = thresholdEstimate(windows, samples, DFA_AEROBIC);
  let hrvt2 = thresholdEstimate(windows, samples, DFA_ANAEROBIC);
  const hrOf = (t?: DfaThreshold) => t?.hr ?? t?.hrNear;
  if (hrvt1 && hrvt2 && isNum(hrOf(hrvt1)) && isNum(hrOf(hrvt2)) && hrOf(hrvt2)! <= hrOf(hrvt1)!) hrvt2 = undefined; // the anaerobic threshold cannot sit below the aerobic one

  return {
    fieldKey: DFA_FIELD_KEY,
    windowSec: DFA_WINDOW_SEC, stepSec: DFA_STEP_SEC, boxRange: [DFA_BOX_MIN, DFA_BOX_MAX],
    thresholds: { aerobic: DFA_AEROBIC, anaerobic: DFA_ANAEROBIC },
    rrCount: meta.rrCount, rrUsed: meta.rrUsed, artefactPct: meta.artefactPct, timingSource: meta.timingSource, hrSource: meta.hrSource,
    windows,
    reliableWindows: rel.length,
    coveragePct: timerTotal > 0 ? Math.min(100, (bands.total / timerTotal) * 100) : 0,
    startsAtTimer: windows[0].timer,
    times: { aerobic: bands.seconds[0], heavy: bands.seconds[1], severe: bands.seconds[2] },
    stats: { min: sorted[0], max: sorted[sorted.length - 1], mean: mean(vals)!, median: median(vals)!, p10: q(0.1), p90: q(0.9) },
    hrvt1, hrvt2,
    firstBelowAerobic, firstSustainedBelowAerobic: firstSustained, firstBelowAnaerobic, sustainedWindowSec: DFA_SUSTAINED_SEC,
    hrMeanAerobic: hrMean((a) => a >= DFA_AEROBIC), hrMeanHeavy: hrMean((a) => a < DFA_AEROBIC && a >= DFA_ANAEROBIC), hrMeanSevere: hrMean((a) => a < DFA_ANAEROBIC),
    corrWithHr: corr,
    ddfa,
    perSplit, splitDistance,
    halves: isNum(h1) && isNum(h2) ? { first: h1, second: h2 } : undefined,
  };
}

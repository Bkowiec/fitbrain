import type { RrBatch } from './types';
import { isNum, median } from './format';

/**
 * Shared handling of beat-to-beat (RR) intervals. Every consumer (HRV statistics, DFA α1, heartbeat replay) goes
 * through the same timing reconstruction and the same artefact correction, so all of them report the same numbers.
 */
export const RR_MIN_S = 0.3;
export const RR_MAX_S = 2.0;
export const RR_JUMP_REL = 0.2; // relative deviation from the running median that marks a beat as an artefact
export const RR_MEDIAN_WINDOW = 7;

export interface Beat { ts: number; rr: number } // ts = epoch ms at the end of the interval

/**
 * Turn hrv messages into timed beats. When the decoder saw record messages around the hrv messages, each batch is
 * placed so that its last beat ends at the preceding record's timestamp and following unanchored batches continue
 * forward from there; otherwise beat times are the cumulative sum of RR intervals from the session start.
 */
export function timedBeats(batches: RrBatch[], fallbackStartMs: number): { beats: Beat[]; source: string } {
  const beats: Beat[] = [];
  const anchored = batches.filter((b) => isNum(b.anchorTs)).length;
  if (batches.length && anchored / batches.length >= 0.5) {
    let base: number | undefined;
    for (const b of batches) {
      if (isNum(b.anchorTs)) {
        const total = b.rr.reduce((a, v) => a + v, 0) * 1000;
        base = b.anchorTs - total;
      }
      if (base === undefined) continue;
      for (const v of b.rr) { base += v * 1000; beats.push({ ts: base, rr: v }); }
    }
    return { beats, source: `record message timestamps (${anchored} of ${batches.length} hrv messages anchored)` };
  }
  let t = fallbackStartMs;
  for (const b of batches) for (const v of b.rr) { t += v * 1000; beats.push({ ts: t, rr: v }); }
  return { beats, source: 'cumulative sum of RR intervals from the session start (no record anchors in the file)' };
}

/** Artefact correction: physiological range plus a relative jump test against the running median; flagged beats are interpolated. */
export function cleanRr(rr: number[]): { rr: number[]; artefacts: boolean[] } {
  const out = rr.slice();
  const flags = new Array<boolean>(rr.length).fill(false);
  const recent: number[] = [];
  for (let i = 0; i < rr.length; i++) {
    const v = rr[i];
    const ref = recent.length >= 3 ? median(recent)! : undefined;
    const bad = v < RR_MIN_S || v > RR_MAX_S || (ref !== undefined && Math.abs(v - ref) / ref > RR_JUMP_REL);
    if (bad) {
      flags[i] = true;
      out[i] = ref ?? (recent.length ? recent[recent.length - 1] : v);
    } else {
      recent.push(v);
      if (recent.length > RR_MEDIAN_WINDOW) recent.shift();
    }
  }
  // Linear interpolation across runs of flagged beats when both neighbours are valid.
  for (let i = 0; i < out.length; i++) {
    if (!flags[i]) continue;
    let j = i;
    while (j < out.length && flags[j]) j++;
    const left = i > 0 ? out[i - 1] : undefined;
    const right = j < out.length ? out[j] : undefined;
    for (let k = i; k < j; k++) {
      if (left !== undefined && right !== undefined) out[k] = left + ((right - left) * (k - i + 1)) / (j - i + 1);
      else if (left !== undefined) out[k] = left;
      else if (right !== undefined) out[k] = right;
    }
    i = j;
  }
  return { rr: out, artefacts: flags };
}

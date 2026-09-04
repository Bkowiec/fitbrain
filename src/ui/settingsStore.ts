import type { AthleteSettings } from '../fit/types';

const KEY = 'fitbrain.athlete';

export function loadSettings(): AthleteSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : undefined);
    return { maxHr: num(obj.maxHr), restingHr: num(obj.restingHr), lthr: num(obj.lthr), ftp: num(obj.ftp), weightKg: num(obj.weightKg) };
  } catch {
    return {};
  }
}

export function saveSettings(s: AthleteSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings live for this page only */
  }
}

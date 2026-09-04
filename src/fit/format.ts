import type { SpeedMode } from './types';

export const FIT_EPOCH_MS = 631065600000;

export function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v;
  if (typeof v === 'number' && isFinite(v)) return new Date(FIT_EPOCH_MS + v * 1000);
  return undefined;
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function fmtNum(n: number | undefined, digits = 1): string {
  if (!isNum(n)) return '–';
  return round(n, digits).toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Fixed decimals (always shows the requested digits). */
export function fmtFixed(n: number | undefined, digits = 2): string {
  if (!isNum(n)) return '–';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Seconds -> h:mm:ss (or m:ss when under an hour). */
export function fmtDuration(s: number | undefined, forceHours = false): string {
  if (!isNum(s)) return '–';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0 || forceHours) return `${h}:${pad2(m)}:${pad2(sec)}`;
  return `${m}:${pad2(sec)}`;
}

/** Seconds -> "2h 46m" style. */
export function fmtDurationHuman(s: number | undefined): string {
  if (!isNum(s)) return '–';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function fmtKm(m: number | undefined, digits = 2): string {
  if (!isNum(m)) return '–';
  return `${fmtNum(m / 1000, digits)} km`;
}

export function fmtMeters(m: number | undefined, digits = 0): string {
  if (!isNum(m)) return '–';
  return `${fmtNum(m, digits)} m`;
}

/** Seconds per unit -> m:ss */
export function fmtPaceSeconds(secPerUnit: number | undefined): string {
  if (!isNum(secPerUnit) || secPerUnit <= 0 || secPerUnit > 3600 * 3) return '–';
  const total = Math.round(secPerUnit);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${pad2(s)}`;
}

export function speedModeForSport(sport: string, subSport?: string): SpeedMode {
  const s = (sport || '').toLowerCase();
  const ss = (subSport || '').toLowerCase();
  if (['running', 'walking', 'hiking', 'trailrunning', 'transition', 'snowshoeing', 'mountaineering'].includes(s) || ss.includes('run')) return 'pace_km';
  if (['swimming'].includes(s)) return 'pace_100m';
  if (['rowing', 'kayaking', 'paddling', 'standuppaddleboarding', 'surfing', 'rafting'].includes(s)) return 'pace_500m';
  return 'kmh';
}

export function speedUnitsLabel(mode: SpeedMode): string {
  switch (mode) {
    case 'pace_km': return 'min/km';
    case 'pace_100m': return 'min/100m';
    case 'pace_500m': return 'min/500m';
    default: return 'km/h';
  }
}

/** Format a speed (m/s) according to the sport's convention. */
export function fmtSpeed(mps: number | undefined, mode: SpeedMode, withUnits = true): string {
  if (!isNum(mps)) return '–';
  const u = withUnits ? ` ${speedUnitsLabel(mode)}` : '';
  if (mode === 'kmh') return `${fmtNum(mps * 3.6, 1)}${u}`;
  if (mps <= 0.05) return '–';
  const per = mode === 'pace_km' ? 1000 : mode === 'pace_100m' ? 100 : 500;
  return `${fmtPaceSeconds(per / mps)}${u}`;
}

export function fmtKmh(mps: number | undefined): string {
  return isNum(mps) ? `${fmtNum(mps * 3.6, 1)} km/h` : '–';
}

export function semicirclesToDeg(s: number): number {
  return s * (180 / 2 ** 31);
}

export function fmtCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function fmtTz(offsetMin: number | undefined): string {
  if (!isNum(offsetMin)) return 'UTC';
  const sign = offsetMin >= 0 ? '+' : '-';
  const a = Math.abs(offsetMin);
  return `UTC${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

/** Format a Date in the activity's local time zone (offset in minutes). */
export function fmtLocal(d: Date | undefined, offsetMin: number | undefined, withDate = true): string {
  if (!d) return '–';
  const shifted = new Date(d.getTime() + (offsetMin ?? 0) * 60000);
  const y = shifted.getUTCFullYear();
  const mo = pad2(shifted.getUTCMonth() + 1);
  const da = pad2(shifted.getUTCDate());
  const t = `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`;
  return withDate ? `${y}-${mo}-${da} ${t}` : t;
}

export function fmtIso(d: Date | undefined): string {
  return d ? d.toISOString() : '–';
}

export function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function fmtPct(v: number | undefined, digits = 0): string {
  return isNum(v) ? `${fmtNum(v, digits)}%` : '–';
}

export function signed(v: number | undefined, digits = 1, suffix = ''): string {
  if (!isNum(v)) return '–';
  const r = round(v, digits);
  return `${r > 0 ? '+' : ''}${r.toLocaleString('en-US', { maximumFractionDigits: digits })}${suffix}`;
}

export function mean(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const a = [...xs].sort((p, q) => p - q);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

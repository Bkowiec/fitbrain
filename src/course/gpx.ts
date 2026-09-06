import type { Sample } from '../fit/types';
import { isNum } from '../fit/format';

export interface CoursePt { lat: number; lon: number; ele?: number; dist: number } // dist = cumulative metres
export interface Course { name: string; points: CoursePt[]; distance: number; hasElevation: boolean }

const R = 6371008.8;
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function finalize(name: string, raw: { lat: number; lon: number; ele?: number; dist?: number }[]): Course {
  const points: CoursePt[] = [];
  let dist = 0;
  for (const p of raw) {
    if (!isNum(p.lat) || !isNum(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
    const prev = points[points.length - 1];
    if (prev) {
      const step = isNum(p.dist) && isNum(prev.dist) && p.dist >= prev.dist && raw.every((r) => isNum(r.dist)) ? p.dist - prev.dist : haversine(prev.lat, prev.lon, p.lat, p.lon);
      if (step < 0.5) { if (isNum(p.ele) && !isNum(prev.ele)) prev.ele = p.ele; continue; }
      dist += step;
    } else if (isNum(p.dist)) {
      dist = 0;
    }
    points.push({ lat: p.lat, lon: p.lon, ele: isNum(p.ele) ? p.ele : undefined, dist });
  }
  // Fill isolated missing elevations from neighbours so the profile stays continuous.
  for (let i = 0; i < points.length; i++) {
    if (isNum(points[i].ele)) continue;
    const before = [...points.slice(0, i)].reverse().find((q) => isNum(q.ele))?.ele;
    const after = points.slice(i + 1).find((q) => isNum(q.ele))?.ele;
    points[i].ele = isNum(before) && isNum(after) ? (before + after) / 2 : before ?? after;
  }
  const withEle = points.filter((p) => isNum(p.ele)).length;
  return { name, points, distance: dist, hasElevation: points.length > 0 && withEle / points.length > 0.8 };
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

/** Minimal GPX reader: track points (or route points as fallback) with optional elevation. Works in the browser and in Node. */
export function parseGpx(text: string, fallbackName = 'course'): Course {
  const pick = (kind: 'trkpt' | 'rtept') => {
    const re = new RegExp(`<${kind}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${kind}>)`, 'g');
    const out: { lat: number; lon: number; ele?: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const lat = Number(/\blat\s*=\s*"([^"]+)"/.exec(m[1])?.[1]);
      const lon = Number(/\blon\s*=\s*"([^"]+)"/.exec(m[1])?.[1]);
      const eleText = m[2] ? /<ele>\s*([-+\d.eE]+)\s*<\/ele>/.exec(m[2])?.[1] : undefined;
      const ele = eleText !== undefined ? Number(eleText) : undefined;
      out.push({ lat, lon, ele: isNum(ele) ? ele : undefined });
    }
    return out;
  };
  let raw = pick('trkpt');
  if (raw.length < 2) raw = pick('rtept');
  if (raw.length < 2) throw new Error('No track or route points found in the GPX file.');
  const name = /<trk>[\s\S]*?<name>([^<]*)<\/name>/.exec(text)?.[1] ?? /<rte>[\s\S]*?<name>([^<]*)<\/name>/.exec(text)?.[1] ?? /<metadata>[\s\S]*?<name>([^<]*)<\/name>/.exec(text)?.[1];
  return finalize(name ? unescapeXml(name) : fallbackName, raw);
}

/** The recorded activity as a course: GPS positions with barometric/GPS altitude and the device's own distance. */
export function courseFromSamples(samples: Sample[], name: string): Course | undefined {
  const raw = samples.filter((s) => isNum(s.lat) && isNum(s.lon)).map((s) => ({ lat: s.lat!, lon: s.lon!, ele: s.alt, dist: s.dist }));
  if (raw.length < 2) return undefined;
  const c = finalize(name, raw);
  return c.distance > 100 ? c : undefined;
}

import { Encoder } from '@garmin/fitsdk';
import type { Encodable, Mesg } from '@garmin/fitsdk';
import type { PacingPlan, PlanSplit } from './pacing';
import { fmtDuration, fmtPaceSeconds, isNum } from '../fit/format';

const MESG = { FILE_ID: 0, FILE_CREATOR: 49, COURSE: 31, LAP: 19, EVENT: 21, RECORD: 20, COURSE_POINT: 32 } as const;
const SEMICIRCLE = 2 ** 31 / 180;

/** Course-point name: "12k 4:35 55:02" (distance, target pace for the split, planned elapsed time). Kept short for watch screens. */
export function splitLabel(s: PlanSplit, splitMeters: number): string {
  const km = s.endDist / 1000;
  const kmText = Math.abs(km - Math.round(km)) < 0.005 || splitMeters % 1000 === 0 && Math.abs(s.distance - splitMeters) < 1 ? `${Math.round(km)}k` : `${km.toFixed(1)}k`;
  const label = `${kmText} ${fmtPaceSeconds(s.pace)} ${fmtDuration(s.cumTime)}`;
  return label.length > 16 ? `${Math.round(km)}k ${fmtPaceSeconds(s.pace)} ${fmtDuration(s.cumTime)}` : label;
}

/**
 * FIT course file with the plan encoded in the record timestamps (Garmin's Virtual Partner follows them when the course is
 * used for navigation) and a course point at every split carrying the target pace and planned elapsed time.
 */
export function buildFitCourse(plan: PacingPlan, opts: { name: string; startTime?: Date; sport?: 'running' | 'cycling' | 'hiking' }): Uint8Array {
  const enc = new Encoder();
  const w = (mesgNum: number, fields: Record<string, unknown>) => enc.writeMesg({ mesgNum, ...fields } as unknown as Encodable<Mesg>);
  const start = new Date(Math.floor((opts.startTime ?? new Date()).getTime() / 1000) * 1000);
  const at = (sec: number) => new Date(start.getTime() + Math.round(sec) * 1000);
  const sc = (deg: number) => Math.round(deg * SEMICIRCLE);
  const first = plan.points[0], last = plan.points[plan.points.length - 1];
  const name = opts.name.slice(0, 32);

  w(MESG.FILE_ID, { type: 'course', manufacturer: 'development', product: 1, serialNumber: 0x46495442, timeCreated: start, productName: 'FitBrain' });
  w(MESG.FILE_CREATOR, { softwareVersion: 100 });
  w(MESG.COURSE, { name, sport: opts.sport ?? 'running' });
  w(MESG.LAP, {
    timestamp: at(plan.goalTime), startTime: start,
    startPositionLat: sc(first.lat), startPositionLong: sc(first.lon), endPositionLat: sc(last.lat), endPositionLong: sc(last.lon),
    totalElapsedTime: plan.goalTime, totalTimerTime: plan.goalTime, totalDistance: plan.distance, avgSpeed: plan.distance / plan.goalTime,
    totalAscent: Math.round(plan.gain), totalDescent: Math.round(plan.loss),
  });
  w(MESG.EVENT, { timestamp: start, event: 'timer', eventType: 'start', eventGroup: 0 });
  for (const p of plan.points) {
    const rec: Record<string, unknown> = { timestamp: at(p.cumTime), positionLat: sc(p.lat), positionLong: sc(p.lon), distance: p.dist };
    if (isNum(p.ele) && p.ele > -500 && p.ele < 12000) rec.altitude = p.ele;
    w(MESG.RECORD, rec);
  }
  plan.splits.forEach((s, i) => {
    w(MESG.COURSE_POINT, {
      timestamp: at(s.cumTime), positionLat: sc(s.lat), positionLong: sc(s.lon), distance: s.endDist,
      type: 'generic', name: splitLabel(s, plan.splitMeters), messageIndex: i,
    });
  });
  w(MESG.EVENT, { timestamp: at(plan.goalTime), event: 'timer', eventType: 'stopDisableAll', eventGroup: 0 });
  return enc.close();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GPX 1.1 route with the planned track (timestamps included) and a waypoint per split. Suunto, COROS and most apps import this. */
export function buildGpxCourse(plan: PacingPlan, opts: { name: string; startTime?: Date }): string {
  const start = new Date(Math.floor((opts.startTime ?? new Date()).getTime() / 1000) * 1000);
  const at = (sec: number) => new Date(start.getTime() + Math.round(sec) * 1000).toISOString();
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<gpx version="1.1" creator="FitBrain" xmlns="http://www.topografix.com/GPX/1/1">');
  out.push(`  <metadata><name>${esc(opts.name)}</name><desc>Pacing plan: ${fmtDuration(plan.goalTime)} for ${(plan.distance / 1000).toFixed(2)} km, flat-equivalent pace ${fmtPaceSeconds(plan.flatPace)} min/km</desc><time>${start.toISOString()}</time></metadata>`);
  for (const s of plan.splits) {
    const desc = `Split ${s.index}: ${fmtPaceSeconds(s.pace)} min/km, elapsed ${fmtDuration(s.cumTime)}, +${Math.round(s.gain)}/−${Math.round(s.loss)} m`;
    out.push(`  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}">${isNum(s.eleEnd) ? `<ele>${s.eleEnd.toFixed(1)}</ele>` : ''}<time>${at(s.cumTime)}</time><name>${esc(splitLabel(s, plan.splitMeters))}</name><desc>${esc(desc)}</desc><sym>Flag</sym></wpt>`);
  }
  out.push(`  <trk><name>${esc(opts.name)}</name><trkseg>`);
  for (const p of plan.points) {
    out.push(`    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${isNum(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}<time>${at(p.cumTime)}</time></trkpt>`);
  }
  out.push('  </trkseg></trk>');
  out.push('</gpx>');
  return out.join('\n') + '\n';
}

/** Markdown version of the plan for pasting into an assistant. */
export function planMarkdown(plan: PacingPlan): string {
  const rows = plan.splits.map((s) => `| ${s.index} | ${(s.endDist / 1000).toFixed(2)} | ${fmtPaceSeconds(s.pace)} | ${fmtDuration(s.time)} | ${fmtDuration(s.cumTime)} | +${Math.round(s.gain)}/−${Math.round(s.loss)} | ${s.avgGrade.toFixed(1)} |`);
  return [
    `# Pacing plan: ${plan.name}`,
    `Goal ${fmtDuration(plan.goalTime)} over ${(plan.distance / 1000).toFixed(2)} km (+${Math.round(plan.gain)} / −${Math.round(plan.loss)} m). Even-effort plan: flat-equivalent pace ${fmtPaceSeconds(plan.flatPace)} min/km, average ${fmtPaceSeconds(plan.avgPace)} min/km, grade-adjusted distance ${(plan.effortDistance / 1000).toFixed(2)} km. Segment paces range ${fmtPaceSeconds(plan.minPace)}–${fmtPaceSeconds(plan.maxPace)} min/km. Grade cost after Minetti et al. (2002), downhill saving damped to 30 % and capped at 12 %.`,
    '',
    `| # | At km | Target pace (min/km) | Split time | Elapsed | Asc/Desc m | Avg grade % |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...rows,
  ].join('\n') + '\n';
}

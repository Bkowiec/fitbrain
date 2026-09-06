import type { Analysis, DevStreamDef, DfaAlpha1, DfaCrossing, DfaThreshold, KV, RacePredictions, SessionAnalysis, ZoneSet, Histogram, ZoneSense, ZoneSenseCrossing } from '../fit/types';
import { fmtCoord, fmtDuration, fmtFixed, fmtKm, fmtLocal, fmtNum, fmtPaceSeconds, fmtPct, fmtSpeed, fmtTz, isNum, signed, speedUnitsLabel } from '../fit/format';
import { DFA_AEROBIC, DFA_ANAEROBIC } from '../fit/dfa';
import { ZONESENSE_AEROBIC, ZONESENSE_ANAEROBIC } from '../fit/zonesense';

export type MdMode = 'full' | 'compact';

type Cell = string | number | undefined;
function table(headers: string[], rows: Cell[][]): string {
  const h = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map((c) => (c === undefined || c === '' ? '–' : String(c))).join(' | ')} |`).join('\n');
  return `${h}\n${sep}\n${body}`;
}
const kvList = (items: KV[]) => items.map((i) => `- ${i.label}: ${i.value}${i.note ? ` (${i.note})` : ''}`).join('\n');
const n0 = (v?: number) => (isNum(v) ? fmtNum(v, 0) : undefined);
const n1 = (v?: number) => (isNum(v) ? fmtNum(v, 1) : undefined);
const t = (s?: number) => (isNum(s) ? fmtDuration(s) : undefined);
const devVal = (v?: number) => (isNum(v) ? fmtNum(v, Math.abs(v) < 10 ? 2 : 1) : undefined);
const devHeaders = (cols: DevStreamDef[]) => cols.map((d) => (d.units ? `${d.label} (${d.units})` : d.label));
const devCells = (cols: DevStreamDef[], extra?: Record<string, number>) => cols.map((d) => devVal(extra?.[d.key]));

function zoneSenseMarkdown(z: ZoneSense, s: SessionAnalysis, mode: MdMode): string {
  const out: string[] = [];
  const spd = (v?: number) => (isNum(v) ? fmtSpeed(v, s.speedMode, false) : undefined);
  const total = z.computedTimes.aerobic + z.computedTimes.anaerobic + z.computedTimes.vo2max;
  const pct = (v: number) => (total > 0 ? fmtPct((v / total) * 100, 1) : '–');
  const dev = (v?: number) => (isNum(v) ? fmtDuration(v) : '–');
  out.push('### Suunto ZoneSense (DDFA index)');
  out.push(`DDFA index relative to the athlete's aerobic baseline (0). Suunto thresholds: aerobic ${z.thresholds.aerobic} (below it = anaerobic zone), anaerobic ${z.thresholds.anaerobic} (below it = VO2max zone). The device does not compute the index during the first 10 minutes. Coverage ${fmtPct(z.coveragePct, 0)} of samples, first value at timer ${fmtDuration(z.startsAtTimer)}.`);
  out.push(table(['Zone', 'Index range', 'Time (from stream)', 'Share', 'Time (device)'], [
    ['Aerobic', `> ${z.thresholds.aerobic}`, fmtDuration(z.computedTimes.aerobic), pct(z.computedTimes.aerobic), dev(z.deviceTimes?.aerobic)],
    ['Anaerobic', `${z.thresholds.anaerobic} … ${z.thresholds.aerobic}`, fmtDuration(z.computedTimes.anaerobic), pct(z.computedTimes.anaerobic), dev(z.deviceTimes?.anaerobic)],
    ['VO2max', `< ${z.thresholds.anaerobic}`, fmtDuration(z.computedTimes.vo2max), pct(z.computedTimes.vo2max), dev(z.deviceTimes?.vo2max)],
  ]));
  const cross = (c?: ZoneSenseCrossing) => (c ? `timer ${fmtDuration(c.timer)}${isNum(c.dist) ? `, km ${fmtFixed(c.dist / 1000, 2)}` : ''}${isNum(c.hr) ? `, HR ${fmtNum(c.hr, 0)}` : ''}` : 'never');
  const lines = [
    `- Aerobic threshold HR estimated by the device: ${isNum(z.aerobicThresholdHr) ? `${fmtNum(z.aerobicThresholdHr, 1)} bpm` : '–'}${isNum(z.anaerobicThresholdHr) ? `; anaerobic threshold HR: ${fmtNum(z.anaerobicThresholdHr, 1)} bpm` : ''}`,
    `- Index statistics: min ${fmtFixed(z.stats.min, 2)}, p10 ${fmtFixed(z.stats.p10, 2)}, median ${fmtFixed(z.stats.median, 2)}, mean ${fmtFixed(z.stats.mean, 2)}, p90 ${fmtFixed(z.stats.p90, 2)}, max ${fmtFixed(z.stats.max, 2)}`,
    `- First sample below the aerobic threshold: ${cross(z.firstBelowAerobic)}`,
    `- First time the ${z.sustainedWindowSec}-s moving average dropped below the aerobic threshold: ${cross(z.firstSustainedBelowAerobic)}`,
    `- First sample below the anaerobic threshold: ${cross(z.firstBelowAnaerobic)}`,
  ];
  if (isNum(z.hrAtAerobicCrossing)) lines.push(`- Mean HR when the index was near ${z.thresholds.aerobic} in this session: ${fmtNum(z.hrAtAerobicCrossing, 0)} bpm`);
  if (isNum(z.hrMeanAerobic) && isNum(z.hrMeanAnaerobic)) lines.push(`- Mean HR in aerobic vs anaerobic samples: ${fmtNum(z.hrMeanAerobic, 0)} vs ${fmtNum(z.hrMeanAnaerobic, 0)} bpm`);
  if (isNum(z.corrWithHr)) lines.push(`- Correlation of the index with HR: ${fmtFixed(z.corrWithHr, 2)} (near 0 means the index carries information HR does not)`);
  if (z.halves) lines.push(`- Mean index first half ${fmtFixed(z.halves.first, 3)} → second half ${fmtFixed(z.halves.second, 3)}`);
  out.push(lines.join('\n'));
  if (mode === 'full' && z.perSplit.length) {
    const unit = z.splitDistance >= 1000 ? `${z.splitDistance / 1000} km` : `${z.splitDistance} m`;
    out.push(`Per ${unit}:\n\n${table(['#', 'At km', 'Mean index', '% anaerobic', '% VO2max', 'Avg HR', s.speedMode === 'kmh' ? 'km/h' : 'Pace', 'Avg W'], z.perSplit.map((p) => [p.index, fmtFixed(p.endDist / 1000, 2), fmtFixed(p.mean, 3), fmtPct(p.anaerobicPct, 0), fmtPct(p.vo2maxPct, 0), n0(p.avgHr), spd(p.avgSpeed), n0(p.avgPower)]))}`);
  }
  return out.join('\n\n');
}

function dfaMarkdown(d: DfaAlpha1, s: SessionAnalysis, mode: MdMode): string {
  const out: string[] = [];
  const spd = (v?: number) => (isNum(v) ? fmtSpeed(v, s.speedMode, false) : undefined);
  const total = d.times.aerobic + d.times.heavy + d.times.severe;
  const pct = (v: number) => (total > 0 ? fmtPct((v / total) * 100, 1) : '–');
  const cross = (c?: DfaCrossing) => (c ? `timer ${fmtDuration(c.timer)}${isNum(c.dist) ? `, km ${fmtFixed(c.dist / 1000, 2)}` : ''}${isNum(c.hr) ? `, HR ${fmtNum(c.hr, 0)}` : ''}` : 'never');
  const thr = (t: DfaThreshold | undefined, name: string) => {
    if (!t) return `- ${name}: not estimable (the session lacks sustained, reliable data on both sides of this intensity, or the candidate HR was not consistent with the rest of the session)`;
    const parts: string[] = [];
    if (isNum(t.hr)) parts.push(`${fmtNum(t.hr, 0)} bpm by regression of HR on α1 (r ${fmtFixed(t.r, 2)}, n ${t.n} windows)`);
    if (isNum(t.hrNear)) parts.push(`${fmtNum(t.hrNear, 0)} bpm as the median HR of windows within ±0.05 of α1 = ${t.alpha1}`);
    if (isNum(t.speed)) parts.push(`${spd(t.speed)} ${speedUnitsLabel(s.speedMode)}`);
    if (isNum(t.power)) parts.push(`${fmtNum(t.power, 0)} W`);
    if (!t.reached) parts.push('one-sided data, rough indication only');
    return `- ${name}: ${parts.join('; ')}`;
  };
  out.push('### DFA α1 (HRV-based intensity, computed from RR intervals)');
  out.push(`Short-term detrended fluctuation analysis of beat-to-beat intervals in ${d.windowSec}-s windows recomputed every ${d.stepSec} s (box sizes ${d.boxRange[0]}–${d.boxRange[1]} beats). α1 falls with intensity, largely independently of heart rate. Thresholds: aerobic threshold (HRVT1) at α1 ≈ ${d.thresholds.aerobic}, anaerobic threshold (HRVT2) at α1 ≈ ${d.thresholds.anaerobic}. ${d.rrCount} RR intervals, ${fmtPct(d.artefactPct, 1)} corrected as artefacts; ${d.reliableWindows} of ${d.windows.length} windows reliable (≤ 5 % corrected beats and no strap jitter); a reliable α1 value covers ${fmtPct(d.coveragePct, 0)} of timer time; first value at timer ${fmtDuration(d.startsAtTimer)}. RR timing: ${d.timingSource}. Heart rate in this section: ${d.hrSource === 'device' ? 'the device HR stream' : 'derived from RR intervals (no HR stream in the file)'}.`);
  out.push(table(['Zone', 'α1 range', 'Time', 'Share', 'Mean HR'], [
    ['Aerobic (below HRVT1)', `> ${d.thresholds.aerobic}`, fmtDuration(d.times.aerobic), pct(d.times.aerobic), n0(d.hrMeanAerobic)],
    ['Heavy (between thresholds)', `${d.thresholds.anaerobic} … ${d.thresholds.aerobic}`, fmtDuration(d.times.heavy), pct(d.times.heavy), n0(d.hrMeanHeavy)],
    ['Severe (above HRVT2)', `< ${d.thresholds.anaerobic}`, fmtDuration(d.times.severe), pct(d.times.severe), n0(d.hrMeanSevere)],
  ]));
  const lines = [
    thr(d.hrvt1, `Aerobic threshold estimate (α1 = ${d.thresholds.aerobic})`),
    thr(d.hrvt2, `Anaerobic threshold estimate (α1 = ${d.thresholds.anaerobic})`),
    `- α1 statistics: min ${fmtFixed(d.stats.min, 2)}, p10 ${fmtFixed(d.stats.p10, 2)}, median ${fmtFixed(d.stats.median, 2)}, mean ${fmtFixed(d.stats.mean, 2)}, p90 ${fmtFixed(d.stats.p90, 2)}, max ${fmtFixed(d.stats.max, 2)}`,
    `- First reliable window below ${d.thresholds.aerobic}: ${cross(d.firstBelowAerobic)}`,
    `- First ${d.sustainedWindowSec} s continuously below ${d.thresholds.aerobic}: ${cross(d.firstSustainedBelowAerobic)}`,
    `- First reliable window below ${d.thresholds.anaerobic}: ${cross(d.firstBelowAnaerobic)}`,
  ];
  if (isNum(d.corrWithHr)) lines.push(`- Correlation of α1 with HR: ${fmtFixed(d.corrWithHr, 2)} (negative expected; the further from −1, the more α1 adds beyond HR)`);
  if (d.halves) lines.push(`- Mean α1 first half ${fmtFixed(d.halves.first, 3)} → second half ${fmtFixed(d.halves.second, 3)} (a fall at constant pace suggests accumulating fatigue)`);
  if (d.ddfa) lines.push(`- Agreement with the device's Suunto ZoneSense DDFA index: correlation ${fmtFixed(d.ddfa.corr, 2)} over ${d.ddfa.n} samples${isNum(d.ddfa.deviceAerobicTimer) ? `; device first below its aerobic threshold at timer ${fmtDuration(d.ddfa.deviceAerobicTimer)}` : ''}`);
  out.push(lines.join('\n'));
  if (mode === 'full' && d.perSplit.length) {
    const unit = d.splitDistance >= 1000 ? `${d.splitDistance / 1000} km` : `${d.splitDistance} m`;
    out.push(`Per ${unit}:\n\n${table(['#', 'At km', 'Mean α1', '% heavy', '% severe', 'Avg HR', s.speedMode === 'kmh' ? 'km/h' : 'Pace', 'Avg W'], d.perSplit.map((p) => [p.index, fmtFixed(p.endDist / 1000, 2), fmtFixed(p.mean, 3), fmtPct(p.heavyPct, 0), fmtPct(p.severePct, 0), n0(p.avgHr), spd(p.avgSpeed), n0(p.avgPower)]))}`);
  }
  return out.join('\n\n');
}

function predictionsMarkdown(p: RacePredictions): string {
  const b = p.basis;
  const src = b.source === 'race' ? 'a recent race entered in Athlete settings' : `the fastest ${b.name} effort in this session`;
  const pace = (sec: number, d: number) => fmtPaceSeconds(sec / (d / 1000));
  const rows = p.rows.map((r) => [r.name, fmtDuration(r.riegel), fmtDuration(r.vdot), pace(r.vdot, r.distance)]);
  const others = p.bases.filter((x) => x !== b).map((x) => `${x.name} ${fmtDuration(x.time)} (VDOT ${fmtNum(x.vdot, 1)})`);
  const paces = p.trainingPaces.map((t) => `${t.name} ${t.label} ${fmtPaceSeconds(t.paceSlow)}–${fmtPaceSeconds(t.paceFast)}`).join('; ');
  return [
    '### Race predictions',
    `Basis: ${b.name} in ${fmtDuration(b.time)} from ${src}, VDOT ${fmtNum(b.vdot, 1)} (Daniels & Gilbert). Riegel uses exponent ${p.riegelExponent}. ${b.source === 'effort' ? 'Efforts inside a training run are usually slower than a race, so these predictions tend to be conservative; enter a real race result in Athlete settings for a better basis.' : ''}`.trim(),
    table(['Distance', 'Riegel', 'VDOT', 'Pace (VDOT, min/km)'], rows),
    others.length ? `Other candidate bases in this session: ${others.join(', ')}.` : '',
    `Daniels training paces at VDOT ${fmtNum(b.vdot, 1)} (min/km): ${paces}.`,
  ].filter(Boolean).join('\n\n');
}

function zoneTable(z: ZoneSet): string {
  const rangeOf = (b: { low?: number; high?: number }) => {
    if (b.low === undefined && b.high === undefined) return '';
    const lo = b.low !== undefined ? fmtNum(b.low, 0) : '';
    const hi = b.high !== undefined ? fmtNum(b.high, 0) : '';
    return `${lo}${lo && hi ? '–' : lo ? '+' : '<'}${hi} ${z.units}`.trim();
  };
  const hasRange = z.buckets.some((b) => b.low !== undefined || b.high !== undefined);
  const headers = hasRange ? ['Zone', 'Range', 'Time', 'Share'] : ['Zone', 'Time', 'Share'];
  const rows = z.buckets.map((b) => (hasRange ? [b.label, rangeOf(b), fmtDuration(b.seconds), fmtPct(b.pct, 1)] : [b.label, fmtDuration(b.seconds), fmtPct(b.pct, 1)]));
  const meta = [z.source === 'device' ? 'as reported by the device' : 'computed from the record stream', z.basis].filter(Boolean).join('; ');
  return `**${z.title}** (${meta})\n\n${table(headers, rows)}`;
}

function histTable(h: Histogram): string {
  const rows = h.bins.filter((b) => b.seconds > 0).map((b) => [`${fmtNum(b.from, h.binSize < 1 ? 1 : 0)}–${fmtNum(b.to, h.binSize < 1 ? 1 : 0)} ${h.units}`, fmtDuration(b.seconds), fmtPct(b.pct, 1)]);
  return `**${h.title}** (time-weighted, bin ${h.binSize} ${h.units})\n\n${table(['Bin', 'Time', 'Share'], rows)}`;
}

function sessionMarkdown(s: SessionAnalysis, mode: MdMode, multi: boolean): string {
  const out: string[] = [];
  const tz = s.tzOffsetMin;
  const paceHdr = s.speedMode === 'kmh' ? `Speed (${speedUnitsLabel(s.speedMode)})` : `Pace (${speedUnitsLabel(s.speedMode)})`;
  const spd = (v?: number) => (isNum(v) ? fmtSpeed(v, s.speedMode, false) : undefined);
  const cadHdr = s.isRunLike ? 'Cadence (strides/min)' : 'Cadence (rpm)';

  out.push(multi ? `## Session ${s.index + 1}: ${s.sportLabel}` : `## Activity: ${s.sportLabel}`);
  out.push(`Start ${fmtLocal(s.startTime, tz)} (${fmtTz(tz)}) · End ${fmtLocal(s.endTime, tz, false)} · Timer ${fmtDuration(s.timerTime)} · Elapsed ${fmtDuration(s.elapsedTime)}${isNum(s.distance) ? ` · Distance ${fmtKm(s.distance)}` : ''}`);

  out.push('### Summary (from the device session record)');
  for (const g of s.groups) {
    if (mode === 'compact' && g.title === 'Other session fields') continue;
    out.push(`#### ${g.title}\n${kvList(g.items)}`);
  }
  if (s.computed.length) out.push(`### Computed metrics (derived by the analyzer from the raw stream)\n${kvList(s.computed)}`);
  if (s.devFields.length) out.push(`### Developer / vendor fields on the session\n${kvList(s.devFields)}`);

  if (s.laps.length) {
    const rows = s.laps.slice(0, mode === 'compact' ? 40 : 400).map((l) => [
      l.index, fmtDuration(l.startTimer), t(l.timerTime), isNum(l.distance) ? fmtFixed(l.distance / 1000, 2) : undefined, spd(l.avgSpeed), n0(l.avgHr), n0(l.maxHr),
      n0(l.avgPower), n0(l.avgCadence), isNum(l.ascent) || isNum(l.descent) ? `+${n0(l.ascent) ?? 0}/−${n0(l.descent) ?? 0}` : undefined, n0(l.calories), l.trigger,
    ]);
    out.push(`### Laps (${s.laps.length})\n\n${table(['#', 'Start (timer)', 'Time', 'km', paceHdr, 'Avg HR', 'Max HR', 'Avg W', cadHdr, 'Asc/Desc m', 'kcal', 'Trigger'], rows)}`);
    if (mode === 'full') {
      const extras = s.laps.filter((l) => l.extra.length).slice(0, 60);
      if (extras.length) out.push(`Additional lap fields:\n${extras.map((l) => `- Lap ${l.index}: ${l.extra.map((e) => `${e.label} ${e.value}`).join('; ')}`).join('\n')}`);
    }
  }

  const devCols = s.devStreams.filter((d) => d.coverage > 0.2).slice(0, 4);
  if (s.splits.length) {
    const unit = s.splitDistance >= 1000 ? `${s.splitDistance / 1000} km` : `${s.splitDistance} m`;
    const rows = s.splits.slice(0, mode === 'compact' ? 60 : 400).map((p) => [
      p.index, fmtFixed(p.endDist / 1000, 2), fmtDuration(p.time), spd(p.speed), n0(p.avgHr), n0(p.maxHr), n0(p.avgPower), n0(p.avgCadence),
      `+${n0(p.ascent) ?? 0}/−${n0(p.descent) ?? 0}`, ...devCells(devCols, p.extra),
    ]);
    out.push(`### Splits every ${unit} (computed; timer time)\n\n${table(['#', 'At km', 'Time', paceHdr, 'Avg HR', 'Max HR', 'Avg W', cadHdr, 'Asc/Desc m', ...devHeaders(devCols)], rows)}`);
  }

  if (s.zones.length) {
    const zs = mode === 'compact' ? s.zones.filter((z) => z.source === 'device').concat(s.zones.filter((z) => z.source === 'computed' && !s.zones.some((d) => d.source === 'device' && d.id.split('_')[0] === z.id.split('_')[0]))) : s.zones;
    out.push(`### Intensity zones\n\n${zs.map(zoneTable).join('\n\n')}`);
  }
  if (s.dfa) out.push(dfaMarkdown(s.dfa, s, mode));
  if (s.zoneSense) out.push(zoneSenseMarkdown(s.zoneSense, s, mode));
  if (s.hrv) {
    const h = s.hrv;
    out.push(`### Heart rate variability (RR intervals recorded during the session)\n- RR intervals: ${h.count} recorded, ${h.count - h.valid} corrected (${fmtPct(h.artefactPct, 1)}) by the shared artefact filter\n- Mean RR: ${fmtNum(h.meanRR, 0)} ms (≈ ${fmtNum(h.meanHr, 0)} bpm)\n- SDNN: ${fmtNum(h.sdnn, 1)} ms\n- RMSSD: ${fmtNum(h.rmssd, 1)} ms\n- pNN50: ${fmtPct(h.pnn50, 1)}\n- RR range: ${fmtNum(h.minRR, 0)}–${fmtNum(h.maxRR, 0)} ms\n\nNote: HRV during exercise is dominated by intensity; compare only with other in-exercise values, not resting HRV.`);
  }
  if (mode === 'full' && s.histograms.length) out.push(`### Distributions\n\n${s.histograms.map(histTable).join('\n\n')}`);

  if (s.bestEfforts.length) {
    out.push(`### Fastest efforts (any continuous segment, timer time)\n\n${table(['Distance', 'Time', paceHdr, 'Started at km'], s.bestEfforts.map((e) => [e.name, fmtDuration(e.time), spd(e.speed), fmtFixed(e.startDist / 1000, 2)]))}`);
  }
  if (s.predictions) out.push(predictionsMarkdown(s.predictions));
  if (s.peakPower.length) {
    out.push(`### Peak power (best average over window)\n\n${table(['Window', 'Watts', 'Started at (timer)'], s.peakPower.map((p) => [p.label, n0(p.watts), fmtDuration(p.startTimer)]))}`);
  }
  if (s.drift) {
    const d = s.drift;
    const rows = [d.first, d.second].map((h) => [h.label, fmtDuration(h.time), isNum(h.distance) ? fmtFixed(h.distance / 1000, 2) : undefined, spd(h.avgSpeed), n0(h.avgHr), n0(h.avgPower), n0(h.avgCadence), isNum(h.efPace) ? fmtFixed(h.efPace, 3) : undefined, isNum(h.efPower) ? fmtFixed(h.efPower, 3) : undefined]);
    const summary = [
      isNum(d.hrDriftPct) ? `HR drift ${signed(d.hrDriftPct, 1, '%')}` : undefined,
      isNum(d.paceChangePct) ? `pace change ${signed(d.paceChangePct, 1, '%')} (positive = slower)` : undefined,
      isNum(d.powerChangePct) ? `power change ${signed(d.powerChangePct, 1, '%')}` : undefined,
      isNum(d.paceDecouplingPct) ? `Pa:HR decoupling ${signed(d.paceDecouplingPct, 1, '%')}` : undefined,
      isNum(d.powerDecouplingPct) ? `Pw:HR decoupling ${signed(d.powerDecouplingPct, 1, '%')}` : undefined,
    ].filter(Boolean).join('; ');
    out.push(`### First half vs second half\n\n${table(['Half', 'Time', 'km', paceHdr, 'Avg HR', 'Avg W', cadHdr, 'EF (m/min/bpm)', 'EF (W/bpm)'], rows)}\n\n${summary}`);
  }

  if (mode === 'full' && s.digest.length) {
    const rows = s.digest.map((r) => [
      `${fmtDuration(r.timerStart)}–${fmtDuration(r.timerEnd)}`, isNum(r.distEnd) ? fmtFixed(r.distEnd / 1000, 2) : undefined, spd(r.avgSpeed), n0(r.avgHr), n0(r.avgPower), n0(r.avgCadence),
      isNum(r.altStart) ? `${n0(r.altStart)}→${n0(r.altEnd)}` : undefined, `+${n0(r.ascent) ?? 0}/−${n0(r.descent) ?? 0}`, n0(r.avgTemp), ...devCells(devCols, r.extra),
    ]);
    out.push(`### Time-series digest (${s.digestBucketSec / 60}-minute buckets of timer time)\n\n${table(['Timer window', 'At km', paceHdr, 'Avg HR', 'Avg W', cadHdr, 'Alt m', 'Asc/Desc m', '°C', ...devHeaders(devCols)], rows)}`);
  }

  if (mode === 'full' && s.pauses.length) {
    out.push(`### Pauses (${s.pauses.length}, total ${fmtDuration(s.pauses.reduce((a, p) => a + p.seconds, 0))})\n\n${table(['At timer', 'Local time', 'Duration', 'Trigger'], s.pauses.slice(0, 100).map((p) => [fmtDuration(p.startTimer), fmtLocal(p.start, tz, false), fmtDuration(p.seconds), p.trigger]))}`);
  }
  if (mode === 'full' && s.gps) {
    out.push(`### GPS\n- Start: ${s.gps.start ? fmtCoord(s.gps.start[0], s.gps.start[1]) : '–'}\n- End: ${s.gps.end ? fmtCoord(s.gps.end[0], s.gps.end[1]) : '–'}\n- Bounding box (minLat, minLon, maxLat, maxLon): ${s.gps.bbox ? s.gps.bbox.map((x) => x.toFixed(5)).join(', ') : '–'}\n- Coverage: ${fmtPct(s.gps.coveragePct, 0)} of samples`);
  }
  if (mode === 'full') {
    const recorded = s.streams.filter((st) => !st.field.startsWith('calc:'));
    const calc = s.streams.filter((st) => st.field.startsWith('calc:'));
    out.push(`### Record streams (per-sample statistics, as recorded)\n\n${table(['Stream', 'Units', 'Samples', 'Coverage', 'Min', 'Avg', 'Max'], recorded.map((st) => [st.label, st.units, st.count, fmtPct(st.coverage * 100, 0), n1(st.min), n1(st.avg), n1(st.max)]))}${calc.length ? `\n\nStreams computed by the analyzer (not recorded by the device): ${calc.map((st) => `${st.label} · coverage ${fmtPct(st.coverage * 100, 0)}, ${n1(st.min)}–${n1(st.max)} (avg ${n1(st.avg)})`).join('; ')}` : ''}`);
    out.push(`### Data quality\n${kvList(s.quality)}`);
  }
  return out.join('\n\n');
}

export function toMarkdown(a: Analysis, mode: MdMode = 'full'): string {
  const out: string[] = [];
  const first = a.sessions[0];
  const title = first ? `${first.sportLabel} on ${fmtLocal(first.startTime, first.tzOffsetMin).slice(0, 10)}` : a.fileName;
  out.push(`# Workout analysis: ${title}`);
  out.push(`Generated by FitBrain from the FIT file \`${a.fileName}\`. All times are device-local unless marked UTC. ${mode === 'compact' ? 'Compact report.' : 'Full report.'}`);

  const fileKeys = mode === 'compact' ? ['fitType', 'manufacturer', 'product', 'integrity', 'sessions'] : a.file.items.map((i) => i.key);
  out.push(`## File\n${kvList(a.file.items.filter((i) => fileKeys.includes(i.key)))}`);
  out.push(`## Athlete parameters used for computed metrics\n${kvList(a.settingsUsed)}`);

  for (const s of a.sessions) out.push(sessionMarkdown(s, mode, a.sessions.length > 1));

  if (mode === 'full') {
    if (a.devices.length) {
      out.push(`## Devices and sensors\n\n${table(['Role', 'Manufacturer', 'Product', 'Serial', 'SW', 'Battery', 'Source/ANT type'], a.devices.map((d) => [d.role, d.manufacturer, d.product, d.serial, d.software, d.battery, [d.source, d.antDeviceType].filter(Boolean).join(' / ')]))}`);
      const extra = a.devices.filter((d) => d.extra.length);
      if (extra.length) out.push(extra.map((d) => `- ${d.role} (${d.product ?? d.id}): ${d.extra.map((e) => `${e.label} ${e.value}`).join('; ')}`).join('\n'));
    }
    if (a.events.length) {
      const tz = first?.tzOffsetMin;
      const rows = a.events.slice(0, 80).map((e) => [fmtLocal(e.time, tz, false), fmtDuration(e.elapsed), e.event, e.eventType, e.details]);
      out.push(`## Events (${a.events.length}${a.events.length > 80 ? ', first 80 shown' : ''})\n\n${table(['Local time', 'Elapsed', 'Event', 'Type', 'Details'], rows)}`);
    }
    if (a.profile.length) out.push(`## Athlete profile, settings and other metadata\n\n${a.profile.map((g) => `### ${g.title}\n${kvList(g.items)}`).join('\n\n')}`);
    if (a.unknown.messages.length || a.unknown.fieldsByMessage.length) {
      out.push(`## Undocumented data\n- Unknown message types: ${a.unknown.messages.length ? a.unknown.messages.map((m) => `#${m.num} ×${m.count}`).join(', ') : 'none'}\n- Unknown fields: ${a.unknown.fieldsByMessage.length ? a.unknown.fieldsByMessage.map((f) => `${f.message} [${f.fields.join(', ')}]`).join('; ') : 'none'}`);
    }
  }

  out.push(`## Methods and assumptions\n${kvList(a.methods)}`);

  out.push(`## How to read this report
- "Timer time" excludes pauses (auto-pause and manual stops); "elapsed time" is wall-clock from start to end. Splits, digest, zones and efforts use timer time.
- Pace is shown as ${first ? speedUnitsLabel(first.speedMode) : 'min/km'}${first?.speedMode === 'kmh' ? '' : ' (minutes:seconds per unit distance; lower is faster)'}. Speeds in the raw data are m/s.
- Running cadence in FIT files is in strides/min (one leg); steps/min is twice that value. Cycling cadence is crank rpm.
- Zone tables marked "device" come from the watch's own zone settings; "computed" tables use the stated basis (max HR, LTHR or FTP) and the analyzer's default zone boundaries. Computed HR zones are only produced when a real max HR or LTHR is known, never from the activity's own peak HR.
- A note "inconsistent with the record stream" on a device value means the session summary written by the device contradicts its own per-second data (a known export bug on some devices); use the stream-derived value listed under computed metrics instead.${a.sessions.some((s) => s.dfa) ? `\n- DFA α1: the short-term scaling exponent of the RR-interval series, computed by the analyzer from the beat-to-beat data in the file. It falls as intensity rises: values above ${DFA_AEROBIC} indicate the aerobic (easy) domain, ${DFA_ANAEROBIC}–${DFA_AEROBIC} the heavy domain between the aerobic and anaerobic thresholds, below ${DFA_ANAEROBIC} the severe domain. HRVT1/HRVT2 are the device heart rates at which α1 crosses ${DFA_AEROBIC} and ${DFA_ANAEROBIC}, estimated from this session only; a single easy or steady session may not allow an estimate. The α1 column in the splits and digest is the mean of reliable windows.` : ''}${a.sessions.some((s) => s.zoneSense) ? `\n- Suunto ZoneSense / DDFA: an HRV-based intensity index where 0 is the athlete's aerobic baseline; values below ${ZONESENSE_AEROBIC} indicate the anaerobic zone and below ${ZONESENSE_ANAEROBIC} the VO2max zone. It is largely independent of heart rate, so it can flag metabolic strain that HR alone does not show. The device ignores the first 10 minutes.` : ''}
- Normalized Power, Intensity Factor, TSS, Efficiency Factor and decoupling are standard endurance-training metrics computed here from the raw stream; device-reported values, where present, are listed in the summary.${a.sessions.some((s) => s.predictions) ? `\n- Race predictions: Riegel scales the reference time by (distance ratio)^1.06; the VDOT method (Daniels & Gilbert) converts the reference into a pseudo-VO2max and solves it for each distance. Both assume the athlete is equally prepared for the target distance; a reference taken from a training run understates race fitness.` : ''}
- Aerobic decoupling compares (pace or power) / HR between the first and second half of the session; values under ~5% suggest good aerobic durability.
- Elevation gain marked "computed" uses a smoothed altitude stream with 2 m hysteresis and may differ from the device total.
- Developer fields are vendor extensions (e.g. Suunto, Stryd, Garmin Connect IQ) and carry the vendor's own semantics.`);

  return out.join('\n\n') + '\n';
}

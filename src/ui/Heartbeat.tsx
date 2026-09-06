import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RrBeat, Sample, SessionAnalysis } from '../fit/types';
import { fmtDuration, fmtFixed, fmtNum, fmtSpeed, isNum } from '../fit/format';
import { DFA_AEROBIC, DFA_ANAEROBIC, DFA_FIELD_KEY } from '../fit/dfa';
import { Empty, Tag } from './common';
import { usePrefersDark } from './Charts';

/**
 * Heartbeat replay in real time. The beat times are the RR intervals recorded by the strap, placed on the timer axis.
 * The ECG-like waveform is a template (P-QRS-T shapes with a Bazett-scaled QT); a strap records no voltage, so only the
 * rhythm is real.
 */
const PX_PER_SEC = 100; // constant paper speed (≈ 25 mm/s on a typical screen); the visible window follows the canvas width
const POINCARE_WINDOW_SEC = 120;
const TREND_WINDOW_SEC = 60;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Template ECG voltage (mV) at τ seconds from the R peak of a beat whose RR interval is `rr` seconds. */
function ecgValue(tau: number, rr: number): number {
  const g = (x: number, w: number) => Math.exp(-(x * x) / (2 * w * w));
  const k = Math.sqrt(Math.max(0.3, Math.min(1.5, rr)));
  const qt = Math.max(0.22, Math.min(0.45, 0.4 * k)); // Bazett: QT scales with √RR
  const pr = 0.1 + 0.06 * k;
  return 0.12 * g(tau + pr, 0.025) - 0.08 * g(tau + 0.028, 0.008) + g(tau, 0.011) - 0.22 * g(tau - 0.028, 0.01) + 0.28 * g(tau - 0.72 * qt, 0.045 * (qt / 0.36));
}

function lowerBound<T>(arr: T[], key: (x: T) => number, v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (key(arr[mid]) < v) lo = mid + 1; else hi = mid; }
  return lo;
}

function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const zoneOf = (a1: number | undefined) => (!isNum(a1) ? 0 : a1 >= DFA_AEROBIC ? 1 : a1 >= DFA_ANAEROBIC ? 2 : 3);

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{value}</div>
      {sub && <div className="fact-sub">{sub}</div>}
    </div>
  );
}

export function Heartbeat({ s }: { s: SessionAnalysis }) {
  const beats = s.rrBeats ?? [];
  const dark = usePrefersDark();
  const total = Math.max(s.timerTime, beats.length ? beats[beats.length - 1].timer : 0);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
  const [tick, setTick] = useState(0); // throttled copy of the playhead for the React overlay
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const soundRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const ecgRef = useRef<HTMLCanvasElement>(null);
  const poincareRef = useRef<HTMLCanvasElement>(null);
  const tachoRef = useRef<HTMLCanvasElement>(null);
  const heartRef = useRef<SVGSVGElement>(null);
  const offscreen = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

  // α1 zone per beat (from the injected record stream), for colouring the tachogram.
  const beatZone = useMemo(() => {
    const samples = s.samples;
    const out = new Uint8Array(beats.length);
    if (!samples.length) return out;
    let j = 0;
    for (let i = 0; i < beats.length; i++) {
      while (j + 1 < samples.length && samples[j + 1].timer <= beats[i].timer) j++;
      out[i] = zoneOf(samples[j].extra?.[DFA_FIELD_KEY]);
    }
    return out;
  }, [beats, s.samples]);
  const rrRange = useMemo(() => {
    if (!beats.length) return { min: 0.3, max: 1.2 };
    const rrs = beats.map((b) => b.rr).sort((a, b) => a - b);
    const q = (p: number) => rrs[Math.min(rrs.length - 1, Math.floor(p * (rrs.length - 1)))];
    return { min: Math.max(0.25, q(0.002) - 0.05), max: Math.min(2, q(0.998) + 0.05) };
  }, [beats]);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => {
    // Start at the first beat; dev: `&t=600` seeks to timer second 600.
    const dev = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('t')) : NaN;
    timeRef.current = isFinite(dev) && dev > 0 ? Math.min(total, dev) : beats.length ? beats[0].timer : 0;
    setTick(timeRef.current);
  }, [beats, total]);

  const seek = useCallback((t: number) => { timeRef.current = Math.max(0, Math.min(total, t)); setTick(timeRef.current); }, [total]);
  const toggleSound = () => {
    if (!sound && !audioRef.current) {
      try { audioRef.current = new AudioContext(); } catch { /* no audio */ }
    }
    setSound((v) => !v);
  };
  const beep = (ac: AudioContext) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    const t0 = ac.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    o.connect(g).connect(ac.destination);
    o.start(t0);
    o.stop(t0 + 0.06);
  };

  useEffect(() => {
    if (!beats.length) return;
    let raf = 0;
    let last = performance.now();
    let lastTick = 0;
    const colors = {
      grid: cssVar('--grid'), ink: cssVar('--text-muted'), text: cssVar('--text'), hr: cssVar('--series-hr'), accent: cssVar('--accent'),
      zone: [cssVar('--text-muted'), cssVar('--zone-aerobic'), cssVar('--zone-heavy'), cssVar('--zone-severe')],
    };

    const drawEcg = (t: number) => {
      const c = ecgRef.current; if (!c) return;
      const f = fitCanvas(c); if (!f) return;
      const { ctx, w, h } = f;
      ctx.clearRect(0, 0, w, h);
      const windowSec = w / PX_PER_SEC;
      const t0 = t - windowSec;
      // ECG paper: 1 mm = 0.04 s, 5 mm = 0.2 s.
      const mm = PX_PER_SEC * 0.04;
      ctx.lineWidth = 1;
      for (let x = (((-t0 % 0.2) + 0.2) % 0.2) * PX_PER_SEC, i = 0; x < w; x += mm, i++) {
        ctx.strokeStyle = colors.grid; ctx.globalAlpha = i % 5 === 0 ? 0.9 : 0.35;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
      }
      const base = h * 0.66;
      for (let y = base, i = 0; y > 0; y -= mm, i++) { ctx.globalAlpha = i % 5 === 0 ? 0.9 : 0.35; ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke(); }
      for (let y = base + mm, i = 1; y < h; y += mm, i++) { ctx.globalAlpha = i % 5 === 0 ? 0.9 : 0.35; ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // Trace gain: 20 mm/mV when the strip is tall enough, less on short canvases so the R wave stays inside.
      const amp = Math.min(mm * 20, h * 0.5);
      const gain = Math.round(amp / mm);
      const i0 = lowerBound(beats, (b) => b.timer, t0 - 0.8);
      const i1 = lowerBound(beats, (b) => b.timer, t + 0.8);
      ctx.strokeStyle = colors.hr; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        const tt = t0 + x / PX_PER_SEC;
        let v = 0;
        for (let k = i0; k < i1; k++) { const d = tt - beats[k].timer; if (d > -0.5 && d < 0.6) v += ecgValue(d, beats[k].rr); }
        const y = base - v * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = colors.ink; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${windowSec.toFixed(0)} s window · gain ${gain} mm/mV · template waveform on real beat times`, 8, 15);
      const k = lowerBound(beats, (b) => b.timer, t) - 1;
      if (k >= 0 && t - beats[k].timer < 5) {
        ctx.textAlign = 'right';
        ctx.fillStyle = colors.hr; ctx.font = `bold ${Math.round(Math.min(24, Math.max(16, h / 9)))}px system-ui, sans-serif`;
        ctx.fillText(`${Math.round(60 / beats[k].rr)} bpm`, w - 10, 28);
        ctx.fillStyle = colors.ink; ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(`RR ${Math.round(beats[k].rr * 1000)} ms`, w - 10, 43);
      }
    };

    const drawPoincare = (t: number) => {
      const c = poincareRef.current; if (!c) return;
      const f = fitCanvas(c); if (!f) return;
      const { ctx, w, h } = f;
      ctx.clearRect(0, 0, w, h);
      const pad = 34;
      const x0 = pad, y0 = h - pad, size = Math.max(40, Math.min(w - pad - 8, h - pad - 8));
      const toX = (rr: number) => x0 + ((rr - rrRange.min) / (rrRange.max - rrRange.min)) * size;
      const toY = (rr: number) => y0 - ((rr - rrRange.min) / (rrRange.max - rrRange.min)) * size;
      ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 - size + 0.5, size, size);
      ctx.beginPath(); ctx.moveTo(toX(rrRange.min), toY(rrRange.min)); ctx.lineTo(toX(rrRange.max), toY(rrRange.max)); ctx.stroke();
      ctx.fillStyle = colors.ink; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const rr of [rrRange.min, (rrRange.min + rrRange.max) / 2, rrRange.max]) {
        ctx.fillText(`${Math.round(rr * 1000)}`, toX(rr), y0 + 14);
        ctx.textAlign = 'right'; ctx.fillText(`${Math.round(rr * 1000)}`, x0 - 4, toY(rr) + 4); ctx.textAlign = 'center';
      }
      ctx.fillText('RRₙ (ms)', x0 + size / 2, h - 4);
      ctx.save(); ctx.translate(10, y0 - size / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('RRₙ₊₁ (ms)', 0, 0); ctx.restore();
      const i0 = lowerBound(beats, (b) => b.timer, t - POINCARE_WINDOW_SEC);
      const i1 = lowerBound(beats, (b) => b.timer, t);
      const d: number[] = [], sum: number[] = [];
      for (let k = Math.max(1, i0); k < i1; k++) {
        const a = beats[k - 1].rr, b = beats[k].rr;
        const age = (t - beats[k].timer) / POINCARE_WINDOW_SEC;
        ctx.fillStyle = colors.hr; ctx.globalAlpha = Math.max(0.08, 1 - age);
        ctx.beginPath(); ctx.arc(toX(a), toY(b), age < 0.05 ? 3 : 2, 0, Math.PI * 2); ctx.fill();
        d.push((b - a) / Math.SQRT2); sum.push((a + b) / Math.SQRT2);
      }
      ctx.globalAlpha = 1;
      if (d.length > 5) {
        const sd = (xs: number[]) => { const m = xs.reduce((p, v) => p + v, 0) / xs.length; return Math.sqrt(xs.reduce((p, v) => p + (v - m) ** 2, 0) / xs.length); };
        ctx.fillStyle = colors.text; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`last ${POINCARE_WINDOW_SEC} s · ${d.length} beats`, x0 + 8, y0 - size + 16);
        ctx.fillText(`SD1 ${(sd(d) * 1000).toFixed(1)} ms · SD2 ${(sd(sum) * 1000).toFixed(1)} ms`, x0 + 8, y0 - size + 32);
      }
    };

    const drawTacho = (t: number) => {
      const c = tachoRef.current; if (!c) return;
      const f = fitCanvas(c); if (!f) return;
      const { ctx, w, h } = f;
      const key = `${w}x${h}:${dark}:${beats.length}`;
      if (!offscreen.current || offscreen.current.key !== key) {
        const off = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        off.width = Math.round(w * dpr); off.height = Math.round(h * dpr);
        const o = off.getContext('2d')!;
        o.setTransform(dpr, 0, 0, dpr, 0, 0);
        const hrMin = Math.floor(60 / rrRange.max / 10) * 10, hrMax = Math.ceil(60 / rrRange.min / 10) * 10;
        const toY = (hr: number) => 18 + (1 - (hr - hrMin) / Math.max(1, hrMax - hrMin)) * (h - 36);
        o.strokeStyle = colors.grid; o.lineWidth = 1; o.fillStyle = colors.ink; o.font = '11px system-ui, sans-serif'; o.textAlign = 'left';
        const stepHr = hrMax - hrMin > 80 || h < 140 ? 20 : 10;
        for (let hr = hrMin; hr <= hrMax; hr += stepHr) { const y = Math.round(toY(hr)) + 0.5; o.beginPath(); o.moveTo(30, y); o.lineTo(w, y); o.stroke(); o.fillText(String(hr), 2, y + 4); }
        for (let i = 0; i < beats.length; i++) {
          const b = beats[i];
          o.fillStyle = colors.zone[beatZone[i]];
          o.globalAlpha = 0.8;
          o.fillRect(30 + (b.timer / total) * (w - 30), toY(60 / b.rr), 1.2, 1.2);
        }
        offscreen.current = { key, canvas: off };
      }
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(offscreen.current.canvas, 0, 0, w, h);
      const x = 30 + (t / total) * (w - 30);
      ctx.strokeStyle = colors.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = colors.ink; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = x > w - 60 ? 'right' : 'left';
      ctx.fillText(fmtDuration(t), x + (x > w - 60 ? -4 : 4), h - 4);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const prev = timeRef.current;
      if (playingRef.current) {
        const next = Math.min(total, prev + dt);
        timeRef.current = next;
        if (next >= total) { playingRef.current = false; setPlaying(false); }
        if (soundRef.current && audioRef.current) {
          const a = lowerBound(beats, (b) => b.timer, prev), b = lowerBound(beats, (b) => b.timer, next);
          for (let k = a; k < b && k < a + 4; k++) beep(audioRef.current);
        }
      }
      const t = timeRef.current;
      drawEcg(t); drawPoincare(t); drawTacho(t);
      const heart = heartRef.current;
      if (heart) {
        const k = lowerBound(beats, (b) => b.timer, t) - 1;
        const env = k >= 0 ? Math.exp(-(t - beats[k].timer) / 0.12) : 0;
        heart.style.transform = `scale(${1 + 0.2 * env})`;
      }
      if (now - lastTick > 100) { lastTick = now; setTick(t); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [beats, beatZone, dark, rrRange, total]);

  if (!beats.length) return <Empty text="No RR intervals in this file, so there is nothing to replay." />;

  // Overlay values at the playhead.
  const t = tick;
  const bi = lowerBound(beats, (b) => b.timer, t) - 1;
  const beat: RrBeat | undefined = bi >= 0 ? beats[bi] : undefined;
  const si = Math.min(s.samples.length - 1, lowerBound(s.samples, (x) => x.timer, t));
  const sample: Sample | undefined = s.samples[si];
  const trend = (() => {
    const i0 = lowerBound(beats, (b) => b.timer, t - TREND_WINDOW_SEC), i1 = bi + 1;
    if (i1 - i0 < 5) return undefined;
    const rr = beats.slice(i0, i1).map((b) => b.rr);
    const mean = rr.reduce((a, v) => a + v, 0) / rr.length;
    let ss = 0; for (let i = 1; i < rr.length; i++) ss += (rr[i] - rr[i - 1]) ** 2;
    return { hr: 60 / mean, rmssd: Math.sqrt(ss / (rr.length - 1)) * 1000, beats: rr.length };
  })();
  const a1 = sample?.extra?.[DFA_FIELD_KEY];

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h3>Heartbeat replay <span className="muted">({fmtNum(beats.length, 0)} beats recorded by the strap)</span><Tag kind="device" label="device RR" /><Tag kind="computed" label="template waveform" /></h3>
          <div className="inline">
            <button className="btn primary" onClick={() => setPlaying((v) => !v)}>{playing ? 'Pause' : 'Play'}</button>
            <button className={sound ? 'btn active' : 'btn'} onClick={toggleSound} title="Click on every beat">{sound ? 'Sound on' : 'Sound off'}</button>
            <button className="btn" onClick={() => seek(beats[0].timer)} title="Back to the first beat">⟲</button>
          </div>
        </div>
        <p className="muted small">
          Real-time replay: every QRS complex is drawn at the moment your strap registered a beat, so what you see is the rhythm you ran with. The waveform itself is a textbook template scaled with heart rate; a strap records intervals, not voltage. Drag the slider or click the tachogram to jump anywhere.
        </p>
        <input className="scrubber" type="range" min={0} max={Math.ceil(total)} step={1} value={Math.round(t)} onChange={(e) => seek(Number(e.target.value))} aria-label="Position in the workout" />
        <div className="chart-box ecg"><canvas ref={ecgRef} className="hb-canvas" role="img" aria-label="ECG-style strip" /></div>
      </section>

      <div className="hb-grid">
        <div className="stack">
          <section className="card">
            <h3>Now <span className="muted">timer {fmtDuration(t)}{isNum(sample?.dist) ? ` · km ${fmtFixed(sample!.dist! / 1000, 2)}` : ''}</span></h3>
            <div className="heart-row">
              <svg ref={heartRef} className="heart" viewBox="0 0 32 29" aria-hidden width="64" height="58">
                <path d="M23.6 0c-3.4 0-6.3 2.7-7.6 5.6C14.7 2.7 11.8 0 8.4 0 3.8 0 0 3.8 0 8.4c0 9.4 9.5 11.9 16 20.4 6.1-8.4 16-11.3 16-20.4C32 3.8 28.2 0 23.6 0z" fill="var(--series-hr)" />
              </svg>
              <div className="heart-readout">
                <div className="heart-bpm">{beat ? Math.round(60 / beat.rr) : '–'} <span className="muted small">bpm, beat to beat</span></div>
                <div className="muted small">{trend ? `${Math.round(trend.hr)} bpm over the last ${TREND_WINDOW_SEC} s · RMSSD ${fmtNum(trend.rmssd, 1)} ms` : '…'}{isNum(sample?.hr) ? ` · device ${fmtNum(sample!.hr, 0)} bpm` : ''}</div>
              </div>
            </div>
            <div className="facts">
              <Fact label="Beat" value={fmtNum(bi + 1, 0)} sub={`of ${fmtNum(beats.length, 0)}`} />
              <Fact label="RR interval" value={beat ? `${Math.round(beat.rr * 1000)} ms` : '–'} />
              {isNum(sample?.speed) && <Fact label={s.speedMode === 'kmh' ? 'Speed' : 'Pace'} value={fmtSpeed(sample!.speed, s.speedMode, false)} sub={s.speedMode === 'kmh' ? 'km/h' : s.speedMode === 'pace_km' ? 'min/km' : undefined} />}
              {isNum(sample?.power) && <Fact label="Power" value={`${fmtNum(sample!.power, 0)} W`} />}
              {isNum(sample?.cadence) && <Fact label="Cadence" value={`${fmtNum(s.isRunLike ? sample!.cadence * 2 : sample!.cadence, 0)}`} sub={s.isRunLike ? 'steps/min' : 'rpm'} />}
              {isNum(a1) && <Fact label="DFA α1" value={fmtFixed(a1, 2)} sub={a1 >= DFA_AEROBIC ? 'aerobic' : a1 >= DFA_ANAEROBIC ? 'heavy' : 'severe'} />}
              {isNum(sample?.alt) && <Fact label="Altitude" value={`${fmtNum(sample!.alt, 0)} m`} />}
              {isNum(sample?.temp) && <Fact label="Temperature" value={`${fmtNum(sample!.temp, 0)} °C`} />}
            </div>
          </section>
          <section className="card">
            <h3>Tachogram <span className="muted">(beat-to-beat heart rate; click to seek)</span><Tag kind="device" label="device RR" /></h3>
            <div className="chart-box tacho">
              <canvas ref={tachoRef} className="hb-canvas" role="img" aria-label="Tachogram" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left; seek(((x - 30) / Math.max(1, r.width - 30)) * total); }} style={{ cursor: 'pointer' }} />
            </div>
            <p className="muted small">Dots are coloured by the DFA α1 zone when available: green aerobic, amber heavy, red severe, grey unknown. Vertical spread within a second is beat-to-beat variability; isolated outliers are usually strap artefacts.</p>
          </section>
        </div>
        <section className="card">
          <h3>Poincaré plot <span className="muted">(each beat against the next, last {POINCARE_WINDOW_SEC} s)</span><Tag kind="device" label="device RR" /></h3>
          <div className="chart-box poincare"><canvas ref={poincareRef} className="hb-canvas" role="img" aria-label="Poincaré plot" /></div>
          <p className="muted small">A tight cloud on the diagonal means a metronomic heart under load; a wide cloud means high variability. SD1 is short-term variability, SD2 long-term.</p>
        </section>
      </div>
    </div>
  );
}

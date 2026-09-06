import { useState } from 'react';
import type { AthleteSettings, KV } from '../fit/types';
import { fmtDuration, parseDuration } from '../fit/format';

const RACE_OPTIONS: { label: string; m: number }[] = [
  { label: '5 km', m: 5000 }, { label: '10 km', m: 10000 }, { label: 'Half marathon', m: 21097.5 }, { label: 'Marathon', m: 42195 },
];

interface Props { value: AthleteSettings; used: KV[]; onApply: (s: AthleteSettings) => void; onClose: () => void }

const FIELDS: { key: keyof AthleteSettings; label: string; units: string; hint: string }[] = [
  { key: 'maxHr', label: 'Max heart rate', units: 'bpm', hint: 'enables % of max HR and computed HR zones' },
  { key: 'restingHr', label: 'Resting heart rate', units: 'bpm', hint: 'enables % of heart rate reserve' },
  { key: 'lthr', label: 'Lactate threshold HR', units: 'bpm', hint: 'enables LTHR-based HR zones' },
  { key: 'ftp', label: 'FTP / critical power', units: 'W', hint: 'enables power zones, IF and TSS' },
  { key: 'weightKg', label: 'Body weight', units: 'kg', hint: 'enables W/kg' },
];

export function AthleteSettingsPanel({ value, used, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, value[f.key] !== undefined ? String(value[f.key]) : ''])));
  const initialSel = value.raceDistanceM === undefined ? '' : RACE_OPTIONS.find((o) => Math.abs(o.m - value.raceDistanceM!) < 1) ? String(value.raceDistanceM) : 'custom';
  const [raceSel, setRaceSel] = useState<string>(initialSel);
  const [raceCustom, setRaceCustom] = useState<string>(value.raceDistanceM !== undefined && initialSel === 'custom' ? String(value.raceDistanceM) : '');
  const [raceTime, setRaceTime] = useState<string>(value.raceTimeSec !== undefined ? fmtDuration(value.raceTimeSec) : '');
  const raceDistance = raceSel === 'custom' ? Number(raceCustom) : raceSel ? Number(raceSel) : NaN;
  const raceSeconds = parseDuration(raceTime);
  const raceValid = isFinite(raceDistance) && raceDistance >= 1000 && raceSeconds !== undefined && raceSeconds > 60;
  const apply = () => {
    const out: AthleteSettings = {};
    for (const f of FIELDS) {
      const n = Number(draft[f.key]);
      if (draft[f.key].trim() !== '' && isFinite(n) && n > 0) out[f.key] = n;
    }
    if (raceValid) { out.raceDistanceM = raceDistance; out.raceTimeSec = raceSeconds; }
    onApply(out);
  };
  const clear = () => { setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, '']))); setRaceSel(''); setRaceCustom(''); setRaceTime(''); onApply({}); };
  return (
    <section className="card panel" role="dialog" aria-label="Athlete settings">
      <div className="card-head">
        <h3>Athlete settings</h3>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <p className="muted small">Physiological parameters are rarely stored in FIT files. Values entered here are kept in this browser only and are used for every file you open. Leave a field empty to fall back to the value in the file, if any.</p>
      <div className="form-grid">
        {FIELDS.map((f) => {
          const u = used.find((k) => k.key === f.key);
          return (
            <label className="field" key={f.key}>
              <span className="field-label">{f.label} <span className="muted">({f.units})</span></span>
              <input className="input" type="number" inputMode="decimal" min={0} step="any" value={draft[f.key]} placeholder={u && u.note?.startsWith('from file') ? u.value : '–'} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              <span className="muted small">{f.hint}{u ? ` · currently: ${u.value}${u.note ? ` (${u.note})` : ''}` : ''}</span>
            </label>
          );
        })}
      </div>
      <h4 className="subhead">Recent race result <span className="muted small">(optional; basis for race predictions instead of training efforts)</span></h4>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Distance</span>
          <select className="select" value={raceSel} onChange={(e) => setRaceSel(e.target.value)}>
            <option value="">not set</option>
            {RACE_OPTIONS.map((o) => <option key={o.m} value={String(o.m)}>{o.label}</option>)}
            <option value="custom">custom (metres)</option>
          </select>
          {raceSel === 'custom' && <input className="input" type="number" inputMode="numeric" min={1000} step="any" placeholder="e.g. 15000" value={raceCustom} onChange={(e) => setRaceCustom(e.target.value)} />}
        </label>
        <label className="field">
          <span className="field-label">Finish time <span className="muted">(h:mm:ss)</span></span>
          <input className="input" type="text" inputMode="numeric" placeholder="e.g. 1:45:30" value={raceTime} onChange={(e) => setRaceTime(e.target.value)} />
          <span className="muted small">{raceSel && !raceValid ? 'enter a distance of at least 1 km and a time like 45:30 or 1:45:30' : 'a real race is a better predictor than efforts inside a training run'}</span>
        </label>
      </div>
      <div className="inline">
        <button className="btn primary" onClick={apply}>Apply and re-analyze</button>
        <button className="btn" onClick={clear}>Clear</button>
      </div>
    </section>
  );
}

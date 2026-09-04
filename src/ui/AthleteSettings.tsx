import { useState } from 'react';
import type { AthleteSettings, KV } from '../fit/types';

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
  const apply = () => {
    const out: AthleteSettings = {};
    for (const f of FIELDS) {
      const n = Number(draft[f.key]);
      if (draft[f.key].trim() !== '' && isFinite(n) && n > 0) out[f.key] = n;
    }
    onApply(out);
  };
  const clear = () => { setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, '']))); onApply({}); };
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
      <div className="inline">
        <button className="btn primary" onClick={apply}>Apply and re-analyze</button>
        <button className="btn" onClick={clear}>Clear</button>
      </div>
    </section>
  );
}

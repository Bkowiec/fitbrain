import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Analysis, AthleteSettings, DecodedFit } from './fit/types';
import { decodeFit } from './fit/decode';
import { analyze } from './fit/analyze';
import { DropZone } from './ui/DropZone';
import { Overview } from './ui/Overview';
import { LapsSplits } from './ui/LapsSplits';
import { Zones } from './ui/Zones';
import { Charts } from './ui/Charts';
import { Performance } from './ui/Performance';
import { ZoneSenseView } from './ui/ZoneSense';
import { EventsDevices } from './ui/EventsDevices';
import { RawData } from './ui/RawData';
import { LlmExport } from './ui/LlmExport';
import { AthleteSettingsPanel } from './ui/AthleteSettings';
import { loadSettings, saveSettings } from './ui/settingsStore';
import { fmtLocal } from './fit/format';

type TabId = 'overview' | 'laps' | 'zones' | 'charts' | 'performance' | 'zonesense' | 'events' | 'raw' | 'llm';
const ALL_TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'laps', label: 'Laps & splits' },
  { id: 'zones', label: 'Zones' },
  { id: 'charts', label: 'Charts' },
  { id: 'performance', label: 'Performance' },
  { id: 'zonesense', label: 'ZoneSense' },
  { id: 'events', label: 'Events & devices' },
  { id: 'raw', label: 'Raw data' },
  { id: 'llm', label: 'LLM export' },
];

interface LoadedState { fit: DecodedFit; analysis: Analysis }

function settingsSummary(s: AthleteSettings): string {
  const parts = [s.maxHr ? `HRmax ${s.maxHr}` : null, s.lthr ? `LTHR ${s.lthr}` : null, s.ftp ? `FTP ${s.ftp}` : null, s.weightKg ? `${s.weightKg} kg` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'not set';
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const [sessionIdx, setSessionIdx] = useState(0);
  const [settings, setSettings] = useState<AthleteSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get('settings') === '1');

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      await new Promise((r) => setTimeout(r, 20));
      const fit = decodeFit(buf, file.name);
      const analysis = analyze(fit, settings);
      if (!analysis.sessions.length) throw new Error('The file decoded but contains no session or record data to analyze.');
      setLoaded({ fit, analysis });
      setSessionIdx(0);
      const wanted = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('tab') : null;
      setTab(ALL_TABS.some((t) => t.id === wanted) ? (wanted as TabId) : 'overview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const applySettings = useCallback((s: AthleteSettings) => {
    setSettings(s);
    saveSettings(s);
    setLoaded((prev) => (prev ? { fit: prev.fit, analysis: analyze(prev.fit, s) } : prev));
  }, []);

  const session = useMemo(() => loaded?.analysis.sessions[Math.min(sessionIdx, (loaded?.analysis.sessions.length ?? 1) - 1)], [loaded, sessionIdx]);
  const tabs = useMemo(() => ALL_TABS.filter((t) => t.id !== 'zonesense' || !!session?.zoneSense), [session]);
  useEffect(() => { if (!tabs.some((t) => t.id === tab)) setTab('overview'); }, [tabs, tab]);

  // Dev convenience: `?file=/@fs/abs/path/to/activity.fit` auto-loads a file served by Vite.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const p = new URLSearchParams(window.location.search).get('file');
    if (!p) return;
    fetch(p).then(async (r) => {
      if (!r.ok) throw new Error(`Could not fetch ${p}: ${r.status}`);
      const blob = await r.blob();
      onFile(new File([blob], p.split('/').pop() ?? 'activity.fit'));
    }).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◔</span>
          <div>
            <h1>FitBrain</h1>
            <p className="tagline">FIT file analyzer · everything the device recorded, in a form people and LLMs can read</p>
          </div>
        </div>
        <div className="topbar-right">
          {loaded && <span className="filechip" title={loaded.fit.fileName}>{loaded.fit.fileName}</span>}
          {loaded && loaded.analysis.sessions.length > 1 && (
            <select className="select" value={sessionIdx} onChange={(e) => setSessionIdx(Number(e.target.value))} aria-label="Session">
              {loaded.analysis.sessions.map((s) => (
                <option key={s.index} value={s.index}>Session {s.index + 1}: {s.sportLabel} ({fmtLocal(s.startTime, s.tzOffsetMin, false)})</option>
              ))}
            </select>
          )}
          <button className={showSettings ? 'btn active' : 'btn'} onClick={() => setShowSettings((v) => !v)} title="Athlete settings: max HR, LTHR, FTP, weight">
            Athlete <span className="muted small">{settingsSummary(settings)}</span>
          </button>
          {loaded && (
            <label className="btn">
              Open another file
              <input type="file" accept=".fit,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
            </label>
          )}
        </div>
      </header>

      {showSettings && (
        <div className="content settings-wrap">
          <AthleteSettingsPanel value={settings} used={loaded?.analysis.settingsUsed ?? []} onApply={(s) => { applySettings(s); setShowSettings(false); }} onClose={() => setShowSettings(false)} />
        </div>
      )}

      {!loaded && (
        <main className="landing">
          <DropZone onFile={onFile} busy={busy} />
          {error && <div className="alert" role="alert">{error}</div>}
          <section className="landing-notes">
            <h2>What you get</h2>
            <ul>
              <li>Every session, lap, record stream, event, device and developer field decoded with the official Garmin FIT SDK, entirely in your browser. Nothing is uploaded.</li>
              <li>Derived metrics: splits, intensity zones, distributions, fastest efforts, peak power, Normalized Power, drift and decoupling, HRV, elevation, data quality, Suunto ZoneSense (DDFA).</li>
              <li>An LLM-ready Markdown or JSON report you can paste into any assistant for coaching feedback.</li>
            </ul>
          </section>
        </main>
      )}

      {loaded && session && (
        <main className="content">
          {error && <div className="alert" role="alert">{error}</div>}
          {!loaded.fit.integrityOk && <div className="alert warn" role="alert">CRC integrity check failed. The file may be truncated; data below is what could be decoded.</div>}
          <nav className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </nav>
          <section className="tabpanel" role="tabpanel">
            {tab === 'overview' && <Overview s={session} a={loaded.analysis} />}
            {tab === 'laps' && <LapsSplits s={session} />}
            {tab === 'zones' && <Zones s={session} />}
            {tab === 'charts' && <Charts s={session} />}
            {tab === 'performance' && <Performance s={session} />}
            {tab === 'zonesense' && <ZoneSenseView s={session} />}
            {tab === 'events' && <EventsDevices s={session} a={loaded.analysis} />}
            {tab === 'raw' && <RawData fit={loaded.fit} a={loaded.analysis} />}
            {tab === 'llm' && <LlmExport a={loaded.analysis} />}
          </section>
        </main>
      )}
      <footer className="footer">Decoding runs locally with @garmin/fitsdk. Computed metrics are estimates; device values are reported as recorded.</footer>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, AthleteSettings, DecodedFit, SessionAnalysis } from './fit/types';
import { decodeFit } from './fit/decode';
import { analyze } from './fit/analyze';
import { DropZone } from './ui/DropZone';
import { Overview } from './ui/Overview';
import { LapsSplits } from './ui/LapsSplits';
import { Zones } from './ui/Zones';
import { Charts } from './ui/Charts';
import { Performance } from './ui/Performance';
import { ZoneSenseView } from './ui/ZoneSense';
import { DfaAlpha1View } from './ui/DfaAlpha1';
import { RacePacing } from './ui/RacePacing';
import { Heartbeat } from './ui/Heartbeat';
import { EventsDevices } from './ui/EventsDevices';
import { RawData } from './ui/RawData';
import { LlmExport } from './ui/LlmExport';
import { AthleteSettingsPanel } from './ui/AthleteSettings';
import { loadSettings, saveSettings } from './ui/settingsStore';
import { Lockup, Mark } from './ui/Brand';
import { Tag, type Provenance } from './ui/common';
import { applyThemePref, loadThemePref, type ThemePref } from './ui/theme';
import { fmtLocal, fmtNum, isNum } from './fit/format';

type TabId = 'overview' | 'laps' | 'zones' | 'charts' | 'performance' | 'race' | 'dfa' | 'heart' | 'zonesense' | 'events' | 'raw' | 'llm';
interface TabDef { id: TabId; label: string; group: string; hint: string; prov?: Provenance; available: (s: SessionAnalysis | undefined) => boolean }
const always = () => true;
const ALL_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', group: 'Activity', hint: 'summary, computed metrics, data quality', available: always },
  { id: 'laps', label: 'Laps and splits', group: 'Activity', hint: 'laps as recorded, splits every km', available: always },
  { id: 'zones', label: 'Zones', group: 'Activity', hint: 'intensity zones and distributions', available: always },
  { id: 'charts', label: 'Charts', group: 'Activity', hint: 'every record stream over time or distance', available: always },
  { id: 'performance', label: 'Performance', group: 'Activity', hint: 'fastest efforts, peaks, drift, digest', available: always },
  { id: 'race', label: 'Race and pacing', group: 'Insights', hint: 'predictions and a grade-adjusted pacing plan', prov: 'computed', available: (s) => !!s?.isRunLike },
  { id: 'dfa', label: 'DFA α1', group: 'Insights', hint: 'HRV-based intensity from RR intervals', prov: 'computed', available: (s) => !!s?.dfa },
  { id: 'heart', label: 'Heartbeat replay', group: 'Insights', hint: 'the strap, beat by beat, in real time', available: (s) => !!s?.rrBeats?.length },
  { id: 'zonesense', label: 'ZoneSense', group: 'Insights', hint: 'Suunto DDFA index as recorded', available: (s) => !!s?.zoneSense },
  { id: 'events', label: 'Events and devices', group: 'Data', hint: 'pauses, events, sensors, HRV, GPS', available: always },
  { id: 'raw', label: 'Raw data', group: 'Data', hint: 'every decoded message', available: always },
  { id: 'llm', label: 'Report', group: 'Data', hint: 'Markdown and JSON for people and LLMs', available: always },
];
const GROUPS = ['Activity', 'Insights', 'Data'];
const THEMES: { id: ThemePref; label: string }[] = [{ id: 'system', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }];

interface LoadedState { fit: DecodedFit; analysis: Analysis }

function settingsSummary(s: AthleteSettings): string {
  const parts = [s.maxHr ? `HRmax ${s.maxHr}` : null, s.lthr ? `LTHR ${s.lthr}` : null, s.ftp ? `FTP ${s.ftp}` : null, s.weightKg ? `${s.weightKg} kg` : null, s.raceDistanceM ? 'race set' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'not set';
}
const fmtSize = (bytes: number) => (bytes >= 1048576 ? `${fmtNum(bytes / 1048576, 1)} MB` : `${fmtNum(bytes / 1024, 0)} kB`);

export default function App() {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const [sessionIdx, setSessionIdx] = useState(0);
  const [settings, setSettings] = useState<AthleteSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get('settings') === '1');
  const [menuOpen, setMenuOpen] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get('menu') === '1');
  const [theme, setTheme] = useState<ThemePref>(() => {
    const dev = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('theme') : null;
    return dev === 'light' || dev === 'dark' ? dev : loadThemePref();
  });
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { applyThemePref(theme); }, [theme]);

  // Mobile drawer: lock page scroll while open, close on Escape, and drop the state when the layout switches to desktop.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); menuButton.current?.focus(); };
  }, [menuOpen]);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const h = (e: MediaQueryListEvent) => { if (e.matches) setMenuOpen(false); };
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

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
  const tabs = useMemo(() => ALL_TABS.filter((t) => t.available(session)), [session]);
  useEffect(() => { if (!tabs.some((t) => t.id === tab)) setTab('overview'); }, [tabs, tab]);

  // Motion follows the heartbeat: every ambient animation is timed to the recording's mean RR interval (1 000 ms without a file).
  useEffect(() => {
    const rr = session?.hrv?.meanRR ?? (isNum(session?.raw.avgHeartRate) ? 60000 / session!.raw.avgHeartRate : undefined);
    document.documentElement.style.setProperty('--beat-period', `${Math.round(isNum(rr) && rr > 250 && rr < 2500 ? rr : 1000)}ms`);
  }, [session]);

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

  const fileInput = (label: string, hint: string, className: string) => (
    <label className={className}>
      <span className="side-label">{label}</span>
      <span className="side-hint">{hint}</span>
      <input type="file" accept=".fit,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; setMenuOpen(false); }} />
    </label>
  );
  const current = tabs.find((t) => t.id === tab);
  const mobileTitle = showSettings ? 'Athlete settings' : loaded ? current?.label ?? 'FitBrain' : 'Open a file';
  const product = loaded?.analysis.file.items.find((i) => i.key === 'product')?.value;

  return (
    <div className="shell">
      <header className="mobile-bar">
        <button ref={menuButton} className="icon-btn" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="app-sidebar" onClick={() => setMenuOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <Mark size={18} />
        <span className="mobile-title">{mobileTitle}</span>
        {loaded && <span className="filechip mobile-chip" title={loaded.fit.fileName}><span className="name">{loaded.fit.fileName}</span></span>}
      </header>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} aria-hidden />}

      <aside id="app-sidebar" className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Menu">
        <div className="brand">
          <Lockup size={22} as="h1" />
          <span style={{ flex: 1 }} />
          <button ref={closeButton} className="icon-btn side-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="side-file">
          {loaded ? (
            <>
              <div className="filechip" title={loaded.fit.fileName}><span className="name">{loaded.fit.fileName}</span><span className="size">{fmtSize(loaded.fit.fileSize)}</span></div>
              {loaded.analysis.sessions.length > 1 && (
                <select className="select side-select" value={sessionIdx} onChange={(e) => setSessionIdx(Number(e.target.value))} aria-label="Session">
                  {loaded.analysis.sessions.map((s) => (
                    <option key={s.index} value={s.index}>Session {s.index + 1}: {s.sportLabel} ({fmtLocal(s.startTime, s.tzOffsetMin, false)})</option>
                  ))}
                </select>
              )}
              {session && <p className="side-meta">{session.sportLabel} · {fmtLocal(session.startTime, session.tzOffsetMin)}</p>}
            </>
          ) : (
            <p className="side-meta">No file loaded. Drop a .fit file anywhere on the page.</p>
          )}
        </div>

        <nav className="side-nav" aria-label="Sections">
          {GROUPS.map((g) => (
            <div className="side-section" key={g}>
              <div className="side-group">{g}</div>
              {ALL_TABS.filter((t) => t.group === g).map((t) => {
                const enabled = !!loaded && tabs.some((x) => x.id === t.id);
                const active = enabled && tab === t.id && !showSettings;
                return (
                  <button
                    key={t.id}
                    className={active ? 'side-item active' : 'side-item'}
                    aria-current={active ? 'page' : undefined}
                    disabled={!enabled}
                    title={enabled || !loaded ? t.hint : 'Not available for this file'}
                    onClick={() => { setTab(t.id); setShowSettings(false); setMenuOpen(false); }}
                  >
                    <span className="side-label">{t.label}</span>
                    {t.prov && <Tag kind={t.prov} />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="side-actions">
          <button className={showSettings ? 'side-item action active' : 'side-item action'} onClick={() => { setShowSettings((v) => !v); setMenuOpen(false); }} title="Athlete settings: max HR, LTHR, FTP, weight, recent race">
            <span className="side-label">Athlete settings</span>
            <span className="side-hint">{settingsSummary(settings)}</span>
          </button>
          {fileInput(loaded ? 'Open another file' : 'Open a .fit file', 'Garmin, Suunto, Wahoo, COROS, Polar, Zwift', 'side-item action')}
          <div className="theme-row">
            <span className="label">Theme</span>
            <div className="segmented small" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'active' : ''} onClick={() => setTheme(t.id)}>{t.label}</button>)}
            </div>
          </div>
        </div>
        <p className="side-foot"><span className="beat-dot" aria-hidden /> Local only · nothing uploaded</p>
      </aside>

      <main className="content">
        {showSettings && (
          <div className="settings-wrap">
            <AthleteSettingsPanel value={settings} used={loaded?.analysis.settingsUsed ?? []} onApply={(s) => { applySettings(s); setShowSettings(false); }} onClose={() => setShowSettings(false)} />
          </div>
        )}

        {!loaded && (
          <div className="landing">
            <section className="hero">
              <div>
                <h2>Read everything your watch recorded.</h2>
                <p className="lede">FitBrain decodes .fit files in your browser, derives the metrics your watch does not show, and writes a report you or your AI coach can read.</p>
                <ul>
                  <li><span className="beat-dot" aria-hidden /> Runs entirely on this device. No upload, no account, no tracking.</li>
                  <li><span className="beat-dot" aria-hidden /> Garmin, Suunto, Wahoo, COROS, Polar, Zwift and every other FIT writer.</li>
                  <li><span className="beat-dot" aria-hidden /> Every number labelled <Tag kind="device" /> or <Tag kind="computed" /></li>
                </ul>
              </div>
              <div>
                <DropZone onFile={onFile} busy={busy} />
                {error && <div className="alert" role="alert" style={{ marginTop: 12 }}>{error}</div>}
              </div>
            </section>
            <section className="landing-notes card">
              <h3>What you get</h3>
              <ul>
                <li>Every session, lap, record stream, event, device and developer field decoded with the official Garmin FIT SDK.</li>
                <li>Derived metrics: splits, intensity zones, distributions, fastest efforts, peak power, Normalized Power, drift and decoupling, HRV, elevation, data quality, Suunto ZoneSense.</li>
                <li>DFA α1 from the RR intervals of any device that logs them: HRV-based intensity, time in the aerobic, heavy and severe domains, threshold heart-rate estimates.</li>
                <li>Heartbeat replay: an ECG-style strip, Poincaré plot and tachogram driven by the real beat-to-beat timing from your strap.</li>
                <li>Race predictions (Riegel, Daniels VDOT) and a grade-adjusted pacing plan for any GPX course, exported as a FIT course with split targets for the watch.</li>
                <li>A Markdown or JSON report that ends with the methods and assumptions behind every derived number.</li>
              </ul>
            </section>
          </div>
        )}

        {loaded && session && !showSettings && (
          <>
            {error && <div className="alert" role="alert">{error}</div>}
            {!loaded.fit.integrityOk && <div className="alert warn" role="alert">CRC integrity check failed. The file may be truncated; data below is what could be decoded.</div>}
            <div className="page-head">
              <div className="titles">
                <h2>{current?.label}</h2>
                <p className="page-meta">{fmtLocal(session.startTime, session.tzOffsetMin)} · {product ?? 'unknown device'} · {fmtNum(session.samples.length, 0)} records · {current?.hint}</p>
              </div>
              {tab !== 'llm' && <div className="page-actions"><button className="btn" onClick={() => setTab('llm')}>Export report</button></div>}
            </div>
            <section className="tabpanel">
              {tab === 'overview' && <Overview s={session} a={loaded.analysis} />}
              {tab === 'laps' && <LapsSplits s={session} />}
              {tab === 'zones' && <Zones s={session} />}
              {tab === 'charts' && <Charts s={session} />}
              {tab === 'performance' && <Performance s={session} />}
              {tab === 'race' && <RacePacing s={session} />}
              {tab === 'dfa' && <DfaAlpha1View s={session} />}
              {tab === 'heart' && <Heartbeat s={session} />}
              {tab === 'zonesense' && <ZoneSenseView s={session} />}
              {tab === 'events' && <EventsDevices s={session} a={loaded.analysis} />}
              {tab === 'raw' && <RawData fit={loaded.fit} a={loaded.analysis} />}
              {tab === 'llm' && <LlmExport a={loaded.analysis} />}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, AthleteSettings, DecodedFit, SessionAnalysis } from './fit/types';
import { analyze } from './fit/analyze';
import { Library, LibraryFeedback } from './ui/Library';
import { Trends } from './ui/Trends';
import { useLibrary } from './library/useLibrary';
import type { LoadedActivity } from './library/model';
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
import { TAB_IDS, useNavigation, useRestoreView, type TabId } from './ui/navigation';
import { applyThemePref, loadThemePref, type ThemePref } from './ui/theme';
import { fmtLocal, fmtNum, isNum } from './fit/format';

interface TabDef { id: TabId; label: string; group: string; hint: string; available: (s: SessionAnalysis | undefined) => boolean }
const always = () => true;
const ALL_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', group: 'Activity', hint: 'summary, computed metrics, data quality', available: always },
  { id: 'laps', label: 'Laps and splits', group: 'Activity', hint: 'laps as recorded, splits every km', available: always },
  { id: 'zones', label: 'Zones', group: 'Activity', hint: 'intensity zones and distributions', available: always },
  { id: 'charts', label: 'Charts', group: 'Activity', hint: 'every record stream over time or distance', available: always },
  { id: 'performance', label: 'Performance', group: 'Activity', hint: 'fastest efforts, peaks, drift, digest', available: always },
  { id: 'race', label: 'Race and pacing', group: 'Insights', hint: 'predictions and a grade-adjusted pacing plan', available: (s) => !!s?.isRunLike },
  { id: 'dfa', label: 'DFA α1', group: 'Insights', hint: 'HRV-based intensity from RR intervals', available: (s) => !!s?.dfa },
  { id: 'heart', label: 'Heartbeat replay', group: 'Insights', hint: 'the strap, beat by beat, in real time', available: (s) => !!s?.rrBeats?.length },
  { id: 'zonesense', label: 'ZoneSense', group: 'Insights', hint: 'Suunto DDFA index as recorded', available: (s) => !!s?.zoneSense },
  { id: 'events', label: 'Events and devices', group: 'Data', hint: 'pauses, events, sensors, HRV, GPS', available: always },
  { id: 'raw', label: 'Raw data', group: 'Data', hint: 'every decoded message', available: always },
  { id: 'llm', label: 'Report', group: 'Data', hint: 'Markdown and JSON for people and LLMs', available: always },
];
const THEMES: { id: ThemePref; label: string }[] = [{ id: 'system', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }];

interface LoadedState { fit: DecodedFit; analysis: Analysis; id: string }

function settingsSummary(s: AthleteSettings): string {
  const parts = [s.maxHr ? `HRmax ${s.maxHr}` : null, s.lthr ? `LTHR ${s.lthr}` : null, s.ftp ? `FTP ${s.ftp}` : null, s.weightKg ? `${s.weightKg} kg` : null, s.raceDistanceM ? 'race set' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'not set';
}
export default function App() {
  const navigation = useNavigation();
  const { route, navigate, returnToSource } = navigation;
  const routeRef = useRef(route);
  routeRef.current = route;
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showLibrary = route.view === 'library';
  const showTrends = route.view === 'trends';
  const showSettings = route.view === 'settings';
  const tab = route.view === 'activity' ? route.tab : 'overview';
  const sessionIdx = route.view === 'activity' ? route.session : 0;
  const [settings, setSettings] = useState<AthleteSettings>(() => loadSettings());
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get('menu') === '1');
  const [theme, setTheme] = useState<ThemePref>(() => {
    const dev = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('theme') : null;
    return dev === 'light' || dev === 'dark' ? dev : loadThemePref();
  });
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);

  const onOpen = useCallback((activity: LoadedActivity, id: string, sessionIndex = 0) => {
    setLoaded({ ...activity, id });
    setMenuOpen(false);
    setError(null);
    const wanted = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('tab') : null;
    navigate({ view: 'activity', id, session: sessionIndex, tab: TAB_IDS.includes(wanted as TabId) ? wanted as TabId : 'overview' });
  }, [navigate]);
  const onRemove = useCallback((id: string) => {
    setLoaded((prev) => prev?.id === id ? null : prev);
    if (routeRef.current.view === 'activity' && routeRef.current.id === id) navigate({ view: 'library' }, true);
  }, [navigate]);
  const libraryState = useLibrary(settings, onOpen, onRemove);
  const library = { ...libraryState, open: (id: string, session = 0) => {
    if (libraryState.busy) return Promise.resolve(false);
    // Navigate before analysis starts so the source keeps its original scroll position.
    navigate({ view: 'activity', id, session, tab: 'overview' });
    setMenuOpen(false);
    return Promise.resolve(true);
  } };
  const requestedId = route.view === 'activity' ? route.id : undefined;
  const attemptedLoad = useRef('');
  const [loadFailed, setLoadFailed] = useState('');
  useEffect(() => {
    if (!requestedId || loaded?.id === requestedId || library.loading || library.busy) return;
    const attempt = `${navigation.entry.key}:${requestedId}`;
    if (attemptedLoad.current === attempt || !library.activities.some((a) => a.id === requestedId)) return;
    attemptedLoad.current = attempt;
    void library.load(requestedId).then((activity) => {
      if (routeRef.current.view !== 'activity' || routeRef.current.id !== requestedId) return;
      if (activity) { setLoaded({ ...activity, id: requestedId }); setLoadFailed(''); }
      else setLoadFailed(requestedId);
    });
  }, [requestedId, loaded?.id, library.loading, library.busy, library.activities, navigation.entry.key]);
  const missingActivity = !!requestedId && !library.loading && !library.activities.some((a) => a.id === requestedId);
  const ready = !library.loading && (!requestedId || loaded?.id === requestedId || missingActivity || loadFailed === requestedId);
  useRestoreView(navigation.entry.key, navigation.entry.y, ready, navigation.finishRestore);
  const setTab = (next: TabId) => { if (loaded) navigate({ view: 'activity', id: loaded.id, session: sessionIdx, tab: next }); };
  const go = (view: 'library' | 'trends' | 'settings') => { navigate({ view }); setMenuOpen(false); };
  const onFiles = (files: File[]) => {
    if (!files.length || library.busy) return;
    setMenuOpen(false);
    navigate({ view: 'library' });
    setError(null);
    void library.importFiles(files);
  };

  useEffect(() => { applyThemePref(theme); }, [theme]);

  // Mobile drawer: lock page scroll while open, close on Escape, and drop the state when the layout switches to desktop.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (main.current) main.current.inert = true;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
      if (e.key === 'Tab') {
        const elements = [...(sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, summary, [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length);
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; if (main.current) main.current.inert = false; window.removeEventListener('keydown', onKey); menuButton.current?.focus({ preventScroll: true }); };
  }, [menuOpen]);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const h = (e: MediaQueryListEvent) => { if (e.matches) setMenuOpen(false); };
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  const applySettings = useCallback((s: AthleteSettings) => {
    setSettings(s);
    saveSettings(s);
    setLoaded((prev) => (prev ? { ...prev, analysis: analyze(prev.fit, s) } : prev));
  }, []);

  const session = useMemo(() => loaded?.analysis.sessions[Math.min(sessionIdx, (loaded?.analysis.sessions.length ?? 1) - 1)], [loaded, sessionIdx]);
  const tabs = useMemo(() => ALL_TABS.filter((t) => t.available(session)), [session]);
  useEffect(() => {
    if (route.view === 'activity' && loaded?.id === route.id && !tabs.some((t) => t.id === tab)) navigate({ ...route, tab: 'overview' }, true);
  }, [tabs, tab, route, loaded?.id, navigate]);

  // Motion follows the heartbeat: every ambient animation is timed to the recording's mean RR interval (1 000 ms without a file).
  useEffect(() => {
    const rr = session?.hrv?.meanRR ?? (isNum(session?.raw.avgHeartRate) ? 60000 / session!.raw.avgHeartRate : undefined);
    document.documentElement.style.setProperty('--beat-period', `${Math.round(isNum(rr) && rr > 250 && rr < 2500 ? rr : 1000)}ms`);
  }, [session]);

  // Dev convenience: `?file=/@fs/abs/path/to/activity.fit` auto-loads a file served by Vite.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get('settings') === '1') navigate({ view: 'settings' });
    const p = new URLSearchParams(window.location.search).get('file');
    if (!p) return;
    fetch(p).then(async (r) => {
      if (!r.ok) throw new Error(`Could not fetch ${p}: ${r.status}`);
      const blob = await r.blob();
      onFiles([new File([blob], p.split('/').pop() ?? 'activity.fit')]);
    }).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = tabs.find((t) => t.id === tab);
  const mobileTitle = showSettings ? 'Athlete settings' : showTrends ? 'Trends and records' : showLibrary ? 'Activity library' : current?.label ?? 'FitBrain';
  const product = loaded?.analysis.file.items.find((i) => i.key === 'product')?.value;
  const activityTitle = library.activities.find((a) => a.id === loaded?.id)?.title || loaded?.fit.fileName;
  const activityVisible = route.view === 'activity' && loaded?.id === requestedId && !missingActivity;
  const primaryTabs = tabs.filter((t) => t.group === 'Activity');
  const extraTabs = tabs.filter((t) => t.group !== 'Activity' && t.id !== 'llm');
  const tabButton = (t: TabDef) => <button key={t.id} className={tab === t.id ? 'side-item active' : 'side-item'} aria-current={tab === t.id ? 'page' : undefined} disabled={library.busy} title={t.hint} onClick={() => { setTab(t.id); setMenuOpen(false); }}><span className="side-label">{t.label}</span></button>;

  return (
    <div className="shell">
      <header className="mobile-bar">
        <button ref={menuButton} className="icon-btn" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="app-sidebar" onClick={() => setMenuOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <Mark size={24} />
        <span className="mobile-title">{mobileTitle}</span>
      </header>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} aria-hidden />}

      <aside ref={sidebar} id="app-sidebar" className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Menu">
        <div className="brand">
          <Lockup size={32} as="h1" />
          <span style={{ flex: 1 }} />
          <button ref={closeButton} className="icon-btn side-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <nav className="side-nav" aria-label="Sections">
          <div className="side-section">
            <button className={showLibrary ? 'side-item active' : 'side-item'} aria-current={showLibrary ? 'page' : undefined} onClick={() => go('library')}>
              <span className="side-label">Activity library</span><span className="num small muted">{library.activities.length}</span>
            </button>
            <button className={showTrends ? 'side-item active' : 'side-item'} aria-current={showTrends ? 'page' : undefined} onClick={() => go('trends')}><span className="side-label">Trends and records</span></button>
            <button className={showSettings ? 'side-item active' : 'side-item'} aria-current={showSettings ? 'page' : undefined} disabled={library.busy} onClick={() => go('settings')}><span className="side-label">Athlete settings</span></button>
          </div>
          {activityVisible && <div className="side-section activity-navigation">
            <div className="side-group">This activity</div>
            {primaryTabs.map(tabButton)}
            <details className="side-more" open={moreOpen || extraTabs.some((t) => t.id === tab)} onToggle={(e) => setMoreOpen(e.currentTarget.open)}><summary>More analyses</summary>{extraTabs.map(tabButton)}</details>
            {tabButton(ALL_TABS.find((t) => t.id === 'llm')!)}
          </div>}
          {!activityVisible && loaded && <button className="side-item resume-activity" disabled={library.busy} onClick={() => { navigate({ view: 'activity', id: loaded.id, session: 0, tab: 'overview' }); setMenuOpen(false); }}><span className="side-hint">Return to activity</span><span className="side-label">{activityTitle}</span></button>}
        </nav>

        <div className="side-actions">
          <p className="side-hint settings-summary">Athlete · {settingsSummary(settings)}</p>
          {((!showLibrary && !showTrends) || showSettings) && <button className="side-item action" disabled={library.busy || library.loading} onClick={() => importInput.current?.click()}><span className="side-label">Import FIT files</span><span className="side-hint">Add one activity or a whole batch</span></button>}
          <input ref={importInput} type="file" accept=".fit,application/octet-stream" multiple hidden aria-label="Import files from sidebar" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; onFiles(files); }} />
          <div className="theme-row">
            <span className="label">Theme</span>
            <div className="segmented small" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'active' : ''} onClick={() => setTheme(t.id)}>{t.label}</button>)}
            </div>
          </div>
        </div>
        <p className="side-foot"><span className="beat-dot" aria-hidden /> Local only · nothing uploaded</p>
      </aside>

      <main ref={main} tabIndex={-1} className="content" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        onFiles(Array.from(e.dataTransfer.files));
      }}>
        {error && <div className="alert" role="alert">{error}</div>}
        <LibraryFeedback library={library} />
        {showSettings && (
          <div className="settings-wrap">
            <AthleteSettingsPanel value={settings} used={loaded?.analysis.settingsUsed ?? []} onApply={(s) => { applySettings(s); returnToSource(); }} onClose={returnToSource} />
          </div>
        )}

        <div hidden={!showLibrary || showSettings}><Library library={library} onImport={onFiles} currentId={loaded?.id} /></div>
        <Trends library={library} settings={settings} active={showTrends} onLibrary={() => go('library')} onSettings={() => go('settings')} />

        {requestedId && !activityVisible && <section className="card activity-loading" role="status">
          <h2>{missingActivity ? 'Activity not found' : loadFailed === requestedId ? 'Could not open this activity' : 'Opening activity…'}</h2>
          <p className="muted">{missingActivity ? 'This recording is no longer saved in this browser.' : loadFailed === requestedId ? 'Please try opening it again from your library.' : 'Preparing your saved recording.'}</p>
          {(missingActivity || loadFailed === requestedId) && <button className="btn" onClick={() => go('library')}>Go to activity library</button>}
        </section>}

        {loaded && session && activityVisible && (
          <>
            {!loaded.fit.integrityOk && <div className="alert warn" role="alert">CRC integrity check failed. The file may be truncated; data below is what could be decoded.</div>}
            <button className="text-button back-link" onClick={returnToSource}>← {navigation.entry.source?.route.view === 'trends' ? 'Back to trends' : 'Back to library'}</button>
            <div className="page-head activity-head">
              <div className="titles">
                <h2>{activityTitle}</h2>
                <p className="activity-meta">{session.sportLabel} · {fmtLocal(session.startTime, session.tzOffsetMin)}</p>
                {loaded.analysis.sessions.length > 1 && <label className="field activity-session"><span className="field-label">Session</span><select className="select" aria-label="Session" value={Math.min(sessionIdx, loaded.analysis.sessions.length - 1)} onChange={(e) => navigate({ view: 'activity', id: loaded.id, session: Number(e.target.value), tab })}>{loaded.analysis.sessions.map((s) => <option key={s.index} value={s.index}>Session {s.index + 1}: {s.sportLabel}</option>)}</select></label>}
                <details className="details activity-file"><summary>Recording details</summary><p>{loaded.fit.fileName} · {product ?? 'unknown device'} · {fmtNum(session.samples.length, 0)} records</p></details>
              </div>
              {tab !== 'llm' && <div className="page-actions"><button className="btn" onClick={() => setTab('llm')}>Export report</button></div>}
            </div>
            <h3 className="view-title">{current?.label}</h3>
            <section className="tabpanel" aria-label={current?.label} key={`${loaded.id}:${sessionIdx}`}>
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

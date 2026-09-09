import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const TAB_IDS = ['overview', 'laps', 'zones', 'charts', 'performance', 'race', 'dfa', 'heart', 'zonesense', 'events', 'raw', 'llm'] as const;
export type TabId = typeof TAB_IDS[number];
export type Route = { view: 'library' | 'trends' | 'settings' } | { view: 'activity'; id: string; session: number; tab: TabId };
interface Location { key: string; index: number; route: Route; y: number }
interface Entry extends Location { app: 'fitbrain'; source?: Location }

function readRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'activity' && /^[a-f0-9]{64}$/.test(parts[1] ?? '')) {
    return { view: 'activity', id: parts[1], session: /^\d+$/.test(parts[2] ?? '') ? Math.min(Number(parts[2]), 10000) : 0, tab: TAB_IDS.includes(parts[3] as TabId) ? parts[3] as TabId : 'overview' };
  }
  return { view: parts[0] === 'trends' || parts[0] === 'settings' ? parts[0] : 'library' };
}
function url(route: Route): string {
  const hash = route.view === 'activity' ? `activity/${route.id}/${route.session}/${route.tab}` : route.view;
  return `${window.location.pathname}${window.location.search}#/${hash}`;
}
function initialEntry(): Entry {
  const route = readRoute();
  const saved = window.history.state as Entry | null;
  return saved?.app === 'fitbrain' && JSON.stringify(saved.route) === JSON.stringify(route)
    ? saved : { app: 'fitbrain', key: crypto.randomUUID(), index: 0, route, y: 0 };
}

/** Hash URLs work on static hosts. Each browser history entry owns its scroll position and source. */
export function useNavigation() {
  const [entry, setEntry] = useState(initialEntry);
  const current = useRef(entry);
  const positions = useRef(new Map<string, number>());
  const restoring = useRef(true);
  const save = useCallback(() => {
    const next = { ...current.current, y: restoring.current ? current.current.y : window.scrollY };
    positions.current.set(next.key, next.y);
    current.current = next;
    window.history.replaceState(next, '', url(next.route));
    return next;
  }, []);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.history.replaceState(current.current, '', url(current.current.route));
    const pop = () => {
      if (!restoring.current) positions.current.set(current.current.key, window.scrollY);
      const saved = initialEntry();
      const next = { ...saved, y: positions.current.get(saved.key) ?? saved.y };
      restoring.current = true;
      current.current = next;
      setEntry(next);
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('pagehide', save);
    return () => {
      window.history.scrollRestoration = previous;
      window.removeEventListener('popstate', pop);
      window.removeEventListener('pagehide', save);
    };
  }, [save]);

  const navigate = useCallback((route: Route, replace = false) => {
    if (JSON.stringify(route) === JSON.stringify(current.current.route)) return;
    const prev = save();
    const source = route.view === 'settings' ? prev : route.view === 'activity'
      ? prev.route.view === 'activity' ? prev.source : prev.route.view === 'settings' ? prev.source : prev
      : undefined;
    const next: Entry = { app: 'fitbrain', key: crypto.randomUUID(), index: prev.index + (replace ? 0 : 1), route, source, y: 0 };
    window.history[replace ? 'replaceState' : 'pushState'](next, '', url(route));
    restoring.current = true;
    current.current = next;
    setEntry(next);
  }, [save]);

  const returnToSource = useCallback(() => {
    const here = save();
    if (here.source && here.source.index < here.index) window.history.go(here.source.index - here.index);
    else navigate({ view: 'library' });
  }, [save, navigate]);

  const finishRestore = useCallback(() => { restoring.current = false; }, []);
  return { entry, route: entry.route, navigate, returnToSource, finishRestore };
}

/** Wait for a saved FIT to reopen before restoring a scrolled activity page. */
export function useRestoreView(key: string, y: number, ready: boolean, finish: () => void) {
  useLayoutEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
      window.scrollTo({ top: y, behavior: 'instant' });
      finish();
    });
    return () => cancelAnimationFrame(frame);
  }, [key, y, ready, finish]);
}

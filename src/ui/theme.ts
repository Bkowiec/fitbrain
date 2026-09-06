/** Theme preference: follow the system by default; an explicit choice is stamped on <html data-theme> and remembered. */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'fitbrain.theme';
const EVENT = 'fitbrain:theme';

export function loadThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme; else root.dataset.theme = pref;
  try { window.localStorage.setItem(KEY, pref); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function isDarkNow(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function subscribeTheme(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  window.addEventListener(EVENT, cb);
  return () => { mq.removeEventListener('change', cb); window.removeEventListener(EVENT, cb); };
}

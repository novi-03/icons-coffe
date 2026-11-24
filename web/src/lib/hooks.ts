import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from './api';

/** Fetch data with loading/error state. `reload()` refetches; `softReload()` debounces bursts of realtime events. */
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const timer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fetchRef.current();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  const softReload = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(reload, 150);
  }, [reload]);

  useEffect(() => {
    setLoading(true);
    reload();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, softReload, setData };
}

/** Re-render every `ms` (for live timers). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** State persisted in localStorage. When `key` changes, the value is re-read from the new key (never overwritten with the old one). */
export function useLocalStorage<T>(key: string, initial: T) {
  const read = (k: string): T => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  };
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read(key) }));
  // Key changed (e.g. table context loaded): switch to that key's stored value during render.
  const current = state.key === key ? state : { key, value: read(key) };
  if (current !== state) setState(current);
  useEffect(() => {
    if (state.key !== key) return;
    try { localStorage.setItem(key, JSON.stringify(state.value)); } catch { /* storage unavailable */ }
  }, [key, state]);
  const setValue = useCallback((v: T | ((prev: T) => T)) => {
    setState((s) => ({ key: s.key, value: typeof v === 'function' ? (v as (p: T) => T)(s.value) : v }));
  }, []);
  return [current.value, setValue] as const;
}

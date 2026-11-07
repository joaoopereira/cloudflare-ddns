import { useCallback, useEffect, useRef, useState } from "react";

/** Load data on mount and every `intervalMs`, with a manual reload. */
export function usePolling<T>(load: () => Promise<T>, intervalMs = 10_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, intervalMs);
    return () => clearInterval(t);
  }, [reload, intervalMs]);

  return { data, error, reload };
}

/** Re-render every second (for countdowns and "x ago" labels). */
export function useTick(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Run an action, tracking busy state and surfacing errors via `onError`. */
export function useAction(onError: (msg: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        return true;
      } catch (e) {
        onError((e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );
  return { busy, run };
}

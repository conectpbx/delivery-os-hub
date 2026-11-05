import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useAuth } from "@/hooks/useAuth";

const PREFIX = "delivery-os-draft:";

/** Drafts are scoped during render as well as storage, so an account switch cannot show/save another draft. */
export function usePersistentState<T>(key: string, initial: T) {
  const { user, loading } = useAuth();
  const storageKey = user ? `${PREFIX}${user.id}:${key}` : null;
  const initialValue = useRef(initial);
  const [state, setState] = useState<{ owner: string | null; value: T }>({
    owner: null,
    value: initial,
  });
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const value = state.owner === storageKey ? state.value : initialValue.current;
  const latest = useRef({ owner: storageKey, value });
  latest.current = { owner: storageKey, value };

  useEffect(() => {
    if (loading || !storageKey) return;
    let restored = initialValue.current;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) restored = JSON.parse(raw) as T;
    } catch {
      /* Invalid or unavailable storage must not break the form. */
    }
    setState({ owner: storageKey, value: restored });
    setRestoredKey(storageKey);
  }, [loading, storageKey]);

  useEffect(() => {
    if (!storageKey || restoredKey !== storageKey) return;
    const save = () => {
      if (latest.current.owner !== storageKey) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(latest.current.value));
      } catch {
        /* Keep the form usable when storage is full. */
      }
    };
    const timer = window.setTimeout(save, 350);
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [restoredKey, storageKey, value]);

  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      setState((current) => {
        const previous = current.owner === storageKey ? current.value : initialValue.current;
        return {
          owner: storageKey,
          value: typeof next === "function" ? (next as (value: T) => T)(previous) : next,
        };
      });
    },
    [storageKey],
  );
  const clear = () => {
    try {
      if (storageKey) window.localStorage.removeItem(storageKey);
    } catch {
      /* Ignore unavailable storage. */
    }
  };
  return [value, setValue, clear] as const;
}

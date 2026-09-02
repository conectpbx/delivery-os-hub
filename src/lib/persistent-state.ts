import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

const PREFIX = "delivery-os-draft:";

/**
 * Estado que sobrevive a trocas de app / recarregamentos do navegador.
 * Salva no localStorage (com hidratação segura para SSR) e restaura ao voltar.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const { user, loading } = useAuth();
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const storageKey = user ? `${PREFIX}${user.id}:${key}` : null;
  const initialValue = useRef(initial);
  const latest = useRef(value);
  latest.current = value;

  // Restaura o rascunho depois da hidratação.
  useEffect(() => {
    if (loading || !storageKey) return;
    setRestored(false);
    setValue(initialValue.current);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      /* rascunho inválido — ignora */
    }
    setRestored(true);
  }, [loading, storageKey]);

  // Persiste a cada alteração e também ao sair/ocultar a aba.
  useEffect(() => {
    if (!restored || !storageKey) return;
    const save = () => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(latest.current));
      } catch {
        /* storage cheio — ignora */
      }
    };
    save();
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [restored, storageKey, value]);

  const clear = () => {
    try {
      if (storageKey) window.localStorage.removeItem(storageKey);
    } catch {
      /* ignora */
    }
  };

  return [value, setValue, clear] as const;
}

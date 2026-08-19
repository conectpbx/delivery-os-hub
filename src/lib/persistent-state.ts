import { useEffect, useRef, useState } from "react";

const PREFIX = "delivery-os-draft:";

/**
 * Estado que sobrevive a trocas de app / recarregamentos do navegador.
 * Salva no localStorage (com hidratação segura para SSR) e restaura ao voltar.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const storageKey = PREFIX + key;
  const latest = useRef(value);
  latest.current = value;

  // Restaura o rascunho depois da hidratação.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      /* rascunho inválido — ignora */
    }
    setRestored(true);
  }, [storageKey]);

  // Persiste a cada alteração e também ao sair/ocultar a aba.
  useEffect(() => {
    if (!restored) return;
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
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignora */
    }
  };

  return [value, setValue, clear] as const;
}

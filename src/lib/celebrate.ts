import { useEffect } from "react";
import { toast } from "sonner";

const STORE_KEY = "delivery-os:celebrations";

const MESSAGES_100 = [
  "Meta batida! Você transformou quilômetros em resultado. 🚀",
  "Mandou bem demais! Objetivo alcançado com estrada e disciplina. 🏆",
  "Fechou a meta! Cada corrida valeu a pena. 💪",
  "Missão cumprida! Agora é manter o ritmo. 🔥",
];

const MESSAGES_75 = [
  "Faltou pouco: você já passou de 75% da meta. Bora fechar! 🔥",
  "Reta final! Mais alguns pedidos e a meta é sua. 💨",
];

function pick(list: string[]) {
  return list[Math.floor(Math.random() * list.length)]!;
}

function readStore(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function markFired(key: string) {
  if (typeof window === "undefined") return;
  const store = readStore();
  store[key] = Date.now();
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* noop */
  }
}

function alreadyFired(key: string) {
  return Boolean(readStore()[key]);
}

export type GoalProgress = {
  /** Identificador estável do marco, ex.: "diaria-2026-08-18-receita" */
  id: string;
  label: string;
  value: number;
  target: number;
};

/**
 * Dispara alertas motivacionais (uma única vez por marco) quando
 * o progresso da meta atinge 75% e 100%.
 */
export function useGoalCelebrations(goals: GoalProgress[]) {
  const signature = goals
    .map((g) => `${g.id}:${Math.round(g.value)}:${Math.round(g.target)}`)
    .join("|");

  useEffect(() => {
    for (const g of goals) {
      if (!g.target || g.target <= 0) continue;
      const pct = (g.value / g.target) * 100;

      if (pct >= 100) {
        const key = `${g.id}:100`;
        if (!alreadyFired(key)) {
          markFired(key);
          toast.success(`${g.label}: 100% concluída!`, {
            description: pick(MESSAGES_100),
            duration: 7000,
          });
        }
        continue;
      }

      if (pct >= 75) {
        const key = `${g.id}:75`;
        if (!alreadyFired(key)) {
          markFired(key);
          toast(`${g.label}: ${Math.round(pct)}% da meta`, {
            description: pick(MESSAGES_75),
            duration: 6000,
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

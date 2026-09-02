import type { SupabaseClient } from "@supabase/supabase-js";

const PREFIX = "delivery-os-offline-queue:";

function storageKey(userId: string) {
  if (!userId) throw new Error("Sessão necessária para usar o modo offline");
  return `${PREFIX}${userId}`;
}

export type QueuedInsert = {
  id: string;
  table: string;
  cacheKey: string;
  values: Record<string, unknown>;
  createdAt: string;
};

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function readQueue(userId: string): QueuedInsert[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "[]");
    return Array.isArray(value) ? (value as QueuedInsert[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(userId: string, items: QueuedInsert[]) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    throw new Error("Não foi possível salvar o registro offline neste dispositivo");
  }
}

export function enqueueInsert(
  table: string,
  cacheKey: string,
  values: Record<string, unknown>,
  userId: string,
): QueuedInsert {
  const item: QueuedInsert = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    table,
    cacheKey,
    values,
    createdAt: new Date().toISOString(),
  };
  writeQueue(userId, [...readQueue(userId), item]);
  return item;
}

/** Envia tudo que foi salvo offline. Retorna as chaves de cache afetadas. */
export async function flushQueue(db: SupabaseClient, userId: string): Promise<string[]> {
  const items = readQueue(userId);
  if (!items.length) return [];

  const remaining: QueuedInsert[] = [];
  const synced = new Set<string>();

  for (const item of items) {
    try {
      const { error } = await db.from(item.table).insert(item.values);
      if (error) remaining.push(item);
      else synced.add(item.cacheKey);
    } catch {
      remaining.push(item);
    }
  }

  writeQueue(userId, remaining);
  return [...synced];
}

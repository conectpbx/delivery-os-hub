import type { SupabaseClient } from "@supabase/supabase-js";

const KEY = "delivery-os-offline-queue";

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

export function readQueue(): QueuedInsert[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as QueuedInsert[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedInsert[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
}

export function enqueueInsert(
  table: string,
  cacheKey: string,
  values: Record<string, unknown>,
): QueuedInsert {
  const item: QueuedInsert = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    table,
    cacheKey,
    values,
    createdAt: new Date().toISOString(),
  };
  writeQueue([...readQueue(), item]);
  return item;
}

/** Envia tudo que foi salvo offline. Retorna as chaves de cache afetadas. */
export async function flushQueue(db: SupabaseClient): Promise<string[]> {
  const items = readQueue();
  if (!items.length) return [];

  const remaining: QueuedInsert[] = [];
  const synced = new Set<string>();

  for (const item of items) {
    const { error } = await db.from(item.table).insert(item.values);
    if (error) remaining.push(item);
    else synced.add(item.cacheKey);
  }

  writeQueue(remaining);
  return [...synced];
}

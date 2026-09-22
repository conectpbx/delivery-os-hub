import type { SupabaseClient } from "@supabase/supabase-js";
import { get, set } from "idb-keyval";

const PREFIX = "delivery-os-offline-queue:";

async function storageKey(userId: string) {
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

export async function readQueue(userId: string): Promise<QueuedInsert[]> {
  if (typeof window === "undefined") return [];
  try {
    const key = await storageKey(userId);
    const value = await get(key);
    return Array.isArray(value) ? (value as QueuedInsert[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(userId: string, items: QueuedInsert[]) {
  try {
    const key = await storageKey(userId);
    await set(key, items);
  } catch {
    throw new Error("Não foi possível salvar o registro offline neste dispositivo");
  }
}

export async function enqueueInsert(
  table: string,
  cacheKey: string,
  values: Record<string, unknown>,
  userId: string,
): Promise<QueuedInsert> {
  const item: QueuedInsert = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    table,
    cacheKey,
    values,
    createdAt: new Date().toISOString(),
  };
  const current = await readQueue(userId);
  await writeQueue(userId, [...current, item]);
  return item;
}

/** Envia tudo que foi salvo offline. Retorna as chaves de cache afetadas. */
export async function flushQueue(db: SupabaseClient, userId: string): Promise<string[]> {
  const items = await readQueue(userId);
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

  await writeQueue(userId, remaining);
  return [...synced];
}

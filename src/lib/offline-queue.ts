import type { SupabaseClient } from "@supabase/supabase-js";
import { get, update } from "idb-keyval";

const PREFIX = "delivery-os-offline-queue:";
const TABLES = new Set([
  "deliveries",
  "fuelings",
  "expenses",
  "maintenances",
  "goals",
  "apps",
  "work_journeys",
]);
const syncing = new Map<string, Promise<string[]>>();

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
export async function readQueue(userId: string): Promise<QueuedInsert[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const value = await get(storageKey(userId));
    return Array.isArray(value) ? (value as QueuedInsert[]) : [];
  } catch {
    return [];
  }
}

export async function enqueueInsert(
  table: string,
  cacheKey: string,
  values: Record<string, unknown>,
  userId: string,
): Promise<QueuedInsert> {
  if (!TABLES.has(table) || cacheKey !== table || values["user_id"] !== userId)
    throw new Error("Registro offline inválido para esta conta");
  const id = typeof values["id"] === "string" ? values["id"] : crypto.randomUUID();
  const item: QueuedInsert = {
    id: crypto.randomUUID(),
    table,
    cacheKey,
    values: { ...values, id },
    createdAt: new Date().toISOString(),
  };
  try {
    // IndexedDB's atomic update avoids losing simultaneous inserts in this or another tab.
    await update<QueuedInsert[]>(storageKey(userId), (current) => [...(current ?? []), item]);
  } catch {
    throw new Error("Não foi possível salvar o registro offline neste dispositivo");
  }
  return item;
}

async function syncQueue(db: SupabaseClient, userId: string): Promise<string[]> {
  let items: QueuedInsert[] = [];
  // Give legacy entries stable IDs before any request so retries remain idempotent.
  await update<QueuedInsert[]>(storageKey(userId), (current) => {
    items = (current ?? []).map((item) => ({
      ...item,
      values: { ...item.values, id: item.values["id"] ?? crypto.randomUUID() },
    }));
    return items;
  });
  const completed = new Set<string>();
  const synced = new Set<string>();
  for (const item of items) {
    if (
      !TABLES.has(item.table) ||
      item.cacheKey !== item.table ||
      item.values["user_id"] !== userId
    )
      continue;
    try {
      const { error } = await db.from(item.table).upsert(item.values, {
        onConflict: "id",
        ignoreDuplicates: item.table !== "work_journeys",
      });
      if (!error) {
        completed.add(item.id);
        synced.add(item.cacheKey);
      }
    } catch {
      // Keep failures for the next online sync, with the same record ID.
    }
  }
  if (completed.size)
    await update<QueuedInsert[]>(storageKey(userId), (current) =>
      (current ?? []).filter((item) => !completed.has(item.id)),
    );
  return [...synced];
}

/** Single-flight in this tab; stable IDs also prevent duplicates across tabs/retries. */
export function flushQueue(db: SupabaseClient, userId: string): Promise<string[]> {
  const running = syncing.get(userId);
  if (running) return running;
  const pending = syncQueue(db, userId).finally(() => syncing.delete(userId));
  syncing.set(userId, pending);
  return pending;
}

import type { QueryClient } from "@tanstack/react-query";
export type ListRange = { from?: Date; to?: Date; overlap?: boolean };
export type ListScope = {
  from: string | null;
  to: string | null;
  field: string;
  mode: "date" | "delivery-overlap" | "journey-overlap";
  app?: string;
  status?: string;
};
export function listScope(range: ListRange, field = "occurred_at"): ListScope {
  return {
    from: range.from?.toISOString() ?? null,
    to: range.to?.toISOString() ?? null,
    field,
    mode: !range.overlap ? "date" : field === "started_at" ? "journey-overlap" : "delivery-overlap",
  };
}
export function deliveryPeriod(range: "hoje" | "7d" | "mes" | "tudo", now: Date): ListRange {
  if (range === "tudo") return {};
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (range === "7d") from.setDate(from.getDate() - 6);
  if (range === "mes") from.setDate(1);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}
export function deliveryLearningPeriod(now: Date): ListRange {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  from.setDate(from.getDate() - 56);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}
export function matchesScope(row: Record<string, unknown>, scope?: Partial<ListScope>): boolean {
  if (!scope) return true;
  if (scope.app && row["app_name"] !== scope.app) return false;
  if (scope.status && row["status"] !== scope.status) return false;
  const from = scope.from ? Date.parse(scope.from) : -Infinity;
  const to = scope.to ? Date.parse(scope.to) : Infinity;
  const occurred = Date.parse(String(row[scope.field ?? "occurred_at"] ?? ""));
  if (scope.mode === "journey-overlap") {
    const end = row["ended_at"] ? Date.parse(String(row["ended_at"])) : Infinity;
    return occurred <= to && end >= from;
  }
  if (occurred >= from && occurred <= to) return true;
  if (scope.mode === "delivery-overlap" && (row["ended_at"] || row["status"] === "em_rota")) {
    const start = Date.parse(String(row["started_at"] ?? row["occurred_at"]));
    const end = row["ended_at"] ? Date.parse(String(row["ended_at"])) : Infinity;
    return start <= to && end >= from;
  }
  return !scope.from && !scope.to;
}

/** Update only existing matching caches; never create an incomplete "all history" cache. */
export function cacheInsertedRow(client: QueryClient, key: string, row: Record<string, unknown>) {
  for (const [queryKey, current] of client.getQueriesData<unknown>({ queryKey: [key] })) {
    const scope = queryKey[2] as Partial<ListScope> | undefined;
    if (!matchesScope(row, scope)) continue;
    if (Array.isArray(current))
      client.setQueryData(queryKey, [row, ...current.filter((item) => item.id !== row["id"])]);
    else if (
      queryKey[1] === "history" &&
      current &&
      typeof current === "object" &&
      "pages" in current
    ) {
      const data = current as {
        pages: { rows: Record<string, unknown>[]; total: number | null; next: number | null }[];
        pageParams: unknown[];
      };
      const exists = data.pages.some((page) => page.rows.some((item) => item["id"] === row["id"]));
      client.setQueryData(queryKey, {
        ...data,
        pages: data.pages.map((page, index) => ({
          ...page,
          rows:
            index === 0
              ? [row, ...page.rows.filter((item) => item["id"] !== row["id"])]
              : page.rows.filter((item) => item["id"] !== row["id"]),
          total: page.total === null ? null : page.total + (exists ? 0 : 1),
        })),
      });
    }
  }
}
export function cacheRemovedRow(client: QueryClient, key: string, id: string) {
  for (const [queryKey, current] of client.getQueriesData<unknown>({ queryKey: [key] })) {
    if (Array.isArray(current))
      client.setQueryData(
        queryKey,
        current.filter((item) => item.id !== id),
      );
    else if (
      queryKey[1] === "history" &&
      current &&
      typeof current === "object" &&
      "pages" in current
    ) {
      const data = current as {
        pages: { rows: Record<string, unknown>[]; total: number | null; next: number | null }[];
        pageParams: unknown[];
      };
      const exists = data.pages.some((page) => page.rows.some((item) => item["id"] === id));
      client.setQueryData(queryKey, {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          rows: page.rows.filter((item) => item["id"] !== id),
          total: page.total === null ? null : Math.max(0, page.total - (exists ? 1 : 0)),
        })),
      });
    }
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  cacheInsertedRow,
  cacheRemovedRow,
  deliveryPeriod,
  deliveryLearningPeriod,
  listScope,
  matchesScope,
} from "./delivery-scope";
import { filterScope } from "./data";
const now = new Date(2026, 10, 6, 12);

test("delivery periods use civil days and preserve the goal's 56 days before month start", () => {
  const today = deliveryPeriod("hoje", now);
  const week = deliveryPeriod("7d", now);
  const month = deliveryPeriod("mes", now);
  assert.equal(today.from?.getHours(), 0);
  assert.equal(today.to?.getHours(), 23);
  assert.equal(week.from?.getDate(), 31);
  assert.equal(week.from?.getMonth(), 9);
  assert.equal(month.from?.getDate(), 1);
  assert.deepEqual(deliveryPeriod("tudo", now), {});
  const expected = new Date(2026, 10, 1);
  expected.setDate(expected.getDate() - 56);
  assert.equal(deliveryLearningPeriod(now).from?.getTime(), expected.getTime());
});

test("database date filters preserve cross-midnight delivery and journey intervals", () => {
  const calls: string[][] = [];
  const builder = {
    gte: (field: string, value: string) => {
      calls.push(["gte", field, value]);
      return builder;
    },
    lte: (field: string, value: string) => {
      calls.push(["lte", field, value]);
      return builder;
    },
    or: (value: string) => {
      calls.push(["or", value]);
      return builder;
    },
  };
  const period = deliveryPeriod("hoje", now);
  filterScope(builder, listScope(period));
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["gte", "lte"],
  );
  calls.length = 0;
  filterScope(builder, listScope({ ...period, overlap: true }));
  assert.ok(calls[0]?.[1]?.includes("started_at.lte."));
  const started = new Date(period.from!.getTime() - 3600_000).toISOString();
  const ended = new Date(period.from!.getTime() + 3600_000).toISOString();
  assert.equal(
    matchesScope(
      { occurred_at: started, started_at: started, ended_at: ended },
      listScope({ ...period, overlap: true }),
    ),
    true,
  );
  assert.equal(matchesScope({ occurred_at: started }, listScope(period)), false);
  assert.equal(
    matchesScope(
      { started_at: started, ended_at: ended },
      listScope({ ...period, overlap: true }, "started_at"),
    ),
    true,
  );
});

test("scoped inserts do not fabricate a partial all-history cache and preserve offline pages", () => {
  const client = new QueryClient();
  const scope = listScope(deliveryPeriod("hoje", now));
  const key = ["deliveries", "history", scope];
  client.setQueryData(key, {
    pages: [{ rows: [{ id: "a" }], total: 31, next: 20 }],
    pageParams: [0],
  });
  client.setQueryData(["deliveries", "range", scope], []);
  const other = listScope(deliveryPeriod("hoje", new Date(2026, 9, 1)));
  client.setQueryData(["deliveries", "range", other], []);
  const row = { id: "b", occurred_at: now.toISOString(), status: "concluida" };
  cacheInsertedRow(client, "deliveries", row);
  assert.equal(client.getQueryData(["deliveries"]), undefined);
  assert.deepEqual(client.getQueryData(["deliveries", "range", other]), []);
  assert.deepEqual(client.getQueryData(["deliveries", "range", scope]), [row]);
  const page = client.getQueryData<{
    pages: { rows: { id: string }[]; total: number; next: number }[];
  }>(key)!.pages[0]!;
  assert.deepEqual(
    page.rows.map((item) => item.id),
    ["b", "a"],
  );
  assert.equal(page.total, 32);
  assert.equal(page.next, 20);
  cacheInsertedRow(client, "deliveries", row);
  assert.equal(client.getQueryData<{ pages: { total: number }[] }>(key)!.pages[0]!.total, 32);
  cacheRemovedRow(client, "deliveries", "b");
  assert.equal(client.getQueryData<{ pages: { total: number }[] }>(key)!.pages[0]!.total, 31);
  assert.equal(client.getQueryData(["deliveries"]), undefined);
  client.clear();
});

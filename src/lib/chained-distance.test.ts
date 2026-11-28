import { routeTotals } from "./delivery-records";
import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateChainedDistance,
  chainedRouteSegments,
  orderedRoutePoints,
} from "./chained-distance";
import { completionDistanceKm, recordedDistanceKm } from "./distance-values";
import {
  summarize,
  reportBreakdown,
  avgFuelPrice,
  costPerKm,
  maintenanceReservePerKm,
} from "./metrics";
import type { Delivery } from "./data";
const point = (lat: number | null, lng: number | null, at: string, address = "") => ({
  kind: "entrega" as "coleta" | "entrega",
  address,
  lat,
  lng,
  recorded_at: at,
});
const row = (id: string, stops: ReturnType<typeof point>[], extra = {}) =>
  ({
    id,
    occurred_at: "2026-11-10T12:00:00Z",
    app_name: "iFood",
    earnings: 30,
    tip: 0,
    distance_km: 5,
    duration_min: 10,
    idle_min: 0,
    stops,
    ...extra,
  }) as Delivery;

test("multi-day chaining never invents the overnight return between independent days", async () => {
  const a = row("a", [
    point(-23, -46, "2026-11-10T12:00:00Z"),
    point(-23.1, -46.1, "2026-11-10T13:00:00Z"),
  ]);
  const b = row("b", [
    point(-24, -47, "2026-11-11T12:00:00Z"),
    point(-24.1, -47.1, "2026-11-11T13:00:00Z"),
  ]);
  const calls: unknown[] = [];
  const result = await calculateChainedDistance([b, a], async (points) => {
    calls.push(points);
    return { distanceKm: 4 };
  });
  assert.equal(calls.length, 2);
  assert.equal(result.distanceKm, 8);
});
test("an unresolved intermediate stop breaks the chain instead of creating a shortcut", async () => {
  const d = row("a", [
    point(-23, -46, "2026-11-10T12:00:00Z"),
    point(null, null, "2026-11-10T12:10:00Z"),
    point(-24, -47, "2026-11-10T12:20:00Z"),
  ]);
  let calls = 0;
  const result = await calculateChainedDistance([d], async () => {
    calls++;
    return { distanceKm: 10 };
  });
  assert.equal(calls, 0);
  assert.equal(result.distanceKm, null);
  assert.equal(result.partial, true);
});
test("road distance totals are not silently capped or lost by rounding tiny legs", async () => {
  const d = row("a", [
    point(-23, -46, "2026-11-10T12:00:00Z"),
    point(-23.001, -46.001, "2026-11-10T12:01:00Z"),
  ]);
  assert.equal(
    (await calculateChainedDistance([d], async () => ({ distanceKm: 12.34 }))).distanceKm,
    12.34,
  );
  assert.equal(
    (
      await calculateChainedDistance([d], async () => ({
        distanceKm: 0.12,
        legs: [{ distanceKm: 0 }, { distanceKm: 0 }],
      }))
    ).distanceKm,
    0.12,
  );
  assert.equal(
    (await calculateChainedDistance([d], async () => ({ distanceKm: 2, approximate: true })))
      .approximate,
    true,
  );
});
test("consecutive duplicate points collapse but a later return still counts", () => {
  const d = row("a", [
    point(-23, -46, "2026-11-10T12:00:00Z"),
    point(-23, -46, "2026-11-10T12:01:00Z"),
    point(-24, -47, "2026-11-10T12:02:00Z"),
    point(-23, -46, "2026-11-10T12:03:00Z"),
  ]);
  assert.deepEqual(orderedRoutePoints([d]), [
    [-23, -46],
    [-24, -47],
    [-23, -46],
  ]);
  assert.equal(chainedRouteSegments([d])[0]?.length, 3);
});
test("business civil days use São Paulo even across UTC midnight", () => {
  const d = row("a", [
    point(-23, -46, "2026-11-10T23:50:00Z"),
    point(-24, -47, "2026-11-11T00:20:00Z"),
  ]);
  assert.equal(chainedRouteSegments([d]).length, 1);
});
test("GPS and manual completion preserve recorded km and fill only missing distance", () => {
  assert.equal(completionDistanceKm("12.5", 20), 12.5);
  assert.equal(completionDistanceKm(0, 4.25), 4.25);
  assert.equal(completionDistanceKm(null, null), 0);
  for (const value of [-5, "bad", Infinity, NaN]) assert.equal(recordedDistanceKm(value), 0);
});
test("summary and report distance use the same registered values despite invalid legacy km", () => {
  const rows = [
    row("a", [], { distance_km: "1.5" }),
    row("b", [], { distance_km: -3 }),
    row("c", [], { distance_km: 2.5 }),
  ];
  const summary = summarize(rows, [], [], 2);
  assert.equal(summary.distance, 4);
  assert.equal(summary.fuelCost, 8);
  assert.equal(summary.perKm, 90 / 4);
  const report = reportBreakdown(rows, [], [], [], "day");
  assert.equal(
    report.reduce((sum, row) => sum + row.distance, 0),
    summary.distance,
  );
});

test("completion routing cannot silently omit an unlocated intermediate stop", async () => {
  const pts = [
    point(-23, -46, "2026-11-10T12:00:00Z"),
    point(null, null, "2026-11-10T12:10:00Z"),
    point(-24, -47, "2026-11-10T12:20:00Z"),
  ];
  assert.equal(await routeTotals(pts), null);
});

test("fuel cost uses paid amount weighted by liters and ignores invalid volume", () => {
  const fuel = [
    { liters: 1, price_per_liter: 10, total: 10 },
    { liters: 100, price_per_liter: 5, total: 500 },
  ] as import("./data").Fueling[];
  assert.equal(avgFuelPrice(fuel), 510 / 101);
  assert.equal(
    costPerKm(fuel, { fuel_efficiency: 10 } as import("./data").Profile),
    510 / 101 / 10,
  );
  assert.equal(
    costPerKm(fuel, { fuel_efficiency: Infinity } as import("./data").Profile),
    510 / 101 / 12,
  );
  assert.equal(avgFuelPrice([]), 6.1);
});
test("missing maintenance odometer is not interpreted as a zero-km cycle", () => {
  const reserve = maintenanceReservePerKm([
    {
      id: "m",
      service_type: "Óleo",
      cost: 100,
      odometer: null,
      next_due_km: 10000,
      performed_at: "2026-11-10",
      next_due_date: null,
    },
  ] as import("./data").Maintenance[]);
  assert.equal(reserve.costPerKm, 0);
  assert.equal(reserve.incomplete.length, 1);
});

test("one continuous delivery across civil midnight retains its actual linked points", () => {
  const d = row("night", [
    point(-23, -46, "2026-11-11T02:50:00Z"),
    point(-24, -47, "2026-11-11T03:20:00Z"),
  ]);
  assert.equal(chainedRouteSegments([d]).length, 1);
});

test("a later same-address pickup does not erase the original recorded starting point", () => {
  const d = row(
    "return",
    [
      { ...point(null, null, "2026-11-10T12:10:00Z", "Rua inicial"), kind: "coleta" },
      point(-24, -47, "2026-11-10T12:05:00Z"),
    ],
    { lat: -23, lng: -46, pickup_address: "Rua inicial", started_at: "2026-11-10T12:00:00Z" },
  );
  assert.deepEqual(orderedRoutePoints([d]), [
    [-23, -46],
    [-24, -47],
  ]);
});

test("a delivery with no stops breaks the chain between neighboring deliveries", async () => {
  const first = row("first", [
    point(-23, -46, "2026-11-10T12:00:00Z"),
    point(-23.1, -46.1, "2026-11-10T12:10:00Z"),
  ]);
  const gap = row("gap", [], { occurred_at: "2026-11-10T12:20:00Z" });
  const last = row(
    "last",
    [point(-24, -47, "2026-11-10T12:30:00Z"), point(-24.1, -47.1, "2026-11-10T12:40:00Z")],
    { occurred_at: "2026-11-10T12:30:00Z" },
  );
  const calls: [number, number][][] = [];
  const result = await calculateChainedDistance([first, gap, last], async (points) => {
    calls.push(points);
    return { distanceKm: 2 };
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((points) => points.length),
    [2, 2],
  );
  assert.equal(result.distanceKm, 4);
  assert.equal(result.partial, true);
});

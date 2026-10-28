import assert from "node:assert/strict";
import test from "node:test";
import type { Delivery } from "./data";
import { appInsights } from "./app-insights";

const d = (v: Partial<Delivery>): Delivery => ({
  id: Math.random().toString(), app_name: "iFood", earnings: 10, tip: 0, distance_km: 5, duration_min: 30,
  payment_method: "pix", idle_min: 0, pickup_address: null, dropoff_address: null, lat: null, lng: null,
  occurred_at: "2026-10-20T15:00:00-03:00", ...v,
});

test("separa receita, participação e lucro por aplicativo", () => {
  const rows = appInsights(
    [d({ earnings: 30, tip: 10 }), d({ earnings: 20 }), d({ app_name: "Uber", earnings: 40, distance_km: 2, payment_method: "credito" })],
    1,
  );
  const ifood = rows.find((r) => r.app === "iFood")!;
  const uber = rows.find((r) => r.app === "Uber")!;
  assert.equal(ifood.revenue, 60);
  assert.equal(ifood.tips, 10);
  assert.equal(ifood.profit, 50);
  assert.equal(ifood.ticket, 30);
  assert.equal(ifood.revenueShare, 0.6);
  assert.equal(uber.perKm, 20);
  assert.equal(uber.payments.credito, 40);
  assert.equal(rows[0].app, "iFood");
});

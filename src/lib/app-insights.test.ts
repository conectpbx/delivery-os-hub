import assert from "node:assert/strict";
import test from "node:test";
import type { Delivery } from "./data";
import { appInsights } from "./app-insights";

const d = (v: Partial<Delivery>): Delivery => ({
  id: Math.random().toString(),
  app_name: "iFood",
  earnings: 10,
  tip: 0,
  distance_km: 5,
  duration_min: 30,
  payment_method: "pix",
  idle_min: 0,
  pickup_address: null,
  dropoff_address: null,
  lat: null,
  lng: null,
  occurred_at: "2026-10-20T15:00:00-03:00",
  ...v,
});

test("separa receita, participação e lucro por aplicativo", () => {
  const rows = appInsights(
    [
      d({ earnings: 30, tip: 10 }),
      d({ earnings: 20 }),
      d({ app_name: "Uber", earnings: 40, distance_km: 2, payment_method: "credito" }),
    ],
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
  assert.equal(rows[0]?.app, "iFood");
});

test("não duplica tempo de rotas simultâneas e desconta pausas da jornada", () => {
  const deliveries = [
    d({ started_at: "2026-10-20T12:00:00Z", ended_at: "2026-10-20T13:00:00Z", earnings: 30 }),
    d({ started_at: "2026-10-20T12:30:00Z", ended_at: "2026-10-20T13:30:00Z", earnings: 30 }),
  ];
  const rows = appInsights(deliveries, 1, {
    from: new Date("2026-10-20T00:00:00Z"),
    to: new Date("2026-10-20T23:59:59Z"),
    now: new Date("2026-10-21T00:00:00Z"),
    journeys: [
      {
        id: "j",
        started_at: "2026-10-20T12:00:00Z",
        ended_at: "2026-10-20T14:00:00Z",
        distance_km: 10,
        source: "browser",
        pauses: [
          {
            id: "p",
            reason: "Almoço",
            started_at: "2026-10-20T13:00:00Z",
            ended_at: "2026-10-20T13:15:00Z",
          },
        ],
      },
    ],
  });
  assert.equal(rows[0]!.minutes, 75);
  assert.equal(rows[0]!.perHour, 48);
});

test("mantém apps sem nome, bases sem km e custos estimados separados", () => {
  const rows = appInsights(
    [
      d({ app_name: "  ", distance_km: 0, duration_min: 0, tip: 5 }),
      d({ app_name: " Uber ", earnings: 20 }),
    ],
    2,
  );
  const unnamed = rows.find((r) => r.app === "Sem aplicativo")!;
  assert.equal(unnamed.revenue, 15);
  assert.equal(unnamed.cost, 0);
  assert.equal(unnamed.perKm, 0);
  assert.equal(unnamed.perHour, 0);
  assert.equal(rows.find((r) => r.app === "Uber")!.profit, 10);
});

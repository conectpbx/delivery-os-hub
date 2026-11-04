import assert from "node:assert/strict";
import test from "node:test";
import {
  addBonusIncome,
  bonusTotal,
  challengeProgress,
  challengeSchema,
  receivedBonuses,
  type AppChallenge,
} from "./app-challenges";
import type { Delivery } from "./data";

const challenge = (overrides: Partial<AppChallenge> = {}): AppChallenge => ({
  id: "c1",
  app_name: "iFood",
  title: "Desafio",
  starts_at: "2026-10-20T03:00:00.000Z",
  ends_at: "2026-10-21T02:59:59.999Z",
  metric: "deliveries",
  target: 2,
  reward: 50,
  received_at: null,
  ...overrides,
});
const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  id: "d1",
  app_name: "iFood",
  occurred_at: "2026-10-20T13:00:00Z",
  earnings: 20,
  tip: 5,
  distance_km: 5,
  duration_min: 30,
  idle_min: 0,
  payment_method: "pix",
  pickup_address: null,
  dropoff_address: null,
  lat: null,
  lng: null,
  ...overrides,
});
const now = new Date("2026-10-21T12:00:00Z");

test("novos desafios usam crédito automático e permitem optar pelo recebimento manual", () => {
  assert.equal(challengeSchema.parse(challenge()).auto_receive, true);
  assert.equal(challengeSchema.parse(challenge({ auto_receive: false })).auto_receive, false);
  assert.equal(challengeSchema.safeParse({ ...challenge(), auto_receive: "false" }).success, false);
});

test("progresso isola aplicativo e validade, incluindo os limites, sem contar rotas abertas", () => {
  const c = challenge();
  const rows = [
    delivery({ occurred_at: c.starts_at }),
    delivery({ occurred_at: c.ends_at, app_name: " ifood " }),
    delivery({ app_name: "Uber" }),
    delivery({ status: "em_rota" }),
    delivery({ occurred_at: "2026-10-20T02:59:59.999Z" }),
    delivery({ occurred_at: "2026-10-21T03:00:00Z" }),
  ];
  assert.deepEqual(challengeProgress(c, rows, now), {
    value: 2,
    achieved: true,
    status: "Conquistada",
    percent: 100,
  });
});

test("meta de receita inclui gratificação, não usa bonificação como progresso", () => {
  const c = challenge({ metric: "revenue", target: 25, reward: 100 });
  assert.equal(challengeProgress(c, [delivery()], now).value, 25);
  assert.equal(challengeProgress(c, [], now).value, 0);
  assert.equal(
    challengeProgress(
      c,
      [delivery({ occurred_at: "2026-10-20T20:00:00Z" })],
      new Date("2026-10-20T19:00:00Z"),
    ).value,
    0,
  );
});

test("status diferencia antes do início, andamento, prazo encerrado, conquista e recebimento", () => {
  assert.equal(
    challengeProgress(challenge(), [], new Date("2026-10-19T12:00:00Z")).status,
    "Não iniciada",
  );
  assert.equal(
    challengeProgress(challenge(), [], new Date("2026-10-20T12:00:00Z")).status,
    "Em andamento",
  );
  assert.equal(challengeProgress(challenge(), [], now).status, "Encerrada sem atingir");
  assert.equal(
    challengeProgress(challenge({ target: 1 }), [delivery()], now).status,
    "Conquistada",
  );
  assert.equal(
    challengeProgress(challenge({ received_at: now.toISOString() }), [], now).status,
    "Recebida",
  );
});

test("receita segue o recebimento em outro mês, filtra app e permite estorno sem duplicar", () => {
  const rows = [
    challenge(),
    challenge({ id: "c2", received_at: "2026-11-01T03:00:00Z" }),
    challenge({ id: "c3", app_name: "Uber", reward: 80, received_at: "2026-11-01T03:00:00Z" }),
  ];
  const octoberEnd = new Date("2026-11-01T02:59:59.999Z");
  assert.equal(bonusTotal(rows, new Date("2026-10-01T03:00:00Z"), octoberEnd), 0);
  const from = new Date("2026-11-01T03:00:00Z"),
    to = new Date("2026-12-01T02:59:59.999Z");
  assert.equal(bonusTotal(rows, from, to), 130);
  assert.equal(bonusTotal(rows, from, to, " ifood "), 50);
  assert.equal(receivedBonuses(rows, from, to).length, 2);
  assert.equal(
    bonusTotal(
      rows.map((c) => ({ ...c, received_at: null })),
      from,
      to,
    ),
    0,
  );
});

test("bonificação aumenta receita e lucro sem inventar entregas, quilômetros ou horas", () => {
  const base = {
    revenue: 25,
    profit: 20,
    distance: 5,
    workedMin: 30,
    idleMin: 0,
    count: 1,
    perKm: 5,
    perHour: 50,
  };
  const result = addBonusIncome(base, 50);
  assert.equal(result.revenue, 75);
  assert.equal(result.profit, 70);
  assert.equal(result.count, 1);
  assert.equal(result.distance, 5);
  assert.equal(result.workedMin, 30);
  assert.equal(result.perKm, 15);
  assert.equal(result.perHour, 150);
  assert.equal(base.revenue, 25);
  assert.equal(addBonusIncome({ ...base, revenue: 0, distance: 0, workedMin: 0 }, 50).perKm, 0);
});

test("validação rejeita intervalos invertidos, metas fracionárias, valores negativos e inválidos", () => {
  const c = challenge();
  for (const invalid of [
    { target: 0 },
    { target: 1.5 },
    { reward: -1 },
    { reward: Infinity },
    { app_name: "  " },
    { title: "" },
    { ends_at: "2026-10-19T00:00:00Z" },
    { starts_at: "invalid" },
  ])
    assert.equal(challengeSchema.safeParse({ ...c, ...invalid }).success, false);
  assert.equal(challengeSchema.safeParse({ ...c, metric: "revenue", target: 100.5 }).success, true);
});

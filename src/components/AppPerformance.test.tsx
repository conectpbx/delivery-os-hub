import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppPerformance } from "./AppPerformance";
import type { Delivery } from "@/lib/data";

const time = {
  from: new Date("2026-10-20T00:00:00Z"),
  to: new Date("2026-10-21T23:59:59Z"),
  now: new Date("2026-10-22T00:00:00Z"),
  journeys: [],
};
const delivery = (id: string, app_name: string): Delivery => ({
  id,
  app_name,
  occurred_at: "2026-10-20T12:00:00Z",
  earnings: 30,
  tip: 5,
  distance_km: 10,
  duration_min: 20,
  idle_min: 0,
  payment_method: "pix",
  pickup_address: null,
  dropoff_address: null,
  lat: null,
  lng: null,
});

test("relatório mostra apps, evolução, pagamentos e entrega com endereço ausente", () => {
  const html = renderToStaticMarkup(
    <AppPerformance
      detailed
      deliveries={[delivery("1", "iFood"), delivery("2", "Uber")]}
      costPerKm={1}
      periodLabel="20 a 21 de outubro"
      time={time}
    />,
  );
  for (const text of [
    "iFood",
    "Uber",
    "Evolução diária",
    "Pix",
    "Gorjetas",
    "Origem não informada",
    "Exportar seleção",
    "não são rateados",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes("20 a 21 de outubro"));
});

test("visão vazia não oferece exportação de entregas nem números enganosos", () => {
  const html = renderToStaticMarkup(
    <AppPerformance detailed deliveries={[]} costPerKm={1} periodLabel="Hoje" time={time} />,
  );
  assert.ok(html.includes("Sem entregas no período selecionado"));
  assert.ok(!html.includes("Evolução diária"));
  assert.ok(html.includes("disabled"));
});

test("paginação limita detalhes a vinte e mantém o total informado", () => {
  const html = renderToStaticMarkup(
    <AppPerformance
      detailed
      deliveries={Array.from({ length: 21 }, (_, i) => delivery(String(i), "iFood"))}
      costPerKm={1}
      periodLabel="Hoje"
      time={time}
    />,
  );
  assert.equal((html.match(/Origem não informada/g) ?? []).length, 20);
  assert.ok(html.includes("21 registros"));
});

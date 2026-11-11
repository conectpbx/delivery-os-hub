import assert from "node:assert/strict";
import test from "node:test";
import { coordinateAddress, validCoordinates, resolveDeliveryLocation } from "./delivery-location";
import { orderedRoutePoints, resolveChainedPoints } from "./chained-distance";
import { deliveryEntryMoney } from "./delivery-entry";
import type { Delivery } from "./data";

const delivery = (stops: unknown[], extra = {}) =>
  ({ id: "delivery", occurred_at: "2026-11-10T10:00:00Z", stops, ...extra }) as Delivery;
test("quick amount ignores hidden fees and tips while complete mode retains them", () => {
  const quick = deliveryEntryMoney(20, 15, 7, "quick");
  assert.equal(quick.earnings, 20);
  assert.equal(quick.gross_earnings, 20);
  assert.equal(quick.tip, 0);
  assert.equal(quick.fee_percent, 0);
  assert.equal(deliveryEntryMoney(20, 15, 7, "full").earnings, 17);
  assert.equal(deliveryEntryMoney(20, 15, 7, "full").tip, 7);
});
test("chaining normalizes legacy coordinates and preserves the initial point and returns", () => {
  const d = delivery(
    [
      { kind: "entrega", address: "", lat: "-23.56", lng: "-46.64", recorded_at: "bad" },
      {
        kind: "entrega",
        address: "",
        lat: -23.55,
        lng: -46.63,
        recorded_at: "2026-11-10T10:02:00Z",
      },
      { kind: "entrega", address: "", lat: 100, lng: -46 },
    ],
    { lat: "-23.55", lng: "-46.63", started_at: "2026-11-10T09:00:00Z" },
  );
  assert.deepEqual(orderedRoutePoints([d]), [
    [-23.55, -46.63],
    [-23.56, -46.64],
    [-23.55, -46.63],
  ]);
  assert.equal(validCoordinates(null, -46), null);
  assert.equal(validCoordinates("bad", -46), null);
  assert.deepEqual(coordinateAddress("-23.55000, -46.63000"), [-23.55, -46.63]);
  assert.equal(coordinateAddress("Rua A, 100"), null);
});
test("GPS becomes a street address and address-only historical stops enter the chain", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    return new Response(
      JSON.stringify(
        url.includes("/reverse")
          ? { address: { road: "Rua da Coleta", house_number: "42", city: "São Paulo" } }
          : [{ lat: "-23.56", lon: "-46.64" }],
      ),
      { status: 200 },
    );
  };
  try {
    const stop = await resolveDeliveryLocation({
      address: "-23.551, -46.631",
      lat: -23.551,
      lng: -46.631,
    });
    assert.equal(stop.address, "Rua da Coleta, 42, São Paulo");
    const chain = await resolveChainedPoints([
      delivery([
        { kind: "coleta", address: "Rua inicial", lat: -23.55, lng: -46.63 },
        { kind: "entrega", address: "Rua só endereço para teste", lat: null, lng: null },
      ]),
    ]);
    assert.deepEqual(chain, [
      [-23.55, -46.63],
      [-23.56, -46.64],
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("historical address recovery stops when its query is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    resolveChainedPoints(
      [delivery([{ kind: "entrega", address: "Rua cancelada", lat: null, lng: null }])],
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

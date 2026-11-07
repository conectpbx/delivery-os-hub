import assert from "node:assert/strict";
import test from "node:test";
import { createAsyncCache } from "./async-cache";
import { fetchRoute, fetchRouteWithFallback, geocodeAddress } from "./geo";

test("geographic cache coalesces requests, expires entries and evicts least recently used keys", async () => {
  let now = 0,
    calls = 0;
  const cache = createAsyncCache<number | null>(2, 10, () => now);
  const load = async () => ++calls;
  const first = cache.get("a", load);
  assert.equal(cache.get("a", load), first);
  await first;
  assert.equal(await cache.get("a", load), 1);
  await cache.get("b", load);
  await cache.get("a", load);
  await cache.get("c", load);
  assert.equal(await cache.get("b", load), 4);
  now = 20;
  await cache.get("b", load);
  assert.equal(calls, 5);
  let misses = 0;
  await cache.get("missing", async () => {
    misses++;
    return null;
  });
  await cache.get("missing", async () => {
    misses++;
    return null;
  });
  assert.equal(misses, 2);
});
test("routing uses one provider call for repeated ordered coordinates and preserves the approximate fallback", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({
      routes: [
        {
          distance: 1000,
          duration: 120,
          geometry: {
            coordinates: [
              [-46, -23],
              [-46.01, -23.01],
            ],
          },
          legs: [{ distance: 1000, duration: 120 }],
        },
      ],
    });
  }) as typeof fetch;
  try {
    const points: [number, number][] = [
      [-23, -46],
      [-23.01, -46.01],
    ];
    const [a, b] = await Promise.all([fetchRoute(points), fetchRoute(points)]);
    assert.equal(calls, 1);
    assert.equal(a?.distanceKm, 1);
    assert.deepEqual(a, b);
    globalThis.fetch = (async () => {
      calls++;
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    const fallback = await fetchRouteWithFallback([
      [-24, -47],
      [-24.01, -47.01],
    ]);
    assert.equal(fallback?.approximate, true);
    assert.ok(fallback!.distanceKm > 0);
    assert.equal(
      await fetchRouteWithFallback([
        [NaN, -47],
        [-24, -47],
      ]),
      null,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("repeated addresses reuse geocoding and provider timeouts remain enabled", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    assert.ok(options?.signal);
    return Response.json([{ lat: "-23", lon: "-46" }]);
  }) as typeof fetch;
  try {
    assert.deepEqual(await geocodeAddress(" Rua A, teste "), { lat: -23, lng: -46 });
    await geocodeAddress("rua a, teste");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

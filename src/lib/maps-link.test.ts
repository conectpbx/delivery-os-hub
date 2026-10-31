import assert from "node:assert/strict";
import test from "node:test";
import { mapsLink } from "./maps-link";
import { navigationUrl } from "./geo";

test("Android entrega a rota com origem, paradas e destino ao Maps e preserva fallback", () => {
  const url = navigationUrl([
    { address: "Praça da Sé, São Paulo", lat: null, lng: null },
    { address: "", lat: -23.5, lng: -46.6 },
    { address: "Av. Paulista, 1000", lat: null, lng: null },
  ])!;
  const link = mapsLink(url, true);
  assert.ok(link.startsWith("intent://www.google.com/maps/dir/?api=1&destination="));
  assert.ok(link.includes("&origin="));
  assert.ok(link.includes("&waypoints="));
  assert.ok(link.includes("package=com.google.android.apps.maps;"));
  const fallback = link.split("S.browser_fallback_url=")[1]!.split(";end")[0]!;
  assert.equal(decodeURIComponent(fallback), url);
  assert.equal(mapsLink(url, false), url);
});

test("não transforma outros destinos nem URLs inválidas em intents", () => {
  for (const url of [
    "/dashboard",
    "https://example.com/maps/dir/",
    "https://www.google.com.evil.test/maps/dir/",
    "http://www.google.com/maps/dir/",
    "https://www.google.com/login",
    "https://user:pass@www.google.com/maps/dir/",
  ]) {
    assert.equal(mapsLink(url, true), url);
  }
});

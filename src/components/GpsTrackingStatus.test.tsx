import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GpsTrackingStatus } from "./GpsTrackingStatus";
import type { TripState } from "@/lib/trip-tracker";

const trip: TripState = {
  active: true,
  source: "browser",
  preferredGps: "external",
  startedAt: null,
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
};
const render = (state = trip, error: string | null = null) =>
  renderToStaticMarkup(<GpsTrackingStatus trip={state} error={error} onRetry={() => {}} />);

test("fallback explains lost integration and iPhone foreground requirement", () => {
  const html = render();
  assert.match(html, /Integração GPS sem leitura recente/);
  assert.match(html, /iPhone/);
  assert.match(html, /tela bloqueada/);
  assert.doesNotMatch(html, /<button/);
});

test("permission error offers a user-initiated retry without claiming GPS is working", () => {
  const html = render(trip, "Permita a localização");
  assert.match(html, /Permita a localização/);
  assert.match(html, /<button/);
  assert.match(html, /Tentar ativar GPS deste dispositivo/);
});

test("paused and integrated trips do not offer browser retry", () => {
  const paused = render(
    {
      ...trip,
      pauses: [{ id: "p", reason: "Almoço", started_at: "2026-10-21T10:00:00Z", ended_at: null }],
    },
    "Erro",
  );
  assert.match(paused, /Captura GPS pausada/);
  assert.doesNotMatch(paused, /<button/);
  const integrated = render({ ...trip, source: "external" });
  assert.match(integrated, /GPS integrado selecionado/);
  assert.doesNotMatch(integrated, /sem leitura recente/);
});

test("finished trips preserve saving errors without offering location capture", () => {
  const html = render({ ...trip, active: false }, "Jornada preservada neste dispositivo");
  assert.match(html, /Jornada preservada neste dispositivo/);
  assert.doesNotMatch(html, /<button|GPS deste dispositivo selecionado/);
});

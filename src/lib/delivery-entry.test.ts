import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryMoney,
  frequentDeliveryValues,
  deliveryGpsSuggestion,
  deliveryActiveMinutes,
  automaticDeliveryMeasurement,
} from "./delivery-entry";
import type { TripState } from "./trip-tracker";
import { parseDeliveryScan, reviewedDeliveryFee } from "./delivery-scan";
const trip: TripState = {
  active: true,
  journeyId: "a",
  source: "browser",
  startedAt: "2026-11-06T10:00:00Z",
  endedAt: null,
  distanceKm: 12,
  points: 20,
  last: null,
  browserGpsAt: "2026-11-06T10:20:00Z",
  pauses: [
    {
      id: "p",
      reason: "Pausa",
      started_at: "2026-11-06T10:05:00Z",
      ended_at: "2026-11-06T10:10:00Z",
    },
  ],
};
const now = new Date("2026-11-06T10:20:00Z");
test("automatic measurement starts at the current distance, not the journey origin", () => {
  assert.deepEqual(automaticDeliveryMeasurement(trip, null, null, now), {
    journeyId: "a", distanceKm: 12, at: now.toISOString(),
  });
});
test("automatic measurement preserves an ongoing delivery across rerenders", () => {
  const baseline = { journeyId: "a", distanceKm: 5, at: "2026-11-06T10:02:00Z" };
  assert.equal(automaticDeliveryMeasurement(trip, baseline, baseline.at, now), baseline);
});
test("a next delivery starts a new segment without including the previous delivery", () => {
  const baseline = { journeyId: "a", distanceKm: 5, at: "2026-11-06T10:02:00Z" };
  const next = automaticDeliveryMeasurement(trip, baseline, null, now);
  assert.deepEqual(next, { journeyId: "a", distanceKm: 12, at: now.toISOString() });
  assert.deepEqual(deliveryGpsSuggestion({ ...trip, distanceKm: 15, browserGpsAt: "2026-11-06T10:25:00Z" }, next, new Date("2026-11-06T10:25:00Z")), { distanceKm: 3, durationMin: 5 });
});
test("automatic measurement replaces another journey's draft and does not start during pauses", () => {
  const old = { journeyId: "old", distanceKm: 5, at: "2026-11-06T09:00:00Z" };
  assert.deepEqual(automaticDeliveryMeasurement(trip, old, old.at, now), { journeyId: "a", distanceKm: 12, at: now.toISOString() });
  assert.equal(automaticDeliveryMeasurement({ ...trip, active: false }, null, null, now), null);
  assert.equal(automaticDeliveryMeasurement({ ...trip, pauses: [{ id: "p", reason: "Almoço", started_at: now.toISOString(), ended_at: null }] }, null, null, now), null);
});
test("quick entry applies fee once and keeps gratuities separate", () => {
  assert.deepEqual(deliveryMoney(20, 15, 2), {
    gross_earnings: 20,
    fee_percent: 15,
    earnings: 17,
    tip: 2,
  });
  for (const args of [
    [0, 0, 0],
    [NaN, 0, 0],
    [10, 101, 0],
    [10, 0, -1],
  ])
    assert.throws(() => deliveryMoney(args[0]!, args[1]!, args[2]!));
  assert.deepEqual(
    frequentDeliveryValues(
      [
        { app_name: "A", gross_earnings: 20, earnings: 17, fee_percent: 15 },
        { app_name: "A", earnings: 17, fee_percent: 15 },
        { app_name: "B", gross_earnings: 100, earnings: 100 },
      ],
      "A",
    ),
    [20],
  );
});
test("GPS suggestions isolate the journey, reject resets/stale readings and exclude pauses", () => {
  const baseline = { journeyId: "a", distanceKm: 5, at: trip.startedAt! };
  assert.deepEqual(deliveryGpsSuggestion(trip, baseline, now), { distanceKm: 7, durationMin: 15 });
  assert.equal(deliveryActiveMinutes(trip.startedAt!, now.toISOString(), trip.pauses), 15);
  assert.equal(deliveryGpsSuggestion(trip, { ...baseline, journeyId: "b" }, now), null);
  assert.equal(deliveryGpsSuggestion({ ...trip, distanceKm: 1 }, baseline, now), null);
  assert.equal(
    deliveryGpsSuggestion({ ...trip, browserGpsAt: "2026-11-06T10:18:00Z" }, baseline, now),
    null,
  );
  assert.equal(deliveryGpsSuggestion({ ...trip, active: false }, baseline, now), null);
  assert.equal(
    deliveryGpsSuggestion(
      { ...trip, pauses: [{ ...trip.pauses![0]!, ended_at: null }] },
      baseline,
      now,
    ),
    null,
  );
});
test("delivery OCR accepts partial results but rejects unsafe amounts and never sums two fees", () => {
  assert.deepEqual(
    parseDeliveryScan(
      '```json\n{"appName":"iFood","gross":20,"feeAmount":3,"dropoffAddress":"Rua A"}\n```',
    ),
    { appName: "iFood", gross: 20, feeAmount: 3, dropoffAddress: "Rua A" },
  );
  assert.equal(reviewedDeliveryFee(20, 3, 30), 15);
  assert.equal(reviewedDeliveryFee(20, null, 10), 10);
  assert.equal(reviewedDeliveryFee(20, null, null), null);
  assert.throws(() => reviewedDeliveryFee(20, 21, null));
  assert.throws(() => parseDeliveryScan('{"gross":-5}'));
  assert.throws(() => parseDeliveryScan('{"feePercent":101}'));
  assert.throws(() => parseDeliveryScan("not JSON"));
});

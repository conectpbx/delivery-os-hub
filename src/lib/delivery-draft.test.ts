import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deliveryFormDraft,
  deliveryStopsDraft,
  deliveryFinishingDraft,
  deliveryModeDraft,
  deliveryStartedDraft,
  deliveryBaselineDraft,
} from "./delivery-draft";

test("delivery drafts reject valid JSON with incompatible shapes before rendering", () => {
  for (const value of [null, {}, "old", 3, [null], [{ id: "a", kind: "coleta", address: null }]]) {
    assert.equal(deliveryStopsDraft.safeParse(value).success, false);
  }
  assert.equal(deliveryFormDraft.safeParse(null).success, false);
  assert.equal(deliveryFinishingDraft.safeParse({ id: "a", stops: null }).success, false);
  assert.equal(deliveryModeDraft.safeParse("legacy").success, false);
  assert.equal(deliveryStartedDraft.safeParse("invalid date").success, false);
  assert.equal(
    deliveryBaselineDraft.safeParse({ journeyId: "a", distanceKm: -1, at: "bad" }).success,
    false,
  );
});

test("delivery draft migration retains valid input and fills missing older fields", () => {
  const form = deliveryFormDraft.parse({
    app_name: "iFood",
    earnings: "25,00",
    payment_method: "pix",
  });
  assert.equal(form.earnings, "25,00");
  assert.equal(form.payment_method, "pix");
  assert.equal(form.fee_amount, "");
  const stops = [{ id: "pickup", kind: "coleta", address: "Restaurante", lat: -23, lng: -46 }];
  assert.deepEqual(deliveryStopsDraft.parse(stops), stops);
});

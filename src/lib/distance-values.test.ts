import assert from "node:assert/strict";
import test from "node:test";
import { deliveryEntryDistance, completionDistanceKm } from "./distance-values";

test("quick and full entries preserve reviewed kilometres instead of saving zero", () => {
  assert.equal(deliveryEntryDistance("4,25"), 4.25);
  assert.equal(deliveryEntryDistance("12.5"), 12.5);
  assert.equal(deliveryEntryDistance(""), 0);
});
test("distance corrections reject invalid or negative kilometres", () => {
  for (const value of ["-1", "abc", "Infinity"])
    assert.throws(() => deliveryEntryDistance(value));
});
test("completion fills missing kilometres without overwriting an informed distance", () => {
  assert.equal(completionDistanceKm(0, 4.25), 4.25);
  assert.equal(completionDistanceKm(12.5, 4.25), 12.5);
});
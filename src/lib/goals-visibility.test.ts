import test from "node:test";
import assert from "node:assert/strict";
import { monthlyGoalIsFinished, challengeIsFinished } from "./goals-visibility";
import type { Goal } from "./data";
import type { AppChallenge } from "./app-challenges";
const goal: Goal = {
  id: "g",
  month: "2026-11-01",
  revenue_target: 1000,
  profit_target: 600,
  deliveries_target: 50,
};
test("current monthly goal finishes only after every configured target is reached", () => {
  assert.equal(
    monthlyGoalIsFinished(goal, "2026-11", { revenue: 1000, profit: 500, count: 50 }),
    false,
  );
  assert.equal(
    monthlyGoalIsFinished(goal, "2026-11", { revenue: 1000, profit: 600, count: 50 }),
    true,
  );
  assert.equal(
    monthlyGoalIsFinished({ ...goal, profit_target: 0, deliveries_target: 0 }, "2026-11", {
      revenue: 1000,
      profit: 0,
      count: 0,
    }),
    true,
  );
  assert.equal(
    monthlyGoalIsFinished(
      { ...goal, revenue_target: 0, profit_target: 0, deliveries_target: 0 },
      "2026-11",
    ),
    false,
  );
});
test("past months are hidden by default while future plans remain visible", () => {
  assert.equal(monthlyGoalIsFinished(goal, "2026-12"), true);
  assert.equal(
    monthlyGoalIsFinished(goal, "2026-10", { revenue: 2000, profit: 2000, count: 100 }),
    false,
  );
});
test("won, received and expired challenges are grouped without changing receipt data", () => {
  const c = { id: "c", received_at: null, ends_at: "2026-11-30T23:59:59Z" } as AppChallenge;
  const now = new Date("2026-11-19T12:00:00Z");
  assert.equal(challengeIsFinished(c, false, now), false);
  assert.equal(challengeIsFinished(c, true, now), true);
  assert.equal(c.received_at, null);
  assert.equal(challengeIsFinished({ ...c, received_at: now.toISOString() }, false, now), true);
  assert.equal(challengeIsFinished({ ...c, ends_at: "2026-11-18T23:59:59Z" }, false, now), true);
});

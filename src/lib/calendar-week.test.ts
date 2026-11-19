import assert from "node:assert/strict";
import test from "node:test";
import { calendarWeekRange } from "./calendar-week";
import { PERIODS, periodRange, inRange } from "./metrics";
import { presetDates } from "./period-dates";

test("weekly filters include Monday through Sunday, never the preceding or following week", () => {
  const weekly = PERIODS.find((period) => period.key === "7");
  assert.ok(weekly);
  for (let day = 16; day <= 22; day++) {
    const now = new Date(2026, 10, day, 12);
    const { from, to } = periodRange(weekly, now);
    assert.equal(from.getTime(), new Date(2026, 10, 16).getTime());
    assert.equal(to.getTime(), new Date(2026, 10, 22, 23, 59, 59, 999).getTime());
    assert.deepEqual(presetDates(weekly, now), { from: "2026-11-16", to: "2026-11-22" });
    const records = [15, 16, 18, 22, 23].map((date) => new Date(2026, 10, date, 12));
    assert.deepEqual(
      records.filter((date) => inRange(date.toISOString(), from, to)).map((date) => date.getDate()),
      [16, 18, 22],
    );
  }
});

test("civil weeks stay intact across month and year boundaries without mutating the reference", () => {
  const now = new Date(2027, 0, 1, 12);
  const timestamp = now.getTime();
  const { from, to } = calendarWeekRange(now);
  assert.equal(from.getTime(), new Date(2026, 11, 28).getTime());
  assert.equal(to.getTime(), new Date(2027, 0, 3, 23, 59, 59, 999).getTime());
  assert.equal(now.getTime(), timestamp);
});
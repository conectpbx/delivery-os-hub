import assert from "node:assert/strict";
import test from "node:test";
import { brl, num, csvCell } from "./format";

test("CSV neutralizes user formulas, quotes separators/CRs and preserves negative numbers", () => {
  for (const value of ["=1+1", "+cmd", "@SUM(A1)", "-1+2", " \t=1+1"])
    assert.equal(csvCell(value), "'" + value);
  assert.equal(csvCell(-12.5), "-12.5");
  assert.equal(csvCell('normal;"name"'), '"normal;""name"""');
  assert.equal(csvCell("a\rb"), '"a\rb"');
});

test("reused number formatters preserve pt-BR output and finite-value fallback", () => {
  for (const value of [0, 1.55, -12345.25, NaN, Infinity]) {
    assert.equal(
      brl(value),
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
        Number.isFinite(value) ? value : 0,
      ),
    );
    for (const digits of [0, 1, 2, 4])
      assert.equal(
        num(value, digits),
        new Intl.NumberFormat("pt-BR", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(Number.isFinite(value) ? value : 0),
      );
  }
});

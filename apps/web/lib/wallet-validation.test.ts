import assert from "node:assert/strict";
import test from "node:test";

import { parseAmountInput, parseRequiredText } from "./wallet-validation";

test("parseRequiredText trims surrounding whitespace", () => {
  const result = parseRequiredText("  demo-alice  ", "Wallet hint");
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value, "demo-alice");
  assert.equal(result.normalized, "demo-alice");
});

test("parseRequiredText rejects empty input", () => {
  const result = parseRequiredText("   ", "Recipient wallet hint");
  assert.deepEqual(result, {
    ok: false,
    error: "Recipient wallet hint is required.",
  });
});

test("parseAmountInput rejects non-integer values", () => {
  const result = parseAmountInput("1.5", "Transfer amount");
  assert.deepEqual(result, {
    ok: false,
    error: "Transfer amount must be a whole number.",
  });
});

test("parseAmountInput rejects zero when allowZero is false", () => {
  const result = parseAmountInput("0", "Withdraw amount");
  assert.deepEqual(result, {
    ok: false,
    error: "Withdraw amount must be greater than zero.",
  });
});

test("parseAmountInput defaults empty optional fee to zero", () => {
  const result = parseAmountInput("", "Transfer fee", {
    allowZero: true,
    defaultToZero: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value, 0n);
  assert.equal(result.normalized, "0");
});

test("parseAmountInput normalizes leading zeros", () => {
  const result = parseAmountInput("0004200", "Deposit amount");
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value, 4200n);
  assert.equal(result.normalized, "4200");
});

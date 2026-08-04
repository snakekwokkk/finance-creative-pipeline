import assert from "node:assert/strict";
import test from "node:test";
import { shouldRunHeadless } from "./browser.mjs";

test("normal pipeline runs stay headless by default", () => {
  assert.equal(shouldRunHeadless({}), true);
  assert.equal(shouldRunHeadless({ browser: { headless: true } }), true);
});

test("login and explicit debugging can force a visible browser", () => {
  assert.equal(shouldRunHeadless({}, { forceVisible: true }), false);
  assert.equal(shouldRunHeadless({ browser: { headless: true } }, { forceVisible: true }), false);
  assert.equal(shouldRunHeadless({ browser: { headless: false } }), false);
});

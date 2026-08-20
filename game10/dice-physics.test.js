"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { createSeededRandom, simulateDiceRoll, topFaceValue } from "./dice-physics.js";

test("seeded random generator is repeatable", () => {
  const first = createSeededRandom(42);
  const second = createSeededRandom(42);
  assert.deepEqual(Array.from({ length:8 }, first), Array.from({ length:8 }, second));
});

test("identity orientation exposes the configured top face", () => {
  assert.equal(topFaceValue({ x:0, y:0, z:0, w:1 }), 3);
});

test("same seed produces the same physical roll", async () => {
  const first = await simulateDiceRoll(20260820);
  const second = await simulateDiceRoll(20260820);
  assert.deepEqual(first.results, second.results);
  assert.equal(first.durationMs, second.durationMs);
  assert.equal(first.results.length, 4);
  assert.ok(first.results.every((value) => value >= 1 && value <= 6));
  assert.ok(first.durationMs >= 1500 && first.durationMs <= 4300);
});

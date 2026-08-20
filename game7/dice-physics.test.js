"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { simulateDiceRoll } from "./dice-physics.js";

test("Manila rolls only the active ship dice and remains deterministic", async () => {
  for (const diceCount of [1, 2, 3]) {
    const first = await simulateDiceRoll(7000 + diceCount, { diceCount });
    const second = await simulateDiceRoll(7000 + diceCount, { diceCount });
    assert.equal(first.diceCount, diceCount);
    assert.equal(first.results.length, diceCount);
    assert.deepEqual(first.results, second.results);
    assert.equal(first.durationMs, second.durationMs);
    assert.ok(first.results.every((value) => value >= 1 && value <= 6));
  }
});

test("physical faces map onto each Manila cargo die without changing its distribution", async () => {
  const cargoFaces = [1, 1, 2, 2, 3, 3];
  const roll = await simulateDiceRoll(7123, { diceCount:3 });
  const mapped = roll.results.map((face) => cargoFaces[face - 1]);
  assert.ok(mapped.every((value) => cargoFaces.includes(value)));
});

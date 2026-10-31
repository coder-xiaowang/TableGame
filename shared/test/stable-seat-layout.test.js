"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { compassSeatSlots, sideColumnSlots } from "../client/stable-seat-layout.js";

test("side columns keep the odd extra seat on the right", () => {
  assert.deepEqual(sideColumnSlots(7).map(({ side }) => side), ["left", "left", "left", "right", "right", "right", "right"]);
});

test("compass slots are unique and keep the local player at the south seat", () => {
  for (let count = 3; count <= 8; count += 1) {
    const slots = compassSeatSlots(count, { hasSelf: true });
    assert.equal(slots[0], "south");
    assert.equal(new Set(slots).size, count);
  }
});

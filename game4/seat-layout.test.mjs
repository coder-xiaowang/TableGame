import test from "node:test";
import assert from "node:assert/strict";
import { distributeEdgeCounts, edgeSeatSlots } from "./seat-layout.mjs";

test("边缘席位始终使用对称分配", () => {
  assert.deepEqual(distributeEdgeCounts(1), { top: 1, left: 0, right: 0 });
  assert.deepEqual(distributeEdgeCounts(2), { left: 0, top: 2, right: 0 });
  assert.deepEqual(distributeEdgeCounts(4), { top: 2, left: 1, right: 1 });
  assert.deepEqual(distributeEdgeCounts(5), { left: 2, top: 1, right: 2 });
});

test("玩家视角底部只有自己并沿左上右保持连续行动顺序", () => {
  assert.deepEqual(edgeSeatSlots(6, true).map((slot) => slot.edge), ["bottom", "left", "left", "top", "right", "right"]);
  assert.equal(edgeSeatSlots(6, true).filter((slot) => slot.edge === "bottom").length, 1);
});

test("旁观视角底边留空并把全部玩家分到上左右三边", () => {
  const slots = edgeSeatSlots(6, false);
  assert.equal(slots.length, 6);
  assert.equal(slots.some((slot) => slot.edge === "bottom"), false);
  assert.deepEqual(slots.map((slot) => slot.edge), ["left", "left", "top", "top", "right", "right"]);
});

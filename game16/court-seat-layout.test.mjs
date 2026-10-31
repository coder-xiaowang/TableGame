import test from "node:test";
import assert from "node:assert/strict";
import { courtSeatSlots } from "./court-seat-layout.mjs";

test("玩家视角固定自己的王座位并对称分配宫廷席", () => {
  assert.deepEqual(courtSeatSlots(3, true).map((slot) => slot.rail), ["throne", "gallery", "gallery"]);
  assert.deepEqual(courtSeatSlots(4, true).map((slot) => slot.rail), ["throne", "left", "gallery", "right"]);
  assert.deepEqual(courtSeatSlots(5, true).map((slot) => slot.rail), ["throne", "left", "gallery", "gallery", "right"]);
  assert.deepEqual(courtSeatSlots(6, true).map((slot) => slot.rail), ["throne", "left", "left", "gallery", "right", "right"]);
});

test("旁观者没有王座位且使用稳定对称的公共布局", () => {
  assert.deepEqual(courtSeatSlots(3, false).map((slot) => slot.rail), ["left", "gallery", "right"]);
  assert.deepEqual(courtSeatSlots(6, false).map((slot) => slot.rail), ["left", "left", "gallery", "gallery", "right", "right"]);
});

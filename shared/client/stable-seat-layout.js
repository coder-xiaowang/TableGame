"use strict";

const RING_SLOTS = Object.freeze([
  "south", "southwest", "west", "northwest", "north", "northeast", "east", "southeast"
]);

export function sideColumnSlots(playerCount) {
  const count = Math.max(0, Math.floor(Number(playerCount) || 0));
  const leftCount = Math.floor(count / 2);
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    side: index < leftCount ? "left" : "right",
    order: index < leftCount ? index : index - leftCount
  })));
}

export function compassSeatSlots(playerCount, { hasSelf = false } = {}) {
  const count = Math.max(0, Math.min(8, Math.floor(Number(playerCount) || 0)));
  if (!count) return Object.freeze([]);
  const start = hasSelf ? 0 : 4;
  const used = new Set();
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    let ringIndex = (start + Math.round(index * RING_SLOTS.length / count)) % RING_SLOTS.length;
    while (used.has(ringIndex)) ringIndex = (ringIndex + 1) % RING_SLOTS.length;
    used.add(ringIndex);
    slots.push(RING_SLOTS[ringIndex]);
  }
  return Object.freeze(slots);
}

export const STABLE_RING_SLOTS = RING_SLOTS;

const EDGE_DISTRIBUTIONS = Object.freeze({
  0: Object.freeze({ left: 0, top: 0, right: 0 }),
  1: Object.freeze({ left: 0, top: 1, right: 0 }),
  2: Object.freeze({ left: 0, top: 2, right: 0 }),
  3: Object.freeze({ left: 1, top: 1, right: 1 }),
  4: Object.freeze({ left: 1, top: 2, right: 1 }),
  5: Object.freeze({ left: 2, top: 1, right: 2 }),
  6: Object.freeze({ left: 2, top: 2, right: 2 })
});

export function distributeEdgeCounts(playerCount) {
  const count = Math.max(0, Math.min(6, Math.floor(Number(playerCount) || 0)));
  return EDGE_DISTRIBUTIONS[count];
}

export function edgeSeatSlots(playerCount, hasSelf) {
  const count = Math.max(0, Math.floor(Number(playerCount) || 0));
  const outsideCount = Math.max(0, count - (hasSelf ? 1 : 0));
  const counts = distributeEdgeCounts(outsideCount);
  const slots = [];
  if (hasSelf && count) slots.push({ edge: "bottom", progress: 0.5 });
  for (let index = 0; index < counts.left; index += 1) {
    slots.push({ edge: "left", progress: (counts.left - index) / (counts.left + 1) });
  }
  for (let index = 0; index < counts.top; index += 1) {
    slots.push({ edge: "top", progress: (index + 1) / (counts.top + 1) });
  }
  for (let index = 0; index < counts.right; index += 1) {
    slots.push({ edge: "right", progress: (index + 1) / (counts.right + 1) });
  }
  return slots;
}

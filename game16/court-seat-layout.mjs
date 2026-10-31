const DISTRIBUTIONS = Object.freeze({
  0: Object.freeze({ left: 0, top: 0, right: 0 }),
  1: Object.freeze({ left: 0, top: 1, right: 0 }),
  2: Object.freeze({ left: 0, top: 2, right: 0 }),
  3: Object.freeze({ left: 1, top: 1, right: 1 }),
  4: Object.freeze({ left: 1, top: 2, right: 1 }),
  5: Object.freeze({ left: 2, top: 1, right: 2 }),
  6: Object.freeze({ left: 2, top: 2, right: 2 })
});

export function courtSeatSlots(playerCount, hasSelf) {
  const count = Math.max(0, Math.floor(Number(playerCount) || 0));
  const outsideCount = Math.max(0, count - (hasSelf ? 1 : 0));
  const distribution = DISTRIBUTIONS[Math.min(6, outsideCount)];
  const slots = [];
  if (hasSelf && count) slots.push({ rail: "throne" });
  for (let index = 0; index < distribution.left; index += 1) slots.push({ rail: "left" });
  for (let index = 0; index < distribution.top; index += 1) slots.push({ rail: "gallery" });
  for (let index = 0; index < distribution.right; index += 1) slots.push({ rail: "right" });
  return slots;
}

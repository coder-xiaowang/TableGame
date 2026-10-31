export function distributeEdgeCounts(playerCount) {
  const count = Math.max(0, Math.floor(Number(playerCount) || 0));
  const base = Math.floor(count / 3);
  const remainder = count % 3;
  return {
    top: base + (remainder >= 1 ? 1 : 0),
    left: base + (remainder >= 2 ? 1 : 0),
    right: base
  };
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

export function draftContext(view, roomCode) {
  return view?.phase === "playing" && view.permissions?.canAct
    ? JSON.stringify([roomCode, view.selfId, view.gameNumber, view.turnId]) : null;
}

export function restoreDraft(saved, fresh) {
  if (!saved || saved.base !== fresh.base || !Array.isArray(saved.originalHandIds)
    || JSON.stringify([...saved.originalHandIds].sort()) !== JSON.stringify([...fresh.originalHandIds].sort())) return null;
  const originalTable = JSON.parse(fresh.base);
  const expected = [...fresh.originalHandIds, ...originalTable.flatMap(meld => meld.tileIds)].sort();
  function valid(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.handIds) || !Array.isArray(snapshot.table)) return false;
    if (snapshot.handIds.some(id => !fresh.originalHandIds.has(id))) return false;
    if (snapshot.table.some(meld => !meld || typeof meld.id !== "string" || !["group", "run"].includes(meld.kind)
      || !Array.isArray(meld.tileIds) || !meld.tileIds.length)) return false;
    const ids = [...snapshot.handIds, ...snapshot.table.flatMap(meld => meld.tileIds)];
    return new Set(ids).size === ids.length && JSON.stringify(ids.sort()) === JSON.stringify(expected);
  }
  if (!valid(saved)) return null;
  return { ...fresh, table: saved.table, handIds: saved.handIds,
    undo: Array.isArray(saved.undo) ? saved.undo.slice(-60).filter(valid) : [] };
}

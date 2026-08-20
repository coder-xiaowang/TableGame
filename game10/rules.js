"use strict";

export const COLUMN_LENGTHS = Object.freeze({
  2: 3, 3: 5, 4: 7, 5: 9, 6: 11, 7: 13,
  8: 11, 9: 9, 10: 7, 11: 5, 12: 3
});

export function dicePairings(dice) {
  if (!Array.isArray(dice) || dice.length !== 4 || dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6)) {
    throw new TypeError("dice must contain four values from 1 to 6");
  }
  const [a, b, c, d] = dice;
  const raw = [[a + b, c + d], [a + c, b + d], [a + d, b + c]];
  const seen = new Set();
  return raw.filter((pair) => {
    pair.sort((x, y) => x - y);
    const key = pair.join("-");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canAdvance(column, progress, closedColumns) {
  return !closedColumns.includes(column) && (progress[column] || 0) < COLUMN_LENGTHS[column];
}

export function legalMoveOptions(pair, turnProgress = {}, closedColumns = [], maxRunners = 3) {
  const active = new Set(Object.keys(turnProgress).filter((key) => turnProgress[key] > 0).map(Number));
  const availableSlots = maxRunners - active.size;
  const [first, second] = pair;
  if (first === second) {
    if (!canAdvance(first, turnProgress, closedColumns)) return [];
    if (!active.has(first) && availableSlots <= 0) return [];
    const remaining = COLUMN_LENGTHS[first] - (turnProgress[first] || 0);
    return [[first, ...(remaining > 1 ? [first] : [])]];
  }
  const usable = [first, second].filter((column) => canAdvance(column, turnProgress, closedColumns));
  const existing = usable.filter((column) => active.has(column));
  const fresh = usable.filter((column) => !active.has(column));
  const moves = [];
  if (fresh.length <= availableSlots) {
    if (usable.length) moves.push(usable);
  } else if (availableSlots > 0) {
    for (const column of fresh) moves.push([...existing, column]);
  } else if (existing.length) {
    moves.push(existing);
  }
  return moves;
}

export function rollOptions(dice, turnProgress = {}, closedColumns = [], maxRunners = 3) {
  const options = [];
  for (const pair of dicePairings(dice)) {
    for (const moves of legalMoveOptions(pair, turnProgress, closedColumns, maxRunners)) {
      const key = moves.join("-");
      if (!options.some((option) => option.key === key)) options.push({ key, pair, moves });
    }
  }
  return options;
}

export function applyMoves(turnProgress, permanentProgress, moves) {
  const next = { ...turnProgress };
  for (const column of moves) {
    const floor = Math.max(next[column] || 0, permanentProgress[column] || 0);
    next[column] = Math.min(COLUMN_LENGTHS[column], floor + 1);
  }
  return next;
}

export function commitTurn(permanentProgress, turnProgress) {
  const next = { ...permanentProgress };
  for (const [column, value] of Object.entries(turnProgress)) next[column] = Math.max(next[column] || 0, value);
  return next;
}

export function completedColumns(progress) {
  return Object.keys(COLUMN_LENGTHS).map(Number).filter((column) => (progress[column] || 0) >= COLUMN_LENGTHS[column]);
}

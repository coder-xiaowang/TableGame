export const ACTION_SECONDS = 15;
export const REVEAL_MS = 2600;
export const PLACE_ANIMATION_MS = 1200;
export const CAPTURE_ANIMATION_MS = 1800;
export const TURN_END_MS = 900;
export const SCORE_LIMIT = 66;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const CARD_COUNT = 104;
export const HAND_SIZE = 10;
export const ROW_COUNT = 4;
export const ROW_LIMIT = 5;

export function bullheads(number) {
  const card = Number(number);
  if (card === 55) return 7;
  if (card % 11 === 0) return 5;
  if (card % 10 === 0) return 3;
  if (card % 5 === 0) return 2;
  return 1;
}

export function rowBullheads(row) {
  return row.reduce((sum, card) => sum + bullheads(card), 0);
}

export function targetRowIndex(rows, card) {
  let target = -1;
  let greatestEnding = -Infinity;
  rows.forEach((row, index) => {
    const ending = row.at(-1);
    if (ending < card && ending > greatestEnding) {
      greatestEnding = ending;
      target = index;
    }
  });
  return target;
}

export function shuffledDeck(random = Math.random) {
  const deck = Array.from({length:CARD_COUNT}, (_, index) => index + 1);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const sample = Math.max(0, Math.min(0.999999999999, Number(random()) || 0));
    const swapIndex = Math.floor(sample * (index + 1));
    [deck[index],deck[swapIndex]] = [deck[swapIndex],deck[index]];
  }
  return deck;
}

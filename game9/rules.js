"use strict";

export function startingChips(playerCount) {
  if (playerCount >= 3 && playerCount <= 5) return 11;
  if (playerCount === 6) return 9;
  if (playerCount === 7) return 7;
  throw new RangeError("No Thanks requires 3–7 players");
}

export function cardScore(cards) {
  const sorted = [...cards].sort((a, b) => a - b);
  return sorted.reduce(
    (score, card, index) => score + (index === 0 || card !== sorted[index - 1] + 1 ? card : 0),
    0
  );
}

export function finalScore(player) {
  return cardScore(player.cards) - player.chips;
}

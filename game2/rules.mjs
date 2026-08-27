import { IDIOMS } from "./idioms.js";

export const PLAYER_COUNTS = Object.freeze([2, 4, 6, 8]);

export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?]/g, "")
    .toLocaleLowerCase();
}

export function roleForSeat(index) {
  return Number(index) % 2 === 0 ? "captain" : "member";
}

export function teamIndexForSeat(index) {
  return Math.floor(Number(index) / 2);
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const sample = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    const target = Math.floor(sample * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createIdiomDeck(random = Math.random) {
  return shuffle(IDIOMS, random);
}

export function drawIdiom(deck, previousIdiom = "", random = Math.random) {
  if (!Array.isArray(deck)) throw new TypeError("成语牌堆无效。");
  if (!deck.length) deck.push(...createIdiomDeck(random));
  if (deck.length > 1 && deck.at(-1) === previousIdiom) {
    [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
  }
  return deck.pop() || "";
}

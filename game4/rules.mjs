export const SUITS = Object.freeze(["♠", "♥", "♦", "♣"]);
export const RANKS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
export const BLINDS = Object.freeze([
  Object.freeze([10, 20]), Object.freeze([15, 30]), Object.freeze([25, 50]),
  Object.freeze([40, 80]), Object.freeze([60, 120]), Object.freeze([100, 200]),
  Object.freeze([150, 300]), Object.freeze([250, 500])
]);
export const STARTING_CHIPS = 1000;
export const ACTION_SECONDS = 60;

export function blindInfo(handNumber) {
  const level = Math.floor(Math.max(0, Number(handNumber) - 1) / 5);
  if (level < BLINDS.length) return { level: level + 1, sb: BLINDS[level][0], bb: BLINDS[level][1] };
  let sb = BLINDS.at(-1)[0];
  for (let index = BLINDS.length; index <= level; index += 1) sb = Math.ceil((sb * 1.5) / 50) * 50;
  return { level: level + 1, sb, bb: sb * 2 };
}

export function cardKey(card) {
  return card ? `${card.r}${card.s}` : "";
}

export function createDeck(random = Math.random) {
  const cards = [];
  for (const suit of SUITS) for (const rank of RANKS) cards.push({ r: rank, s: suit });
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [cards[index], cards[target]] = [cards[target], cards[index]];
  }
  return cards;
}

export function fiveCardRank(cards) {
  const ranks = cards.map((card) => card.r).sort((a, b) => b - a);
  const counts = {};
  for (const rank of ranks) counts[rank] = (counts[rank] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([rank, count]) => ({ r: Number(rank), n: count }))
    .sort((a, b) => b.n - a.n || b.r - a.r);
  const flush = cards.every((card) => card.s === cards[0].s);
  const unique = [...new Set(ranks)];
  const straightHigh = unique.includes(14) && [5, 4, 3, 2].every((rank) => unique.includes(rank))
    ? 5
    : unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0] : 0;
  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0].n === 4) return [7, groups[0].r, groups[1].r];
  if (groups[0].n === 3 && groups[1].n === 2) return [6, groups[0].r, groups[1].r];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0].n === 3) return [3, groups[0].r, ...groups.slice(1).map((group) => group.r).sort((a, b) => b - a)];
  if (groups[0].n === 2 && groups[1].n === 2) {
    const pairs = [groups[0].r, groups[1].r].sort((a, b) => b - a);
    return [2, ...pairs, groups[2].r];
  }
  if (groups[0].n === 2) return [1, groups[0].r, ...groups.slice(1).map((group) => group.r).sort((a, b) => b - a)];
  return [0, ...ranks];
}

export function compareRanks(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function evaluateBestHand(cards) {
  if (!Array.isArray(cards) || cards.length < 5) throw new TypeError("at least five cards are required");
  let best = null;
  for (let a = 0; a < cards.length - 4; a += 1)
    for (let b = a + 1; b < cards.length - 3; b += 1)
      for (let c = b + 1; c < cards.length - 2; c += 1)
        for (let d = c + 1; d < cards.length - 1; d += 1)
          for (let e = d + 1; e < cards.length; e += 1) {
            const rank = fiveCardRank([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareRanks(rank, best) > 0) best = rank;
          }
  return best;
}

export function rankName(rank) {
  return ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"][rank?.[0]] || "未知牌型";
}

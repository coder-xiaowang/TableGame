export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const INITIAL_CARD_COUNT = 4;
export const ACTION_SECONDS = 45;
export const DECISION_SECONDS = 30;
export const TARGET_SECONDS = 20;
export const INITIAL_PEEK_SECONDS = 30;
export const REVEAL_SECONDS = 5;

export const POWER_NAMES = Object.freeze({
  peek: "查看自己的一张牌",
  spy: "查看对手的一张牌",
  swap: "交换自己与对手的一张牌"
});

export function powerForValue(value) {
  if (value === 7 || value === 8) return "peek";
  if (value === 9 || value === 10) return "spy";
  if (value === 11 || value === 12) return "swap";
  return null;
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const sample = Math.max(0, Math.min(.999999999999, Number(random()) || 0));
    const swapIndex = Math.floor(sample * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

// CABO 2019 second edition: two 0s, four of every value 1-12, two 13s.
export function createDeck(random = Math.random) {
  const cards = [];
  let sequence = 0;
  const add = (value, count) => {
    for (let copy = 0; copy < count; copy += 1) {
      sequence += 1;
      cards.push({id:`cabo_${sequence}`, value, power:powerForValue(value)});
    }
  };
  add(0, 2);
  for (let value = 1; value <= 12; value += 1) add(value, 4);
  add(13, 2);
  return shuffle(cards, random);
}

export function cardTotal(slots) {
  return slots.reduce((sum, slot) => sum + Number(slot.card.value), 0);
}

export function isKamikaze(slots) {
  if (slots.length !== 4) return false;
  const values = slots.map((slot) => slot.card.value).sort((a,b) => a-b);
  return values.join(",") === "12,12,13,13";
}

export function scoreRound(players, callerId = null) {
  const totals = new Map(players.map((player) => [player.id, cardTotal(player.slots)]));
  const kamikaze = players.find((player) => isKamikaze(player.slots));
  if (kamikaze) {
    return players.map((player) => ({
      playerId:player.id,
      cardTotal:totals.get(player.id),
      score:player.id === kamikaze.id ? 0 : 50,
      reason:player.id === kamikaze.id ? "kamikaze" : "kamikazePenalty"
    }));
  }
  const lowest = Math.min(...totals.values());
  return players.map((player) => {
    const total = totals.get(player.id);
    const callerSucceeded = player.id === callerId && total === lowest;
    const callerFailed = player.id === callerId && total !== lowest;
    return {
      playerId:player.id,
      cardTotal:total,
      score:callerSucceeded ? 0 : total + (callerFailed ? 10 : 0),
      reason:callerSucceeded ? "caboSuccess" : callerFailed ? "caboPenalty" : "cards"
    };
  });
}

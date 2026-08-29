export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 3;
export const ACTION_SECONDS = 30;
export const REVEAL_SECONDS = 8;

export const CARD_TYPES = Object.freeze({
  MUD: "mud",
  RAIN: "rain",
  BARN: "barn",
  LIGHTNING: "lightning",
  ROD: "rod",
  FARMER: "farmer",
  DOOR: "door"
});

export const CARD_LABELS = Object.freeze({
  mud: "泥巴",
  rain: "下雨",
  barn: "猪舍",
  lightning: "闪电",
  rod: "避雷针",
  farmer: "农夫洗猪",
  door: "封门"
});

export const BASE_CARD_COUNTS = Object.freeze({
  mud: 21,
  rain: 4,
  barn: 9,
  lightning: 4,
  rod: 4,
  farmer: 8,
  door: 4
});

export const EXPANDED_CARD_COUNTS = Object.freeze({
  ...BASE_CARD_COUNTS,
  barn: 12
});

// 保留旧导出名，表示2～4人基础版配置。
export const CARD_COUNTS = BASE_CARD_COUNTS;
export const ACTION_CARD_COUNT = 54;

export function cardCountsForPlayers(playerCount) {
  const count = Number(playerCount);
  if (!Number.isInteger(count) || count < MIN_PLAYERS || count > MAX_PLAYERS) {
    throw new RangeError("脏小猪只支持2～6名玩家。");
  }
  return count <= 4 ? BASE_CARD_COUNTS : EXPANDED_CARD_COUNTS;
}

export function actionCardCount(playerCount) {
  return Object.values(cardCountsForPlayers(playerCount))
    .reduce((total, count) => total + count, 0);
}

export function pigsPerPlayer(playerCount) {
  const count = Number(playerCount);
  if (count === 2) return 5;
  if (count === 3) return 4;
  if (count >= 4 && count <= 6) return 3;
  throw new RangeError("脏小猪只支持2～6名玩家。");
}

export function shuffle(cards, random = Math.random) {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createActionDeck(random = Math.random, playerCount = 4) {
  const cards = [];
  for (const [type, count] of Object.entries(cardCountsForPlayers(playerCount))) {
    for (let copy = 1; copy <= count; copy += 1) {
      cards.push({ id: `${type}_${copy}`, type });
    }
  }
  return shuffle(cards, random);
}

export function cardLabel(type) {
  return CARD_LABELS[type] || "未知牌";
}

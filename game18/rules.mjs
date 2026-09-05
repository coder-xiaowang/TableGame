export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const DEFAULT_TARGET_SCORE = 5;
export const TARGET_SCORE_OPTIONS = Object.freeze([5, 10]);

export const CARDS = Object.freeze({
  CRIMINAL: "criminal",
  DISCOVERER: "discoverer",
  DETECTIVE: "detective",
  ALIBI: "alibi",
  ACCOMPLICE: "accomplice",
  WITNESS: "witness",
  DOG: "dog",
  CHILD: "child",
  TRADE: "trade",
  PASS_LEFT: "passLeft",
  GOSSIP: "gossip",
  CIVILIAN: "civilian"
});

export const CARD_META = Object.freeze({
  [CARDS.CRIMINAL]: { label: "犯人", icon: "♠", count: 1, tone: "culprit", description: "仅当它是最后一张手牌时可以打出；成功打出则犯人阵营获胜。" },
  [CARDS.DISCOVERER]: { label: "第一发现者", icon: "!", count: 1, tone: "clue", description: "持有者描述案件并公开此牌，成为本局起点。" },
  [CARDS.DETECTIVE]: { label: "侦探", icon: "⌕", count: 4, tone: "detective", description: "第二圈起指认一名玩家；对方持有犯人且没有不在场证明时抓捕成功。" },
  [CARDS.ALIBI]: { label: "不在场证明", icon: "✓", count: 5, tone: "alibi", description: "留在手中时可抵挡侦探；打出没有效果，不能抵挡神犬。" },
  [CARDS.ACCOMPLICE]: { label: "共犯", icon: "◇", count: 2, tone: "culprit", description: "公开打出后加入犯人阵营，直到本轮结束。" },
  [CARDS.WITNESS]: { label: "目击者", icon: "◉", count: 3, tone: "clue", description: "秘密查看一名其他玩家当前的全部手牌。" },
  [CARDS.DOG]: { label: "神犬", icon: "♧", count: 1, tone: "dog", description: "检查一名玩家的一张随机手牌并公开；若是犯人则立即抓捕。" },
  [CARDS.CHILD]: { label: "少年", icon: "☆", count: 1, tone: "clue", description: "仅自己知道当前是谁持有犯人牌。" },
  [CARDS.TRADE]: { label: "交易", icon: "⇄", count: 5, tone: "motion", description: "与一名玩家各自秘密选择一张手牌，同时交换。" },
  [CARDS.PASS_LEFT]: { label: "情报交换", icon: "↶", count: 3, tone: "motion", description: "所有有手牌的玩家同时选择一张，交给左侧玩家。" },
  [CARDS.GOSSIP]: { label: "谣言", icon: "↻", count: 4, tone: "motion", description: "所有玩家从右侧玩家的结算前手牌中随机取得一张。" },
  [CARDS.CIVILIAN]: { label: "普通人", icon: "○", count: 2, tone: "plain", description: "打出后没有效果。" }
});

export const FULL_DECK_SIZE = Object.values(CARD_META).reduce((sum, meta) => sum + meta.count, 0);

export const REQUIRED_BY_PLAYER_COUNT = Object.freeze({
  3: Object.freeze({ discoverer: 1, criminal: 1, detective: 1, alibi: 1 }),
  4: Object.freeze({ discoverer: 1, criminal: 1, detective: 1, alibi: 1, accomplice: 1 }),
  5: Object.freeze({ discoverer: 1, criminal: 1, detective: 1, alibi: 2, accomplice: 1 }),
  6: Object.freeze({ discoverer: 1, criminal: 1, detective: 2, alibi: 2, accomplice: 2 }),
  7: Object.freeze({ discoverer: 1, criminal: 1, detective: 2, alibi: 3, accomplice: 2 }),
  8: Object.freeze({})
});

export function cardMeta(type) {
  return CARD_META[type] || null;
}

export function cardLabel(type) {
  return cardMeta(type)?.label || "未知牌";
}

export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createFullDeck() {
  const deck = [];
  for (const [type, meta] of Object.entries(CARD_META)) {
    for (let copy = 1; copy <= meta.count; copy += 1) deck.push({ id: `${type}_${copy}`, type });
  }
  return deck;
}

function takeRequired(deck, requirements) {
  const selected = [];
  const remaining = [...deck];
  for (const [type, count] of Object.entries(requirements)) {
    for (let index = 0; index < count; index += 1) {
      const found = remaining.findIndex((card) => card.type === type);
      if (found < 0) throw new Error(`Missing required card: ${type}`);
      selected.push(remaining.splice(found, 1)[0]);
    }
  }
  return { selected, remaining };
}

export function createRoundDeck(playerCount, random = Math.random) {
  const count = Number(playerCount);
  if (!Number.isInteger(count) || count < MIN_PLAYERS || count > MAX_PLAYERS) throw new RangeError("玩家人数必须为3～8人。");
  const fullDeck = createFullDeck();
  if (count === 8) return shuffle(fullDeck, random);
  const { selected, remaining } = takeRequired(fullDeck, REQUIRED_BY_PLAYER_COUNT[count]);
  const needed = count * 4 - selected.length;
  return shuffle([...selected, ...shuffle(remaining, random).slice(0, needed)], random);
}

export function leftIndex(index, length) {
  return (index + 1) % length;
}

export function rightIndex(index, length) {
  return (index - 1 + length) % length;
}


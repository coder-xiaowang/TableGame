export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const STARTING_CASH = 20_000;
export const TWO_PLAYER_STARTING_CASH = 30_000;
export const STARTING_PRICE = 5;
export const SPLIT_RESET_PRICE = 6;
export const DIVIDEND_PER_SHARE = 2_000;
export const SECOND_SPLIT_PAYOUT = 10_000;
export const MAJORITY_BONUS = 10_000;
export const TIED_MAJORITY_BONUS = 5_000;

export const BID_LEVELS = Object.freeze([0, 1_000, 3_000, 6_000, 10_000, 15_000, 20_000, 25_000]);
export const ROUND_COUNTS = Object.freeze({ 2: 6, 3: 7, 4: 6, 5: 5 });

export const COMPANIES = Object.freeze([
  { id: "nova", name: "新星科技", short: "新星", color: "#4d78b8" },
  { id: "evergreen", name: "常青能源", short: "常青", color: "#4c956c" },
  { id: "harbor", name: "海港金融", short: "海港", color: "#b88a3d" },
  { id: "apex", name: "巅峰汽车", short: "巅峰", color: "#c75b4d" },
  { id: "cloud", name: "云端零售", short: "云端", color: "#8c68ad" },
  { id: "aurora", name: "极光传媒", short: "极光", color: "#3c9a9a" }
]);

export const FORECASTS = Object.freeze([
  { id: "down3", kind: "move", value: -3, label: "-3" },
  { id: "down2", kind: "move", value: -2, label: "-2" },
  { id: "up1", kind: "move", value: 1, label: "+1" },
  { id: "up2", kind: "move", value: 2, label: "+2" },
  { id: "up4", kind: "move", value: 4, label: "+4" },
  { id: "dividend", kind: "dividend", value: 0, label: "分红" }
]);

export const ACTION_TYPES = Object.freeze({ BOOM: "boom", BUST: "bust" });

export function companyById(id) {
  return COMPANIES.find((company) => company.id === String(id)) || null;
}

export function forecastById(id) {
  return FORECASTS.find((forecast) => forecast.id === String(id)) || null;
}

export function roundsFor(playerCount) {
  return ROUND_COUNTS[Number(playerCount)] || 0;
}

export function stockpileCount(playerCount) {
  return Number(playerCount) === 2 ? 4 : Number(playerCount);
}

export function biddingTokenCount(playerCount) {
  return Number(playerCount) === 2 ? 2 : 1;
}

export function createMarketDeck() {
  const cards = [];
  for (const company of COMPANIES) {
    for (let index = 1; index <= 10; index += 1) {
      cards.push({ id: `stock_${company.id}_${index}`, kind: "stock", companyId: company.id });
    }
  }
  for (const amount of [1_000, 2_000, 3_000]) {
    for (let index = 1; index <= 4; index += 1) cards.push({ id: `fee_${amount}_${index}`, kind: "fee", amount });
  }
  for (const type of Object.values(ACTION_TYPES)) {
    for (let index = 1; index <= 4; index += 1) cards.push({ id: `action_${type}_${index}`, kind: "action", actionType: type });
  }
  return cards;
}

export function createInformationDecks() {
  return {
    companies: COMPANIES.map((company) => ({ id: `company_${company.id}`, companyId: company.id })),
    forecasts: FORECASTS.map((forecast) => ({ id: `forecast_${forecast.id}`, forecastId: forecast.id }))
  };
}

export function shuffle(items, random = Math.random) {
  const result = items.map((item) => ({ ...item }));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function movePrice(price, amount) {
  let next = Number(price);
  let remaining = Math.abs(Number(amount));
  const direction = Math.sign(Number(amount));
  const events = [];
  while (remaining > 0) {
    next += direction;
    remaining -= 1;
    if (next > 10) {
      events.push({ type: "split" });
      next = SPLIT_RESET_PRICE;
    } else if (next < 1) {
      events.push({ type: "bankruptcy" });
      next = STARTING_PRICE;
      remaining = 0;
    }
  }
  return { price: next, events };
}

export function sharesHeld(player, companyId) {
  return player.portfolio.filter((card) => card.companyId === companyId).length
    + player.splitPortfolio.filter((card) => card.companyId === companyId).length * 2;
}

export function cardLabel(card) {
  if (!card) return "未知牌";
  if (card.kind === "stock") return `${companyById(card.companyId)?.name || "未知公司"}股票`;
  if (card.kind === "fee") return `交易费 $${card.amount / 1_000}K`;
  if (card.kind === "action") return card.actionType === ACTION_TYPES.BOOM ? "股价上涨 +2" : "股价下跌 -2";
  return "市场牌";
}

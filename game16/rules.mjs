export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const STARTING_COINS = 2;
export const COUP_COST = 7;
export const ASSASSINATE_COST = 3;
export const FORCED_COUP_COINS = 10;

export const ROLES = Object.freeze({
  DUKE: "duke",
  ASSASSIN: "assassin",
  CAPTAIN: "captain",
  AMBASSADOR: "ambassador",
  CONTESSA: "contessa"
});

export const ROLE_LABELS = Object.freeze({
  duke: "公爵",
  assassin: "刺客",
  captain: "船长",
  ambassador: "大使",
  contessa: "女伯爵"
});

export const ACTIONS = Object.freeze({
  INCOME: "income",
  FOREIGN_AID: "foreignAid",
  COUP: "coup",
  TAX: "tax",
  ASSASSINATE: "assassinate",
  STEAL: "steal",
  EXCHANGE: "exchange"
});

export const ACTION_META = Object.freeze({
  income: { label: "收入", role: null, cost: 0, target: false, blockRoles: [] },
  foreignAid: { label: "外援", role: null, cost: 0, target: false, blockRoles: [ROLES.DUKE] },
  coup: { label: "政变", role: null, cost: COUP_COST, target: true, blockRoles: [] },
  tax: { label: "征税", role: ROLES.DUKE, cost: 0, target: false, blockRoles: [] },
  assassinate: { label: "刺杀", role: ROLES.ASSASSIN, cost: ASSASSINATE_COST, target: true, blockRoles: [ROLES.CONTESSA] },
  steal: { label: "偷窃", role: ROLES.CAPTAIN, cost: 0, target: true, blockRoles: [ROLES.CAPTAIN, ROLES.AMBASSADOR] },
  exchange: { label: "交换", role: ROLES.AMBASSADOR, cost: 0, target: false, blockRoles: [] }
});

export function createCourtDeck() {
  let sequence = 0;
  return Object.values(ROLES).flatMap((role) => Array.from({ length: 3 }, () => ({
    id: `influence_${sequence += 1}`,
    role,
    revealed: false
  })));
}

export function shuffle(cards, random = Math.random) {
  const result = cards.map((card) => ({ ...card }));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function actionMeta(type) {
  return ACTION_META[String(type)] || null;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "无角色";
}

export function actionLabel(type) {
  return ACTION_META[type]?.label || type || "行动";
}

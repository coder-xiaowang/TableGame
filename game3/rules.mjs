export const CATEGORIES = Object.freeze([
  { id: "ones", name: "一点", help: "所有一点骰子之和", section: "upper", face: 1 },
  { id: "twos", name: "二点", help: "所有二点骰子之和", section: "upper", face: 2 },
  { id: "threes", name: "三点", help: "所有三点骰子之和", section: "upper", face: 3 },
  { id: "fours", name: "四点", help: "所有四点骰子之和", section: "upper", face: 4 },
  { id: "fives", name: "五点", help: "所有五点骰子之和", section: "upper", face: 5 },
  { id: "sixes", name: "六点", help: "所有六点骰子之和", section: "upper", face: 6 },
  { id: "threeKind", name: "三条", help: "至少三颗相同，五骰总和", section: "lower" },
  { id: "fourKind", name: "四条", help: "至少四颗相同，五骰总和", section: "lower" },
  { id: "fullHouse", name: "葫芦", help: "三颗相同加两颗相同 · 25", section: "lower" },
  { id: "smallStraight", name: "小顺子", help: "任意四连 · 30", section: "lower" },
  { id: "largeStraight", name: "大顺子", help: "五连 · 40", section: "lower" },
  { id: "yahtzee", name: "快艇", help: "五颗相同 · 50", section: "lower" },
  { id: "chance", name: "机会", help: "五颗骰子总和", section: "lower" }
]);

export function newScorecard() {
  return Object.fromEntries(CATEGORIES.map((category) => [category.id, null]));
}

export function diceCounts(dice) {
  const counts = Array(7).fill(0);
  for (const value of dice) {
    if (Number.isInteger(value) && value >= 1 && value <= 6) counts[value] += 1;
  }
  return counts;
}

export function isYahtzee(dice) {
  return Array.isArray(dice)
    && dice.length === 5
    && dice[0] != null
    && dice.every((value) => value === dice[0]);
}

export function categoryScore(categoryId, dice) {
  if (!Array.isArray(dice) || dice.length !== 5 || dice.some((value) => !Number.isInteger(value) || value < 1 || value > 6)) {
    return 0;
  }
  const counts = diceCounts(dice);
  const sum = dice.reduce((total, value) => total + value, 0);
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  const category = CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return 0;
  if (category.section === "upper") return counts[category.face] * category.face;
  if (categoryId === "threeKind") return Math.max(...counts) >= 3 ? sum : 0;
  if (categoryId === "fourKind") return Math.max(...counts) >= 4 ? sum : 0;
  if (categoryId === "fullHouse") return counts.includes(3) && counts.includes(2) ? 25 : 0;
  if (categoryId === "smallStraight") {
    const key = unique.join("");
    return key.includes("1234") || key.includes("2345") || key.includes("3456") ? 30 : 0;
  }
  if (categoryId === "largeStraight") {
    const key = unique.join("");
    return key === "12345" || key === "23456" ? 40 : 0;
  }
  if (categoryId === "yahtzee") return isYahtzee(dice) ? 50 : 0;
  if (categoryId === "chance") return sum;
  return 0;
}

export function totals(player) {
  const scorecard = player?.scorecard || {};
  const upper = CATEGORIES
    .filter((category) => category.section === "upper")
    .reduce((sum, category) => sum + (scorecard[category.id] || 0), 0);
  const lower = CATEGORIES
    .filter((category) => category.section === "lower")
    .reduce((sum, category) => sum + (scorecard[category.id] || 0), 0);
  const upperBonus = upper >= 63 ? 35 : 0;
  const yahtzeeBonus = Number(player?.yahtzeeBonus) || 0;
  return {
    upper,
    upperBonus,
    lower,
    yahtzeeBonus,
    total: upper + upperBonus + lower + yahtzeeBonus
  };
}

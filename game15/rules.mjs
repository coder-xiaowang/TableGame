export const COLORS = Object.freeze(["red", "blue", "orange", "black"]);
export const COLOR_LABELS = Object.freeze({ red: "红", blue: "蓝", orange: "橙", black: "黑" });
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const INITIAL_HAND_SIZE = 14;
export const INITIAL_MELD_SCORE = 30;
export const JOKER_RACK_SCORE = 30;

export function createTileSet() {
  const tiles = [];
  for (const color of COLORS) {
    for (let number = 1; number <= 13; number += 1) {
      for (let copy = 1; copy <= 2; copy += 1) {
        tiles.push({ id: `${color}-${number}-${copy}`, color, number, joker: false });
      }
    }
  }
  tiles.push({ id: "joker-1", color: null, number: null, joker: true });
  tiles.push({ id: "joker-2", color: null, number: null, joker: true });
  return tiles;
}

export function shuffleTiles(items, random = Math.random) {
  const result = items.map((item) => ({ ...item }));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function invalid(kind, message) {
  return { valid: false, kind, score: 0, assignments: [], error: message };
}

function validateGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return invalid("group", "数字组必须由3张或4张牌组成。");
  const natural = tiles.filter((tile) => !tile.joker);
  if (!natural.length) return invalid("group", "数字组必须至少包含一张数字牌。");
  const number = natural[0].number;
  if (natural.some((tile) => tile.number !== number)) return invalid("group", "数字组中的数字必须相同。");
  const usedColors = new Set(natural.map((tile) => tile.color));
  if (usedColors.size !== natural.length) return invalid("group", "数字组不能出现重复颜色。");
  const remainingColors = COLORS.filter((color) => !usedColors.has(color));
  const assignments = tiles.map((tile) => {
    if (!tile.joker) return { tileId: tile.id, color: tile.color, number: tile.number };
    return { tileId: tile.id, color: remainingColors.shift(), number };
  });
  if (assignments.some((item) => !item.color)) return invalid("group", "百搭牌无法获得唯一合法颜色。");
  return { valid: true, kind: "group", score: number * tiles.length, assignments, error: "" };
}

function validateRun(tiles) {
  if (tiles.length < 3 || tiles.length > 13) return invalid("run", "顺子必须由3至13张牌组成。");
  const natural = tiles.map((tile, index) => ({ tile, index })).filter(({ tile }) => !tile.joker);
  if (!natural.length) return invalid("run", "顺子必须至少包含一张数字牌。");
  const color = natural[0].tile.color;
  if (natural.some(({ tile }) => tile.color !== color)) return invalid("run", "顺子必须使用同一种颜色。");
  const start = natural[0].tile.number - natural[0].index;
  if (start < 1 || start + tiles.length - 1 > 13) return invalid("run", "顺子不能越过1或13，也不能首尾循环。");
  if (natural.some(({ tile, index }) => tile.number !== start + index)) return invalid("run", "顺子的数字必须按照牌的位置连续排列。");
  const assignments = tiles.map((tile, index) => ({
    tileId: tile.id,
    color,
    number: start + index
  }));
  return {
    valid: true,
    kind: "run",
    score: assignments.reduce((total, item) => total + item.number, 0),
    assignments,
    error: ""
  };
}

export function validateMeld({ kind, tiles } = {}) {
  if (!Array.isArray(tiles)) return invalid(kind, "牌组格式无效。");
  if (new Set(tiles.map((tile) => tile?.id)).size !== tiles.length) return invalid(kind, "同一张牌不能重复出现。");
  if (kind === "group") return validateGroup(tiles);
  if (kind === "run") return validateRun(tiles);
  return invalid(kind, "请选择数字组或顺子。");
}

export function rackScore(tiles = []) {
  return tiles.reduce((total, tile) => total + (tile.joker ? JOKER_RACK_SCORE : tile.number), 0);
}


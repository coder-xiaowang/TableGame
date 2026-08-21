"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const cards = require("../data/cards.json");

const ROOT = path.resolve(__dirname, "..");
const TIERS = { stage1:35, stage2:30, stage3:15, rare:10, legend:10 };
const COLORS = ["red", "blue", "black", "pink", "yellow", "purple"];

test("基础牌库包含预期的 100 张唯一卡牌", () => {
  assert.equal(cards.length, 100);
  assert.equal(new Set(cards.map((card) => card.id)).size, 100);
  for (const [tier, count] of Object.entries(TIERS)) {
    assert.equal(cards.filter((card) => card.tier === tier).length, count, tier);
  }
});

test("每张卡的数据字段、费用和卡面文件完整", () => {
  for (const card of cards) {
    assert.ok(card.id && card.name && TIERS[card.tier]);
    assert.ok(COLORS.includes(card.bonus));
    assert.ok(Number.isInteger(card.vp) && card.vp >= 0);
    for (const color of COLORS) assert.ok(Number.isInteger(card.cost[color]) && card.cost[color] >= 0, `${card.id}:${color}`);
    assert.ok(card.img.startsWith("assets/cards/") && !card.img.includes(".."));
    assert.ok(fs.existsSync(path.join(ROOT, card.img)), `缺少卡面 ${card.img}`);
  }
});

test("所有进化目标存在且只指向下一阶", () => {
  const targetTier = { stage1:"stage2", stage2:"stage3" };
  for (const card of cards.filter((item) => item.evolvesTo)) {
    const targets = cards.filter((item) => item.name === card.evolvesTo);
    assert.ok(targets.length > 0, `${card.name} -> ${card.evolvesTo}`);
    assert.ok(targets.some((target) => target.tier === targetTier[card.tier]));
    assert.ok(card.evoCost && COLORS.includes(card.evoCost.color) && card.evoCost.color !== "purple");
    assert.ok(Number.isInteger(card.evoCost.count) && card.evoCost.count > 0);
  }
});

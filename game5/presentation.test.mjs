import assert from "node:assert/strict";
import test from "node:test";
import { composePresentationText } from "./presentation.mjs";

test("ordinary card play is announced only once after scene cloning", () => {
  const text = "房主 打出 绿色5";
  assert.equal(composePresentationText({
    kind: "card-play",
    text,
    sceneEvents: [{ kind: "card-play", text }, { kind: "turn-start", text: "轮到玩家行动" }]
  }), text);
});

test("equivalent card-play text with spacing and punctuation differences is deduplicated", () => {
  assert.equal(composePresentationText({
    kind: "card-play",
    text: "房主打出绿色5！",
    sceneEvents: [{ kind: "card-play", text: " 房主 打出 绿色5 " }]
  }), "房主 打出 绿色5");
});

test("a distinct resolution remains after the card-play announcement", () => {
  assert.equal(composePresentationText({
    kind: "penalty-window",
    text: "玩家面临累计 +4",
    sceneEvents: [{ kind: "card-play", text: "房主打出万能 +4" }, { kind: "penalty-window", text: "玩家面临累计 +4" }]
  }), "房主打出万能 +4；玩家面临累计 +4");
});

test("non-card scenes use their focused event text and retain the fallback", () => {
  assert.equal(composePresentationText({ kind: "challenge-result", text: "质疑成功，房主摸 4 张" }), "质疑成功，房主摸 4 张");
  assert.equal(composePresentationText({ kind: "turn-start", sceneEvents: [] }), "牌桌状态已经更新");
});

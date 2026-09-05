"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("房间控制并入标题栏且旧工具栏和身份横幅已移除", () => {
  const html = read("index.html");
  const headerStart = html.indexOf('<header id="siteHeader"');
  const headerEnd = html.indexOf("</header>", headerStart);
  const roomTools = html.indexOf('id="roomHeaderTools"');

  assert.ok(headerStart >= 0 && roomTools > headerStart && roomTools < headerEnd);
  assert.ok(html.indexOf('id="hostTools"') > headerStart && html.indexOf('id="hostTools"') < headerEnd);
  assert.doesNotMatch(html, /roomRoleBanner|roomRoleTitle|roomRoleHint|class="room-toolbar"/);
  assert.match(html, /id="seatActionButton"/);
});

test("辅助栏按折叠规则、记录和旁观排序", () => {
  const html = read("index.html");
  const supportStart = html.indexOf('class="support-panel panel"');
  const supportEnd = html.indexOf("</aside>", supportStart);
  const rules = html.indexOf('class="rules-card"');
  const log = html.indexOf('id="logList"');
  const spectators = html.indexOf('id="spectatorPanel"');

  assert.ok(supportStart < rules && rules < log && log < spectators && spectators < supportEnd);
  assert.match(html, /<details class="rules-card">/);
  assert.doesNotMatch(html, /<details class="rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /没有筹码时不能拒绝/);
  assert.match(html, /每段连续数字只计算最小的一张/);
  assert.match(html, /其他玩家的筹码数量隐藏/);
});

test("进入房间时启用紧凑标题工具且旁观接口不依赖身份横幅", () => {
  const script = read("app.js");

  assert.match(script, /"siteHeader", "connectionStatus", "roomHeaderTools"/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(script, /E\.siteHeader\.classList\.add\("in-room"\)/);
  assert.doesNotMatch(script, /E\.roomRole(?:Banner|Title|Hint)/);
  assert.match(script, /seatActionButton: E\.seatActionButton/);
});

test("手机端依次显示牌桌、个人状态、玩家和辅助信息", () => {
  const css = read("styles.css");

  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.game-grid \.table-panel \{ order: 1; \}/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.game-grid \.my-area \{ order: 2; \}/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.game-grid \.players-panel \{ order: 3; \}/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.game-grid \.support-panel \{ grid-column: auto; order: 4; \}/);
  assert.match(css, /\.rule-details \{ max-height: 58vh; overflow: auto/);
});

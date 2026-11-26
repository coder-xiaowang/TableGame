"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("房间控制并入标题栏且独立房间栏和身份横幅已移除", () => {
  const html = read("index.html");
  const headerStart = html.indexOf('<header id="siteHeader"');
  const headerEnd = html.indexOf("</header>", headerStart);
  const roomTools = html.indexOf('id="roomHeaderTools"');

  assert.ok(headerStart >= 0 && roomTools > headerStart && roomTools < headerEnd);
  assert.ok(html.indexOf('id="hostTools"') > headerStart && html.indexOf('id="hostTools"') < headerEnd);
  assert.doesNotMatch(html, /roomRoleBanner|roomRoleTitle|roomRoleHint|class="room-toolbar"/);
  assert.match(html, /id="seatActionButton"/);
});

test("登山队侧栏按规则、记录和旁观排序，行动面板不再混入日志", () => {
  const html = read("index.html");
  const sideStart = html.indexOf('class="side-panel panel"');
  const sideEnd = html.indexOf("</aside>", sideStart);
  const rules = html.indexOf('class="rules-card"');
  const log = html.indexOf('class="game-log"');
  const spectators = html.indexOf('id="spectatorPanel"');
  const actionStart = html.indexOf('class="action-panel panel"');
  const actionEnd = html.indexOf("</aside>", actionStart);

  assert.ok(sideStart < rules && rules < log && log < spectators && spectators < sideEnd);
  assert.match(html, /<details class="rules-card">/);
  assert.doesNotMatch(html, /<details class="rules-card"[^>]*\sopen(?:\s|>)/);
  assert.ok(html.indexOf('id="logList"') < actionStart || html.indexOf('id="logList"') > actionEnd);
  assert.match(html, /各操作阶段限时30秒/);
  assert.match(html, /点选路线即可按标明的步数攀登/);
});

test("进入房间时展示标题工具且旁观组件不依赖身份横幅", () => {
  const script = read("app.js");

  assert.match(script, /"siteHeader", "connectionStatus", "roomHeaderTools"/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(script, /E\.siteHeader\.classList\.add\("in-room"\)/);
  assert.doesNotMatch(script, /E\.roomRole(?:Banner|Title|Hint)/);
  assert.match(script, /seatActionButton: E\.seatActionButton/);
});

test("移动端路线、吸附行动区和辅助侧栏依次展示", () => {
  const css = read("styles.css");

  assert.match(css, /\.action-panel \{ position:sticky; top:10px; \}/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*?\.game-layout \.board-panel \{ order:1; \}/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*?\.game-layout \.action-panel \{ order:2;[^}]*bottom:calc\(4px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*?\.game-layout \.side-panel \{ order:3; \}/);
  assert.match(css, /\.rule-details \{ max-height:58vh; overflow:auto/);
});

test("骰盘展示权威骰面并支持积压追赶", () => {
  const html = read("index.html");
  const script = read("app.js");
  const css = read("styles.css");

  assert.match(html, /id="presentationEffects"/);
  assert.match(html, /id="presentationTrail"/);
  assert.match(script, /createPresentationTimeline/);
  assert.match(script, /presentationEvents\?\.filter/);
  assert.doesNotMatch(html, /diceCanvas/);
  assert.match(css, /prefers-reduced-motion:reduce\) \{ \.die\.landing \{ animation:none/);
  assert.match(script, /catchUpThreshold:2/);
  assert.match(script, /severeBacklogThreshold:5/);
  assert.match(css, /\.presentation-effects \{[^}]*pointer-events:none/);
});

test("权威视图按房间、玩家、山道、骰子、决策和演出分区更新", () => {
  const script = read("app.js");
  const partitions = read("render-partitions.mjs");

  assert.match(script, /createGame10PartitionRenderer/);
  assert.match(script, /createGame10RenderModel/);
  assert.match(script, /room:renderRoom,status:renderStatus,players:renderPlayers/);
  assert.match(script, /board:\(model\)=>renderBoard\(model\.view\),dice:renderDice/);
  assert.match(script, /spectatorUi\.render\(view\)/);
  assert.doesNotMatch(script, /function renderLegacy/);
  assert.match(script, /existing = new Map\(\[\.\.\.E\.playerList\.querySelectorAll/);
  assert.match(script, /existing = new Map\(\[\.\.\.E\.board\.querySelectorAll/);
  assert.match(partitions, /"room", "status", "players", "board", "dice"/);
  assert.match(partitions, /"decision", "log", "countdown", "result"/);
});

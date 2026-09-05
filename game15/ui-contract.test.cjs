"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("房间信息并入标题栏，侧栏按比赛、规则、记录和旁观排序", () => {
  const html = read("index.html");
  const headerStart = html.indexOf('<header id="hero"');
  const headerEnd = html.indexOf("</header>", headerStart);
  const roomTools = html.indexOf('id="roomHeaderTools"');
  const score = html.indexOf('class="panel score-card"');
  const rules = html.indexOf('class="panel rule-card"');
  const log = html.indexOf('class="panel log-card"');
  const spectators = html.indexOf('id="spectatorPanel"');

  assert.ok(headerStart >= 0 && roomTools > headerStart && roomTools < headerEnd);
  assert.doesNotMatch(html, /roomRoleBanner|roomRoleTitle|roomRoleHint/);
  assert.match(html, /<details class="panel rule-card">/);
  assert.doesNotMatch(html, /<details class="panel rule-card"[^>]*\sopen(?:\s|>)/);
  assert.ok(score < rules && rules < log && log < spectators);
  assert.match(html, /90秒/);
  assert.match(html, /恢复回合开始时的牌桌并罚摸3张/);
});

test("进入房间时启用紧凑标题工具且旁观接口不依赖身份横幅", () => {
  const script = read("app.js");

  assert.match(script, /"hero", "connectionStatus", "roomHeaderTools"/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(script, /E\.hero\.classList\.add\("in-room"\)/);
  assert.doesNotMatch(script, /E\.roomRole(?:Banner|Title|Hint)/);
  assert.match(script, /createSpectatorUi\(\{/);
  assert.match(script, /seatActionButton: E\.seatActionButton/);
});

test("移动端优先展示牌桌并保留吸附操作牌架", () => {
  const css = read("styles.css");

  assert.match(css, /\.control-dock\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.room-layout\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.game-area\s*\{\s*order:\s*1;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.sidebar\s*\{\s*order:\s*2;/);
  assert.match(css, /\.rule-details\s*\{[^}]*max-height:\s*58vh;[^}]*overflow:\s*auto;/s);
  assert.doesNotMatch(css, /\.rule-card\s*\{[^}]*display:\s*none|\.log-card\s*\{[^}]*display:\s*none/);
});

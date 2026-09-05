"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("房间控制并入标题栏，辅助信息按规则、记录和旁观排序", () => {
  const html = read("index.html");
  const headerStart = html.indexOf('<header id="hero"');
  const headerEnd = html.indexOf("</header>", headerStart);
  const roomTools = html.indexOf('id="roomHeaderTools"');
  const rules = html.indexOf('class="panel rule-card"');
  const log = html.indexOf('class="panel log-card"');
  const spectators = html.indexOf('id="spectatorPanel"');

  assert.ok(headerStart >= 0 && roomTools > headerStart && roomTools < headerEnd);
  assert.doesNotMatch(html, /roomRoleBanner|roomRoleTitle|roomRoleHint/);
  assert.match(html, /<details class="panel rule-card">/);
  assert.doesNotMatch(html, /<details class="panel rule-card"[^>]*\sopen(?:\s|>)/);
  assert.ok(rules < log && log < spectators);
  assert.match(html, /任意一张牌直接弃掉/);
  assert.match(html, /三张手牌全部无法合法使用/);
  assert.match(html, /每回合限时30秒/);
});

test("进入房间时展示紧凑标题工具且旁观切换不依赖身份横幅", () => {
  const script = read("app.js");

  assert.match(script, /"hero", "connectionStatus", "roomHeaderTools"/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(script, /E\.hero\.classList\.add\("in-room"\)/);
  assert.doesNotMatch(script, /E\.roomRole(?:Banner|Title|Hint)/);
  assert.match(script, /createSpectatorUi\(\{/);
  assert.match(script, /seatActionButton: E\.seatActionButton/);
});

test("手机端优先显示农场并保留吸附行动手牌区", () => {
  const css = read("styles.css");

  assert.match(css, /\.control-dock\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.room-layout\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.game-area\s*\{\s*order:\s*1;/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.sidebar\s*\{\s*order:\s*2;/);
  assert.match(css, /\.rule-details\s*\{[^}]*max-height:\s*58vh;[^}]*overflow:\s*auto;/s);
  assert.doesNotMatch(css, /\.rule-card\s*\{[^}]*display:\s*none|\.log-card\s*\{[^}]*display:\s*none/);
});

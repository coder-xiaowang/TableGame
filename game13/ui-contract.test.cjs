"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("房间设置并入标题栏，侧栏按积分、规则、记录和旁观排序", () => {
  const html = read("index.html");
  const headerStart = html.indexOf('<header id="hero"');
  const headerEnd = html.indexOf("</header>", headerStart);
  const roomTools = html.indexOf('id="roomHeaderTools"');
  const score = html.indexOf('class="panel score-card"');
  const rules = html.indexOf('class="panel rules-card"');
  const log = html.indexOf('class="panel log-panel sidebar-log"');
  const spectators = html.indexOf('id="spectatorPanel"');

  assert.ok(headerStart >= 0 && roomTools > headerStart && roomTools < headerEnd);
  assert.doesNotMatch(html, /roomRoleBanner|roomRoleTitle|roomRoleHint/);
  assert.match(html, /<details class="panel rules-card">/);
  assert.doesNotMatch(html, /<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.ok(score < rules && rules < log && log < spectators);
  assert.match(html, /SPY或SWAP的目标玩家会知道被操作的具体牌位/);
  assert.match(html, /选择至少3张失败时还会获得一张不可查看的惩罚牌/);
  assert.match(html, /普通回合限时45秒/);
});

test("进入房间时启用紧凑标题工具且旁观接口不依赖身份横幅", () => {
  const script = read("app.js");

  assert.match(script, /const ids=\["hero","connectionStatus","roomHeaderTools"/);
  assert.match(script, /setHidden\(E\.roomHeaderTools,false\)/);
  assert.match(script, /E\.hero\.classList\.add\("in-room"\)/);
  assert.doesNotMatch(script, /E\.roomRole(?:Banner|Title|Hint)/);
  assert.match(script, /createSpectatorUi\(\{/);
  assert.match(script, /seatActionButton:E\.seatActionButton/);
});

test("手机端牌桌优先且四张固定牌位继续完整展示", () => {
  const css = read("styles.css");

  assert.match(css, /@media\(max-width:850px\)[^{]*\{[^}]*\.hero\.in-room/s);
  assert.match(css, /@media\(max-width:850px\)[\s\S]*?\.room-layout\{display:flex;flex-direction:column\}/);
  assert.match(css, /@media\(max-width:850px\)[\s\S]*?\.game-area\{order:1\}/);
  assert.match(css, /@media\(max-width:850px\)[\s\S]*?\.room-layout aside\{order:2;/);
  assert.match(css, /@media\(max-width:1050px\)\{\.slots[^}]*grid-template-columns:repeat\(4,minmax\(0,54px\)\)/);
  assert.match(css, /\.rule-details\{max-height:58vh;overflow:auto/);
});

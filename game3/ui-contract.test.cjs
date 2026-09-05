"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const script = fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
const styles = fs.readFileSync(path.join(__dirname,"styles.css"),"utf8");

test("game3 merges room controls into the compact title bar",() => {
  const header = html.slice(html.indexOf('<header class="topbar"'),html.indexOf("</header>") + 9);
  assert.match(header,/id="connectionStatus"/);
  assert.match(header,/id="roomHeaderTools"/);
  assert.match(header,/id="roomCodeDisplay"/);
  assert.match(header,/id="hostTools"/);
  assert.match(header,/id="seatActionButton"/);
  assert.doesNotMatch(html,/class="panel room-card"/);
  assert.doesNotMatch(html,/room-role-banner/);
  assert.match(script,/setHidden\(elements\.roomHeaderTools, false\)/);
  assert.match(script,/elements\.siteHeader\.classList\.add\("in-room"\)/);
});

test("game3 replaces the short note with folded detailed rules",() => {
  const playersAt = html.indexOf('class="panel player-panel"');
  const rulesAt = html.indexOf('class="panel rules-card"');
  const spectatorsAt = html.indexOf('id="spectatorPanel"');
  assert.ok(playersAt >= 0 && playersAt < rulesAt && rulesAt < spectatorsAt);
  assert.match(html,/<details class="panel rules-card">/);
  assert.doesNotMatch(html,/<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html,/rules-note/);
  assert.match(html,/上半区合计至少 63 分/);
  assert.match(html,/本版本没有回合倒计时/);
});

test("game3 prioritizes dice and score sheet on narrow screens",() => {
  assert.ok(html.indexOf('<aside class="sidebar">') < html.indexOf('<section class="table-area">'));
  assert.match(styles,/@media \(max-width: 850px\)[\s\S]*?\.room-layout \{ display: flex; flex-direction: column; \}/);
  assert.match(styles,/\.room-layout > \.table-area \{ order: 1; \}/);
  assert.match(styles,/\.room-layout > \.sidebar \{ order: 2;/);
});

test("game3 preserves dice controls and public score inspection",() => {
  for (const id of ["gameNotice","turnTitle","roundBadge","rollBadge","diceTray","turnActions","scorePlayerSelect","scoreSummary","scoreGrid"]) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(script,/categoryScore/);
  assert.match(script,/data-die-index/);
  assert.match(script,/spectatorUi\.render\(view\)/);
});

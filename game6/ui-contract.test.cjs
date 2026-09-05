"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const script = fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
const styles = fs.readFileSync(path.join(__dirname,"styles.css"),"utf8");

test("game6 merges room management into the compact title bar",() => {
  const header = html.slice(html.indexOf('<header class="topbar"'),html.indexOf("</header>") + 9);
  assert.match(header,/id="connectionStatus"/);
  assert.match(header,/id="roomHeaderTools"/);
  assert.match(header,/id="roomCodeDisplay"/);
  assert.match(header,/id="hostTools"/);
  assert.match(header,/id="seatActionButton"/);
  assert.doesNotMatch(html,/class="panel room-card"/);
  assert.doesNotMatch(html,/room-role-banner/);
  assert.match(script,/setHidden\(E\.roomHeaderTools,false\)/);
  assert.match(script,/E\.siteHeader\.classList\.add\("in-room"\)/);
});

test("game6 folds detailed rules and orders the log before spectators",() => {
  const playersAt = html.indexOf('class="panel player-panel"');
  const rulesAt = html.indexOf('class="panel rules-card"');
  const logAt = html.indexOf('class="panel log-panel"');
  const spectatorsAt = html.indexOf('id="spectatorPanel"');
  assert.ok(playersAt >= 0 && playersAt < rulesAt);
  assert.ok(rulesAt < logAt && logAt < spectatorsAt);
  assert.match(html,/<details class="panel rules-card">/);
  assert.doesNotMatch(html,/<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(html,/达到 66 分/);
  assert.match(html,/15 秒内秘密选择/);
});

test("game6 keeps table and sticky turn console ahead of auxiliary panels on mobile",() => {
  assert.ok(html.indexOf('<aside class="sidebar">') < html.indexOf('<section class="table-area">'));
  assert.match(styles,/@media \(max-width: 900px\)[^{]*\{[\s\S]*?\.game-layout \{ display: flex; flex-direction: column; \}/);
  assert.match(styles,/\.game-layout > \.table-area \{ order: 1; \}/);
  assert.match(styles,/\.game-layout > \.sidebar \{ order: 2;/);
  assert.match(styles,/@media \(max-width: 720px\)[\s\S]*?\.turn-console \{[\s\S]*?position: sticky;/);
  assert.match(html,/id="turnConsole"/);
  assert.match(html,/id="turnHandPanel"/);
});

test("game6 preserves reveal timeline, board rows and countdown controls",() => {
  assert.match(html,/id="revealPanel"/);
  assert.match(html,/id="revealedPlays"/);
  assert.match(html,/id="rows"/);
  assert.match(html,/id="timerText"/);
  assert.match(html,/id="timerBar"/);
  assert.match(script,/createCountdown/);
  assert.match(script,/renderCountdown/);
});

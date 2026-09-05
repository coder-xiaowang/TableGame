"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const script=fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
const styles=fs.readFileSync(path.join(__dirname,"styles.css"),"utf8");

test("game1 merges room management into the compact title bar",()=>{
  const header=html.slice(html.indexOf('<header class="topbar"'),html.indexOf("</header>")+9);
  for(const id of["connectionStatus","roomHeaderTools","roomCodeDisplay","hostTools","seatActionButton"])assert.match(header,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/room-role-banner/);
  assert.doesNotMatch(html,/房主管理/);
  assert.match(script,/setHidden\(elements\.roomHeaderTools, false\)/);
  assert.match(script,/elements\.siteHeader\.classList\.add\("in-room"\)/);
});

test("game1 folds detailed rules and moves filtered history before spectators",()=>{
  const aside=html.slice(html.indexOf('<aside class="sidebar">'),html.indexOf("</aside>")+8);
  const playersAt=aside.indexOf('class="panel player-panel"');
  const rulesAt=aside.indexOf('class="panel rules-card"');
  const logAt=aside.indexOf('class="panel log-panel"');
  const spectatorsAt=aside.indexOf('id="spectatorPanel"');
  assert.ok(playersAt>=0&&playersAt<rulesAt&&rulesAt<logAt&&logAt<spectatorsAt);
  assert.match(html,/<details class="panel rules-card">/);
  assert.doesNotMatch(html,/<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(aside,/id="logPlayerFilter"/);
  assert.match(html,/自己的答案和陷阱词始终对本人隐藏/);
});

test("game1 prioritizes words and active actions on narrow screens",()=>{
  assert.ok(html.indexOf('<aside class="sidebar">')<html.indexOf('<section class="table-area">'));
  assert.match(styles,/@media \(max-width: 860px\)[\s\S]*?\.room-panel \{ display: flex; flex-direction: column; \}/);
  assert.match(styles,/\.room-panel > \.table-area \{ order: 1; \}/);
  assert.match(styles,/\.room-panel > \.sidebar \{[\s\S]*?order: 2;/);
});

test("game1 preserves private words, question actions and log filtering",()=>{
  for(const id of["wordBoard","turnTitle","roundBadge","actionArea","logPlayerFilter","logList"])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(script,/renderWords\(memberRole\)/);
  assert.match(script,/questionInput/);
  assert.match(script,/guessInput/);
  assert.match(script,/renderLog\(\)/);
  assert.match(script,/logPlayerFilter/);
});

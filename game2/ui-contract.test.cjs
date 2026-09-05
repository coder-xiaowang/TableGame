"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const script=fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
const styles=fs.readFileSync(path.join(__dirname,"styles.css"),"utf8");

test("game2 merges room management into the compact title bar",()=>{
  const header=html.slice(html.indexOf('<header class="topbar"'),html.indexOf("</header>")+9);
  for(const id of["connectionStatus","roomHeaderTools","roomCodeDisplay","hostTools","seatActionButton"])assert.match(header,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/room-role-banner/);
  assert.doesNotMatch(html,/房主面板/);
  assert.match(script,/setHidden\(elements\.roomHeaderTools,true\)|setHidden\(elements\.roomHeaderTools,false\)/);
  assert.match(script,/elements\.siteHeader\.classList\.add\("in-room"\)/);
});

test("game2 folds detailed rules and puts public history before spectators",()=>{
  const aside=html.slice(html.indexOf('<aside class="sidebar">'),html.indexOf("</aside>")+8);
  const playersAt=aside.indexOf('class="panel player-panel"');
  const rulesAt=aside.indexOf('class="panel rules-card"');
  const logAt=aside.indexOf('class="panel log-panel"');
  const spectatorsAt=aside.indexOf('id="spectatorPanel"');
  assert.ok(playersAt>=0&&playersAt<rulesAt&&rulesAt<logAt&&logAt<spectatorsAt);
  assert.match(html,/<details class="panel rules-card">/);
  assert.doesNotMatch(html,/<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(html,/旁观者可以看到公开描述/);
  assert.match(html,/本版本没有行动倒计时/);
});

test("game2 prioritizes score, seats and active turn on small screens",()=>{
  assert.ok(html.indexOf('<aside class="sidebar">')<html.indexOf('<section class="table-area">'));
  assert.match(styles,/@media \(max-width: 900px\)[\s\S]*?\.room-panel \{ display: flex; flex-direction: column; \}/);
  assert.match(styles,/\.room-panel > \.table-area \{ order: 1; \}/);
  assert.match(styles,/\.room-panel > \.sidebar \{[\s\S]*?order: 2;/);
});

test("game2 preserves team seats, private idiom and text action surfaces",()=>{
  for(const id of["scoreBoard","seatBoard","idiomValue","turnTitle","teamBadge","actionArea","logList"])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(script,/view\.roomRole !== "spectator"/);
  assert.match(script,/descriptionInput/);
  assert.match(script,/guessInput/);
  assert.match(script,/renderIdiom/);
});

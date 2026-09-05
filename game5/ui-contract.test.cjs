"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const script=fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
const styles=fs.readFileSync(path.join(__dirname,"styles.css"),"utf8");

test("game5 merges room controls into the UNO title bar",()=>{
  const header=html.slice(html.indexOf('<header id="siteHeader"'),html.indexOf("</header>")+9);
  assert.match(header,/id="connectionStatus"/);
  assert.match(header,/id="roomHeaderTools"/);
  assert.match(header,/id="roomCodeDisplay"/);
  assert.match(header,/id="hostTools"/);
  assert.match(header,/id="seatActionButton"/);
  assert.doesNotMatch(html,/room-role-banner/);
  assert.match(script,/setHidden\(E\.roomHeaderTools,false\)/);
  assert.match(script,/E\.siteHeader\.classList\.add\("in-room"\)/);
});

test("game5 removes the redundant player heading and folds full rules",()=>{
  assert.doesNotMatch(html,/players-panel-head/);
  assert.match(html,/<details class="panel rules-card" id="rulesCard">/);
  assert.doesNotMatch(html,/<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(html,/质疑成功时出牌者摸 4 张/);
  assert.match(html,/其他玩家只公开手牌数量/);
  assert.match(html,/id="rulesCard"/);
  assert.match(html,/id="rulesShortcutButton"/);
  assert.match(script,/E\.rulesCard\.open=true/);
  assert.match(script,/E\.rulesCard\.scrollIntoView/);
});

test("game5 places history before spectators in the auxiliary column",()=>{
  const aside=html.slice(html.indexOf("<aside>"),html.indexOf("</aside>")+8);
  const rulesAt=aside.indexOf('class="panel rules-card"');
  const logAt=aside.indexOf('class="panel log-panel"');
  const spectatorsAt=aside.indexOf('id="spectatorPanel"');
  assert.ok(rulesAt>=0&&rulesAt<logAt&&logAt<spectatorsAt);
  const main=html.slice(html.indexOf('<section class="main">'),html.indexOf("</section>",html.indexOf('<section class="main">'))+10);
  assert.doesNotMatch(main,/id="logList"/);
});

test("game5 prioritizes the main table on phones and preserves core controls",()=>{
  assert.ok(html.indexOf("<aside>")<html.indexOf('<section class="main">'));
  assert.match(styles,/@media\(max-width:720px\)[\s\S]*?\.layout \{ display: flex; flex-direction: column; \}/);
  assert.match(styles,/\.layout > \.main \{ order: 1; \}/);
  assert.match(styles,/\.layout > aside \{ order: 2;/);
  for(const id of["players","drawPile","discardPile","actionArea","timerText","handPanel","unoButton","colorModal"])assert.match(html,new RegExp(`id="${id}"`));
});

test("game5 integrates action, countdown and hand into one large UNO table",()=>{
  const tableStart=html.indexOf('<div class="table panel">');
  const tableEnd=html.indexOf("</div>\n            </section>",tableStart);
  const table=html.slice(tableStart,tableEnd);
  assert.match(table,/class="table-stage"/);
  assert.match(table,/class="table-console"/);
  assert.match(table,/id="actionTitle"/);
  assert.match(table,/id="timerText"/);
  assert.match(table,/id="handPanel"/);
  assert.match(table,/id="hand"/);
  assert.match(styles,/\.table \{[\s\S]*?min-height: 640px;/);
  assert.match(styles,/\.table-console \{[\s\S]*?grid-template-columns:/);
});

test("game5 auxiliary cards remain separate and single-column",()=>{
  assert.match(styles,/\.layout aside > \.rules-card,[\s\S]*?\.layout aside > \.spectator-panel \{/);
  assert.match(styles,/\.layout aside \{[\s\S]*?grid-template-columns: minmax\(0,1fr\)/);
  assert.match(styles,/\.layout aside > \.spectator-panel \.spectator-list/);
  assert.match(styles,/\.layout aside \{ position: static; max-height: none; overflow: visible; \}/);
  assert.match(styles,/\.layout aside > \.rules-card,[\s\S]*?grid-column: 1;[\s\S]*?grid-row: auto;/);
});

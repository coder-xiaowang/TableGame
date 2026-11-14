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

test("game5 reserves separate board and control regions before optional references", () => {
  assert.match(html, /href="\/shared\/styles\/play-layout\.css"/);
  const workspaceAt = html.indexOf('data-play-workspace');
  const controlsAt = html.indexOf('data-play-controls');
  const referenceAt = html.indexOf('data-play-reference');
  assert.ok(workspaceAt >= 0 && controlsAt > workspaceAt && referenceAt > controlsAt);
  assert.match(html, /data-play-board/);
});

test("game5 consumes the shared server-authored presentation timeline",()=>{
  for(const id of["unoStage","tableStage","presentationEffects","presentationTrail","presentationAnnouncement","presentationLabel","presentationText"])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(script,/createPresentationTimeline/);
  assert.match(script,/presentation\?\.sync\(nextView\.presentationEvents\)/);
  assert.match(script,/player\.dataset\.playerId/);
  assert.match(script,/function presentationSource/);
  assert.match(script,/function presentationTarget/);
  assert.match(script,/import \{composePresentationText\} from "\.\/presentation\.mjs"/);
  assert.match(script,/textFor:composePresentationText/);
  assert.match(script,/sceneKey:\(event\)=>event\.sceneId\|\|event\.id/);
  assert.match(script,/catchUpThreshold:2,severeBacklogThreshold:5/);
  assert.match(script,/urgentPriority:4,retainPriority:3/);
  assert.match(styles,/\.presentation-effects/);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
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

test("game5 authoritative broadcasts update stable UNO partitions",()=>{
  const partitions=fs.readFileSync(path.join(__dirname,"render-partitions.mjs"),"utf8");
  assert.match(script,/createGame5PartitionRenderer/);assert.match(script,/createGame5RenderModel/);
  assert.match(script,/decision:renderDecision,decisionFacts:renderDecisionFacts/);
  assert.match(script,/existing=new Map\(\[\.\.\.E\.players\.querySelectorAll/);
  assert.match(script,/existing=new Map\(\[\.\.\.E\.hand\.querySelectorAll/);
  assert.match(partitions,/"room","status","players","table","decision","decisionFacts","hand","log","countdown"/);
});

test("game5 arrival shell presents a bright friends card table without changing room contracts",()=>{
  assert.match(html,/class="color-table-arrival" id="setupPanel"/);
  assert.match(html,/COLOR CARD NIGHT/);
  assert.match(html,/今晚的好友牌局/);
  assert.match(html,/跟上颜色，<br>把最后一张牌打出去/);
  for(const id of["hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","playerCountSelect","createRoomButton","guestNameInput","roomCodeInput","joinIntentField","joinRoomButton"]){
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(styles,/url\("assets\/sunlit-color-card-table-v1\.png"\)/);
  assert.match(styles,/@media\(max-width:760px\)[\s\S]*?\.color-table-arrival \{ display: block;/);
});

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

test("game3 reserves separate board and control regions before optional references", () => {
  assert.match(html, /href="\/shared\/styles\/play-layout\.css"/);
  const workspaceAt = html.indexOf('data-play-workspace');
  const controlsAt = html.indexOf('data-play-controls');
  const referenceAt = html.indexOf('data-play-reference');
  assert.ok(workspaceAt >= 0 && controlsAt > workspaceAt && referenceAt > controlsAt);
  assert.match(html, /data-play-board/);
});

test("game3 preserves dice controls and public score inspection",() => {
  for (const id of ["gameNotice","turnTitle","roundBadge","rollBadge","diceTray","turnActions","scoreGrid"]) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(script,/categoryScore/);
  assert.match(html,/<table id="scoreGrid"/);
  assert.match(script,/data-die-index/);
  assert.match(script,/spectatorUi\.render\(view\)/);
});

test("game3 partitions authoritative views without replacing unrelated interaction DOM",() => {
  assert.match(script,/createGame3RenderModel/);
  assert.match(script,/createGame3PartitionRenderer/);
  assert.match(script,/turnActionFacts: renderTurnActionFactsPartition/);
  assert.match(script,/scorecard: renderScorecardPartition/);
  assert.match(script,/elements\.playerList\.addEventListener\("click"/);
  assert.match(script,/elements\.diceTray\.addEventListener\("click"/);
  assert.match(script,/elements\.scoreGrid\.addEventListener\("click"/);
  assert.doesNotMatch(script,/playerList\.innerHTML\s*=/);
  assert.doesNotMatch(script,/function renderLegacy/);
});

test("game3 arrival shell presents a bright dice club without changing room contracts",() => {
  assert.match(html,/class="dice-club-arrival" id="setupPanel"/);
  assert.match(html,/YACHT DICE CLUB/);
  assert.match(html,/计分员登记台/);
  assert.match(html,/摇出组合，<br>填满你的十三格计分表/);
  for (const id of ["hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","playerCountSelect","createRoomButton","guestNameInput","roomCodeInput","joinIntentField","joinRoomButton"]) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(styles,/url\("assets\/sunlit-dice-club-v1\.png"\)/);
  assert.match(styles,/@media \(max-width: 760px\)[\s\S]*?\.dice-club-arrival \{ display: block;/);
});

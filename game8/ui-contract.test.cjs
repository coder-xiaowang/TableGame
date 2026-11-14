"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

test("game8 entry shell presents a trainer departure while preserving room contracts", () => {
  const setupStart = html.indexOf('id="setupPanel"');
  const setupEnd = html.indexOf('id="roomPanel"', setupStart);
  const setup = html.slice(setupStart, setupEnd);

  assert.match(setup, /class="setup-wrap trainer-arrival"/);
  assert.match(setup, /class="trainer-briefing"/);
  assert.match(setup, /class="trainer-route"/);
  assert.match(setup, /class="trainer-terminal"/);
  assert.match(setup, /id="hostModeButton" class="mode active"/);
  assert.match(setup, /id="guestModeButton" class="mode"/);
  assert.match(setup, /id="hostSetup" class="panel setup-card trainer-form"/);
  assert.match(setup, /id="guestSetup" class="panel setup-card trainer-form hidden"/);
  assert.match(setup, /id="hostNameInput" maxlength="12"/);
  assert.match(setup, /id="roomCodeInput" maxlength="4"/);
  assert.match(setup, /name="joinIntent" value="play" checked/);
  assert.match(setup, /name="joinIntent" value="spectate"/);
  assert.match(styles, /url\("assets\/trainer-departure-arrival-v1\.png"\)/);
  assert.match(styles, /\.trainer-arrival \.mode-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.trainer-briefing\{[\s\S]*?align-self:center;[\s\S]*?margin-top:clamp\(-34px,-3vh,-16px\)/);
  assert.match(styles, /@media\(max-width:720px\)\{[\s\S]*?\.trainer-arrival\{[\s\S]*?grid-template-columns:1fr/);
  assert.match(styles, /@media\(max-width:720px\)\{[\s\S]*?\.trainer-briefing\{align-self:start;margin-top:0/);
  assert.ok(fs.existsSync(path.join(__dirname, "assets", "trainer-departure-arrival-v1.png")));
});

test("game8 merges room controls into the compact title bar", () => {
  const header = html.slice(html.indexOf('<header id="siteHeader"'), html.indexOf("</header>") + 9);
  assert.match(header, /id="connectionStatus"/);
  assert.match(header, /id="roomHeaderTools"/);
  assert.match(header, /id="roomCodeDisplay"/);
  assert.match(header, /id="hostTools"/);
  assert.match(header, /id="seatActionButton"/);
  assert.doesNotMatch(html, /class="panel room-card"/);
  assert.doesNotMatch(html, /room-role-banner/);
  assert.match(script, /setHidden\(E\.roomHeaderTools,false\)/);
  assert.match(script, /E\.siteHeader\.classList\.add\("in-room"\)/);
});

test("game8 keeps detailed rules folded and places spectators after the log", () => {
  const playerAt = html.indexOf('class="panel player-panel"');
  const rulesAt = html.indexOf('class="panel rules-card"');
  const logAt = html.indexOf('class="panel log-panel"');
  const spectatorsAt = html.indexOf('id="spectatorPanel"');
  assert.ok(playerAt >= 0 && playerAt < rulesAt);
  assert.ok(rulesAt < logAt && logAt < spectatorsAt);
  assert.match(html, /<details class="panel rules-card">/);
  assert.doesNotMatch(html, /<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /18 枚奖杯/);
  assert.match(html, /暗取牌堆顶的牌面只对持有者可见/);
});

test("game8 reserves separate board and control regions before optional references", () => {
  assert.match(html, /href="\/shared\/styles\/play-layout\.css"/);
  const workspaceAt = html.indexOf('data-play-workspace');
  const controlsAt = html.indexOf('data-play-controls');
  const referenceAt = html.indexOf('data-play-reference');
  assert.ok(workspaceAt >= 0 && controlsAt > workspaceAt && referenceAt > controlsAt);
  assert.match(html, /data-play-board/);
});

test("game8 preserves trainer inspection, compact collections and sticky desktop actions", () => {
  assert.match(html, /id="trainerInspector"/);
  assert.match(html, /class="owned-pokemon-list"/);
  assert.match(html, /class="reserved-pokemon-list"/);
  assert.match(script, /renderTrainerInspector/);
  assert.match(script, /secretReserveHtml/);
  assert.match(styles, /\.trainer-column\{grid-area:trainer;position:sticky/);
});

test("game8 mounts the shared authoritative presentation layer with adaptive playback", () => {
  assert.match(html, /id="presentationEffects"/);
  assert.match(html, /id="presentationTrail"/);
  assert.match(html, /id="presentationAnnouncement"/);
  assert.match(script, /createPresentationTimeline/);
  assert.match(script, /presentation\?\.sync\(nextView\.presentationEvents\)/);
  assert.match(script, /data-player-anchor/);
  assert.match(script, /sceneKey:\(event\)=>event\.sceneId\|\|event\.id/);
  assert.match(script, /catchUpThreshold:2/);
  assert.match(script, /severeBacklogThreshold:5/);
  assert.match(styles, /\.presentation-effects/);
  assert.match(styles, /pointer-events:none/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

test("game8 keeps legal local choices until the server accepts or invalidates them", () => {
  assert.match(script, /onView\(nextView\)\{view=nextView;reconcileLocalSelection\(\);/);
  assert.match(script, /function submit\(action\)\{return room\.submitAction\(action\)\.catch/);
  assert.doesNotMatch(script, /function submit\(action\)\{selection=\[\];selectedCardId=null/);
  assert.match(script, /function reconcileLocalSelection\(\)/);
  assert.match(script, /legalCardIds\.has\(selectedCardId\)/);
  assert.match(script, /g\.supply\[color\]>0/);
});

test("game8 authoritative view is partitioned without replacing unrelated decisions", () => {
  assert.match(script, /createGame8PartitionRenderer/);
  assert.match(script, /createGame8RenderModel/);
  assert.match(script, /dataset\.renderKey/);
  assert.match(script, /function reconcileCardList/);
  assert.match(script, /const partitionRenderer=/);
});

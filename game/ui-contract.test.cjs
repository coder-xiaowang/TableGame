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

test("game1 turns its room into a distinct mechanical cipher workstation",()=>{
  assert.match(html,/<body data-theme="mechanical-cipher-room"[^>]*>/);
  const stage=html.slice(html.indexOf('<section data-play-workspace>'),html.indexOf('<section class="archive-strip"'));
  for(const marker of["cipher-machine","operator-registry","operator-wall","decoder-console"])assert.match(stage,new RegExp(marker));
  assert.match(styles,/Experience shell: a warm, mechanical cipher room/);
  assert.match(styles,/\.cipher-machine\s*\{/);
  assert.match(styles,/\.operator-card\.active\s*\{/);
});

test("game1 gives its create and join flow a compact cipher-bureau arrival shell",()=>{
  const setup=html.slice(html.indexOf('<section class="setup-panel cipher-arrival"'),html.indexOf('<section class="room-panel'));
  for(const marker of["briefing-copy","briefing-route","bureau-checkpoint","checkpoint-heading","registry-form"])assert.match(setup,new RegExp(marker));
  for(const id of["hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","gameModeSelect","topicSelect","roomCodeInput","joinIntentField","createRoomButton","joinRoomButton"])assert.match(setup,new RegExp(`id="${id}"`));
  assert.match(styles,/cipher-bureau-arrival-v1\.png/);
  assert.match(styles,/\.cipher-arrival \.mode-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles,/@media \(max-width: 640px\)[\s\S]*?\.cipher-arrival\s*\{[\s\S]*?grid-template-columns: 1fr/);
  assert.ok(fs.existsSync(path.join(__dirname,"assets","cipher-bureau-arrival-v1.png")));
});

test("game1 keeps rules and public records in ordered archive drawers",()=>{
  const archive=html.slice(html.indexOf('<section class="archive-strip"'),html.indexOf("</main>"));
  const rulesAt=archive.indexOf('class="panel rules-card archive-drawer"');
  const logAt=archive.indexOf('class="panel log-panel archive-drawer"');
  const spectatorsAt=archive.indexOf('id="spectatorPanel"');
  assert.ok(rulesAt>=0&&rulesAt<logAt&&logAt<spectatorsAt);
  assert.match(html,/<details class="panel rules-card archive-drawer">/);
  assert.doesNotMatch(html,/<details class="panel rules-card archive-drawer"[^>]*\sopen(?:\s|>)/);
  assert.match(archive,/id="logPlayerFilter"/);
  assert.match(html,/自己的答案和陷阱词始终对本人隐藏/);
});

test("game1 scales operator plaques and keeps its decoder console available on phones",()=>{
  assert.match(script,/elements\.wordBoard\.classList\.toggle\("crowded", view\.words\.length > 8\)/);
  assert.match(script,/elements\.wordBoard\.classList\.toggle\("dense", view\.words\.length > 16\)/);
  assert.match(styles,/\.decoder-console\s*\{[\s\S]*?position: sticky;/);
  assert.match(styles,/@media \(max-width: 640px\)[\s\S]*?\.operator-wall,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles,/@media \(max-width: 390px\)[\s\S]*?grid-template-columns: 1fr;/);
});

test("game1 preserves private words, question actions and log filtering",()=>{
  for(const id of["wordBoard","turnTitle","roundBadge","actionArea","logPlayerFilter","logList"])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(script,/renderWords\(memberRole\)/);
  assert.match(script,/SEALED PERSONAL CODE/);
  assert.match(script,/ASSIGNED CODE/);
  assert.match(script,/questionInput/);
  assert.match(script,/guessInput/);
  assert.match(script,/renderLogEntries/);
  assert.match(script,/logPlayerFilter/);
});

test("game1 consumes server-authored cipher presentations with backlog control",()=>{
  for(const id of["presentationEffects","presentationTrail","presentationAnnouncement","presentationLabel","presentationText"]) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(script,/createPresentationTimeline/);
  assert.match(script,/presentation\?\.sync\(nextView\.presentationEvents\)/);
  assert.match(script,/data-player-anchor=/);
  assert.match(script,/sceneKey:\(event\) => event\.sceneId/);
  assert.match(script,/catchUpThreshold:4/);
  assert.match(script,/severeBacklogThreshold:8/);
  assert.match(script,/urgentPriority:5/);
  assert.match(styles,/\.presentation-effects\s*\{[\s\S]*?pointer-events: none;/);
  assert.match(styles,/\.presentation-token\s*\{/);
  assert.match(styles,/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.presentation-token/);
});

test("game1 preserves unsent form drafts across authoritative view broadcasts",()=>{
  assert.match(script,/onView\(nextView, version\) \{\s*const previousView = view;\s*captureActionDraft\(\);\s*view = nextView;\s*reconcileActionDraft\(previousView, nextView\);/);
  for(const binding of[
    'restoreDraftInput("submittedWordInput", "submittedWord")',
    'restoreDraftInput("submittedTrapWordInput", "submittedTrapWord")',
    'restoreDraftInput("submittedWordExtraInput", "submittedWordExtra")',
    'restoreDraftInput("questionInput", "question")',
    'restoreDraftInput("guessInput", "guess")'
  ]) assert.match(script,new RegExp(binding.replace(/[()]/g,"\\$&")));
  assert.match(script,/if \(nextView\.phase !== "collectingWords"\) clearDraftGroup\("submission"\)/);
  assert.match(script,/if \(nextView\.phase !== "playing"\) clearDraftGroup\("turn"\)/);
  assert.doesNotMatch(script,/localStorage[\s\S]*actionDraft|actionDraft[\s\S]*localStorage/);
});

test("game1 isolates text decisions from unrelated authoritative partitions",()=>{
  assert.match(script,/createGame1RenderModel/);
  assert.match(script,/createGame1PartitionRenderer/);
  assert.match(script,/decision:\(currentModel\) => renderActions/);
  assert.match(script,/logFilter:renderLogFilter/);
  assert.match(script,/log:renderLogEntries/);
  assert.match(script,/elements\.playerList\.addEventListener\("click"/);
  assert.doesNotMatch(script,/playerList\.innerHTML\s*=/);
});

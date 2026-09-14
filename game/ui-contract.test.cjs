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
  assert.match(html,/<body data-theme="mechanical-cipher-room">/);
  const stage=html.slice(html.indexOf('<section class="table-area decoder-stage">'),html.indexOf('<section class="archive-strip"'));
  for(const marker of["cipher-machine","operator-registry","operator-wall","decoder-console"])assert.match(stage,new RegExp(marker));
  assert.match(styles,/Experience shell: a warm, mechanical cipher room/);
  assert.match(styles,/\.cipher-machine\s*\{/);
  assert.match(styles,/\.operator-card\.active\s*\{/);
});

test("game1 keeps rules and public records in ordered archive drawers",()=>{
  const archive=html.slice(html.indexOf('<section class="archive-strip"'),html.indexOf("</section>\n      </section>")+10);
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
  assert.match(script,/renderLog\(\)/);
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

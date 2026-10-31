"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

test("间谍危机使用地点档案库与分布式情报网络外壳", () => {
  const html = read("index.html"), script = read("app.js"), css = read("styles.css");
  const headerEnd = html.indexOf("</header>");
  assert.ok(html.indexOf('id="roomHeaderTools"') > 0 && html.indexOf('id="roomHeaderTools"') < headerEnd);
  assert.match(html, /data-theme="spyfall-field-network"/);
  assert.match(html, /class="operation-grid"/);
  assert.match(html, /class="location-vault" data-ui-role="location-intelligence"/);
  assert.match(html, /class="intelligence-table field-network" data-ui-role="core-table"/);
  assert.match(html, /id="networkWires"/);
  assert.match(html, /class="support-console"/);
  assert.match(html, /data-ui-role="rules-entry"/);
  assert.match(html, /data-ui-role="game-log"/);
  assert.match(html, /data-ui-role="spectators"/);
  assert.ok(html.indexOf('data-ui-role="game-log"') < html.indexOf('id="spectatorPanel"'));

  const locationsAt = html.indexOf('class="location-vault"');
  const tableAt = html.indexOf('id="intelligenceTable"');
  const dockAt = html.indexOf('id="controlDock"');
  const supportAt = html.indexOf('class="support-console"');
  assert.ok(locationsAt >= 0 && tableAt > locationsAt && dockAt > tableAt && supportAt > dockAt);

  assert.match(script, /const NODE_COORDS = Object\.freeze/);
  assert.match(script, /import \{ compassSeatSlots \}/);
  assert.match(script, /class="network-wire/);
  assert.match(script, /seat\.dataset\.nodeIndex = String\(index\)/);
  assert.match(script, /setAttribute\("data-target-id", item\.id\)/);
  assert.match(script, /type: "spyGuess"/);
  assert.match(script, /type: "voteAccusation"/);
  assert.match(script, /createPresentationTimeline/);
  assert.match(script, /presentation\?\.sync\(nextView\.presentationEvents\)/);
  assert.match(script, /sceneKey: \(event\) => event\.sceneId \|\| event\.id/);
  assert.match(script, /catchUpThreshold: 2/);
  assert.match(script, /severeBacklogThreshold: 5/);
  assert.match(script, /urgentPriority: 4/);
  assert.match(script, /captureLocalInteraction\(\);[\s\S]*?reconcileLocalInteraction\(nextView\);[\s\S]*?view = nextView/);
  assert.match(script, /data-local-draft=["']spy-location["']/);
  assert.match(script, /select\.value = spyLocationDraft/);
  assert.match(script, /nextView\.phase === "accusationVote"/);
  assert.match(script, /contextChanged \|\| \["lobby", "secretReveal", "roundEnd"\]\.includes\(nextView\.phase\)/);
  assert.doesNotMatch(script, /https?:\/\//);

  assert.match(css, /\.operation-grid \{ display: grid; grid-template-columns: 236px/);
  assert.match(css, /\.network-wire\.active/);
  assert.match(css, /player-seat\[data-node-slot="south"\]/);
  assert.doesNotMatch(css, /left: var\(--node-x\)|top: var\(--node-y\)/);
  assert.doesNotMatch(script, /seat\.className\s*=/);
  assert.match(css, /\.control-dock \{ position: sticky/);
  assert.match(css, /\.control-dock\[data-role="spectator"\] \{ position: relative/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.network-wires \{ display: none/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.players \{ position: static; order: 2; display: grid/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.players \{ grid-template-columns: 1fr/);

  const elementBlock = script.match(/const E = Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1];
  for (const [, id] of elementBlock.matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `缺少 #${id}`);
  }
});

test("创建与加入页使用伦敦雨夜接头外壳并保留共享入场契约", () => {
  const html = read("index.html"), css = read("styles.css");
  assert.match(html, /id="setupPanel" class="setup-wrap" data-room-entry data-entry-layout="split"/);
  assert.match(html, /class="entry-story" data-entry-story/);
  assert.match(html, /class="entry-access panel" data-entry-access/);
  assert.match(html, /data-entry-modes/);
  assert.match(html, /data-entry-form="host"/);
  assert.match(html, /data-entry-form="guest"/);
  assert.match(html, /A RENDEZVOUS IN THE RAIN/);
  assert.match(html, /所有人都知道目的地/);
  assert.match(html, /接收身份/);
  assert.match(html, /相互试探/);
  assert.match(html, /做出指认/);
  assert.match(css, /url\("assets\/london-rendezvous-entry-v1\.png"\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.setup-wrap \{ min-height: auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.setup-wrap::before/);
  assert.equal(fs.existsSync(path.join(__dirname, "assets", "london-rendezvous-entry-v1.png")), true);
});

test("页面原生接入旁观系统并仅向正式玩家显示秘密档案", () => {
  const html = read("index.html"), script = read("app.js");
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="spectatorPanel"/);
  assert.match(script, /createSpectatorUi\(\{/);
  assert.match(script, /memberRole === "player" && view\.phase !== "lobby"/);
});

test("权威视图按情报网络职责分区并冻结中断阶段的本地目标", () => {
  const script = read("app.js"), partitions = read("render-partitions.mjs");
  assert.match(script, /createGame21PartitionRenderer, createGame21RenderModel/);
  assert.match(script, /partitionRenderer = createGame21PartitionRenderer\(\{/);
  assert.match(script, /network: renderNetworkWires/);
  assert.match(script, /players: renderPlayers/);
  assert.match(script, /secret: \(model\) => renderSecret\(model\.memberRole\)/);
  assert.match(script, /decision: \(model\) => renderActions\(model\.memberRole\)/);
  assert.match(script, /locations: renderLocations/);
  assert.match(script, /scoreboard: renderScoreboard/);
  assert.match(script, /querySelectorAll\(":scope > \[data-player-id\]"\)/);
  assert.match(script, /!selectionStillLegal\(view\)/);
  assert.match(script, /selectionMode = selectionMode === kind \? null : kind;\s*render\(\)/);
  assert.match(partitions, /"room","status","network","players","focus","secret","decision","locations","scoreboard","log","countdown"/);
});

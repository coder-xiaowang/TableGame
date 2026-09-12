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

  assert.match(script, /const NODE_LAYOUTS = Object\.freeze/);
  assert.match(script, /class="network-wire/);
  assert.match(script, /data-node-index=/);
  assert.match(script, /data-target-id=/);
  assert.match(script, /type: "spyGuess"/);
  assert.match(script, /type: "voteAccusation"/);
  assert.match(script, /createPresentationTimeline/);
  assert.match(script, /presentation\?\.sync\(nextView\.presentationEvents\)/);
  assert.match(script, /sceneKey: \(event\) => event\.sceneId \|\| event\.id/);
  assert.match(script, /catchUpThreshold: 2/);
  assert.match(script, /severeBacklogThreshold: 5/);
  assert.match(script, /urgentPriority: 4/);
  assert.doesNotMatch(script, /https?:\/\//);

  assert.match(css, /\.operation-grid \{ display: grid; grid-template-columns: 236px/);
  assert.match(css, /\.network-wire\.active/);
  assert.match(css, /\.player-seat \{ position: absolute; left: var\(--node-x\); top: var\(--node-y\)/);
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

test("页面原生接入旁观系统并仅向正式玩家显示秘密档案", () => {
  const html = read("index.html"), script = read("app.js");
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="spectatorPanel"/);
  assert.match(script, /createSpectatorUi\(\{/);
  assert.match(script, /memberRole === "player" && view\.phase !== "lobby"/);
});

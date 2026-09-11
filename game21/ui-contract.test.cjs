"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

test("页面遵守最新紧凑标题、折叠侧栏、独立桌面和合并吸附操作坞规范", () => {
  const html = read("index.html"), script = read("app.js"), css = read("styles.css");
  const headerEnd = html.indexOf("</header>");
  assert.ok(html.indexOf('id="roomHeaderTools"') > 0 && html.indexOf('id="roomHeaderTools"') < headerEnd);
  assert.match(html, /<details class="panel rule-card">/);
  assert.doesNotMatch(html, /<details class="panel rule-card"[^>]* open/);
  assert.ok(html.indexOf('class="panel log-card"') < html.indexOf('id="spectatorPanel"'));
  const tableAt = html.indexOf('class="intelligence-table"');
  const focusEnd = html.indexOf("</section>", html.indexOf('class="public-focus"'));
  const tableEnd = html.indexOf("</section>", focusEnd + 1);
  const dockAt = html.indexOf('id="controlDock"'), privateAt = html.indexOf('id="secretPanel"');
  assert.ok(tableAt >= 0 && tableEnd > tableAt && dockAt > tableEnd);
  assert.ok(privateAt > dockAt);
  assert.match(script, /data-target-id=/);
  assert.match(script, /type: "spyGuess"/);
  assert.match(script, /type: "voteAccusation"/);
  assert.match(script, /createPresentationTimeline/);
  assert.match(script, /presentation\?\.sync\(nextView\.presentationEvents\)/);
  assert.match(html, /id="presentationTrail"/);
  assert.match(html, /id="presentationAnnouncement"/);
  assert.match(css, /\.presentation-token/);
  assert.match(css, /\.player-seat\.accused/);
  assert.doesNotMatch(script, /https?:\/\//);
  assert.match(css, /\.control-dock\{position:sticky/);
  assert.match(css, /\.control-dock\[data-role="spectator"\]\{position:relative/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*?\.game-area\{order:1\}[\s\S]*?\.sidebar\{order:2/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*?\.players\{grid-template-columns:1fr\}/);

  const elementBlock = script.match(/const E = Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1];
  for (const [, id] of elementBlock.matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)) assert.match(html, new RegExp(`id=["']${id}["']`), `缺少 #${id}`);
});

test("页面原生接入旁观系统并仅向正式玩家显示秘密档案", () => {
  const html = read("index.html"), script = read("app.js");
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="spectatorPanel"/);
  assert.match(script, /createSpectatorUi\(\{/);
  assert.match(script, /memberRole === "player" && view\.phase !== "lobby"/);
});

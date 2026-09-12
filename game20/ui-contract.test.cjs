"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

test("局内人使用独立问答沙龙外壳，同时保留完整信息责任", () => {
  const html = read("index.html"), script = read("app.js"), css = read("styles.css");
  const headerEnd = html.indexOf("</header>");
  assert.ok(html.indexOf('id="roomHeaderTools"') > 0 && html.indexOf('id="roomHeaderTools"') < headerEnd);
  assert.match(html, /data-theme="insider-question-salon"/);
  assert.match(html, /class="discussion-table question-salon" data-ui-role="core-table"/);
  assert.match(html, /class="sidebar salon-archive"/);
  assert.match(html, /<details class="panel rule-card" data-ui-role="rules-entry">/);
  assert.doesNotMatch(html, /<details class="panel rule-card"[^>]* open/);
  assert.ok(html.indexOf('data-ui-role="game-log"') < html.indexOf('id="spectatorPanel"'));

  const tableAt = html.indexOf('class="discussion-table');
  const dockAt = html.indexOf('id="controlDock"'), privateAt = html.indexOf('id="secretPanel"');
  const archiveAt = html.indexOf('class="sidebar salon-archive"');
  assert.ok(tableAt >= 0 && dockAt > tableAt && archiveAt > dockAt, "问答钟盘、发言卡和档案带应形成独立纵向层级");
  assert.ok(privateAt > dockAt, "私人身份和当前决策必须合并在同一个操作区");
  assert.match(html, /id="answerEchoes"/);

  assert.match(script, /data-target-id=/);
  assert.match(script, /data-player-anchor=/);
  assert.match(script, /Math\.cos\(radians\)/);
  assert.match(script, /view\.answerHistory/);
  assert.match(script, /type: "markCorrectGuesser"/);
  assert.match(script, /type: "submitSecondVote"/);
  assert.doesNotMatch(script, /https?:\/\//);

  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\.players \{ position: static; order: 2; display: grid/);
  assert.match(css, /\.control-dock \{ position: sticky/);
  assert.match(css, /\.control-dock\[data-role="spectator"\] \{ position: relative/);
  assert.match(css, /\.salon-archive \{ display: grid; grid-template-columns:/);
  assert.match(css, /\.public-focus[\s\S]*?border-radius: 50%/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.players \{ grid-template-columns: 1fr/);

  const elementBlock = script.match(/const E = Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1];
  for (const [, id] of elementBlock.matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `app.js引用的 #${id} 必须存在于页面`);
  }
});

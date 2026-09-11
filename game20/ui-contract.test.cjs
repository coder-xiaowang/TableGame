"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

test("页面遵守紧凑标题、折叠侧栏、独立桌面与合并吸附决策规范", () => {
  const html = read("index.html"), script = read("app.js"), css = read("styles.css");
  const headerEnd = html.indexOf("</header>");
  assert.ok(html.indexOf('id="roomHeaderTools"') > 0 && html.indexOf('id="roomHeaderTools"') < headerEnd);
  assert.match(html, /<details class="panel rule-card">/);
  assert.doesNotMatch(html, /<details class="panel rule-card"[^>]* open/);
  assert.ok(html.indexOf('class="panel log-card"') < html.indexOf('id="spectatorPanel"'));
  const tableAt = html.indexOf('class="discussion-table"');
  const publicFocusEnd = html.indexOf("</section>", html.indexOf('class="public-focus"'));
  const tableEnd = html.indexOf("</section>", publicFocusEnd + 1);
  const dockAt = html.indexOf('id="controlDock"'), privateAt = html.indexOf('id="secretPanel"');
  assert.ok(tableAt >= 0 && tableEnd > tableAt && dockAt > tableEnd, "决策区应位于独立讨论桌面之后");
  assert.ok(privateAt > dockAt, "私人身份和当前决策必须合并在同一个操作区");
  assert.match(script, /data-target-id=/);
  assert.match(script, /type: "markCorrectGuesser"/);
  assert.match(script, /type: "submitSecondVote"/);
  assert.doesNotMatch(script, /https?:\/\//);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /\.players\{position:static;display:grid/);
  assert.match(css, /\.control-dock\{position:sticky/);
  assert.match(css, /\.control-dock\[data-role="spectator"\]\{position:relative/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*?\.game-area\{order:1\}[\s\S]*?\.sidebar\{order:2/);

  const elementBlock = script.match(/const E = Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1];
  for (const [, id] of elementBlock.matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `app.js引用的 #${id} 必须存在于页面`);
  }
});

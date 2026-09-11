"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面遵守统一标题、侧栏、独立桌面、合并操作区与手机优先级规范", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.ok(html.indexOf('id="roomHeaderTools"') < html.indexOf("</header>"));
  assert.match(html, /<details class="panel rule-card">/); assert.doesNotMatch(html, /<details class="panel rule-card" open>/);
  assert.ok(html.indexOf('class="panel log-card"') < html.indexOf('id="spectatorPanel"'));
  const tableAt = html.indexOf('class="western-table"'), tableEnd = html.indexOf("</section>", tableAt), dockAt = html.indexOf('id="controlDock"'), privateAt = html.indexOf('id="privateZone"');
  assert.ok(tableAt >= 0 && tableEnd > tableAt && dockAt > tableEnd, "操作区应位于独立主桌面之后");
  assert.ok(privateAt > dockAt, "行动和私人手牌必须合并在同一个操作区");
  assert.match(html, /<h3>距离、武器与装备<\/h3>/);
  assert.match(html, /<h3>濒死、出局与奖励<\/h3>/);
  assert.match(html, /name="joinIntent" value="spectate"/); assert.match(script, /createSpectatorUi/);
  assert.doesNotMatch(script, /https?:\/\//); assert.match(script, /escapeHtml/);
  assert.match(script, /data-side="\$\{side\}"/);
  assert.match(script, /createPresentationTimeline/);
  assert.match(script, /presentation\?\.sync\(next\.presentationEvents\)/);
  assert.match(html, /id="presentationTrail"/);
  assert.match(html, /id="presentationAnnouncement"/);
  assert.match(styles, /\.presentation-token/);
  assert.match(styles, /\.player-seat\.responding/);
  assert.match(script, /E\.controlDock\.dataset\.role=role/);
  assert.match(styles, /@media\(max-width:850px\)[\s\S]*?\.game-area\{order:1\}[\s\S]*?\.sidebar\{order:2/);
  assert.match(styles, /\.control-dock\{position:sticky/);
  assert.match(styles, /\.private-zone\{position:static/);
  assert.match(styles, /\.control-dock\[data-role="spectator"\]\{position:relative/);
});

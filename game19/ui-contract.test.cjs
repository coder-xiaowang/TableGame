"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面遵守标题设置、折叠规则、记录优先、桌内行动区与手机列表规范", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.ok(html.indexOf('id="roomHeaderTools"') < html.indexOf("</header>"));
  assert.match(html, /<details class="panel rule-card">/); assert.doesNotMatch(html, /<details class="panel rule-card" open>/);
  assert.ok(html.indexOf('class="panel log-card"') < html.indexOf('id="spectatorPanel"'));
  assert.ok(html.indexOf('id="controlDock"') > html.indexOf('class="western-table"'));
  assert.match(html, /name="joinIntent" value="spectate"/); assert.match(script, /createSpectatorUi/);
  assert.doesNotMatch(script, /https?:\/\//); assert.match(script, /escapeHtml/);
  assert.match(styles, /@media\(max-width:850px\)/); assert.match(styles, /\.player-seat,.player-seat:nth-child\(n\)\{position:relative/);
  assert.match(styles, /\.control-dock\{position:sticky/); assert.match(styles, /\.private-zone\{position:sticky/);
});

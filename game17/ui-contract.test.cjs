"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面包含旁观、行情、私人区和移动端吸附操作结构", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const heroEnd = html.indexOf("</header>");
  const roomToolsAt = html.indexOf('id="roomHeaderTools"');
  const logAt = html.indexOf('class="panel log-card"');
  const spectatorAt = html.indexOf('id="spectatorPanel"');
  assert.match(html, /name="joinIntent" value="spectate"/); assert.doesNotMatch(html, /id="roomRoleBanner"/); assert.match(html, /id="spectatorList"/);
  assert.ok(roomToolsAt >= 0 && roomToolsAt < heroEnd, "房间管理必须位于标题栏内");
  assert.match(html, /<details class="panel rules-card">/); assert.doesNotMatch(html, /<details class="panel rules-card" open>/);
  assert.ok(logAt >= 0 && spectatorAt > logAt, "旁观席必须位于交易记录之后");
  assert.match(html, /id="stockTicker"/); assert.match(html, /id="stockpiles"/); assert.match(html, /id="privateZone"/); assert.match(html, /id="controlDock"/);
  assert.match(script, /createSpectatorUi/); assert.match(script, /setHidden\(E\.privateZone, memberRole === "spectator"\)/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(styles, /\.control-dock \{ position: sticky/); assert.match(styles, /control-dock\[data-role="spectator"\]/); assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(max-width: 760px\)/); assert.match(styles, /@media \(max-width: 520px\)/); assert.match(styles, /stockpiles \{ grid-template-columns: minmax\(0,1fr\)/);
  assert.doesNotMatch(styles, /sidebar \.rules-card[^}]*display:\s*none/); assert.doesNotMatch(styles, /sidebar \.log-card[^}]*display:\s*none/);
});

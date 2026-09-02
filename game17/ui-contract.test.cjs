"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面包含旁观、行情、私人区和移动端吸附操作结构", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(html, /name="joinIntent" value="spectate"/); assert.match(html, /id="roomRoleBanner"/); assert.match(html, /id="spectatorList"/);
  assert.match(html, /id="stockTicker"/); assert.match(html, /id="stockpiles"/); assert.match(html, /id="privateZone"/); assert.match(html, /id="controlDock"/);
  assert.match(script, /createSpectatorUi/); assert.match(script, /setHidden\(E\.privateZone, memberRole === "spectator"\)/);
  assert.match(styles, /\.control-dock \{ position: sticky/); assert.match(styles, /control-dock\[data-role="spectator"\]/); assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(max-width: 760px\)/); assert.match(styles, /@media \(max-width: 520px\)/); assert.match(styles, /stockpiles \{ grid-template-columns: minmax\(0,1fr\)/);
});

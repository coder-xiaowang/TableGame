"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面接入共享旁观系统、私人区域和移动端吸附操作栏", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="roomRoleBanner"/); assert.match(html, /id="spectatorList"/); assert.match(html, /id="privateZone"/);
  assert.match(script, /createSpectatorUi/); assert.match(script, /setHidden\(E\.privateZone, memberRole === "spectator"\)/);
  assert.match(styles, /\.control-dock \{ position: sticky/); assert.match(styles, /control-dock\[data-role="spectator"\]/);
  for (const count of [3, 4, 5]) assert.match(styles, new RegExp(`players\\[data-count="${count}"\\]`));
});

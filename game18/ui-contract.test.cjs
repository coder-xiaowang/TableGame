"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面满足圆桌中央行动区、旁观与移动端紧凑列表契约", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const boardStart = html.indexOf('<section class="case-board">');
  const boardEnd = html.indexOf("</section>", html.indexOf('id="controlDock"'));
  const dockAt = html.indexOf('id="controlDock"');
  const heroEnd = html.indexOf("</header>");
  const roomToolsAt = html.indexOf('id="roomHeaderTools"');
  const logAt = html.indexOf('class="panel log-card"');
  const spectatorAt = html.indexOf('id="spectatorPanel"');

  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.doesNotMatch(html, /id="roomRoleBanner"/);
  assert.match(html, /id="spectatorList"/);
  assert.ok(roomToolsAt >= 0 && roomToolsAt < heroEnd, "房间设置必须合并进标题区域");
  assert.match(html, /<details class="panel rule-card">/);
  assert.doesNotMatch(html, /<details class="panel rule-card" open>/);
  assert.ok(logAt >= 0 && spectatorAt > logAt, "旁观席必须位于调查记录之后");
  assert.ok(boardStart >= 0 && dockAt > boardStart && dockAt < boardEnd, "当前行动模块必须位于圆桌内部");
  assert.match(html, /id="privateZone" class="panel hand-dock"/);
  assert.match(script, /createSpectatorUi/);
  assert.match(script, /setHidden\(E\.privateZone, memberRole === "spectator"\)/);
  assert.match(script, /if \(!self\?\.connected\) return;/);
  assert.match(script, /if \(view\.targetScore !== targetScore\) submit\(\{ type: "setTargetScore", targetScore \}\);/);
  assert.match(styles, /\.center-action\s*\{[\s\S]*?position: absolute;[\s\S]*?top: 50%;[\s\S]*?left: 50%/);
  assert.match(styles, /\.hand-dock\s*\{ position: sticky;/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.player-seat \{ position: static;[\s\S]*?transform: none;/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});

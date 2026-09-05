"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面接入共享旁观系统、私人区域和移动端吸附操作栏", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const heroEnd = html.indexOf("</header>");
  const roomToolsAt = html.indexOf('id="roomHeaderTools"');
  const logAt = html.indexOf('class="panel log-card"');
  const spectatorAt = html.indexOf('id="spectatorPanel"');
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="courtEffects"/); assert.match(html, /id="momentAnnouncement"/); assert.match(html, /id="momentTrail"/);
  assert.doesNotMatch(html, /id="roomRoleBanner"/); assert.match(html, /id="spectatorList"/); assert.match(html, /id="privateZone"/);
  assert.ok(roomToolsAt >= 0 && roomToolsAt < heroEnd, "房间管理必须位于标题栏内");
  assert.match(html, /<details class="panel rule-card">/); assert.doesNotMatch(html, /<details class="panel rule-card" open>/);
  assert.ok(logAt >= 0 && spectatorAt > logAt, "旁观席必须位于宫廷记录之后");
  assert.match(script, /createSpectatorUi/); assert.match(script, /setHidden\(E\.privateZone, memberRole === "spectator"\)/);
  assert.match(script, /reactionId: view\.reaction\?\.id/); assert.match(script, /expectedVersion: renderedVersion/);
  assert.match(script, /function syncMoments/); assert.match(script, /data-influence-slot/); assert.match(script, /moment\.actorId === view\.selfId/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(styles, /\.control-dock \{ position: sticky/); assert.match(styles, /control-dock\[data-role="spectator"\]/);
  assert.match(styles, /@media \(min-width: 761px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /players\[data-count\] > \.player-seat:nth-child\(n\)/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.moment-announcement/); assert.match(styles, /\.influence-card\.claim-pulse/); assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(styles, /sidebar \.rule-card[^}]*display:\s*none/); assert.doesNotMatch(styles, /sidebar \.log-card[^}]*display:\s*none/);
  for (const count of [3, 4, 5]) assert.match(styles, new RegExp(`players\\[data-count="${count}"\\]`));
});

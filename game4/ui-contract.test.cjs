"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");

test("德州扑克页面使用共享权威客户端、旁观系统和房间入口契约", () => {
  const html = read("index.html");
  const script = read("app.js");
  assert.match(html, /\/shared\/styles\/spectator\.css/);
  assert.match(html, /data-room-entry/);
  assert.match(html, /data-entry-modes/);
  assert.match(html, /data-entry-form="host"/);
  assert.match(html, /data-entry-form="guest"/);
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="spectatorPanel"/);
  assert.match(html, /type="module" src="app\.js"/);
  assert.match(script, /createAuthoritativeRoomClient/);
  assert.match(script, /createRoomEntryController/);
  assert.match(script, /createSpectatorUi/);
  assert.match(script, /roomEntry\.bind\(\)/);
  assert.match(script, /spectatorUi\.bind\(\)/);
  assert.match(script, /spectatorUi\.applyConfig\(await room\.checkServer\(\)\)/);
  assert.match(script, /room\.submitAction/);
  assert.doesNotMatch(script, /function startHand/);
  assert.doesNotMatch(script, /function showdown/);
  assert.doesNotMatch(script, /Math\.random/);
});

test("无关广播不会重建正在输入加注金额的决策区", () => {
  const script = read("app.js");
  assert.match(script, /let decisionKey = ""/);
  assert.match(script, /if \(nextKey === decisionKey\)/);
  assert.match(script, /raiseDraft\?\.key === nextKey/);
  assert.doesNotMatch(script, /deadline: view\.deadline/);
});

test("牌桌采用本地矩形四边槽位排座并提供权威摊牌演出", () => {
  const html = read("index.html");
  const script = read("app.js");
  const css = read("layout.css");
  const seatLayout = read("seat-layout.mjs");
  assert.match(html, /id="seatBoundary"/);
  assert.match(html, /class="hand-rank-guide"/);
  assert.match(html, /id="showdownOverlay"/);
  assert.match(html, /class="action-panel table-action-dock"/);
  assert.match(script, /function playersFromViewerSeat/);
  assert.match(seatLayout, /function distributeEdgeCounts/);
  assert.match(seatLayout, /top: base \+ \(remainder >= 1/);
  assert.match(seatLayout, /left: base \+ \(remainder >= 2/);
  assert.match(script, /import \{ edgeSeatSlots \} from "\.\/seat-layout\.mjs"/);
  assert.match(script, /--seat-x/);
  assert.match(script, /new ResizeObserver\(scheduleSeatLayout\)/);
  assert.match(script, /renderShowdown\(\)/);
  assert.match(css, /\.seat-boundary/);
  assert.match(css, /\.showdown-winner/);
  assert.match(css, /\.table-action-dock/);
  assert.match(css, /border-radius: 0/);
  assert.match(css, /grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(script, /Math\.cos|Math\.sin/);
  assert.doesNotMatch(script, /shared.*round|create.*RoundTable/i);
});

test("权威服务使用独立SQLite和8790默认端口", () => {
  const server = read("signal-server.js");
  assert.match(server, /GAME4_DB_PATH/);
  assert.match(server, /createSqliteRoomStore/);
  assert.match(server, /defaultPort: 8790/);
  assert.match(server, /startAuthoritativeGameServer/);
});

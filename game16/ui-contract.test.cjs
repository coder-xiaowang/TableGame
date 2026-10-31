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
  assert.match(html, /id="seatBoundary"[\s\S]*id="players"/);
  for (const rail of ["galleryRail", "leftCourtRail", "rightCourtRail", "throneRail"]) assert.match(html, new RegExp(`id="${rail}"`));
  assert.doesNotMatch(html, /id="roomRoleBanner"/); assert.match(html, /id="spectatorList"/); assert.match(html, /id="privateZone"/);
  assert.ok(roomToolsAt >= 0 && roomToolsAt < heroEnd, "房间管理必须位于标题栏内");
  assert.match(html, /<details class="panel rule-card">/); assert.doesNotMatch(html, /<details class="panel rule-card" open>/);
  assert.ok(logAt >= 0 && spectatorAt > logAt, "旁观席必须位于宫廷记录之后");
  assert.match(script, /createSpectatorUi/); assert.match(script, /setHidden\(E\.privateZone, memberRole === "spectator"\)/);
  assert.match(script, /reactionId: view\.reaction\?\.id/); assert.match(script, /expectedVersion: room\.snapshot\(\)\.version/);
  assert.match(script, /createPresentationTimeline/); assert.match(script, /presentation\.sync\(view\.moments\)/); assert.match(script, /data-influence-slot/); assert.match(script, /moment\.actorId === view\.selfId/);
  assert.match(script, /import \{ courtSeatSlots \}/);
  assert.match(script, /function playersFromViewerSeat\(\)/); assert.match(script, /function playerNameLabel\(/);
  assert.match(script, /const hasSelfSeat = orderedPlayers\.some\(\(player\) => player\.id === view\.selfId\)/);
  assert.match(script, /const slots = courtSeatSlots\(orderedPlayers\.length, hasSelfSeat\)/); assert.match(script, /rail\.insertBefore\(element, expected \|\| null\)/);
  assert.match(script, /classList\.toggle\("current"/); assert.match(script, /class="seat-admin-proxy"/);
  assert.doesNotMatch(script, /function ellipseAngles\(/); assert.doesNotMatch(script, /function seatsOverlap\(/);
  assert.doesNotMatch(script, /ResizeObserver/); assert.doesNotMatch(script, /--seat-[xy]/);
  assert.doesNotMatch(script, /element\.className\s*=/);
  assert.match(script, /sceneKey: \(moment\) => moment\.sceneId \|\| moment\.id/);
  assert.match(script, /catchUpThreshold: 2/); assert.match(script, /severeBacklogThreshold: 4/);
  assert.match(script, /urgentPriority: 4/); assert.match(script, /retainPriority: 4/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(styles, /\.control-dock \{ position: sticky/); assert.match(styles, /control-dock\[data-role="spectator"\]/);
  assert.match(styles, /@media \(min-width: 761px\)/);
  assert.match(styles, /\.seat-boundary \{ position: absolute/);
  assert.match(styles, /--court-seat-width/); assert.match(styles, /--court-seat-height/);
  assert.match(styles, /\.gallery-rail \{/); assert.match(styles, /\.left-court-rail \{/);
  assert.match(styles, /\.right-court-rail \{/); assert.match(styles, /\.throne-rail \{/);
  assert.match(styles, /\.seat-admin-proxy\.shared-player-admin-trigger/);
  assert.doesNotMatch(styles, /left: var\(--seat-x\)/); assert.doesNotMatch(styles, /top: var\(--seat-y\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /\.court-rail \{ display: contents; \}/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.moment-announcement/); assert.match(styles, /\.influence-card\.claim-pulse/); assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(styles, /sidebar \.rule-card[^}]*display:\s*none/); assert.doesNotMatch(styles, /sidebar \.log-card[^}]*display:\s*none/);
});

test("普通权威广播不会清空仍合法的行动与换牌选择", () => {
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(script, /onView\(nextView\) \{ actionPending = false; view = nextView; reconcileLocalSelection\(\);/);
  assert.match(script, /function selectedActionStillLegal\(current = view\)/);
  assert.match(script, /current\?\.permissions\?\.canDeclareAction/);
  assert.match(script, /function exchangeContextKey\(current = view\)/);
  assert.match(script, /if \(exchangeDraftKey !== nextKey\)/);
  assert.match(script, /exchangeSelection = new Set\(\[\.\.\.exchangeSelection\]\.filter/);
  assert.doesNotMatch(script, /view = nextView; selectedAction = null; exchangeSelection = new Set/);
});

test("宫廷入场外壳与角色画像保持主题完整且不泄露隐藏身份", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(html, /data-entry-story/);
  assert.match(html, /data-entry-access/);
  assert.match(html, /王座属于最后仍握有/);
  assert.match(styles, /assets\/court-conspiracy-entry-v1\.png/);
  assert.match(styles, /\.role-art img/);
  assert.match(styles, /\.hidden-role \.role-icon \{ display: none/);
  for (const role of ["duke", "assassin", "captain", "ambassador", "contessa"]) {
    assert.match(script, new RegExp(`assets/roles/${role}-v1\\.png`));
    assert.ok(fs.existsSync(path.join(__dirname, "assets", "roles", `${role}-v1.png`)), `${role} portrait exists`);
  }
  assert.ok(fs.existsSync(path.join(__dirname, "assets", "court-conspiracy-entry-v1.png")), "entry background exists");
  assert.match(script, /const portrait = known\s*\? `<span class="role-art"/);
  assert.match(script, /: `<span class="role-back-mark"/);
});

test("政变权威视图按宫廷席位、私人身份、响应窗口和倒计时分区更新", () => {
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const partitions = fs.readFileSync(path.join(__dirname, "render-partitions.mjs"), "utf8");
  assert.match(script, /createGame16PartitionRenderer/);
  assert.match(script, /createGame16RenderModel/);
  assert.match(script, /room: renderRoom, status: renderStatus, deck: renderDeck, players: renderPlayers/);
  assert.match(script, /private: \(model\) => renderPrivate\(model\.memberRole\), decision: renderDecision/);
  assert.match(script, /existing = new Map\(\[\.\.\.E\.players\.querySelectorAll/);
  assert.match(script, /spectatorUi\.render\(view\)/);
  assert.match(partitions, /"room","status","deck","players","private","decision","log","countdown"/);
});

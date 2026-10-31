"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面遵守统一标题、侧栏、独立桌面、合并操作区与手机优先级规范", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const seatStyles = fs.readFileSync(path.join(__dirname, "seat-layout.css"), "utf8");
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
  assert.match(script, /setAttribute\("data-side",side\)/);
  assert.match(script, /import \{ sideColumnSlots \}/);
  assert.match(html, /id="leftPlayerRail"/); assert.match(html, /id="rightPlayerRail"/);
  assert.match(seatStyles, /Stable saloon seating/);
  assert.doesNotMatch(script, /--seat-y|seat\.className\s*=/);
  assert.match(script, /createPresentationTimeline/);
  assert.match(script, /presentation\?\.sync\(next\.presentationEvents\)/);
  assert.match(script, /sceneKey:\(event\)=>event\.sceneId\|\|event\.id/);
  assert.match(script, /catchUpThreshold:2/);
  assert.match(script, /severeBacklogThreshold:5/);
  assert.match(script, /urgentPriority:4/);
  assert.match(html, /id="presentationTrail"/);
  assert.match(html, /id="presentationAnnouncement"/);
  assert.match(styles, /\.presentation-token/);
  assert.match(styles, /\.player-seat\.responding/);
  assert.match(script, /E\.controlDock\.dataset\.role=model\.memberRole/);
  assert.match(styles, /@media\(max-width:850px\)[\s\S]*?\.game-area\{order:1\}[\s\S]*?\.sidebar\{order:2/);
  assert.match(styles, /\.control-dock\{position:sticky/);
  assert.match(styles, /\.private-zone\{position:static/);
  assert.match(styles, /\.control-dock\[data-role="spectator"\]\{position:relative/);
});

test("权威视图分区更新并保留合法的本地牌与目标选择", () => {
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const partitions = fs.readFileSync(path.join(__dirname, "render-partitions.mjs"), "utf8");
  assert.match(script, /createGame19PartitionRenderer, createGame19RenderModel/);
  assert.match(script, /partitionRenderer=createGame19PartitionRenderer\(\{room:renderRoom,status:renderStatus,table:renderTable,players:renderPlayers/);
  assert.match(script, /private:\(model\)=>renderHand\(model\.memberRole\),decision:\(model\)=>renderActions\(model\.memberRole\)/);
  assert.match(script, /querySelectorAll\("\[data-player-id\]"\)/);
  assert.match(script, /if\(!view\.permissions\.canPlay\|\|!selected\)\{selectedCardId=null;selectedTargetId=null;\}/);
  assert.match(script, /else if\(selectedTargetId&&!eligibleTargets\(selected\)\.some/);
  assert.match(script, /selectedCardId=button\.dataset\.card;selectedTargetId=null;render\(\)/);
  assert.match(partitions, /"room","status","table","players","private","decision","log","countdown"/);
});

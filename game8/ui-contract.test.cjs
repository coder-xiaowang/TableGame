"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

test("game8 merges room controls into the compact title bar", () => {
  const header = html.slice(html.indexOf('<header id="siteHeader"'), html.indexOf("</header>") + 9);
  assert.match(header, /id="connectionStatus"/);
  assert.match(header, /id="roomHeaderTools"/);
  assert.match(header, /id="roomCodeDisplay"/);
  assert.match(header, /id="hostTools"/);
  assert.match(header, /id="seatActionButton"/);
  assert.doesNotMatch(html, /class="panel room-card"/);
  assert.doesNotMatch(html, /room-role-banner/);
  assert.match(script, /setHidden\(E\.roomHeaderTools,false\)/);
  assert.match(script, /E\.siteHeader\.classList\.add\("in-room"\)/);
});

test("game8 keeps detailed rules folded and places spectators after the log", () => {
  const playerAt = html.indexOf('class="panel player-panel"');
  const rulesAt = html.indexOf('class="panel rules-card"');
  const logAt = html.indexOf('class="panel log-panel"');
  const spectatorsAt = html.indexOf('id="spectatorPanel"');
  assert.ok(playerAt >= 0 && playerAt < rulesAt);
  assert.ok(rulesAt < logAt && logAt < spectatorsAt);
  assert.match(html, /<details class="panel rules-card">/);
  assert.doesNotMatch(html, /<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /18 枚奖杯/);
  assert.match(html, /暗取牌堆顶的牌面只对持有者可见/);
});

test("game8 shows the play table before auxiliary panels on narrow screens", () => {
  assert.ok(html.indexOf("<aside>") < html.indexOf('class="table-area"'), "desktop DOM keeps the sidebar first");
  assert.match(styles, /@media\(max-width:1050px\)[^{]*\{[^}]*\.game\{display:flex;flex-direction:column\}/);
  assert.match(styles, /\.game>\.table-area\{order:1\}/);
  assert.match(styles, /\.game>aside\{order:2/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /\.observer-panels\{grid-template-columns:1fr\}/);
});

test("game8 preserves trainer inspection, compact collections and sticky desktop actions", () => {
  assert.match(html, /id="trainerInspector"/);
  assert.match(html, /class="owned-pokemon-list"/);
  assert.match(html, /class="reserved-pokemon-list"/);
  assert.match(script, /renderTrainerInspector/);
  assert.match(script, /secretReserveHtml/);
  assert.match(styles, /\.trainer-column\{grid-area:trainer;position:sticky/);
});

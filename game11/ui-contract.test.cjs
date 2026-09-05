"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("房间身份与房主控制并入标题，指挥条仅保留阶段和倒计时", () => {
  const html = read("index.html");
  const headerStart = html.indexOf('<header id="masthead"');
  const headerEnd = html.indexOf("</header>", headerStart);
  const roomTools = html.indexOf('id="roomHeaderTools"');
  const commandStart = html.indexOf('class="command-bar panel"');
  const commandEnd = html.indexOf("</div>", html.indexOf('id="timerWrap"', commandStart)) + 6;

  assert.ok(headerStart >= 0 && roomTools > headerStart && roomTools < headerEnd);
  assert.doesNotMatch(html, /roomRoleBanner|roomRoleTitle|roomRoleHint/);
  assert.ok(html.indexOf('id="hostTools"') > headerStart && html.indexOf('id="hostTools"') < headerEnd);
  assert.ok(html.indexOf('id="phaseBadge"') > commandStart && html.indexOf('id="phaseBadge"') < commandEnd);
  assert.ok(html.indexOf('id="timerWrap"') > commandStart && html.indexOf('id="timerWrap"') < commandEnd);
  assert.ok(html.indexOf('id="hostTools"') < commandStart);
});

test("公开推理记录优先于折叠规则和旁观席", () => {
  const html = read("index.html");
  const history = html.indexOf('id="historyList"');
  const rules = html.indexOf('class="panel rules-card"');
  const spectators = html.indexOf('id="spectatorPanel"');

  assert.ok(history < rules && rules < spectators);
  assert.match(html, /<details class="panel rules-card">/);
  assert.doesNotMatch(html, /<details class="panel rules-card"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /达到2次截获、2次误传或完成第8轮/);
  assert.match(html, /双方答案在揭晓前互相隐藏/);
  assert.match(html, /旁观者只能看到已经公开的信息/);
});

test("进入房间启用标题工具且旁观组件不再依赖身份横幅", () => {
  const script = read("app.js");

  assert.match(script, /"masthead","connectionStatus","roomHeaderTools"/);
  assert.match(script, /setHidden\(E\.roomHeaderTools, false\)/);
  assert.match(script, /E\.masthead\.classList\.add\("in-room"\)/);
  assert.doesNotMatch(script, /E\.roomRole(?:Banner|Title|Hint)/);
  assert.match(script, /seatActionButton:E\.seatActionButton/);
});

test("小屏幕压缩标题和指挥条，规则内容内部滚动", () => {
  const css = read("styles.css");

  assert.match(css, /\.masthead\.in-room\{[^}]*margin-bottom:9px/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.command-bar\{align-items:center;flex-direction:row;flex-wrap:wrap/);
  assert.match(css, /@media\(max-width:500px\)[\s\S]*?\.masthead\.in-room \.masthead-title\{display:none\}/);
  assert.match(css, /\.rule-details\{[^}]*max-height:58vh;overflow:auto/);
});

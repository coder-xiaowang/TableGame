"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("页面原生接入旁观控件并隐藏旁观者秘密身份区域", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(html, /name="joinIntent" value="spectate"/);
  assert.match(html, /id="spectatorPanel"/);
  assert.match(script, /createSpectatorUi\(\{/);
  assert.match(script, /memberRole === "player" && view\.phase !== "lobby"/);
  assert.match(script, /旁观者只能看到公开进度/);
  assert.doesNotMatch(script, /buildView|insiderId\s*===\s*view/);
});


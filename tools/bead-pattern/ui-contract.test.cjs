"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

test("拼豆工坊包含从图片生成到导出的完整操作闭环", () => {
  const html = read("index.html"), script = read("app.js");
  for (const id of [
    "imageInput", "cropCanvas", "cropZoom", "gridColumns", "gridRows", "generationProfile", "colorLimit", "generateButton",
    "editorCanvas", "paletteGrid", "undoButton", "redoButton", "materialsBody", "exportCsvButton", "exportPngButton"
  ]) assert.match(html, new RegExp(`id=["']${id}["']`), `缺少 #${id}`);
  assert.match(script, /compilePattern\(croppedImageData/);
  assert.match(script, /data-tool/);
  assert.match(script, /materialRows\(pattern\.cells/);
  assert.match(script, /canvas\.toBlob/);
  assert.match(script, /text\/csv;charset=utf-8/);
  assert.doesNotMatch(html + script, /https?:\/\//);
});

test("移动端具有独立画布移动模式和底部吸附工具区", () => {
  const html = read("index.html"), css = read("styles.css"), script = read("app.js");
  assert.match(html, /data-tool="pan" class="active"/);
  assert.match(html, /id="fitCanvasButton"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /\.tool-dock \{ position: sticky/);
  assert.match(css, /@media \(max-width: 720px\), \(pointer: coarse\)[\s\S]*?\.tool-dock \{ position: fixed/);
  assert.match(css, /\.tool-dock\.canvas-active/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.canvas-viewport \{ height: 55vh/);
  assert.match(script, /activeTool = "pan"/);
  assert.match(script, /function fitCamera\(\)/);
  assert.match(script, /camera\.x = drawing\.cameraX/);
  assert.match(script, /function beginPinchGesture\(\)/);
  assert.match(script, /pinchGesture\.startScale \* distance \/ pinchGesture\.startDistance/);
  assert.doesNotMatch(script, /canvasViewport\.scrollLeft/);
});

test("手机色盘在视口内以小色块自动换行", () => {
  const css = read("styles.css");
  assert.match(css, /\.editor-layout \{ min-width: 0/);
  assert.match(css, /\.canvas-card, \.palette-card, \.materials-card \{ min-width: 0; max-width: 100%/);
  assert.match(css, /\.palette-grid \{[\s\S]*?overflow-x: hidden/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?repeat\(auto-fill, minmax\(30px, 1fr\)\)/);
});

test("所有动态材料行均以DOM文本节点构造", () => {
  const script = read("app.js");
  assert.match(script, /code\.textContent = item\.code/);
  assert.match(script, /name\.textContent = item\.name/);
  assert.match(script, /E\.materialsBody\.replaceChildren/);
});

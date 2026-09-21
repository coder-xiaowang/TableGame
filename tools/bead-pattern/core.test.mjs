import assert from "node:assert/strict";
import test from "node:test";
import { GENERIC_PALETTE } from "./palette.js";
import { countPatternColors, materialCsv, quantizeImageData, rasterLine } from "./core.js";

test("自动配色遵守最大颜色数并保留透明格", () => {
  const imageData = {
    data: new Uint8ClampedArray([
      255, 255, 255, 255,
      225, 40, 55, 255,
      50, 120, 210, 255,
      0, 0, 0, 0
    ])
  };
  const result = quantizeImageData(imageData, GENERIC_PALETTE, 2);
  assert.equal(result.cells.length, 4);
  assert.equal(result.cells[3], -1);
  assert.ok(countPatternColors(result.cells).size <= 2);
  assert.ok(result.cells.slice(0, 3).every((cell) => cell >= 0 && cell < GENERIC_PALETTE.length));
});

test("连续绘制会覆盖起点到终点之间的所有网格", () => {
  assert.deepEqual(rasterLine(0, 0, 4, 2), [[0, 0], [1, 1], [2, 1], [3, 2], [4, 2]]);
  assert.deepEqual(rasterLine(2, 3, 2, 0), [[2, 3], [2, 2], [2, 1], [2, 0]]);
});

test("材料清单统计尺寸、色号和总用量", () => {
  const csv = materialCsv([0, 0, 5, -1], GENERIC_PALETTE, 2, 2);
  assert.match(csv, /拼豆图纸尺寸","2 × 2/);
  assert.match(csv, /拼豆总数","3颗/);
  assert.match(csv, /N01/);
  assert.match(csv, /N06/);
});

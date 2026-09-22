import assert from "node:assert/strict";
import test from "node:test";
import { GENERIC_PALETTE } from "./palette.js";
import { ENGINE_VERSION, analyzePixelArtImage, bilateralFilterImageData, cleanupSmallRegions, compilePattern, countPatternColors, downsampleImageData, materialCsv, patternFingerprint, quantizeImageData, rasterLine, regularizePattern } from "./core.js";

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

test("高分辨率输入会稳定采样到目标拼豆网格", () => {
  const image = { width: 4, height: 2, data: new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255
  ]) };
  const sampled = downsampleImageData(image, 2, 1, "average");
  assert.deepEqual([sampled.width, sampled.height], [2, 1]);
  assert.deepEqual([...sampled.data], [255, 0, 0, 255, 0, 0, 255, 255]);
});

test("区域采样不会把少量非透明像素扩张成整颗拼豆", () => {
  const sampled = downsampleImageData({ width: 2, height: 2, data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0
  ]) }, 1, 1, "average");
  assert.equal(sampled.data[3], 64);
});

test("碎点整理只替换不超过阈值的孤立区域", () => {
  assert.deepEqual(cleanupSmallRegions([
    0, 0, 0,
    0, 1, 0,
    0, 0, 2
  ], 3, 3, 1), [
    0, 0, 0,
    0, 0, 0,
    0, 0, 0
  ]);
});

test("确定性编译管线遵守模式与颜色上限", () => {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = (index * 17) % 256;
    data[index + 1] = (index * 31) % 256;
    data[index + 2] = (index * 47) % 256;
    data[index + 3] = 255;
  }
  const result = compilePattern({ width: 8, height: 8, data }, GENERIC_PALETTE, {
    width: 4, height: 4, maximumColors: 10, profile: "easy"
  });
  assert.equal(result.cells.length, 16);
  assert.equal(result.profile, "easy");
  assert.ok(result.metrics.colors <= result.effectiveColors);
  assert.equal(result.metrics.filled, 16);
});

function syntheticImage(width, height, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    const pixel = index / 4;
    data[index] = pixel * 17 % 256;
    data[index + 1] = pixel * 31 % 256;
    data[index + 2] = pixel * 47 % 256;
    data[index + 3] = alpha;
  }
  return { width, height, data };
}

test("相同输入与设置产生完全相同的图纸指纹", () => {
  const image = syntheticImage(32, 32);
  const options = { width: 8, height: 8, maximumColors: 12, profile: "balanced" };
  const first = compilePattern(image, GENERIC_PALETTE, options);
  const second = compilePattern(image, GENERIC_PALETTE, options);
  assert.deepEqual(first.cells, second.cells);
  assert.equal(patternFingerprint(first.cells), patternFingerprint(second.cells));
  assert.equal(first.engineVersion, ENGINE_VERSION);
});

test("省豆模式不会比细腻模式使用更多颜色或孤立豆", () => {
  const image = syntheticImage(48, 48);
  const easy = compilePattern(image, GENERIC_PALETTE, { width: 12, height: 12, maximumColors: 20, profile: "easy" });
  const detailed = compilePattern(image, GENERIC_PALETTE, { width: 12, height: 12, maximumColors: 20, profile: "detailed" });
  assert.ok(easy.metrics.colors <= detailed.metrics.colors);
  assert.ok(easy.metrics.isolated <= detailed.metrics.isolated);
});

test("透明图、纯色图和非正方形图均能正常生成", () => {
  const transparent = compilePattern(syntheticImage(16, 12, 0), GENERIC_PALETTE, { width: 8, height: 6 });
  assert.ok(transparent.cells.every((cell) => cell === -1));
  const solidData = new Uint8ClampedArray(20 * 12 * 4);
  for (let index = 0; index < solidData.length; index += 4) solidData.set([230, 40, 50, 255], index);
  const solid = compilePattern({ width: 20, height: 12, data: solidData }, GENERIC_PALETTE, { width: 10, height: 6, maximumColors: 16 });
  assert.equal(solid.cells.length, 60);
  assert.equal(solid.metrics.colors, 1);
  assert.equal(solid.width / solid.height, 10 / 6);
});

test("输出格子始终对应透明格或有效色卡", () => {
  const result = compilePattern(syntheticImage(80, 48), GENERIC_PALETTE, { width: 20, height: 12, maximumColors: 16 });
  assert.ok(result.cells.every((cell) => cell === -1 || (cell >= 0 && cell < GENERIC_PALETTE.length)));
  assert.ok(Number.isFinite(result.metrics.meanLabDistance));
  assert.ok(result.metrics.edgeRetention >= 0 && result.metrics.edgeRetention <= 1);
});

test("100×100最大网格在性能预算内完成", { timeout: 1500 }, () => {
  const startedAt = performance.now();
  const result = compilePattern(syntheticImage(400, 400), GENERIC_PALETTE, { width: 100, height: 100, maximumColors: 32, profile: "balanced" });
  assert.equal(result.cells.length, 10000);
  assert.ok(performance.now() - startedAt < 500, "桌面自动化环境应在500ms保护线上完成");
});

test("人物插画采样会保留落在格子中心的高对比小特征", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const darkPixel = (1 * 4 + 1) * 4;
  data.set([20, 20, 20, 255], darkPixel);
  data.set([20, 20, 20, 255], darkPixel + 4);
  const average = downsampleImageData({ width: 4, height: 4, data }, 1, 1, "average");
  const feature = downsampleImageData({ width: 4, height: 4, data }, 1, 1, "feature");
  assert.ok(feature.data[0] < average.data[0] - 100);
});

test("Logo主色采样不会把抗锯齿边界平均成新的脏色", () => {
  const data = new Uint8ClampedArray([
    230, 30, 40, 255, 230, 30, 40, 255,
    230, 30, 40, 255, 80, 60, 180, 255
  ]);
  const dominant = downsampleImageData({ width: 2, height: 2, data }, 1, 1, "dominant");
  assert.ok(dominant.data[0] > 200 && dominant.data[2] < 80);
});

test("保边滤波降低同色噪声但不会跨越强黑白边界", () => {
  const data = new Uint8ClampedArray([
    20, 20, 20, 255,
    50, 45, 40, 255,
    245, 245, 245, 255
  ]);
  const filtered = bilateralFilterImageData({ width: 3, height: 1, data }, 1, 35);
  assert.ok(filtered.data[4] < 50);
  assert.ok(filtered.data[8] > 235);
});

test("区域规则化清理平坦区域中的边界杂色", () => {
  const sampled = { width: 3, height: 3, data: new Uint8ClampedArray(3 * 3 * 4) };
  for (let index = 0; index < sampled.data.length; index += 4) sampled.data.set([247, 244, 234, 255], index);
  const cells = [0, 0, 0, 0, 3, 0, 0, 0, 0];
  const regularized = regularizePattern(cells, sampled, GENERIC_PALETTE, 8, 2);
  assert.equal(regularized[4], 0);
});

test("四种内容模式均为显式、确定且受颜色上限约束", () => {
  const image = syntheticImage(48, 48);
  for (const contentMode of ["photo", "illustration", "icon", "pixel"]) {
    const first = compilePattern(image, GENERIC_PALETTE, { width: 12, height: 12, maximumColors: 10, profile: "balanced", contentMode });
    const second = compilePattern(image, GENERIC_PALETTE, { width: 12, height: 12, maximumColors: 10, profile: "balanced", contentMode });
    assert.equal(first.contentMode, contentMode);
    assert.ok(first.metrics.colors <= 10);
    assert.deepEqual(first.cells, second.cells);
  }
});

test("像素画直转可以恢复被整数放大的逻辑网格", () => {
  const logicalSize = 8, blockSize = 4, width = logicalSize * blockSize;
  const colors = [[25, 35, 45], [230, 65, 75], [75, 170, 95], [70, 115, 210], [245, 210, 75]];
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = colors[(Math.floor(x / blockSize) + Math.floor(y / blockSize) * 3) % colors.length];
      data.set([...color, 255], (y * width + x) * 4);
    }
  }
  const analysis = analyzePixelArtImage({ width, height: width, data });
  assert.equal(analysis.columns, logicalSize);
  assert.equal(analysis.rows, logicalSize);
  assert.equal(analysis.blockWidth, blockSize);
  assert.equal(analysis.blockHeight, blockSize);
  assert.equal(analysis.offGridRatio, 0);
  assert.equal(analysis.likelyPixelArt, true);
});

test("原生低分辨率有限色图片会被识别为直接像素网格", () => {
  const image = syntheticImage(16, 12);
  for (let index = 0; index < image.data.length; index += 4) {
    const color = (index / 4) % 2 ? 30 : 230;
    image.data.set([color, color, color, 255], index);
  }
  const analysis = analyzePixelArtImage(image);
  assert.equal(analysis.columns, 16);
  assert.equal(analysis.rows, 12);
  assert.equal(analysis.likelyPixelArt, true);
});

test("放大的像素画可以按检测网格直接编译为一格一豆", () => {
  const logicalSize = 8, blockSize = 4, width = logicalSize * blockSize;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const light = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
      data.set(light ? [247, 244, 234, 255] : [32, 33, 36, 255], (y * width + x) * 4);
    }
  }
  const result = compilePattern({ width, height: width, data }, GENERIC_PALETTE, {
    width: logicalSize, height: logicalSize, maximumColors: 8, profile: "balanced", contentMode: "pixel"
  });
  assert.equal(result.cells.length, logicalSize * logicalSize);
  assert.equal(result.metrics.colors, 2);
  for (let row = 0; row < logicalSize; row += 1) {
    for (let column = 0; column < logicalSize; column += 1) {
      if (column > 0) assert.notEqual(result.cells[row * logicalSize + column], result.cells[row * logicalSize + column - 1]);
    }
  }
});

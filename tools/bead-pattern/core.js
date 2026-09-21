export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export const ENGINE_VERSION = "2.1.0-benchmark";

export function hexToRgb(hex) {
  const value = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new TypeError(`无效颜色：${hex}`);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

export function rgbToLab({ r, g, b }) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const red = linear(r), green = linear(g), blue = linear(b);
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const pivot = (value) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x), fy = pivot(y), fz = pivot(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labDistanceSquared(left, right) {
  return (left.l - right.l) ** 2 + (left.a - right.a) ** 2 + (left.b - right.b) ** 2;
}

export const PATTERN_PROFILES = Object.freeze({
  easy: Object.freeze({ id: "easy", label: "省豆", colorScale: 0.65, sampling: "average", cleanupSize: 1 }),
  balanced: Object.freeze({ id: "balanced", label: "均衡", colorScale: 0.85, sampling: "representative", cleanupSize: 1 }),
  detailed: Object.freeze({ id: "detailed", label: "细腻", colorScale: 1, sampling: "representative", cleanupSize: 0 })
});

function imageDimensions(imageData) {
  const width = Number(imageData?.width);
  const height = Number(imageData?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError("图像数据缺少有效的宽度或高度");
  }
  if (!imageData.data || imageData.data.length !== width * height * 4) {
    throw new TypeError("图像像素数量与尺寸不一致");
  }
  return { width, height };
}

export function downsampleImageData(imageData, targetWidth, targetHeight, mode = "representative") {
  const source = imageDimensions(imageData);
  const width = clamp(Math.round(targetWidth), 1, source.width);
  const height = clamp(Math.round(targetHeight), 1, source.height);
  const output = new Uint8ClampedArray(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    const startY = Math.floor(row * source.height / height);
    const endY = Math.max(startY + 1, Math.ceil((row + 1) * source.height / height));
    for (let column = 0; column < width; column += 1) {
      const startX = Math.floor(column * source.width / width);
      const endX = Math.max(startX + 1, Math.ceil((column + 1) * source.width / width));
      const samples = [];
      let red = 0, green = 0, blue = 0, alpha = 0, weight = 0, sampleSlots = 0;
      for (let y = startY; y < Math.min(endY, source.height); y += 1) {
        for (let x = startX; x < Math.min(endX, source.width); x += 1) {
          sampleSlots += 1;
          const index = (y * source.width + x) * 4;
          const a = imageData.data[index + 3] / 255;
          if (a <= 0) continue;
          const sample = { r: imageData.data[index], g: imageData.data[index + 1], b: imageData.data[index + 2], a };
          samples.push(sample);
          red += sample.r * a; green += sample.g * a; blue += sample.b * a; alpha += a; weight += a;
        }
      }
      const outputIndex = (row * width + column) * 4;
      if (!samples.length || weight < 0.125) continue;
      const mean = { r: red / weight, g: green / weight, b: blue / weight };
      let color = mean;
      if (mode === "representative") {
        color = samples.reduce((best, sample) => {
          const distance = (sample.r - mean.r) ** 2 + (sample.g - mean.g) ** 2 + (sample.b - mean.b) ** 2;
          return distance < best.distance ? { ...sample, distance } : best;
        }, { ...samples[0], distance: Number.POSITIVE_INFINITY });
      }
      output[outputIndex] = Math.round(color.r);
      output[outputIndex + 1] = Math.round(color.g);
      output[outputIndex + 2] = Math.round(color.b);
      output[outputIndex + 3] = Math.round(clamp(alpha / sampleSlots, 0, 1) * 255);
    }
  }
  return { width, height, data: output };
}

export function preparePalette(palette) {
  return palette.map((color, index) => ({ ...color, index, rgb: hexToRgb(color.hex), lab: rgbToLab(hexToRgb(color.hex)) }));
}

export function quantizeImageData(imageData, palette, maximumColors) {
  const prepared = preparePalette(palette);
  const pixels = [];
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    pixels.push(alpha < 32 ? null : rgbToLab({
      r: imageData.data[index], g: imageData.data[index + 1], b: imageData.data[index + 2]
    }));
  }
  const opaquePixels = pixels.filter(Boolean);
  if (!opaquePixels.length) return { cells: pixels.map(() => -1), paletteIndexes: [] };

  const limit = clamp(Math.round(maximumColors) || 1, 1, prepared.length);
  const selected = [];
  const bestDistances = opaquePixels.map(() => Number.POSITIVE_INFINITY);

  while (selected.length < limit) {
    let bestCandidate = -1;
    let bestImprovement = Number.NEGATIVE_INFINITY;
    for (const candidate of prepared) {
      if (selected.includes(candidate.index)) continue;
      let improvement = 0;
      for (let index = 0; index < opaquePixels.length; index += 1) {
        const distance = labDistanceSquared(opaquePixels[index], candidate.lab);
        improvement += Number.isFinite(bestDistances[index]) ? Math.max(0, bestDistances[index] - distance) : -distance;
      }
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestCandidate = candidate.index;
      }
    }
    if (bestCandidate < 0) break;
    selected.push(bestCandidate);
    const lab = prepared[bestCandidate].lab;
    opaquePixels.forEach((pixel, index) => {
      bestDistances[index] = Math.min(bestDistances[index], labDistanceSquared(pixel, lab));
    });
  }

  const cells = pixels.map((pixel) => {
    if (!pixel) return -1;
    let nearest = selected[0], distance = Number.POSITIVE_INFINITY;
    for (const paletteIndex of selected) {
      const nextDistance = labDistanceSquared(pixel, prepared[paletteIndex].lab);
      if (nextDistance < distance) { nearest = paletteIndex; distance = nextDistance; }
    }
    return nearest;
  });
  return { cells, paletteIndexes: selected };
}

export function cleanupSmallRegions(cells, width, height, maximumRegionSize = 1) {
  const result = cells.slice();
  if (maximumRegionSize < 1) return result;
  const visited = new Uint8Array(cells.length);
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let start = 0; start < cells.length; start += 1) {
    if (visited[start] || cells[start] < 0) continue;
    const color = cells[start];
    const region = [];
    const boundary = new Map();
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      region.push(index);
      const x = index % width, y = Math.floor(index / width);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (cells[next] === color && !visited[next]) { visited[next] = 1; queue.push(next); }
        else if (cells[next] >= 0 && cells[next] !== color) boundary.set(cells[next], (boundary.get(cells[next]) || 0) + 1);
      }
    }
    if (region.length > maximumRegionSize || !boundary.size) continue;
    const replacement = [...boundary.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0][0];
    for (const index of region) result[index] = replacement;
  }
  return result;
}

export function patternMetrics(cells, width, height) {
  const colors = countPatternColors(cells).size;
  let filled = 0, isolated = 0;
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] < 0) continue;
    filled += 1;
    const x = index % width, y = Math.floor(index / width);
    const connected = (x > 0 && cells[index - 1] === cells[index])
      || (x + 1 < width && cells[index + 1] === cells[index])
      || (y > 0 && cells[index - width] === cells[index])
      || (y + 1 < height && cells[index + width] === cells[index]);
    if (!connected) isolated += 1;
  }
  const regions = analyzeRegions(cells, width, height);
  return {
    colors,
    filled,
    isolated,
    isolatedRatio: filled ? isolated / filled : 0,
    regionCount: regions.regionCount,
    smallRegions: regions.smallRegions,
    fragmentsPerHundred: filled ? regions.regionCount / filled * 100 : 0
  };
}

export function analyzeRegions(cells, width, height, smallRegionLimit = 3) {
  const visited = new Uint8Array(cells.length);
  let regionCount = 0, smallRegions = 0, largestRegion = 0;
  for (let start = 0; start < cells.length; start += 1) {
    if (visited[start] || cells[start] < 0) continue;
    const color = cells[start];
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % width, y = Math.floor(index / width);
      if (x > 0 && !visited[index - 1] && cells[index - 1] === color) { visited[index - 1] = 1; queue.push(index - 1); }
      if (x + 1 < width && !visited[index + 1] && cells[index + 1] === color) { visited[index + 1] = 1; queue.push(index + 1); }
      if (y > 0 && !visited[index - width] && cells[index - width] === color) { visited[index - width] = 1; queue.push(index - width); }
      if (y + 1 < height && !visited[index + width] && cells[index + width] === color) { visited[index + width] = 1; queue.push(index + width); }
    }
    regionCount += 1;
    if (queue.length <= smallRegionLimit) smallRegions += 1;
    largestRegion = Math.max(largestRegion, queue.length);
  }
  return { regionCount, smallRegions, largestRegion };
}

export function colorFidelityMetrics(sampled, cells, palette) {
  const prepared = preparePalette(palette);
  let compared = 0, totalDistance = 0, maximumDistance = 0, highError = 0;
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] < 0 || sampled.data[cell * 4 + 3] < 32) continue;
    const sourceLab = rgbToLab({
      r: sampled.data[cell * 4],
      g: sampled.data[cell * 4 + 1],
      b: sampled.data[cell * 4 + 2]
    });
    const distance = Math.sqrt(labDistanceSquared(sourceLab, prepared[cells[cell]].lab));
    compared += 1;
    totalDistance += distance;
    maximumDistance = Math.max(maximumDistance, distance);
    if (distance >= 20) highError += 1;
  }
  return {
    meanLabDistance: compared ? totalDistance / compared : 0,
    maxLabDistance: maximumDistance,
    highErrorRatio: compared ? highError / compared : 0
  };
}

function pixelLuma(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function edgeRetentionMetrics(sampled, cells, palette, sourceThreshold = 24, outputThreshold = 12) {
  const rgbPalette = palette.map((color) => hexToRgb(color.hex));
  let sourceEdges = 0, preservedEdges = 0, totalDifference = 0, comparisons = 0;
  const compare = (left, right) => {
    if (sampled.data[left * 4 + 3] < 32 || sampled.data[right * 4 + 3] < 32 || cells[left] < 0 || cells[right] < 0) return;
    const sourceLeft = pixelLuma(sampled.data[left * 4], sampled.data[left * 4 + 1], sampled.data[left * 4 + 2]);
    const sourceRight = pixelLuma(sampled.data[right * 4], sampled.data[right * 4 + 1], sampled.data[right * 4 + 2]);
    const outputLeft = rgbPalette[cells[left]], outputRight = rgbPalette[cells[right]];
    const sourceDifference = Math.abs(sourceLeft - sourceRight);
    const outputDifference = Math.abs(pixelLuma(outputLeft.r, outputLeft.g, outputLeft.b) - pixelLuma(outputRight.r, outputRight.g, outputRight.b));
    comparisons += 1;
    totalDifference += Math.abs(sourceDifference - outputDifference);
    if (sourceDifference >= sourceThreshold) {
      sourceEdges += 1;
      if (outputDifference >= outputThreshold) preservedEdges += 1;
    }
  };
  for (let y = 0; y < sampled.height; y += 1) {
    for (let x = 0; x < sampled.width; x += 1) {
      const index = y * sampled.width + x;
      if (x + 1 < sampled.width) compare(index, index + 1);
      if (y + 1 < sampled.height) compare(index, index + sampled.width);
    }
  }
  return {
    sourceEdges,
    preservedEdges,
    edgeRetention: sourceEdges ? preservedEdges / sourceEdges : 1,
    meanEdgeDifference: comparisons ? totalDifference / comparisons : 0
  };
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function compilePattern(imageData, palette, options = {}) {
  const startedAt = now();
  const source = imageDimensions(imageData);
  const width = clamp(Math.round(options.width || source.width), 1, source.width);
  const height = clamp(Math.round(options.height || source.height), 1, source.height);
  const profile = PATTERN_PROFILES[options.profile] || PATTERN_PROFILES.balanced;
  const requestedColors = clamp(Math.round(options.maximumColors) || 16, 1, palette.length);
  const effectiveColors = clamp(Math.round(requestedColors * profile.colorScale), 1, requestedColors);
  const sampledAt = now();
  const sampled = downsampleImageData(imageData, width, height, profile.sampling);
  const quantizedAt = now();
  const quantized = quantizeImageData(sampled, palette, effectiveColors);
  const cleanedAt = now();
  const cells = cleanupSmallRegions(quantized.cells, width, height, profile.cleanupSize);
  const measuredAt = now();
  const metrics = {
    ...patternMetrics(cells, width, height),
    ...colorFidelityMetrics(sampled, cells, palette),
    ...edgeRetentionMetrics(sampled, cells, palette)
  };
  const finishedAt = now();
  return {
    engineVersion: ENGINE_VERSION,
    width,
    height,
    cells,
    paletteIndexes: [...countPatternColors(cells).keys()],
    profile: profile.id,
    requestedColors,
    effectiveColors,
    metrics,
    timings: {
      samplingMs: quantizedAt - sampledAt,
      quantizationMs: cleanedAt - quantizedAt,
      cleanupMs: measuredAt - cleanedAt,
      measurementMs: finishedAt - measuredAt,
      totalMs: finishedAt - startedAt
    }
  };
}

export function patternFingerprint(cells) {
  let hash = 2166136261;
  for (const value of cells) {
    hash ^= value + 2;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function countPatternColors(cells) {
  const counts = new Map();
  for (const cell of cells) if (cell >= 0) counts.set(cell, (counts.get(cell) || 0) + 1);
  return counts;
}

export function rasterLine(fromColumn, fromRow, toColumn, toRow) {
  const points = [];
  let x = fromColumn, y = fromRow;
  const dx = Math.abs(toColumn - fromColumn), sx = fromColumn < toColumn ? 1 : -1;
  const dy = -Math.abs(toRow - fromRow), sy = fromRow < toRow ? 1 : -1;
  let error = dx + dy;
  while (true) {
    points.push([x, y]);
    if (x === toColumn && y === toRow) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
  return points;
}

export function materialRows(cells, palette) {
  const counts = countPatternColors(cells);
  return [...counts.entries()]
    .map(([paletteIndex, count]) => ({ ...palette[paletteIndex], paletteIndex, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

export function materialCsv(cells, palette, columns, rows) {
  const materials = materialRows(cells, palette);
  const total = materials.reduce((sum, item) => sum + item.count, 0);
  const lines = [
    ["拼豆图纸尺寸", `${columns} × ${rows}`],
    ["使用颜色", `${materials.length}种`],
    ["拼豆总数", `${total}颗`],
    [],
    ["色号", "颜色名称", "HEX", "数量"]
  ];
  for (const item of materials) lines.push([item.code, item.name, item.hex, item.count]);
  return lines.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

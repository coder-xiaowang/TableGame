export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export const ENGINE_VERSION = "2.3.0-pixel-direct";

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
  easy: Object.freeze({ id: "easy", label: "省豆", colorScale: 0.8, cleanupSize: 1, regularizationScale: 1.25 }),
  balanced: Object.freeze({ id: "balanced", label: "均衡", colorScale: 1, cleanupSize: 1, regularizationScale: 1 }),
  detailed: Object.freeze({ id: "detailed", label: "细腻", colorScale: 1, cleanupSize: 0, regularizationScale: 0.7 })
});

export const CONTENT_MODES = Object.freeze({
  photo: Object.freeze({ id: "photo", label: "照片 / 风景", sampling: "representative", bilateralRadius: 1, rangeSigma: 34, regularization: 2.6, preserveAccents: 2 }),
  illustration: Object.freeze({ id: "illustration", label: "人物 / 插画", sampling: "feature", bilateralRadius: 1, rangeSigma: 48, regularization: 3.4, preserveAccents: 3, preserveSmallRegions: true }),
  icon: Object.freeze({ id: "icon", label: "Logo / 图标", sampling: "dominant", bilateralRadius: 0, rangeSigma: 0, regularization: 4.8, preserveAccents: 3, preserveSmallRegions: true }),
  pixel: Object.freeze({ id: "pixel", label: "像素画直转", sampling: "dominant", bilateralRadius: 0, rangeSigma: 0, regularization: 0, preserveAccents: 3, preserveSmallRegions: true })
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
          sample.luma = pixelLuma(sample.r, sample.g, sample.b);
          samples.push(sample);
          red += sample.r * a; green += sample.g * a; blue += sample.b * a; alpha += a; weight += a;
        }
      }
      const outputIndex = (row * width + column) * 4;
      if (!samples.length || weight < 0.125) continue;
      const mean = { r: red / weight, g: green / weight, b: blue / weight };
      let color = mean;
      if (mode === "center") {
        const centerX = Math.min(source.width - 1, Math.floor((startX + endX - 1) / 2));
        const centerY = Math.min(source.height - 1, Math.floor((startY + endY - 1) / 2));
        const centerIndex = (centerY * source.width + centerX) * 4;
        color = imageData.data[centerIndex + 3] >= 32 ? {
          r: imageData.data[centerIndex], g: imageData.data[centerIndex + 1], b: imageData.data[centerIndex + 2]
        } : mean;
      } else if (mode === "dominant") {
        const buckets = new Map();
        for (const sample of samples) {
          const key = `${sample.r >> 4},${sample.g >> 4},${sample.b >> 4}`;
          const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
          bucket.count += sample.a; bucket.r += sample.r * sample.a; bucket.g += sample.g * sample.a; bucket.b += sample.b * sample.a;
          buckets.set(key, bucket);
        }
        const bucket = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
        color = { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count };
      } else if (mode === "feature") {
        const ordered = samples.slice().sort((left, right) => left.luma - right.luma);
        const featureCount = Math.max(2, Math.ceil(samples.length * 0.25));
        const dark = ordered.slice(0, featureCount), bright = ordered.slice(-featureCount);
        const darkMean = dark.reduce((sum, sample) => sum + sample.luma, 0) / dark.length;
        const brightMean = bright.reduce((sum, sample) => sum + sample.luma, 0) / bright.length;
        const meanLuma = pixelLuma(mean.r, mean.g, mean.b);
        const centerX = Math.min(source.width - 1, Math.floor((startX + endX - 1) / 2));
        const centerY = Math.min(source.height - 1, Math.floor((startY + endY - 1) / 2));
        const centerIndex = (centerY * source.width + centerX) * 4;
        const centerLuma = pixelLuma(imageData.data[centerIndex], imageData.data[centerIndex + 1], imageData.data[centerIndex + 2]);
        const feature = Math.abs(centerLuma - darkMean) <= Math.abs(centerLuma - brightMean) ? dark : bright;
        if (Math.max(meanLuma - darkMean, brightMean - meanLuma) >= 32) {
          const targetLuma = feature.reduce((sum, sample) => sum + sample.luma, 0) / feature.length;
          color = feature.reduce((best, sample) => Math.abs(sample.luma - targetLuma) < Math.abs(best.luma - targetLuma) ? sample : best, feature[0]);
        } else {
          color = samples.reduce((best, sample) => {
            const distance = (sample.r - mean.r) ** 2 + (sample.g - mean.g) ** 2 + (sample.b - mean.b) ** 2;
            return distance < best.distance ? { ...sample, distance } : best;
          }, { ...samples[0], distance: Number.POSITIVE_INFINITY });
        }
      } else if (mode === "representative") {
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

export function bilateralFilterImageData(imageData, radius = 1, rangeSigma = 40) {
  const { width, height } = imageDimensions(imageData);
  if (radius < 1) return { width, height, data: new Uint8ClampedArray(imageData.data) };
  const output = new Uint8ClampedArray(imageData.data.length);
  const rangeFactor = 2 * rangeSigma * rangeSigma;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = (y * width + x) * 4;
      if (imageData.data[center + 3] < 32) continue;
      let red = 0, green = 0, blue = 0, alpha = 0, weightSum = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = (ny * width + nx) * 4;
          if (imageData.data[next + 3] < 32) continue;
          const colorDistance = (imageData.data[next] - imageData.data[center]) ** 2
            + (imageData.data[next + 1] - imageData.data[center + 1]) ** 2
            + (imageData.data[next + 2] - imageData.data[center + 2]) ** 2;
          const spatialWeight = dx === 0 && dy === 0 ? 1 : (dx === 0 || dy === 0 ? 0.8 : 0.58);
          const weight = spatialWeight * Math.exp(-colorDistance / rangeFactor);
          red += imageData.data[next] * weight; green += imageData.data[next + 1] * weight; blue += imageData.data[next + 2] * weight;
          alpha += imageData.data[next + 3] * weight; weightSum += weight;
        }
      }
      output[center] = Math.round(red / weightSum); output[center + 1] = Math.round(green / weightSum);
      output[center + 2] = Math.round(blue / weightSum); output[center + 3] = Math.round(alpha / weightSum);
    }
  }
  return { width, height, data: output };
}

function axisBoundaryEnergy(imageData, axis) {
  const { width, height } = imageDimensions(imageData);
  const length = axis === "x" ? width : height;
  const crossLength = axis === "x" ? height : width;
  const energies = new Float64Array(length);
  for (let position = 1; position < length; position += 1) {
    let total = 0, compared = 0;
    for (let cross = 0; cross < crossLength; cross += 1) {
      const left = axis === "x" ? (cross * width + position - 1) * 4 : ((position - 1) * width + cross) * 4;
      const right = axis === "x" ? (cross * width + position) * 4 : (position * width + cross) * 4;
      if (imageData.data[left + 3] < 32 && imageData.data[right + 3] < 32) continue;
      total += Math.abs(imageData.data[left] - imageData.data[right])
        + Math.abs(imageData.data[left + 1] - imageData.data[right + 1])
        + Math.abs(imageData.data[left + 2] - imageData.data[right + 2]);
      compared += 1;
    }
    energies[position] = compared ? total / compared : 0;
  }
  return energies;
}

function detectAxisGrid(energies) {
  const length = energies.length;
  const totalEnergy = energies.reduce((sum, value) => sum + value, 0);
  if (totalEnergy < 1) return { blockSize: 1, offset: 0, cells: length, confidence: 0 };
  const globalMean = totalEnergy / Math.max(1, length - 1);
  const candidates = [];
  const maximumBlock = Math.min(96, Math.floor(length / 8));
  for (let blockSize = 2; blockSize <= maximumBlock; blockSize += 1) {
    for (let offset = 0; offset < blockSize; offset += 1) {
      let captured = 0, boundarySlots = 0;
      const covered = new Uint8Array(length);
      for (let boundary = offset || blockSize; boundary < length; boundary += blockSize) {
        if (boundary < 1) continue;
        boundarySlots += 1;
        for (let delta = -1; delta <= 1; delta += 1) {
          const position = boundary + delta;
          if (position > 0 && position < length && !covered[position]) { captured += energies[position]; covered[position] = 1; }
        }
      }
      if (boundarySlots < 2) continue;
      const concentration = captured / totalEnergy;
      const boundaryMean = captured / (boundarySlots * 3);
      const density = boundaryMean / Math.max(globalMean, 0.0001);
      const divisibility = 1 - Math.min(1, Math.min((length - offset) % blockSize, blockSize - ((length - offset) % blockSize)) / blockSize);
      const score = concentration * clamp(density / 2, 0, 1) * (0.82 + divisibility * 0.18);
      candidates.push({ blockSize, offset, concentration, density, score, divisibility });
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.blockSize - left.blockSize);
  const best = candidates[0];
  if (!best) return { blockSize: 1, offset: 0, cells: length, confidence: 0 };
  const comparable = candidates.filter((candidate) => candidate.concentration >= best.concentration * 0.94 && candidate.score >= best.score * 0.88);
  const chosen = comparable.sort((left, right) => right.blockSize - left.blockSize)[0] || best;
  return {
    blockSize: chosen.blockSize,
    offset: chosen.offset,
    cells: Math.max(1, Math.round(length / chosen.blockSize)),
    confidence: clamp(chosen.score, 0, 1),
    concentration: chosen.concentration
  };
}

export function analyzePixelArtImage(imageData) {
  const { width, height } = imageDimensions(imageData);
  const horizontal = detectAxisGrid(axisBoundaryEnergy(imageData, "x"));
  const vertical = detectAxisGrid(axisBoundaryEnergy(imageData, "y"));
  const exactColors = new Set(), approximateColors = new Set();
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index + 3] < 32) continue;
    const red = imageData.data[index], green = imageData.data[index + 1], blue = imageData.data[index + 2];
    exactColors.add(`${red},${green},${blue}`);
    approximateColors.add(`${red >> 4},${green >> 4},${blue >> 4}`);
  }
  const blockSimilarity = Math.min(horizontal.blockSize, vertical.blockSize) / Math.max(horizontal.blockSize, vertical.blockSize);
  const detectedConfidence = Math.sqrt(horizontal.confidence * vertical.confidence) * blockSimilarity;
  const nativeGrid = detectedConfidence < 0.45
    && width >= 8 && height >= 8 && width <= 128 && height <= 128 && approximateColors.size <= 64;
  const confidence = nativeGrid ? 0.72 : detectedConfidence;
  const columns = clamp(nativeGrid ? width : horizontal.cells, 1, 200);
  const rows = clamp(nativeGrid ? height : vertical.cells, 1, 200);
  const normalized = downsampleImageData(imageData, columns, rows, "dominant");
  let offGrid = 0, compared = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      if (imageData.data[source + 3] < 32) continue;
      const column = Math.min(columns - 1, Math.floor(x / width * columns));
      const row = Math.min(rows - 1, Math.floor(y / height * rows));
      const target = (row * columns + column) * 4;
      const distance = Math.sqrt(
        (imageData.data[source] - normalized.data[target]) ** 2
        + (imageData.data[source + 1] - normalized.data[target + 1]) ** 2
        + (imageData.data[source + 2] - normalized.data[target + 2]) ** 2
      );
      if (distance > 30) offGrid += 1;
      compared += 1;
    }
  }
  return {
    sourceWidth: width,
    sourceHeight: height,
    columns,
    rows,
    blockWidth: nativeGrid ? 1 : horizontal.blockSize,
    blockHeight: nativeGrid ? 1 : vertical.blockSize,
    confidence: clamp(confidence, 0, 1),
    exactColors: exactColors.size,
    approximateColors: approximateColors.size,
    offGridRatio: compared ? offGrid / compared : 0,
    likelyPixelArt: (nativeGrid || confidence >= 0.45) && columns >= 8 && rows >= 8 && columns <= 128 && rows <= 128
  };
}

export function preparePalette(palette) {
  return palette.map((color, index) => ({ ...color, index, rgb: hexToRgb(color.hex), lab: rgbToLab(hexToRgb(color.hex)) }));
}

export function quantizeImageData(imageData, palette, maximumColors, options = {}) {
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
  const selected = [...new Set(options.seedPaletteIndexes || [])].filter((index) => prepared[index]).slice(0, limit);
  const bestDistances = opaquePixels.map(() => Number.POSITIVE_INFINITY);

  for (const paletteIndex of selected) {
    const lab = prepared[paletteIndex].lab;
    opaquePixels.forEach((pixel, index) => { bestDistances[index] = Math.min(bestDistances[index], labDistanceSquared(pixel, lab)); });
  }

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

export function featurePaletteSeeds(imageData, palette, maximumSeeds = 3) {
  if (maximumSeeds < 1) return [];
  const prepared = preparePalette(palette);
  const pixels = [];
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index + 3] < 32) continue;
    const rgb = { r: imageData.data[index], g: imageData.data[index + 1], b: imageData.data[index + 2] };
    const maximum = Math.max(rgb.r, rgb.g, rgb.b), minimum = Math.min(rgb.r, rgb.g, rgb.b);
    pixels.push({ rgb, lab: rgbToLab(rgb), luma: pixelLuma(rgb.r, rgb.g, rgb.b), chroma: maximum - minimum });
  }
  if (!pixels.length) return [];
  const byLuma = pixels.slice().sort((left, right) => left.luma - right.luma);
  const byChroma = pixels.slice().sort((left, right) => right.chroma - left.chroma);
  const representatives = [
    byLuma[Math.floor((byLuma.length - 1) * 0.08)],
    byLuma[Math.floor((byLuma.length - 1) * 0.92)],
    byChroma[Math.floor((byChroma.length - 1) * 0.05)]
  ];
  const seeds = [];
  for (const representative of representatives) {
    let nearest = 0, distance = Number.POSITIVE_INFINITY;
    for (const color of prepared) {
      const next = labDistanceSquared(representative.lab, color.lab);
      if (next < distance) { nearest = color.index; distance = next; }
    }
    if (!seeds.includes(nearest)) seeds.push(nearest);
    if (seeds.length >= maximumSeeds) break;
  }
  return seeds;
}

export function regularizePattern(cells, sampled, palette, strength = 0, iterations = 1) {
  if (strength <= 0) return cells.slice();
  const prepared = preparePalette(palette);
  let current = cells.slice();
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = current.slice();
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] < 0 || sampled.data[index * 4 + 3] < 32) continue;
      const x = index % sampled.width, y = Math.floor(index / sampled.width);
      const neighbors = [];
      let strongestSourceEdge = 0;
      const sourceLuma = pixelLuma(sampled.data[index * 4], sampled.data[index * 4 + 1], sampled.data[index * 4 + 2]);
      for (const [dx, dy] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= sampled.width || ny >= sampled.height) continue;
        const neighbor = ny * sampled.width + nx;
        if (current[neighbor] >= 0) neighbors.push(current[neighbor]);
        const neighborLuma = pixelLuma(sampled.data[neighbor * 4], sampled.data[neighbor * 4 + 1], sampled.data[neighbor * 4 + 2]);
        strongestSourceEdge = Math.max(strongestSourceEdge, Math.abs(sourceLuma - neighborLuma));
      }
      const candidates = [...new Set([current[index], ...neighbors])];
      if (candidates.length < 2) continue;
      const sourceLab = rgbToLab({ r: sampled.data[index * 4], g: sampled.data[index * 4 + 1], b: sampled.data[index * 4 + 2] });
      const edgeProtection = strongestSourceEdge >= 36 ? 0.15 : strongestSourceEdge >= 22 ? 0.45 : 1;
      let best = current[index], bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const fidelity = Math.sqrt(labDistanceSquared(sourceLab, prepared[candidate].lab));
        const mismatch = neighbors.reduce((count, color) => count + Number(color !== candidate), 0);
        const score = fidelity + mismatch * strength * edgeProtection;
        if (score < bestScore || (score === bestScore && candidate === current[index])) { best = candidate; bestScore = score; }
      }
      next[index] = best;
    }
    current = next;
  }
  return current;
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
  const content = CONTENT_MODES[options.contentMode] || CONTENT_MODES.illustration;
  const requestedColors = clamp(Math.round(options.maximumColors) || 16, 1, palette.length);
  const effectiveColors = clamp(Math.round(requestedColors * profile.colorScale), 1, requestedColors);
  const preprocessedAt = now();
  const preprocessed = bilateralFilterImageData(imageData, content.bilateralRadius, content.rangeSigma);
  const sampledAt = now();
  const sampled = downsampleImageData(preprocessed, width, height, content.sampling);
  const reference = downsampleImageData(imageData, width, height, content.sampling);
  const quantizedAt = now();
  const seeds = featurePaletteSeeds(sampled, palette, Math.min(content.preserveAccents, effectiveColors));
  const quantized = quantizeImageData(sampled, palette, effectiveColors, { seedPaletteIndexes: seeds });
  const regularizedAt = now();
  const regularized = regularizePattern(
    quantized.cells,
    sampled,
    palette,
    content.regularization * profile.regularizationScale,
    profile.id === "easy" ? 2 : 1
  );
  const cleanedAt = now();
  const cleanupSize = content.preserveSmallRegions ? 0 : profile.cleanupSize;
  const cells = cleanupSmallRegions(regularized, width, height, cleanupSize);
  const measuredAt = now();
  const metrics = {
    ...patternMetrics(cells, width, height),
    ...colorFidelityMetrics(reference, cells, palette),
    ...edgeRetentionMetrics(reference, cells, palette)
  };
  const finishedAt = now();
  return {
    engineVersion: ENGINE_VERSION,
    width,
    height,
    cells,
    paletteIndexes: [...countPatternColors(cells).keys()],
    profile: profile.id,
    contentMode: content.id,
    requestedColors,
    effectiveColors,
    metrics,
    timings: {
      preprocessingMs: sampledAt - preprocessedAt,
      samplingMs: quantizedAt - sampledAt,
      quantizationMs: regularizedAt - quantizedAt,
      regularizationMs: cleanedAt - regularizedAt,
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

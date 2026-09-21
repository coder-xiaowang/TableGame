export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

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

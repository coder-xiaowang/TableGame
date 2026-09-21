"use strict";

import { GENERIC_PALETTE } from "./palette.js";
import { CONTENT_MODES, PATTERN_PROFILES, clamp, compilePattern, hexToRgb, materialCsv, materialRows, patternMetrics, rasterLine } from "./core.js";

const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "imageInput", "uploadZone", "cropStage", "cropCanvas", "cropHint", "cropZoom", "cropZoomOutput",
  "gridColumns", "gridRows", "contentMode", "generationProfile", "colorLimit", "colorLimitOutput", "resetCropButton", "generateButton",
  "workspace", "patternSummary", "toolHint", "zoomOutButton", "fitCanvasButton", "zoomInButton", "editorZoomOutput",
  "canvasViewport", "editorCanvas", "paletteGrid", "selectedColorLabel", "toolDock", "undoButton",
  "redoButton", "materialsBody", "materialTotals", "showCodes", "copyListButton", "exportCsvButton",
  "exportPngButton", "toast"
].map((id) => [id, $(id)]));

const TOOL_HINTS = {
  pencil: "画笔：在格子上滑动即可连续绘制",
  eraser: "橡皮：滑过格子可移除拼豆",
  picker: "取色：点击图纸中的拼豆选择该颜色",
  pan: "移动：拖动画布查看其他区域"
};
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HISTORY = 40;
const BASE_CELL_SIZE = 18;

let sourceImage = null;
let sourceUrl = "";
let cropZoom = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropDrag = null;
let pattern = null;
let selectedPaletteIndex = 5;
let activeTool = "pan";
let drawing = null;
let pinchGesture = null;
const editorPointers = new Map();
const camera = { x: 0, y: 0, scale: 1, fitScale: 1, minimumScale: 1, maximumScale: 6, ready: false };
let undoStack = [];
let redoStack = [];
let toastTimer = 0;

function dimensions() {
  return {
    columns: clamp(Number.parseInt(E.gridColumns.value, 10) || 29, 8, 100),
    rows: clamp(Number.parseInt(E.gridRows.value, 10) || 29, 8, 100)
  };
}

function normalizeDimensionInputs() {
  const { columns, rows } = dimensions();
  E.gridColumns.value = String(columns);
  E.gridRows.value = String(rows);
  return { columns, rows };
}

function showToast(message) {
  E.toast.textContent = message;
  E.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => E.toast.classList.remove("show"), 2200);
}

function resetCrop() {
  cropZoom = 1;
  cropOffsetX = 0;
  cropOffsetY = 0;
  E.cropZoom.value = "100";
  E.cropZoomOutput.textContent = "100%";
  renderCrop();
}

function cropCanvasSize() {
  const { columns, rows } = dimensions();
  const aspect = columns / rows;
  const maximumWidth = 720, maximumHeight = 500;
  if (aspect >= maximumWidth / maximumHeight) return { width: maximumWidth, height: Math.max(72, Math.round(maximumWidth / aspect)) };
  return { width: Math.max(72, Math.round(maximumHeight * aspect)), height: maximumHeight };
}

function cropTransform() {
  if (!sourceImage) return null;
  const canvas = E.cropCanvas;
  const baseScale = Math.max(canvas.width / sourceImage.naturalWidth, canvas.height / sourceImage.naturalHeight);
  const scale = baseScale * cropZoom;
  const imageWidth = sourceImage.naturalWidth * scale;
  const imageHeight = sourceImage.naturalHeight * scale;
  const limitX = Math.max(0, (imageWidth - canvas.width) / 2);
  const limitY = Math.max(0, (imageHeight - canvas.height) / 2);
  cropOffsetX = clamp(cropOffsetX, -limitX, limitX);
  cropOffsetY = clamp(cropOffsetY, -limitY, limitY);
  return {
    scale,
    x: (canvas.width - imageWidth) / 2 + cropOffsetX,
    y: (canvas.height - imageHeight) / 2 + cropOffsetY,
    imageWidth,
    imageHeight
  };
}

function renderCrop() {
  if (!sourceImage) return;
  const size = cropCanvasSize();
  E.cropCanvas.width = size.width;
  E.cropCanvas.height = size.height;
  const context = E.cropCanvas.getContext("2d");
  const transform = cropTransform();
  context.clearRect(0, 0, size.width, size.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceImage, transform.x, transform.y, transform.imageWidth, transform.imageHeight);
}

async function loadImageFile(file) {
  if (!file) return;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) { showToast("请选择 JPG、PNG 或 WebP 图片"); return; }
  if (file.size > MAX_FILE_BYTES) { showToast("图片不能超过 20MB"); return; }
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    sourceImage = image;
    E.uploadZone.classList.add("has-image");
    E.uploadZone.querySelector("strong").textContent = "更换图片";
    E.uploadZone.querySelector("small").textContent = file.name;
    E.cropStage.hidden = false;
    E.cropZoom.disabled = false;
    E.resetCropButton.disabled = false;
    E.generateButton.disabled = false;
    E.cropHint.textContent = "拖动画面调整裁剪位置；滑块控制图片缩放。";
    resetCrop();
  };
  image.onerror = () => showToast("无法读取这张图片，请换一张试试");
  image.src = sourceUrl;
}

function beginCropDrag(event) {
  if (!sourceImage) return;
  E.cropCanvas.setPointerCapture(event.pointerId);
  cropDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

function moveCrop(event) {
  if (!cropDrag || cropDrag.pointerId !== event.pointerId) return;
  const rect = E.cropCanvas.getBoundingClientRect();
  cropOffsetX += (event.clientX - cropDrag.x) * E.cropCanvas.width / rect.width;
  cropOffsetY += (event.clientY - cropDrag.y) * E.cropCanvas.height / rect.height;
  cropDrag.x = event.clientX;
  cropDrag.y = event.clientY;
  renderCrop();
}

function endCropDrag(event) {
  if (cropDrag?.pointerId === event.pointerId) cropDrag = null;
}

function croppedImageData(columns, rows, contentMode) {
  const output = document.createElement("canvas");
  const samplingScale = 4;
  output.width = columns * samplingScale;
  output.height = rows * samplingScale;
  const context = output.getContext("2d", { willReadFrequently: true });
  const transform = cropTransform();
  const sourceX = clamp(-transform.x / transform.scale, 0, sourceImage.naturalWidth);
  const sourceY = clamp(-transform.y / transform.scale, 0, sourceImage.naturalHeight);
  const sourceWidth = Math.min(E.cropCanvas.width / transform.scale, sourceImage.naturalWidth - sourceX);
  const sourceHeight = Math.min(E.cropCanvas.height / transform.scale, sourceImage.naturalHeight - sourceY);
  context.clearRect(0, 0, output.width, output.height);
  context.imageSmoothingEnabled = contentMode !== "pixel";
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
  return context.getImageData(0, 0, output.width, output.height);
}

async function generatePattern() {
  if (!sourceImage) return;
  const { columns, rows } = normalizeDimensionInputs();
  E.generateButton.disabled = true;
  E.generateButton.textContent = "正在配色…";
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const result = compilePattern(croppedImageData(columns, rows, E.contentMode.value), GENERIC_PALETTE, {
      width: columns,
      height: rows,
      maximumColors: Number(E.colorLimit.value),
      profile: E.generationProfile.value,
      contentMode: E.contentMode.value
    });
    pattern = { columns, rows, cells: result.cells, generation: result };
    selectedPaletteIndex = result.paletteIndexes[0] ?? selectedPaletteIndex;
    undoStack = [];
    redoStack = [];
    camera.ready = false;
    E.workspace.hidden = false;
    setTool("pan");
    renderPalette();
    renderEditor();
    renderMaterials();
    updateHistoryButtons();
    E.workspace.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    requestAnimationFrame(fitCamera);
    showToast("图纸已经生成，可以继续手工修整");
  } catch (error) {
    console.error(error);
    showToast("生成图纸时遇到问题，请缩小网格或更换图片后重试");
  } finally {
    E.generateButton.disabled = false;
    E.generateButton.textContent = "重新生成图纸";
  }
}

function renderPalette() {
  E.paletteGrid.replaceChildren(...GENERIC_PALETTE.map((color, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `color-button${index === selectedPaletteIndex ? " active" : ""}`;
    button.style.setProperty("--swatch", color.hex);
    button.dataset.code = color.code;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === selectedPaletteIndex));
    button.setAttribute("aria-label", `${color.code} ${color.name}`);
    button.title = `${color.code} · ${color.name}`;
    button.onclick = () => {
      selectedPaletteIndex = index;
      setTool("pencil");
      renderPalette();
    };
    return button;
  }));
  const selected = GENERIC_PALETTE[selectedPaletteIndex];
  E.selectedColorLabel.textContent = `${selected.code} · ${selected.name}`;
}

function renderEditor() {
  if (!pattern) return;
  const logicalWidth = pattern.columns * BASE_CELL_SIZE;
  const logicalHeight = pattern.rows * BASE_CELL_SIZE;
  const maximumScale = Math.min(2, 4096 / logicalWidth, 4096 / logicalHeight);
  const pixelRatio = Math.max(1, Math.min(devicePixelRatio || 1, maximumScale));
  E.editorCanvas.width = Math.round(logicalWidth * pixelRatio);
  E.editorCanvas.height = Math.round(logicalHeight * pixelRatio);
  E.editorCanvas.style.width = `${logicalWidth}px`;
  E.editorCanvas.style.height = `${logicalHeight}px`;
  E.editorCanvas.dataset.tool = activeTool;
  const context = E.editorCanvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, logicalWidth, logicalHeight);

  for (let row = 0; row < pattern.rows; row += 1) {
    for (let column = 0; column < pattern.columns; column += 1) {
      const index = row * pattern.columns + column;
      context.fillStyle = pattern.cells[index] < 0 ? "#ffffff" : GENERIC_PALETTE[pattern.cells[index]].hex;
      context.fillRect(column * BASE_CELL_SIZE, row * BASE_CELL_SIZE, BASE_CELL_SIZE, BASE_CELL_SIZE);
    }
  }
  context.lineWidth = 1;
  for (let column = 0; column <= pattern.columns; column += 1) {
    context.beginPath();
    context.strokeStyle = column % 5 === 0 ? "rgba(62,48,37,.56)" : "rgba(62,48,37,.22)";
    context.moveTo(column * BASE_CELL_SIZE + .5, 0);
    context.lineTo(column * BASE_CELL_SIZE + .5, logicalHeight);
    context.stroke();
  }
  for (let row = 0; row <= pattern.rows; row += 1) {
    context.beginPath();
    context.strokeStyle = row % 5 === 0 ? "rgba(62,48,37,.56)" : "rgba(62,48,37,.22)";
    context.moveTo(0, row * BASE_CELL_SIZE + .5);
    context.lineTo(logicalWidth, row * BASE_CELL_SIZE + .5);
    context.stroke();
  }
  if (camera.ready) applyCamera();
}

function canvasSize() {
  return pattern ? { width: pattern.columns * BASE_CELL_SIZE, height: pattern.rows * BASE_CELL_SIZE } : { width: 0, height: 0 };
}

function clampCameraPosition() {
  if (!pattern) return;
  const viewportWidth = E.canvasViewport.clientWidth;
  const viewportHeight = E.canvasViewport.clientHeight;
  const size = canvasSize();
  const scaledWidth = size.width * camera.scale;
  const scaledHeight = size.height * camera.scale;
  camera.x = scaledWidth <= viewportWidth ? (viewportWidth - scaledWidth) / 2 : clamp(camera.x, viewportWidth - scaledWidth, 0);
  camera.y = scaledHeight <= viewportHeight ? (viewportHeight - scaledHeight) / 2 : clamp(camera.y, viewportHeight - scaledHeight, 0);
}

function applyCamera() {
  if (!pattern) return;
  clampCameraPosition();
  E.editorCanvas.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`;
  const relativeZoom = Math.round(camera.scale / camera.fitScale * 100);
  E.editorZoomOutput.textContent = relativeZoom === 100 ? "适屏 100%" : `${relativeZoom}%`;
}

function fitCamera() {
  if (!pattern || E.canvasViewport.clientWidth < 1 || E.canvasViewport.clientHeight < 1) return;
  const size = canvasSize();
  const padding = 18;
  camera.fitScale = Math.min(
    Math.max(1, E.canvasViewport.clientWidth - padding * 2) / size.width,
    Math.max(1, E.canvasViewport.clientHeight - padding * 2) / size.height,
    2
  );
  camera.minimumScale = camera.fitScale;
  camera.maximumScale = Math.max(2, camera.fitScale * 8);
  camera.scale = camera.fitScale;
  camera.x = (E.canvasViewport.clientWidth - size.width * camera.scale) / 2;
  camera.y = (E.canvasViewport.clientHeight - size.height * camera.scale) / 2;
  camera.ready = true;
  applyCamera();
}

function zoomCamera(factor, anchorX = E.canvasViewport.clientWidth / 2, anchorY = E.canvasViewport.clientHeight / 2) {
  if (!pattern || !camera.ready) return;
  const nextScale = clamp(camera.scale * factor, camera.minimumScale, camera.maximumScale);
  const worldX = (anchorX - camera.x) / camera.scale;
  const worldY = (anchorY - camera.y) / camera.scale;
  camera.x = anchorX - worldX * nextScale;
  camera.y = anchorY - worldY * nextScale;
  camera.scale = nextScale;
  applyCamera();
}

function cellAtPoint(clientX, clientY) {
  const rect = E.editorCanvas.getBoundingClientRect();
  const column = Math.floor((clientX - rect.left) / rect.width * pattern.columns);
  const row = Math.floor((clientY - rect.top) / rect.height * pattern.rows);
  if (column < 0 || row < 0 || column >= pattern.columns || row >= pattern.rows) return null;
  return { column, row, index: row * pattern.columns + column };
}

function viewportPoint(clientX, clientY) {
  const rect = E.canvasViewport.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function pushHistory() {
  undoStack.push(pattern.cells.slice());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function paintCells(from, to) {
  const value = activeTool === "eraser" ? -1 : selectedPaletteIndex;
  let changed = false;
  for (const [column, row] of rasterLine(from.column, from.row, to.column, to.row)) {
    const index = row * pattern.columns + column;
    if (pattern.cells[index] !== value) { pattern.cells[index] = value; changed = true; }
  }
  return changed;
}

function startDrawing(pointerId, cell) {
  if (!cell) return;
  const undoBefore = undoStack.slice();
  const redoBefore = redoStack.slice();
  const cellsBefore = pattern.cells.slice();
  pushHistory();
  drawing = { kind: "draw", pointerId, last: cell, changed: paintCells(cell, cell), undoBefore, redoBefore, cellsBefore };
  renderEditor();
}

function rollbackDrawingForGesture() {
  if (drawing?.kind !== "draw") return;
  pattern.cells = drawing.cellsBefore;
  undoStack = drawing.undoBefore;
  redoStack = drawing.redoBefore;
  renderEditor();
  renderMaterials();
  updateHistoryButtons();
}

function beginPinchGesture() {
  rollbackDrawingForGesture();
  drawing = null;
  const points = [...editorPointers.values()].slice(0, 2);
  const midpointClientX = (points[0].x + points[1].x) / 2;
  const midpointClientY = (points[0].y + points[1].y) / 2;
  const midpoint = viewportPoint(midpointClientX, midpointClientY);
  const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1;
  pinchGesture = {
    startDistance: distance,
    startScale: camera.scale,
    worldX: (midpoint.x - camera.x) / camera.scale,
    worldY: (midpoint.y - camera.y) / camera.scale
  };
}

function updatePinchGesture() {
  if (!pinchGesture || editorPointers.size < 2) return;
  const points = [...editorPointers.values()].slice(0, 2);
  const midpointClientX = (points[0].x + points[1].x) / 2;
  const midpointClientY = (points[0].y + points[1].y) / 2;
  const midpoint = viewportPoint(midpointClientX, midpointClientY);
  const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1;
  camera.scale = clamp(pinchGesture.startScale * distance / pinchGesture.startDistance, camera.minimumScale, camera.maximumScale);
  camera.x = midpoint.x - pinchGesture.worldX * camera.scale;
  camera.y = midpoint.y - pinchGesture.worldY * camera.scale;
  applyCamera();
}

function pickColorAt(clientX, clientY) {
  const cell = cellAtPoint(clientX, clientY);
  if (!cell || pattern.cells[cell.index] < 0) return;
  selectedPaletteIndex = pattern.cells[cell.index];
  setTool("pencil");
  renderPalette();
  showToast(`已选择 ${GENERIC_PALETTE[selectedPaletteIndex].name}`);
}

function beginEditorPointer(event) {
  if (!pattern) return;
  event.preventDefault();
  E.canvasViewport.setPointerCapture(event.pointerId);
  editorPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (editorPointers.size === 2) { beginPinchGesture(); return; }
  if (editorPointers.size > 2) return;

  if (activeTool === "pan") {
    drawing = { kind: "pan", pointerId: event.pointerId, x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y };
  } else if (activeTool === "picker") {
    drawing = { kind: "picker", pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  } else if (event.pointerType === "touch") {
    drawing = { kind: "pending", pointerId: event.pointerId, x: event.clientX, y: event.clientY, startedAt: performance.now(), startCell: cellAtPoint(event.clientX, event.clientY) };
  } else {
    startDrawing(event.pointerId, cellAtPoint(event.clientX, event.clientY));
  }
}

function moveEditorPointer(event) {
  if (!editorPointers.has(event.pointerId)) return;
  event.preventDefault();
  editorPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinchGesture) { updatePinchGesture(); return; }
  if (!drawing || drawing.pointerId !== event.pointerId) return;
  if (drawing.kind === "pan") {
    camera.x = drawing.cameraX + event.clientX - drawing.x;
    camera.y = drawing.cameraY + event.clientY - drawing.y;
    applyCamera();
    return;
  }
  if (drawing.kind === "pending") {
    const moved = Math.hypot(event.clientX - drawing.x, event.clientY - drawing.y);
    if (moved < 3 && performance.now() - drawing.startedAt < 70) return;
    const startCell = drawing.startCell;
    startDrawing(event.pointerId, startCell);
    if (!drawing) return;
  }
  if (drawing.kind !== "draw") return;
  const cell = cellAtPoint(event.clientX, event.clientY);
  if (!cell || (cell.column === drawing.last.column && cell.row === drawing.last.row)) return;
  drawing.changed = paintCells(drawing.last, cell) || drawing.changed;
  drawing.last = cell;
  renderEditor();
}

function endEditorPointer(event) {
  if (!editorPointers.has(event.pointerId)) return;
  event.preventDefault();
  editorPointers.delete(event.pointerId);
  if (pinchGesture) {
    pinchGesture = null;
    drawing = null;
    return;
  }
  if (!drawing || drawing.pointerId !== event.pointerId) return;
  if (drawing.kind === "pending") {
    startDrawing(event.pointerId, drawing.startCell);
  } else if (drawing.kind === "picker") {
    const moved = Math.hypot(event.clientX - drawing.x, event.clientY - drawing.y);
    if (moved < 8) pickColorAt(event.clientX, event.clientY);
  }
  if (drawing?.kind === "draw") {
    const changed = drawing.changed;
    if (!changed) { undoStack = drawing.undoBefore; redoStack = drawing.redoBefore; }
    drawing = null;
    updateHistoryButtons();
    if (changed) renderMaterials();
    return;
  }
  drawing = null;
}

function cancelEditorPointer(event) {
  if (!editorPointers.has(event.pointerId)) return;
  editorPointers.delete(event.pointerId);
  if (drawing?.kind === "draw") rollbackDrawingForGesture();
  drawing = null;
  pinchGesture = null;
}

function updateHistoryButtons() {
  E.undoButton.disabled = !undoStack.length;
  E.redoButton.disabled = !redoStack.length;
}

function undo() {
  if (!pattern || !undoStack.length) return;
  redoStack.push(pattern.cells.slice());
  pattern.cells = undoStack.pop();
  renderEditor(); renderMaterials(); updateHistoryButtons();
}

function redo() {
  if (!pattern || !redoStack.length) return;
  undoStack.push(pattern.cells.slice());
  pattern.cells = redoStack.pop();
  renderEditor(); renderMaterials(); updateHistoryButtons();
}

function setTool(tool) {
  activeTool = tool;
  for (const button of E.toolDock.querySelectorAll("[data-tool]")) {
    const active = button.dataset.tool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  E.toolHint.textContent = TOOL_HINTS[tool];
  E.canvasViewport.dataset.tool = tool;
  E.editorCanvas.dataset.tool = tool;
}

function renderMaterials() {
  if (!pattern) return;
  const rows = materialRows(pattern.cells, GENERIC_PALETTE);
  const total = rows.reduce((sum, item) => sum + item.count, 0);
  const profile = PATTERN_PROFILES[pattern.generation?.profile];
  const content = CONTENT_MODES[pattern.generation?.contentMode];
  const profileText = `${content ? `${content.label} · ` : ""}${profile ? `${profile.label}模式 · ` : ""}`;
  const currentMetrics = patternMetrics(pattern.cells, pattern.columns, pattern.rows);
  const cleanupText = currentMetrics.isolated ? ` · ${currentMetrics.isolated} 个孤立色块` : "";
  E.patternSummary.textContent = `${profileText}${pattern.columns} × ${pattern.rows} 格 · ${rows.length} 种颜色 · ${total} 颗拼豆${cleanupText}`;
  E.materialTotals.innerHTML = `<strong>${total} 颗</strong>${rows.length} 种颜色`;
  E.materialsBody.replaceChildren(...rows.map((item) => {
    const row = document.createElement("tr");
    const swatchCell = document.createElement("td");
    const swatch = document.createElement("span");
    swatch.className = "table-swatch";
    swatch.style.setProperty("--swatch", item.hex);
    swatchCell.append(swatch);
    const code = document.createElement("td"), name = document.createElement("td"), count = document.createElement("td");
    code.textContent = item.code; name.textContent = item.name; count.textContent = `${item.count} 颗`;
    row.append(swatchCell, code, name, count);
    return row;
  }));
}

function fileStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function listText() {
  const rows = materialRows(pattern.cells, GENERIC_PALETTE);
  const total = rows.reduce((sum, item) => sum + item.count, 0);
  return [
    `拼豆图纸：${pattern.columns} × ${pattern.rows} 格`,
    `共 ${rows.length} 种颜色，${total} 颗拼豆`,
    "",
    ...rows.map((item) => `${item.code} ${item.name}：${item.count}颗`),
    "",
    "注：本图使用通用色卡，请在购买前对照实际品牌色卡。"
  ].join("\n");
}

async function copyMaterialList() {
  if (!pattern) return;
  try {
    await navigator.clipboard.writeText(listText());
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = listText();
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast("材料清单已复制");
}

function exportCsv() {
  if (!pattern) return;
  const content = `\ufeff${materialCsv(pattern.cells, GENERIC_PALETTE, pattern.columns, pattern.rows)}`;
  downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), `拼豆材料清单-${fileStamp()}.csv`);
}

function contrastingText(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? "#312a24" : "#ffffff";
}

function exportPng() {
  if (!pattern) return;
  const cell = clamp(Math.floor(3500 / Math.max(pattern.columns, pattern.rows)), 12, 28);
  const margin = { top: 76, right: 22, bottom: 34, left: 44 };
  const canvas = document.createElement("canvas");
  canvas.width = margin.left + pattern.columns * cell + margin.right;
  canvas.height = margin.top + pattern.rows * cell + margin.bottom;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#3d352e";
  context.font = "bold 22px sans-serif";
  context.fillText("拼豆图纸", margin.left, 30);
  context.font = "13px sans-serif";
  context.fillStyle = "#756b61";
  context.fillText(`${pattern.columns} × ${pattern.rows} 格 · 通用色卡 · ${materialRows(pattern.cells, GENERIC_PALETTE).length} 种颜色`, margin.left, 53);

  for (let row = 0; row < pattern.rows; row += 1) {
    for (let column = 0; column < pattern.columns; column += 1) {
      const paletteIndex = pattern.cells[row * pattern.columns + column];
      const x = margin.left + column * cell, y = margin.top + row * cell;
      context.fillStyle = paletteIndex < 0 ? "#ffffff" : GENERIC_PALETTE[paletteIndex].hex;
      context.fillRect(x, y, cell, cell);
      if (E.showCodes.checked && paletteIndex >= 0 && cell >= 18) {
        const color = GENERIC_PALETTE[paletteIndex];
        context.fillStyle = contrastingText(color.hex);
        context.font = `bold ${Math.max(7, Math.floor(cell * .31))}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(color.code, x + cell / 2, y + cell / 2, cell - 2);
      }
    }
  }
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
  for (let column = 0; column <= pattern.columns; column += 1) {
    context.beginPath();
    context.lineWidth = column % 5 === 0 ? 1.4 : .55;
    context.strokeStyle = column % 5 === 0 ? "#5f554b" : "#a69b8e";
    context.moveTo(margin.left + column * cell, margin.top);
    context.lineTo(margin.left + column * cell, margin.top + pattern.rows * cell);
    context.stroke();
  }
  for (let row = 0; row <= pattern.rows; row += 1) {
    context.beginPath();
    context.lineWidth = row % 5 === 0 ? 1.4 : .55;
    context.strokeStyle = row % 5 === 0 ? "#5f554b" : "#a69b8e";
    context.moveTo(margin.left, margin.top + row * cell);
    context.lineTo(margin.left + pattern.columns * cell, margin.top + row * cell);
    context.stroke();
  }
  context.fillStyle = "#6d6257";
  context.font = "10px sans-serif";
  for (let column = 0; column < pattern.columns; column += 5) context.fillText(String(column + 1), margin.left + column * cell + 2, margin.top - 7);
  for (let row = 0; row < pattern.rows; row += 5) context.fillText(String(row + 1), 7, margin.top + row * cell + 11);
  canvas.toBlob((blob) => blob && downloadBlob(blob, `拼豆图纸-${pattern.columns}x${pattern.rows}-${fileStamp()}.png`), "image/png");
}

function changeEditorZoom(factor) {
  zoomCamera(factor);
}

function bindEvents() {
  E.imageInput.addEventListener("change", () => loadImageFile(E.imageInput.files[0]));
  E.uploadZone.addEventListener("dragover", (event) => { event.preventDefault(); E.uploadZone.classList.add("dragover"); });
  E.uploadZone.addEventListener("dragleave", () => E.uploadZone.classList.remove("dragover"));
  E.uploadZone.addEventListener("drop", (event) => { event.preventDefault(); E.uploadZone.classList.remove("dragover"); loadImageFile(event.dataTransfer.files[0]); });
  E.cropZoom.addEventListener("input", () => { cropZoom = Number(E.cropZoom.value) / 100; E.cropZoomOutput.textContent = `${E.cropZoom.value}%`; renderCrop(); });
  E.gridColumns.addEventListener("change", () => { normalizeDimensionInputs(); renderCrop(); });
  E.gridRows.addEventListener("change", () => { normalizeDimensionInputs(); renderCrop(); });
  E.colorLimit.addEventListener("input", () => { E.colorLimitOutput.textContent = `${E.colorLimit.value} 种`; });
  E.resetCropButton.addEventListener("click", resetCrop);
  E.generateButton.addEventListener("click", generatePattern);
  E.cropCanvas.addEventListener("pointerdown", beginCropDrag);
  E.cropCanvas.addEventListener("pointermove", moveCrop);
  E.cropCanvas.addEventListener("pointerup", endCropDrag);
  E.cropCanvas.addEventListener("pointercancel", endCropDrag);
  E.canvasViewport.addEventListener("pointerdown", beginEditorPointer);
  E.canvasViewport.addEventListener("pointermove", moveEditorPointer);
  E.canvasViewport.addEventListener("pointerup", endEditorPointer);
  E.canvasViewport.addEventListener("pointercancel", cancelEditorPointer);
  E.toolDock.addEventListener("click", (event) => { const button = event.target.closest("[data-tool]"); if (button) setTool(button.dataset.tool); });
  E.undoButton.addEventListener("click", undo);
  E.redoButton.addEventListener("click", redo);
  E.zoomOutButton.addEventListener("click", () => changeEditorZoom(1 / 1.25));
  E.fitCanvasButton.addEventListener("click", fitCamera);
  E.zoomInButton.addEventListener("click", () => changeEditorZoom(1.25));
  E.copyListButton.addEventListener("click", copyMaterialList);
  E.exportCsvButton.addEventListener("click", exportCsv);
  E.exportPngButton.addEventListener("click", exportPng);
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || !pattern) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  });
}

renderPalette();
setTool("pan");
bindEvents();

let lastViewportWidth = 0;
new ResizeObserver(() => {
  const width = E.canvasViewport.clientWidth;
  if (!pattern || Math.abs(width - lastViewportWidth) < 4) return;
  lastViewportWidth = width;
  requestAnimationFrame(fitCamera);
}).observe(E.canvasViewport);

if ("IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => E.toolDock.classList.toggle("canvas-active", entry.isIntersecting), {
    threshold: 0.08,
    rootMargin: "0px 0px -64px 0px"
  }).observe(E.canvasViewport);
} else {
  E.toolDock.classList.add("canvas-active");
}

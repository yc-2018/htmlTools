'use strict';

// ========== 常量 ==========
const MAX_HISTORY = 50;                        // 历史记录上限（步）
const SHAPE_TOOLS = ['line', 'rect', 'ellipse'];
const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 400;
const HANDLE_SIZE = 8;                         // 控制点边长（逻辑像素）
const HANDLE_HIT = 8;                          // 控制点命中范围（逻辑像素）
const LINE_HEIGHT_RATIO = 1.3;                 // 文本行高倍数
const MIN_LINE_WIDTH = 1;                      // 笔画粗细下限（与滑块 min 一致）
const MAX_LINE_WIDTH = 100;                    // 笔画粗细上限（与滑块 max 一致）
const HELP_SEEN_KEY = 'whiteboard-help-seen';  // 首次访问自动弹出说明的标记
const SIDE_COLLAPSED_KEY = 'whiteboard-side-collapsed'; // 左侧工具栏收起状态

// ========== 全局状态 ==========
const state = {
  tool: 'pencil',              // 当前工具
  scale: 1,                    // 视图缩放比例
  offset: { x: 0, y: 0 },      // 视图平移：世界原点到画布左上角的像素距离
  view: { w: 1, h: 1 },        // 视口（画布）的 CSS 尺寸，始终等于窗口可视区域
  brush: {
    color: '#000000',
    lineWidth: 5,
    opacity: 1,
    feather: 0,                  // 羽化：0 = 硬边，1 = 最柔
    rectRadius: 0
  },
  text: {
    fontSize: 24,
    fontFamily: "'Segoe UI', Arial, sans-serif"
  },
  textObjects: [],             // 文本对象列表
  selectedTextId: null,        // 选中的文本对象
  recentColors: [],
  spaceDown: false,
  altDown: false               // 按住 Alt = 临时吸色
};

// 当前正在进行的交互（同一时刻只有一个）
// { type: 'stroke' | 'shape' | 'text-drag' | 'text-resize' | 'pan', ... }
let gesture = null;

// 已提交的绘制操作（矢量描述，用于重绘与撤销）
// { type:'stroke', tool, points:[{x,y}], color, width, alpha }
// { type:'shape', tool, start, end, color, width, alpha, radius }
let drawOps = [];

// 历史快照：{ ops: [...], texts: [...] }
let history = [];
let historyStep = -1;

// 内联文本编辑器状态
let editingText = null;

let uid = 0;
function nextTextId() {
  return `text_${++uid}`;
}

// ========== DOM ==========
const elements = {
  toolBtns: document.querySelectorAll('.tool-btn[data-tool]'),
  colorPicker: document.getElementById('colorPicker'),
  recentColors: document.getElementById('recentColors'),
  lineWidth: document.getElementById('lineWidth'),
  lineWidthValue: document.getElementById('lineWidthValue'),
  feather: document.getElementById('feather'),
  featherValue: document.getElementById('featherValue'),
  brushPreviewDot: document.getElementById('brushPreviewDot'),
  opacity: document.getElementById('opacity'),
  opacityValue: document.getElementById('opacityValue'),
  rectRadiusControl: document.getElementById('rectRadiusControl'),
  rectRadius: document.getElementById('rectRadius'),
  rectRadiusValue: document.getElementById('rectRadiusValue'),
  textStyleControl: document.getElementById('textStyleControl'),
  fontSize: document.getElementById('fontSize'),
  fontSizeValue: document.getElementById('fontSizeValue'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  clearBtn: document.getElementById('clearBtn'),
  saveBtn: document.getElementById('saveBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomValue: document.getElementById('zoomValue'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  fitCanvasBtn: document.getElementById('fitCanvasBtn'),
  helpBtn: document.getElementById('helpBtn'),
  helpModal: document.getElementById('helpModal'),
  helpCloseBtn: document.getElementById('helpCloseBtn'),
  helpOkBtn: document.getElementById('helpOkBtn'),
  sideToggleBtn: document.getElementById('sideToggleBtn'),
  toolCapsule: document.getElementById('toolCapsule'),
  topCapsule: document.getElementById('topCapsule'),
  viewport: document.getElementById('canvasViewport'),
  drawCanvas: document.getElementById('drawCanvas'),
  liveCanvas: document.getElementById('liveCanvas'),
  overlayCanvas: document.getElementById('overlayCanvas'),
  brushCursor: document.getElementById('brushCursor'),
  brushCursorFill: document.getElementById('brushCursorFill'),
  brushTip: document.getElementById('brushTip'),
  textEditor: document.getElementById('textEditor')
};

const drawCtx = elements.drawCanvas.getContext('2d');
const liveCtx = elements.liveCanvas.getContext('2d');
const overlayCtx = elements.overlayCanvas.getContext('2d');

// ========== 通用工具 ==========
function getDpr() {
  // 限制上限，避免 4K + 高缩放导致画布过大
  return Math.min(window.devicePixelRatio || 1, 2.5);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
* 捕获指针（部分浏览器在指针已释放时会抛错）
*/
function capturePointer(e) {
  try {
    elements.overlayCanvas.setPointerCapture(e.pointerId);
  } catch (err) {
    // 忽略：指针已失效
  }
}

function cloneTexts(list) {
  return list.map(t => ({
    id: t.id,
    content: t.content,
    x: t.x,
    y: t.y,
    fontSize: t.fontSize,
    fontFamily: t.fontFamily,
    color: t.color,
    opacity: t.opacity
  }));
}

function getSelectedText() {
  if (!state.selectedTextId) return null;
  return state.textObjects.find(t => t.id === state.selectedTextId) || null;
}

function fontOf(obj) {
  return `${obj.fontSize}px ${obj.fontFamily}`;
}

// ========== 画布尺寸与视图变换 ==========
/**
* 把画布尺寸同步为视口尺寸（画布永远等于窗口，超出部分直接裁掉）
*/
function resizeCanvases() {
  const dpr = getDpr();
  state.view.w = Math.max(1, Math.round(elements.viewport.clientWidth));
  state.view.h = Math.max(1, Math.round(elements.viewport.clientHeight));

  [elements.drawCanvas, elements.liveCanvas, elements.overlayCanvas].forEach(canvas => {
    canvas.width = Math.round(state.view.w * dpr);
    canvas.height = Math.round(state.view.h * dpr);
    canvas.style.width = state.view.w + 'px';
    canvas.style.height = state.view.h + 'px';
  });

  // 修改 canvas.width/height 会重置上下文状态，必须重设变换
  setScreenTransform(drawCtx);
  setScreenTransform(liveCtx);
  setScreenTransform(overlayCtx);
}

/**
* 屏幕（CSS 像素）坐标系
*/
function setScreenTransform(ctx) {
  const dpr = getDpr();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
* 世界坐标系（内容坐标）：按当前缩放与平移映射到屏幕上
*/
function setWorldTransform(ctx) {
  const dpr = getDpr();
  const s = state.scale;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * state.offset.x, dpr * state.offset.y);
}

/**
* 重绘调度：高频交互（滚轮缩放）合并到一帧只重绘一次
*/
let renderFrameId = 0;
function scheduleRenderAll() {
  if (renderFrameId) return;
  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = 0;
    renderAll();
  });
}

function clearCanvasLayer(ctx) {
  setScreenTransform(ctx);
  ctx.clearRect(0, 0, state.view.w, state.view.h);
}

/**
* 刷新缩放百分比与画笔光标
*/
function updateZoomLabel() {
  elements.zoomValue.textContent = `${Math.round(state.scale * 100)}%`;
  updateBrushCursorStyle();
}

/**
* 以指定屏幕坐标为中心缩放
*/
function setScale(nextScale, clientX, clientY) {
  const oldScale = state.scale;
  const newScale = clamp(Math.round(nextScale * 100) / 100, MIN_SCALE, MAX_SCALE);
  if (newScale === oldScale) return;

  const rect = elements.overlayCanvas.getBoundingClientRect();

  // 缩放中心：默认视口中心
  const px = (clientX == null) ? state.view.w / 2 : clientX - rect.left;
  const py = (clientY == null) ? state.view.h / 2 : clientY - rect.top;

  // 光标下的世界坐标在缩放前后保持不动
  const worldX = (px - state.offset.x) / oldScale;
  const worldY = (py - state.offset.y) / oldScale;

  state.scale = newScale;
  state.offset.x = px - worldX * newScale;
  state.offset.y = py - worldY * newScale;

  updateZoomLabel();
  // 连续滚轮会高频触发，合并到一帧里只重绘一次
  scheduleRenderAll();
}

/**
* 重置视图：100% 且世界原点回到左上角
*/
function resetZoom() {
  state.scale = 1;
  state.offset.x = 0;
  state.offset.y = 0;
  updateZoomLabel();
  renderAll();
}

/**
* 屏幕坐标 → 世界（内容）坐标
*/
function toLogical(clientX, clientY) {
  const rect = elements.overlayCanvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.offset.x) / state.scale,
    y: (clientY - rect.top - state.offset.y) / state.scale
  };
}

// ========== 绘制原语 ==========
/**
* 沿点集描边（二次曲线平滑，一次性合成，避免半透明被反复叠加）
*/
function strokePath(ctx, points) {
  if (!points.length) return;
  const len = points.length;

  if (len === 1) {
    // 单击落点：画一个圆点
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < len - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  ctx.lineTo(points[len - 1].x, points[len - 1].y);
  ctx.stroke();
}

/**
* 圆角矩形路径（兼容所有浏览器，支持负宽高）
*/
function roundedRectPath(ctx, x, y, width, height, radius) {
  const xStart = width < 0 ? x + width : x;
  const yStart = height < 0 ? y + height : y;
  const w = Math.abs(width);
  const h = Math.abs(height);
  const r = Math.min(radius, Math.min(w / 2, h / 2));

  ctx.moveTo(xStart + r, yStart);
  ctx.lineTo(xStart + w - r, yStart);
  ctx.arcTo(xStart + w, yStart, xStart + w, yStart + r, r);
  ctx.lineTo(xStart + w, yStart + h - r);
  ctx.arcTo(xStart + w, yStart + h, xStart + w - r, yStart + h, r);
  ctx.lineTo(xStart + r, yStart + h);
  ctx.arcTo(xStart, yStart + h, xStart, yStart + h - r, r);
  ctx.lineTo(xStart, yStart + r);
  ctx.arcTo(xStart, yStart, xStart + r, yStart, r);
  ctx.closePath();
}

/**
* 形状几何（直线/矩形/椭圆），只建路径并描边
*/
function drawShapeGeometry(ctx, op) {
  const start = op.start;
  const end = op.end;
  const width = end.x - start.x;
  const height = end.y - start.y;

  ctx.beginPath();
  switch (op.tool) {
    case 'line':
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    break;
    case 'rect':
    roundedRectPath(ctx, start.x, start.y, width, height, op.radius || 0);
    break;
    case 'ellipse':
    ctx.ellipse(start.x, start.y, Math.abs(width), Math.abs(height), 0, 0, Math.PI * 2);
    break;
  }
  ctx.stroke();
}

/**
* 把一个绘制操作画到指定上下文
*/
function drawOp(ctx, op) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.width;
  ctx.globalAlpha = op.alpha;

  // 羽化：模糊半径按「世界坐标 → 目标画布像素」换算，缩放与导出表现一致
  if (op.feather > 0) applyFeatherFilter(ctx, featherRadius(op));

  if (op.type === 'stroke') {
    if (op.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
    }
    strokePath(ctx, op.points);
  } else if (op.type === 'shape') {
    drawShapeGeometry(ctx, op);
  }
  ctx.restore();
}

/**
* 羽化半径（世界坐标）：约为笔画宽度的 0.35 倍
* 再大就会把整个笔画模糊得发淡，而不是只软化边缘
*/
function featherRadius(op) {
  return (op.feather || 0) * op.width * 0.35;
}

/**
* 把世界坐标下的模糊半径换算成目标画布的像素半径后套用 filter
* （canvas filter 的像素半径不受 transform 影响，必须自己乘上缩放倍数）
*/
function applyFeatherFilter(ctx, radiusInWorld) {
  if (!('filter' in ctx)) return;
  const m = ctx.getTransform();
  const unit = Math.hypot(m.a, m.b) || 1;
  ctx.filter = `blur(${Math.max(0.5, radiusInWorld * unit)}px)`;
}

// ========== 文本度量与绘制 ==========
/**
* 计算文本块的行、宽、行高、首行 ascent
*/
function measureTextBlock(obj) {
  const ctx = overlayCtx;
  ctx.save();
  ctx.font = fontOf(obj);
  const lines = String(obj.content).split('\n');
  let width = 0;
  for (const line of lines) {
    width = Math.max(width, ctx.measureText(line).width);
  }
  const metrics = ctx.measureText(lines[0] || 'M');
  const ascent = metrics.actualBoundingBoxAscent || obj.fontSize * 0.8;
  ctx.restore();

  const lineHeight = obj.fontSize * LINE_HEIGHT_RATIO;
  return {
    lines,
    width: Math.max(width, 1),
    ascent,
    lineHeight,
    height: lineHeight * lines.length
  };
}

/**
* 文本外框（逻辑坐标）：x/y 为左上角
*/
function textBox(obj) {
  const m = measureTextBlock(obj);
  return { x: obj.x, y: obj.y - m.ascent, w: m.width, h: m.height, m };
}

function drawTextObject(ctx, obj) {
  const m = measureTextBlock(obj);
  ctx.save();
  ctx.font = fontOf(obj);
  ctx.fillStyle = obj.color;
  ctx.globalAlpha = obj.opacity;
  ctx.textBaseline = 'alphabetic';
  m.lines.forEach((line, i) => {
    if (line) ctx.fillText(line, obj.x, obj.y + i * m.lineHeight);
  });
  ctx.restore();
}

function drawSelection(ctx, obj) {
  const box = textBox(obj);
  const pad = 4;
  ctx.save();
  ctx.strokeStyle = '#28a745';
  ctx.lineWidth = 1 / state.scale * 1.5;
  ctx.setLineDash([5 / state.scale, 4 / state.scale]);
  ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
  ctx.setLineDash([]);

  // 四个控制点
  ctx.fillStyle = '#28a745';
  handlePoints(box).forEach(p => {
    const size = HANDLE_SIZE / state.scale;
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  });
  ctx.restore();
}

function handlePoints(box) {
  return [
    { name: 'topLeft', x: box.x, y: box.y },
    { name: 'topRight', x: box.x + box.w, y: box.y },
    { name: 'bottomRight', x: box.x + box.w, y: box.y + box.h },
    { name: 'bottomLeft', x: box.x, y: box.y + box.h }
  ];
}

// ========== 渲染 ==========
/**
* 重绘绘制层（回放全部操作）
*/
function renderDraw() {
  clearCanvasLayer(drawCtx);
  setWorldTransform(drawCtx);
  drawOps.forEach(op => drawOp(drawCtx, op));
}

/**
* 重绘实时笔画层
*/
function renderLive() {
  clearCanvasLayer(liveCtx);
  if (!gesture || gesture.type !== 'stroke' || gesture.tool !== 'pencil') return;

  setWorldTransform(liveCtx);
  liveCtx.save();
  liveCtx.strokeStyle = gesture.color;
  liveCtx.fillStyle = gesture.color;
  liveCtx.lineWidth = gesture.width;
  liveCtx.globalAlpha = gesture.alpha;
  liveCtx.lineCap = 'round';
  liveCtx.lineJoin = 'round';
  if (gesture.feather > 0) applyFeatherFilter(liveCtx, featherRadius(gesture));
  strokePath(liveCtx, gesture.points);
  liveCtx.restore();
  setScreenTransform(liveCtx);
}

/**
* 重绘文本与预览层
*/
function renderOverlay() {
  clearCanvasLayer(overlayCtx);
  setWorldTransform(overlayCtx);

  state.textObjects.forEach(obj => drawTextObject(overlayCtx, obj));

  const selected = getSelectedText();
  if (selected) drawSelection(overlayCtx, selected);

  if (gesture && gesture.type === 'shape') {
    overlayCtx.save();
    overlayCtx.lineCap = 'round';
    overlayCtx.lineJoin = 'round';
    overlayCtx.strokeStyle = gesture.color;
    overlayCtx.lineWidth = gesture.width;
    overlayCtx.globalAlpha = gesture.alpha;
    if (gesture.feather > 0) applyFeatherFilter(overlayCtx, featherRadius(gesture));
    drawShapeGeometry(overlayCtx, gesture);
    overlayCtx.restore();
  }
  setScreenTransform(overlayCtx);
}

function renderAll() {
  // 平移拖动期间画布靠元素位移做预览，此时重绘会和位移叠加造成错位
  if (gesture && gesture.type === 'pan') return;
  renderDraw();
  renderLive();
  renderOverlay();
}

// ========== 历史记录（操作序列回放） ==========
function pushHistory() {
  history = history.slice(0, historyStep + 1);
  history.push({ ops: drawOps.slice(), texts: cloneTexts(state.textObjects) });
  if (history.length > MAX_HISTORY) history.shift();
  historyStep = history.length - 1;
  updateHistoryButtons();
}

function restoreHistoryAt(index) {
  const snapshot = history[index];
  if (!snapshot) return;

  closeTextEditor(false);
  historyStep = index;
  drawOps = snapshot.ops.slice();
  state.textObjects = cloneTexts(snapshot.texts);
  state.selectedTextId = null;

  renderAll();
  updateHistoryButtons();
}

function undo() {
  if (historyStep <= 0) return;
  restoreHistoryAt(historyStep - 1);
}

function redo() {
  if (historyStep >= history.length - 1) return;
  restoreHistoryAt(historyStep + 1);
}

function updateHistoryButtons() {
  elements.undoBtn.disabled = historyStep <= 0;
  elements.redoBtn.disabled = historyStep >= history.length - 1;
}

// ========== 命中检测 ==========
function hitText(pos) {
  // 后画的在上层，倒序遍历
  for (let i = state.textObjects.length - 1; i >= 0; i--) {
    const obj = state.textObjects[i];
    const box = textBox(obj);
    const pad = 4;
    if (pos.x >= box.x - pad && pos.x <= box.x + box.w + pad &&
      pos.y >= box.y - pad && pos.y <= box.y + box.h + pad) {
      return obj;
    }
  }
  return null;
}

function hitHandle(pos) {
  const selected = getSelectedText();
  if (!selected) return null;
  const box = textBox(selected);
  for (const point of handlePoints(box)) {
    if (Math.abs(pos.x - point.x) <= HANDLE_HIT &&
      Math.abs(pos.y - point.y) <= HANDLE_HIT) {
      return { obj: selected, handle: point.name };
    }
  }
  return null;
}

// ========== 文本内联编辑器 ==========
function openTextEditor(obj) {
  editingText = obj;
  const el = elements.textEditor;
  el.value = obj.content;
  el.style.display = 'block';
  syncTextEditor();
  renderOverlay();

  // pointerdown 的默认行为会在事件处理结束后把焦点交还给画布，
  // 必须等这一轮事件处理完成后再聚焦，否则输入框会立刻失焦、打不进字
  setTimeout(() => {
    if (editingText !== obj) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, 0);
}

/**
* 同步编辑器位置与样式到文本对象（相对于画布视口定位）
*/
function syncTextEditor() {
  if (!editingText) return;
  const obj = editingText;
  const el = elements.textEditor;
  const m = measureTextBlock(obj);
  const s = state.scale;

  el.style.left = `${obj.x * s + state.offset.x}px`;
  el.style.top = `${(obj.y - m.ascent) * s + state.offset.y}px`;
  el.style.width = `${Math.max(m.width * s + 12, 48)}px`;
  el.style.height = `${Math.max(m.height * s, obj.fontSize * s * 1.4)}px`;
  el.style.fontFamily = obj.fontFamily;
  el.style.fontSize = `${obj.fontSize * s}px`;
  el.style.lineHeight = `${m.lineHeight * s}px`;
  el.style.color = obj.color;
}

/**
* 关闭编辑器（commit=true 提交内容，内容为空则丢弃该文本对象）
*/
function closeTextEditor(commit) {
  if (!editingText) return;
  const obj = editingText;
  editingText = null;

  const el = elements.textEditor;
  el.style.display = 'none';
  el.value = '';
  el.blur();

  if (commit) {
    obj.content = obj.content.replace(/\s+$/, '');
    if (!obj.content.trim()) {
      // 空的文本对象直接移除，不留垃圾
      state.textObjects = state.textObjects.filter(t => t.id !== obj.id);
      if (state.selectedTextId === obj.id) state.selectedTextId = null;
      renderOverlay();
      return;
    }
    state.selectedTextId = obj.id;
    pushHistory();
  }
  renderOverlay();
}

function createTextAt(pos) {
  const obj = {
    id: nextTextId(),
    content: '',
    x: pos.x,
    // 点击点作为文字顶部，视觉上更符合直觉
    y: pos.y + state.text.fontSize * 0.8,
    fontSize: state.text.fontSize,
    fontFamily: state.text.fontFamily,
    color: state.brush.color,
    opacity: state.brush.opacity
  };
  state.textObjects.push(obj);
  state.selectedTextId = obj.id;
  renderOverlay();
  openTextEditor(obj);
}

function deleteSelectedText() {
  const selected = getSelectedText();
  if (!selected) return;
  state.textObjects = state.textObjects.filter(t => t.id !== selected.id);
  state.selectedTextId = null;
  renderOverlay();
  pushHistory();
}

// ========== 手势：绘制 / 擦除 / 形状 / 文本 ==========
function onPointerDown(e) {
  // 阻止默认行为：否则浏览器会在事件处理结束后把焦点移回画布，
  // 刚打开的内联文本输入框会立刻失焦，导致打不进字
  if (e.cancelable) e.preventDefault();

  // 点击画布时先提交正在编辑的文本
  if (editingText) closeTextEditor(true);

  // 平移：中键 或 空格 + 左键
  if (e.button === 1 || (e.button === 0 && state.spaceDown)) {
    beginPan(e);
    return;
  }

  // Alt + 右键拖动：左右调笔画大小、上下调羽化（PS 习惯）
  if (e.button === 2) {
    if (e.altKey) beginBrushAdjust(e);
    return;
  }
  if (e.button !== 0) return;

  const pos = toLogical(e.clientX, e.clientY);

  // Alt + 左键：临时吸色（取色器），不画东西
  if (e.altKey) {
    pickColorAt(e.clientX, e.clientY);
    return;
  }

  // 文本工具：优先响应控制点与文本命中
  if (state.tool === 'text') {
    const handleHit = hitHandle(pos);
    if (handleHit) {
      beginTextResize(handleHit, pos);
      capturePointer(e);
      return;
    }
    const textHit = hitText(pos);
    if (textHit) {
      beginTextDrag(textHit, pos);
      capturePointer(e);
      return;
    }
    createTextAt(pos);
    return;
  }

  // 其他工具：取消文本选中，避免误拖动
  if (state.selectedTextId) {
    state.selectedTextId = null;
    renderOverlay();
  }

  if (state.tool === 'pencil' || state.tool === 'eraser') {
    beginStroke(pos, e);
  } else if (SHAPE_TOOLS.includes(state.tool)) {
    beginShape(pos, e);
  }
}

function beginStroke(pos, e) {
  const isEraser = state.tool === 'eraser';
  gesture = {
    type: 'stroke',
    tool: state.tool,
    points: [{ x: pos.x, y: pos.y }],
    color: state.brush.color,
    width: state.brush.lineWidth,
    alpha: isEraser ? 1 : state.brush.opacity, // 橡皮擦固定全不透明，彻底擦除
    feather: isEraser ? 0 : state.brush.feather
  };
  capturePointer(e);

  if (isEraser) {
    // 橡皮擦直接在绘制层上用 destination-out 增量擦除
    drawCtx.save();
    setWorldTransform(drawCtx);
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.globalAlpha = 1;
    drawCtx.strokeStyle = '#000000';
    drawCtx.fillStyle = '#000000';
    drawCtx.lineWidth = gesture.width;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    eraseDot(pos, gesture.width / 2);
  } else {
    renderLive();
  }
}

function eraseDot(pos, radius) {
  drawCtx.beginPath();
  drawCtx.arc(pos.x, pos.y, Math.max(radius, 0.5), 0, Math.PI * 2);
  drawCtx.fill();
}

function eraseSegment(from, to) {
  drawCtx.beginPath();
  drawCtx.moveTo(from.x, from.y);
  drawCtx.lineTo(to.x, to.y);
  drawCtx.stroke();
}

function addStrokePoint(point) {
  const points = gesture.points;
  const last = points[points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < 0.5) return;
  points.push(point);
  if (gesture.tool === 'eraser') {
    eraseSegment(last, point);
  }
}

function beginShape(pos, e) {
  gesture = {
    type: 'shape',
    tool: state.tool,
    start: { x: pos.x, y: pos.y },
    end: { x: pos.x, y: pos.y },
    color: state.brush.color,
    width: state.brush.lineWidth,
    alpha: state.brush.opacity,
    feather: state.brush.feather,
    radius: state.brush.rectRadius
  };
  capturePointer(e);
  renderOverlay();
}

/**
* Shift 约束：直线吸附 45°、矩形变正方形、椭圆变正圆
*/
function constrainShapeEnd(current, pos) {
  const dx = pos.x - current.start.x;
  const dy = pos.y - current.start.y;

  if (current.tool === 'line') {
    const length = Math.hypot(dx, dy);
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    return {
      x: current.start.x + Math.cos(angle) * length,
      y: current.start.y + Math.sin(angle) * length
    };
  }

  if (current.tool === 'rect' || current.tool === 'ellipse') {
    // 取长边并按拖动方向保留正负号
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: current.start.x + (dx < 0 ? -size : size),
      y: current.start.y + (dy < 0 ? -size : size)
    };
  }

  return { x: pos.x, y: pos.y };
}

/**
* Alt + 右键拖动：左右调笔画大小、上下调羽化（PS 习惯）
* 拖动过程中画笔圈与数值提示一直可见，改多少看得见多少
*/
function beginBrushAdjust(e) {
  gesture = {
    type: 'brush-adjust',
    startX: e.clientX,
    startY: e.clientY,
    startWidth: state.brush.lineWidth,
    startFeather: state.brush.feather,
    adjustAxis: null
  };
  capturePointer(e);
  positionBrushCursor(e.clientX, e.clientY);
  updateBrushCursorStyle();
  showBrushTip(e.clientX, e.clientY, brushTipText());
}

function updateBrushAdjust(e) {
  const dx = e.clientX - gesture.startX;
  const dy = e.clientY - gesture.startY;

  // 按主导方向判断本次是调大小还是调羽化，斜拖时不会两者一起乱跳
  gesture.adjustAxis = Math.abs(dx) >= Math.abs(dy) ? 'width' : 'feather';

  if (gesture.adjustAxis === 'width') {
    // 每 3px 对应 1px 粗细，最大 100px 也能拖得动
    setBrushWidth(gesture.startWidth + dx / 3);
  } else {
    // 上移（dy < 0）增加羽化，下移减小
    setBrushFeather(gesture.startFeather - dy / 200);
  }

  positionBrushCursor(e.clientX, e.clientY);
  showBrushTip(e.clientX, e.clientY, brushTipText());
}

function endBrushAdjust() {
  gesture = null;
  hideBrushTip();
  updateBrushCursorStyle();
}

/**
* 调整中在鼠标旁显示的实时数值
*/
function brushTipText() {
  return `大小 ${state.brush.lineWidth}px · 羽化 ${Math.round(state.brush.feather * 100)}%`;
}

function showBrushTip(clientX, clientY, text) {
  const tip = elements.brushTip;
  tip.textContent = text;
  tip.hidden = false;
  // 跟随鼠标但不超出窗口
  const x = Math.min(clientX + 18, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.min(clientY + 18, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function hideBrushTip() {
  elements.brushTip.hidden = true;
}

/**
* 统一修改笔画粗细（滑块 / 快捷键 / Alt + 右键左右拖动都走这里）
*/
function setBrushWidth(value) {
  const width = clamp(Math.round(value), MIN_LINE_WIDTH, MAX_LINE_WIDTH);
  if (width === state.brush.lineWidth) return;
  state.brush.lineWidth = width;
  elements.lineWidth.value = String(width);
  elements.lineWidthValue.textContent = `${width}px`;
  updateBrushPreview();
  updateBrushCursorStyle();
}

/**
* 统一修改羽化（滑块 / Alt + 右键上下拖动都走这里）
*/
function setBrushFeather(value) {
  const feather = clamp(Math.round(value * 100) / 100, 0, 1);
  if (feather === state.brush.feather) return;
  state.brush.feather = feather;
  elements.feather.value = String(feather);
  elements.featherValue.textContent = `${Math.round(feather * 100)}%`;
  updateBrushPreview();
  updateBrushCursorStyle();
}

/**
* 统一修改透明度（滑块 / Alt + 滚轮都走这里）
*/
function setBrushOpacity(value) {
  // 只保留一位小数，避免浮点误差累积成 0.30000000000000004
  const opacity = clamp(Math.round(value * 10) / 10, 0.1, 1);
  if (opacity === state.brush.opacity) return;
  state.brush.opacity = opacity;
  elements.opacity.value = String(opacity);
  elements.opacityValue.textContent = opacity.toFixed(1);

  const selected = getSelectedText();
  if (selected) {
    selected.opacity = opacity;
    renderOverlay();
  }
  updateBrushPreview();
  updateBrushCursorStyle();
}

function beginTextDrag(obj, pos) {
  state.selectedTextId = obj.id;
  gesture = {
    type: 'text-drag',
    obj,
    start: pos,
    origin: { x: obj.x, y: obj.y },
    moved: false
  };
  renderOverlay();
}

function beginTextResize(hit, pos) {
  const obj = hit.obj;
  const box = textBox(obj);
  const anchors = {
    topLeft: { x: box.x + box.w, y: box.y + box.h },
    topRight: { x: box.x, y: box.y + box.h },
    bottomRight: { x: box.x, y: box.y },
    bottomLeft: { x: box.x + box.w, y: box.y }
  };
  const anchor = anchors[hit.handle];
  gesture = {
    type: 'text-resize',
    obj,
    handle: hit.handle,
    anchor,
    startFont: obj.fontSize,
    startDist: Math.max(1, Math.hypot(pos.x - anchor.x, pos.y - anchor.y)),
    changed: false
  };
}

function onPointerMove(e) {
  // Alt 状态以事件为准：避免 keyup 丢失时吸管光标卡住
  if (!gesture && state.altDown !== e.altKey) {
    state.altDown = e.altKey;
    updateBrushCursorStyle();
  }

  moveBrushCursor(e);

  if (!gesture) return;

  if (gesture.type === 'pan') {
    updatePan(e);
    return;
  }

  if (gesture.type === 'brush-adjust') {
    updateBrushAdjust(e);
    return;
  }

  const pos = toLogical(e.clientX, e.clientY);

  switch (gesture.type) {
    case 'stroke': {
      // 使用合并事件提升快速绘制的采样精度
      if (typeof e.getCoalescedEvents === 'function') {
        const coalesced = e.getCoalescedEvents();
        if (coalesced && coalesced.length) {
          coalesced.forEach(ev => addStrokePoint(toLogical(ev.clientX, ev.clientY)));
        }
      }
      addStrokePoint(pos);
      if (gesture.tool === 'pencil') renderLive();
      break;
    }
    case 'shape':
    // 按住 Shift 时把终点约束到 45° / 正方形 / 正圆
    gesture.end = e.shiftKey ? constrainShapeEnd(gesture, pos) : { x: pos.x, y: pos.y };
    renderOverlay();
    break;
    case 'text-drag': {
      const dx = pos.x - gesture.start.x;
      const dy = pos.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) > 1) gesture.moved = true;
      gesture.obj.x = gesture.origin.x + dx;
      gesture.obj.y = gesture.origin.y + dy;
      renderOverlay();
      break;
    }
    case 'text-resize': {
      const dist = Math.hypot(pos.x - gesture.anchor.x, pos.y - gesture.anchor.y);
      const factor = dist / gesture.startDist;
      const fontSize = clamp(Math.round(gesture.startFont * factor), MIN_FONT_SIZE, MAX_FONT_SIZE);
      const obj = gesture.obj;
      if (fontSize === obj.fontSize) break;
      obj.fontSize = fontSize;
      // 以对角为锚点重新定位，拖动时对侧控制点保持不动
      const box = textBox(obj);
      const anchor = gesture.anchor;
      if (gesture.handle === 'bottomRight') {
        obj.x = anchor.x;
        obj.y = anchor.y + box.m.ascent;
      } else if (gesture.handle === 'topLeft') {
        obj.x = anchor.x - box.w;
        obj.y = anchor.y - box.h + box.m.ascent;
      } else if (gesture.handle === 'bottomLeft') {
        obj.x = anchor.x - box.w;
        obj.y = anchor.y + box.m.ascent;
      } else {
        obj.x = anchor.x;
        obj.y = anchor.y - box.h + box.m.ascent;
      }
      gesture.changed = true;
      renderOverlay();
      break;
    }
  }
}

function onPointerUp(e) {
  if (!gesture) return;
  try {
    elements.overlayCanvas.releasePointerCapture(e.pointerId);
  } catch (err) {
    // 指针已释放，忽略
  }

  switch (gesture.type) {
    case 'stroke':
    endStroke();
    break;
    case 'shape':
    endShape();
    break;
    case 'text-drag': {
      const current = gesture;
      gesture = null;
      if (current.moved) {
        pushHistory();
      } else {
        // 单击文本进入编辑
        openTextEditor(current.obj);
      }
      renderOverlay();
      break;
    }
    case 'text-resize': {
      const changed = gesture.changed;
      gesture = null;
      if (changed) pushHistory();
      renderOverlay();
      break;
    }
    case 'brush-adjust':
    endBrushAdjust();
    break;
    case 'pan':
    endPan();
    break;
    default:
    gesture = null;
  }
}

function endStroke() {
  const current = gesture;
  gesture = null;

  if (current.tool === 'eraser') {
    drawCtx.restore();               // 恢复默认合成模式
  }

  const op = {
    type: 'stroke',
    tool: current.tool,
    points: current.points,
    color: current.color,
    width: current.width,
    alpha: current.alpha,
    feather: current.feather
  };

  if (current.tool === 'pencil') {
    // 提交时整条笔画只合成一次，半透明不会被反复叠加
    setWorldTransform(drawCtx);
    drawOp(drawCtx, op);
    clearCanvasLayer(liveCtx);
  }

  drawOps.push(op);
  renderLive();
  pushHistory();
}

function endShape() {
  const current = gesture;
  gesture = null;

  const distance = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
  if (distance < 1) {
    // 只是点了一下，不记录形状
    renderOverlay();
    return;
  }

  const op = {
    type: 'shape',
    tool: current.tool,
    start: current.start,
    end: current.end,
    color: current.color,
    width: current.width,
    alpha: current.alpha,
    feather: current.feather,
    radius: current.radius
  };
  setWorldTransform(drawCtx);
  drawOp(drawCtx, op);
  drawOps.push(op);
  renderOverlay();
  pushHistory();
}

function beginPan(e) {
  gesture = {
    type: 'pan',
    startX: e.clientX,
    startY: e.clientY,
    originX: state.offset.x,
    originY: state.offset.y,
    dx: 0,
    dy: 0
  };
  elements.overlayCanvas.style.cursor = 'grabbing';
  capturePointer(e);
  elements.brushCursor.style.display = 'none';
}

/**
* 平移期间只位移三个画布元素（交给合成器），不重放笔画
* 笔画多 / 有羽化时也能跟手，松手后再真正重绘一次
*/
function translateLayers(dx, dy) {
  const transform = (dx || dy) ? `translate(${dx}px, ${dy}px)` : '';
  elements.drawCanvas.style.transform = transform;
  elements.liveCanvas.style.transform = transform;
  elements.overlayCanvas.style.transform = transform;
}

function updatePan(e) {
  gesture.dx = e.clientX - gesture.startX;
  gesture.dy = e.clientY - gesture.startY;
  translateLayers(gesture.dx, gesture.dy);
}

function endPan() {
  const dx = gesture ? gesture.dx : 0;
  const dy = gesture ? gesture.dy : 0;
  const originX = gesture ? gesture.originX : state.offset.x;
  const originY = gesture ? gesture.originY : state.offset.y;
  gesture = null;

  translateLayers(0, 0);
  state.offset.x = originX + dx;
  state.offset.y = originY + dy;

  elements.overlayCanvas.style.cursor = state.tool === 'text' ? 'text' : 'none';
  updateBrushCursorStyle();
  renderAll();
}

// ========== 画笔光标 ==========
function positionBrushCursor(clientX, clientY) {
  const rect = elements.viewport.getBoundingClientRect();
  const cursor = elements.brushCursor;
  cursor.style.left = `${clientX - rect.left}px`;
  cursor.style.top = `${clientY - rect.top}px`;
  cursor.style.display = 'block';
}

function moveBrushCursor(e) {
  // 触屏没有悬停指针；吸色、平移、文本工具下都不显示画笔圈
  // （Alt + 右键调整笔画时仍然显示，方便实时看到大小与羽化）
  const adjusting = gesture && gesture.type === 'brush-adjust';
  if (e.pointerType === 'touch' || state.tool === 'text' || state.spaceDown ||
    (state.altDown && !adjusting) || (gesture && gesture.type === 'pan')) {
    elements.brushCursor.style.display = 'none';
    return;
  }
  positionBrushCursor(e.clientX, e.clientY);
}

function updateBrushCursorStyle() {
  const cursor = elements.brushCursor;
  const fill = elements.brushCursorFill;
  const size = Math.max(2, state.brush.lineWidth * state.scale);

  cursor.style.width = `${size}px`;
  cursor.style.height = `${size}px`;

  if (state.tool === 'eraser') {
    fill.style.backgroundColor = 'rgba(255, 255, 255, 0.55)';
    fill.style.opacity = '1';
  } else if (SHAPE_TOOLS.includes(state.tool)) {
    // 形状工具：圈内透明只看尺寸，实际形状在 overlay 上预览
    fill.style.backgroundColor = 'transparent';
    fill.style.opacity = '1';
  } else {
    fill.style.backgroundColor = state.brush.color;
    fill.style.opacity = state.brush.opacity;
  }

  // 羽化只柔化填充，双层描边保持清晰，白笔画在白底上也能看到位置
  const featherBlur = state.brush.feather > 0
    ? Math.min(size * 0.12, 14) * state.brush.feather
    : 0;
  fill.style.filter = featherBlur > 0 ? `blur(${featherBlur.toFixed(2)}px)` : 'none';

  if (state.tool === 'text' || (state.altDown && !gesture)) {
    cursor.style.display = 'none';
  }

  if (state.tool === 'text') {
    elements.overlayCanvas.style.cursor = 'text';
  } else if (state.altDown && !gesture) {
    // 按住 Alt = 临时取色器
    elements.overlayCanvas.style.cursor = 'crosshair';
  } else if (gesture && gesture.type === 'pan') {
    elements.overlayCanvas.style.cursor = 'grabbing';
  } else if (state.spaceDown) {
    elements.overlayCanvas.style.cursor = 'grab';
  } else {
    elements.overlayCanvas.style.cursor = 'none';
  }
}

function updateBrushPreview() {
  const dot = elements.brushPreviewDot;
  const size = clamp(state.brush.lineWidth, 2, 28);
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  if (state.tool === 'eraser') {
    dot.style.backgroundColor = '#ffffff';
    dot.style.border = '1px solid #666666';
  } else {
    dot.style.backgroundColor = state.brush.color;
    dot.style.border = 'none';
  }
  dot.style.opacity = state.brush.opacity;
  // 预览点的边缘柔化程度反映羽化（橡皮擦始终是硬边）
  dot.style.filter = (state.brush.feather > 0 && state.tool !== 'eraser')
    ? `blur(${state.brush.feather * (size + 4) * 0.3}px)`
    : 'none';
}

// ========== 最近颜色 ==========
function addRecentColor(color) {
  state.recentColors = state.recentColors.filter(c => c !== color);
  state.recentColors.unshift(color);
  if (state.recentColors.length > 5) state.recentColors.pop();
  renderRecentColors();
}

function renderRecentColors() {
  elements.recentColors.innerHTML = '';
  state.recentColors.forEach(color => {
    const btn = document.createElement('div');
    btn.className = 'recent-color-btn';
    btn.style.backgroundColor = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      applyColor(color);
      addRecentColor(color);
      const selected = getSelectedText();
      if (selected) pushHistory();
    });
    elements.recentColors.appendChild(btn);
  });
}

function applyColor(color) {
  state.brush.color = color;
  elements.colorPicker.value = color;
  const selected = getSelectedText();
  if (selected) selected.color = color;
  updateBrushPreview();
  updateBrushCursorStyle();
  renderOverlay();
}

/**
* 吸色：按住 Alt 点击画布，取点击处“屏幕上看到的”颜色作为笔画颜色
*/
function pickColorAt(clientX, clientY) {
  const rect = elements.overlayCanvas.getBoundingClientRect();
  const dpr = getDpr();
  const px = Math.round((clientX - rect.left) * dpr);
  const py = Math.round((clientY - rect.top) * dpr);

  // 从下往上合成：画笔层 -> 文字层，透明处按白底算
  let r = 255, g = 255, b = 255;
  [drawCtx, overlayCtx].forEach(ctx => {
    const sample = averagePixel(ctx, px, py, 3);
    if (!sample.a) return;
    r = sample.r * sample.a + r * (1 - sample.a);
    g = sample.g * sample.a + g * (1 - sample.a);
    b = sample.b * sample.a + b * (1 - sample.a);
  });

  const color = '#' + [r, g, b]
    .map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
    .join('');

  applyColor(color);
  addRecentColor(color);
}

/**
* 取以 (px, py) 为中心、size×size 区域的加权平均颜色
* 按 alpha 加权，避免描边抗锯齿的透明像素把颜色拉灰
*/
function averagePixel(ctx, px, py, size) {
  const half = Math.floor(size / 2);
  const x = Math.round(clamp(px - half, 0, Math.max(0, ctx.canvas.width - size)));
  const y = Math.round(clamp(py - half, 0, Math.max(0, ctx.canvas.height - size)));
  const data = ctx.getImageData(x, y, size, size).data;
  let r = 0, g = 0, b = 0, alphaSum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (!alpha) continue;
    r += data[i] * alpha;
    g += data[i + 1] * alpha;
    b += data[i + 2] * alpha;
    alphaSum += alpha;
    count++;
  }
  if (!count) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: r / alphaSum, g: g / alphaSum, b: b / alphaSum, a: alphaSum / count };
}

// ========== 工具栏与快捷键 ==========
function setTool(tool) {
  closeTextEditor(true);
  state.tool = tool;
  state.selectedTextId = null;

  elements.toolBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  elements.rectRadiusControl.style.display = tool === 'rect' ? 'flex' : 'none';
  elements.textStyleControl.style.display = tool === 'text' ? 'flex' : 'none';

  renderOverlay();
  updateBrushPreview();
  updateBrushCursorStyle();
}

/**
* 打开 / 关闭使用说明（首次访问会自动打开）
*/
function toggleHelp(show) {
  elements.helpModal.hidden = !show;
  if (show) {
    elements.helpOkBtn.focus();
    try {
      localStorage.setItem(HELP_SEEN_KEY, '1');
    } catch (err) {
      // 隐私模式下 localStorage 可能不可用，忽略
    }
  } else {
    // 收起时把焦点还给页面，避免空格键继续触发按钮
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
  }
}

/**
* 收起 / 展开左侧工具胶囊
* @param {boolean} collapsed
* @param {boolean} persist 是否记住状态
*/
function setSideCollapsed(collapsed, persist = true) {
  elements.toolCapsule.classList.toggle('is-collapsed', collapsed);
  elements.sideToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  elements.sideToggleBtn.setAttribute('aria-label', collapsed ? '展开左侧工具栏' : '收起左侧工具栏');
  elements.sideToggleBtn.title = collapsed ? '展开左侧工具栏' : '收起左侧工具栏';
  elements.sideToggleBtn.classList.toggle('is-on', !collapsed);

  if (!persist) return;
  try {
    localStorage.setItem(SIDE_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch (err) {
    // 隐私模式下 localStorage 不可用，忽略
  }
}

function bindToolbar() {
  // 顶部胶囊最左按钮：收起 / 展开左侧工具胶囊
  elements.sideToggleBtn.addEventListener('click', () => {
    setSideCollapsed(!elements.toolCapsule.classList.contains('is-collapsed'));
  });

  elements.toolBtns.forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // 颜色
  elements.colorPicker.addEventListener('input', e => applyColor(e.target.value));
  elements.colorPicker.addEventListener('change', e => {
    addRecentColor(e.target.value);
    if (getSelectedText()) pushHistory();
  });

  // 粗细
  elements.lineWidth.addEventListener('input', e => setBrushWidth(Number(e.target.value)));

  // 羽化
  elements.feather.addEventListener('input', e => setBrushFeather(Number(e.target.value)));

  // 透明度
  elements.opacity.addEventListener('input', e => setBrushOpacity(Number(e.target.value)));
  elements.opacity.addEventListener('change', () => {
    if (getSelectedText()) pushHistory();
  });

  // 矩形圆角
  elements.rectRadius.addEventListener('input', e => {
    state.brush.rectRadius = Number(e.target.value);
    elements.rectRadiusValue.textContent = `${state.brush.rectRadius}px`;
  });

  // 字号（可同时修改选中文本）
  elements.fontSize.addEventListener('input', e => {
    state.text.fontSize = Number(e.target.value);
    elements.fontSizeValue.textContent = `${state.text.fontSize}px`;
    const selected = getSelectedText();
    if (selected) {
      selected.fontSize = state.text.fontSize;
      renderOverlay();
    }
  });
  elements.fontSize.addEventListener('change', () => {
    if (getSelectedText()) pushHistory();
  });

  // 编辑按钮
  elements.undoBtn.addEventListener('click', undo);
  elements.redoBtn.addEventListener('click', redo);
  elements.clearBtn.addEventListener('click', clearCanvas);
  elements.saveBtn.addEventListener('click', saveImage);

  // 缩放
  elements.zoomInBtn.addEventListener('click', () => setScale(state.scale * 1.25));
  elements.zoomOutBtn.addEventListener('click', () => setScale(state.scale / 1.25));
  elements.zoomResetBtn.addEventListener('click', resetZoom);
  elements.zoomValue.addEventListener('click', resetZoom);
  elements.fitCanvasBtn.addEventListener('click', fitViewToContent);

  // 使用说明
  elements.helpBtn.addEventListener('click', () => toggleHelp(true));
  elements.helpCloseBtn.addEventListener('click', () => toggleHelp(false));
  elements.helpOkBtn.addEventListener('click', () => toggleHelp(false));
  elements.helpModal.addEventListener('click', e => {
    // 点击遮罩空白处关闭
    if (e.target === elements.helpModal) toggleHelp(false);
  });

  // 文本内联编辑器事件
  elements.textEditor.addEventListener('input', () => {
    if (!editingText) return;
    editingText.content = elements.textEditor.value;
    syncTextEditor();
    renderOverlay();
  });
  elements.textEditor.addEventListener('blur', () => {
    if (editingText) closeTextEditor(true);
  });
  elements.textEditor.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      closeTextEditor(true);
    }
    e.stopPropagation();
  });
}

function bindCanvas() {
  const overlay = elements.overlayCanvas;

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('contextmenu', e => e.preventDefault());
  overlay.addEventListener('pointerleave', () => {
    if (!gesture) elements.brushCursor.style.display = 'none';
  });

  // 滚轮：默认以光标为中心缩放；Alt + 滚轮调整画笔透明度
  elements.viewport.addEventListener('wheel', e => {
    if (editingText) return;
    e.preventDefault();

    if (e.altKey) {
      setBrushOpacity(state.brush.opacity + (e.deltaY > 0 ? -0.1 : 0.1));
      return;
    }

    const step = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    setScale(state.scale * step, e.clientX, e.clientY);
  }, { passive: false });

  // 指针在画布外松开时也能结束平移 / 调粗细，避免手势状态残留
  window.addEventListener('pointerup', e => {
    if (!gesture) return;
    if (gesture.type === 'pan' || gesture.type === 'brush-adjust') onPointerUp(e);
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', e => {
    // 正在编辑文本时交给输入框自己处理
    if (e.target === elements.textEditor) return;

    const modifier = e.ctrlKey || e.metaKey;

    // 说明面板打开时只响应 Esc
    if (!elements.helpModal.hidden) {
      if (e.key === 'Escape') {
        e.preventDefault();
        toggleHelp(false);
      }
      return;
    }

    // 空格按住 = 平移模式。必须放在其它按键处理前面：
    // 否则焦点停在工具栏按钮 / 滑块上时，空格会被当成「激活按钮」而不是平移，
    // 表现为空格 + 拖动偶尔失效
    if (e.code === 'Space') {
      const el = e.target;
      const tag = el && el.tagName;
      const isTyping = tag === 'TEXTAREA' ||
        (tag === 'INPUT' && el.type !== 'range' && el.type !== 'color') ||
        !!(el && el.isContentEditable);
      if (isTyping) return;

      // 焦点在按钮上时先移除焦点，避免松开空格后触发该按钮
      if (tag === 'BUTTON' && typeof el.blur === 'function') el.blur();
      e.preventDefault();

      if (!state.spaceDown) {
        state.spaceDown = true;
        elements.overlayCanvas.style.cursor = 'grab';
        elements.brushCursor.style.display = 'none';
      }
      return;
    }

    // 按住 Alt = 临时吸色：阻止 Chrome 把 Alt 当成菜单键，并切换光标
    if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
      e.preventDefault();
      if (!state.altDown) {
        state.altDown = true;
        updateBrushCursorStyle();
      }
      return;
    }

    if (modifier && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (modifier && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }

    if (e.key === 'Escape') {
      if (editingText) closeTextEditor(true);
      if (state.selectedTextId) {
        state.selectedTextId = null;
        renderOverlay();
      }
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedTextId && !editingText) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      deleteSelectedText();
      return;
    }

    // 单键快捷键（PS 习惯）：切换工具 / 笔画粗细 / 说明
    if (!modifier && !e.altKey) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      const toolKeys = {
        p: 'pencil',
        l: 'line',
        r: 'rect',
        o: 'ellipse',
        t: 'text',
        e: 'eraser'
      };
      if (Object.prototype.hasOwnProperty.call(toolKeys, key)) {
        e.preventDefault();
        setTool(toolKeys[key]);
        return;
      }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        setBrushWidth(state.brush.lineWidth + (e.key === ']' ? 1 : -1));
        return;
      }
      if (key === 'h') {
        e.preventDefault();
        toggleHelp(true);
        return;
      }
    }
  });

  document.addEventListener('keyup', e => {
    if (e.key === 'Alt') {
      state.altDown = false;
      updateBrushCursorStyle();
    }
    if (e.code === 'Space') {
      state.spaceDown = false;
      updateBrushCursorStyle();
    }
  });

  // 窗口失焦时正常收尾进行中的手势，避免状态残留或与操作序列脱节
  window.addEventListener('blur', () => {
    state.spaceDown = false;
    state.altDown = false;
    updateBrushCursorStyle();
    if (!gesture) return;
    switch (gesture.type) {
      case 'brush-adjust':
        endBrushAdjust();
        break;
      case 'stroke':
        endStroke();
        break;
      case 'shape':
        endShape();
        break;
      case 'text-drag': {
        const moved = gesture.moved;
        gesture = null;
        if (moved) pushHistory();
        renderOverlay();
        break;
      }
      case 'text-resize': {
        const changed = gesture.changed;
        gesture = null;
        if (changed) pushHistory();
        renderOverlay();
        break;
      }
      default:
        endPan();
    }
  });
}

// ========== 清空 / 导出 ==========
function clearCanvas() {
  if (!confirm('确定要清空画布吗？（清空后仍可用撤销恢复）')) return;
  closeTextEditor(false);
  drawOps = [];
  state.textObjects = [];
  state.selectedTextId = null;
  renderAll();
  pushHistory();
}

function saveImage() {
  closeTextEditor(true);

  const box = contentBounds();
  if (!box) {
    alert('画布还是空的，先画点什么再保存吧。');
    return;
  }

  // 导出范围 = 内容包围盒 + 留白，与当前缩放、平移无关
  const margin = 24;
  const originX = box.x - margin;
  const originY = box.y - margin;
  const width = Math.max(1, Math.round(box.right - box.x + margin * 2));
  const height = Math.max(1, Math.round(box.bottom - box.y + margin * 2));

  // 按设备像素比导出原图，同时限制最大边长，避免超大画布导出失败
  const ratio = Math.max(1, Math.min(getDpr(), 8192 / Math.max(width, height)));

  // 内容先画在透明画布上，橡皮擦才能真擦除，最后再合成白底
  const content = document.createElement('canvas');
  content.width = Math.round(width * ratio);
  content.height = Math.round(height * ratio);
  const contentCtx = content.getContext('2d');
  contentCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  contentCtx.translate(-originX, -originY);

  drawOps.forEach(op => drawOp(contentCtx, op));
  state.textObjects.forEach(obj => drawTextObject(contentCtx, obj));

  const canvas = document.createElement('canvas');
  canvas.width = content.width;
  canvas.height = content.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(content, 0, 0);

  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `白板_${stamp}.png`;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

// ========== 画布尺寸适配 ==========
/**
* 现有内容的包围盒（逻辑坐标），画布为空时返回 null
*/
function contentBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const grow = (x, y, pad) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  };

  drawOps.forEach(op => {
    // 羽化会让笔画边缘向外扩散，包围盒要一起放宽
    const pad = op.width / 2 + (op.feather || 0) * op.width * 1.5;
    if (op.type === 'stroke') {
      op.points.forEach(p => grow(p.x, p.y, pad));
    } else if (op.type === 'shape') {
      if (op.tool === 'line') {
        grow(op.start.x, op.start.y, pad);
        grow(op.end.x, op.end.y, pad);
      } else {
        // 矩形以 start/end 为对角，椭圆以 start 为圆心：包围盒都是这对角框
        grow(Math.min(op.start.x, op.end.x), Math.min(op.start.y, op.end.y), pad);
        grow(Math.max(op.start.x, op.end.x), Math.max(op.start.y, op.end.y), pad);
      }
    }
  });

  state.textObjects.forEach(obj => {
    const box = textBox(obj);
    grow(box.x, box.y, 2);
    grow(box.x + box.w, box.y + box.h, 2);
  });

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, right: maxX, bottom: maxY };
}

/**
* 计算悬浮胶囊占用的视图安全区
* 「适应内容」要让内容落在胶囊之外，否则会被顶部 / 左侧的工具栏盖住
*/
function getCapsuleInsets() {
  const gap = 24;                                  // 内容与胶囊之间的间距
  const inset = { top: gap, right: gap, bottom: gap, left: gap };

  const topRect = elements.topCapsule.getBoundingClientRect();
  if (topRect.height) inset.top = Math.max(gap, topRect.bottom + gap);

  // 收起时左胶囊被移出视口，不再占用空间
  if (!elements.toolCapsule.classList.contains('is-collapsed')) {
    const toolRect = elements.toolCapsule.getBoundingClientRect();
    inset.left = Math.max(gap, toolRect.right + gap);
  }
  return inset;
}

/**
* 缩放并居中显示全部内容（画面为空时回到 100%）
* 可用区域已排除顶部与左侧胶囊的遮挡，内容不会被工具栏盖住
*/
function fitViewToContent() {
  closeTextEditor(true);

  const box = contentBounds();
  if (!box) {
    resetZoom();
    return;
  }

  const inset = getCapsuleInsets();
  const availW = Math.max(40, state.view.w - inset.left - inset.right);
  const availH = Math.max(40, state.view.h - inset.top - inset.bottom);
  const contentW = Math.max(1, box.right - box.x);
  const contentH = Math.max(1, box.bottom - box.y);

  const nextScale = clamp(Math.min(availW / contentW, availH / contentH), MIN_SCALE, MAX_SCALE);
  state.scale = Math.round(nextScale * 100) / 100;

  // 在胶囊之间的空白区域里居中
  state.offset.x = inset.left + (availW - contentW * state.scale) / 2 - box.x * state.scale;
  state.offset.y = inset.top + (availH - contentH * state.scale) / 2 - box.y * state.scale;

  updateZoomLabel();
  renderAll();
}

// ========== 窗口尺寸 ==========
function onWindowResize() {
  // 平移中途改窗口尺寸：先把预览位移并回真实 offset
  if (gesture && gesture.type === 'pan') endPan();

  // 画布始终等于窗口大小，窗口变化时重新分配像素尺寸并重绘
  resizeCanvases();
  renderAll();
  if (editingText) syncTextEditor();
  updateBrushCursorStyle();
}

/**
* 画布上是否有内容（用于关闭前的提醒）
*/
function hasCanvasContent() {
  return drawOps.length > 0 || state.textObjects.length > 0;
}

/**
* 关闭 / 刷新页面前，画布非空时提醒，避免误关丢图
*/
function bindUnloadGuard() {
  window.addEventListener('beforeunload', e => {
    if (!hasCanvasContent()) return;
    // 现代浏览器只弹通用提示，自定文案不允许展示
    e.preventDefault();
    e.returnValue = '';
  });
}

// ========== 初始化 ==========
function init() {
  resizeCanvases();
  bindToolbar();
  bindCanvas();
  bindKeyboard();
  bindUnloadGuard();
  window.addEventListener('resize', onWindowResize);

  // 恢复左侧工具栏的收起状态（首次访问默认展开）
  let sideCollapsed = false;
  try {
    sideCollapsed = localStorage.getItem(SIDE_COLLAPSED_KEY) === '1';
  } catch (err) {
    sideCollapsed = false;
  }
  setSideCollapsed(sideCollapsed, false);

  addRecentColor('#000000');
  elements.lineWidthValue.textContent = `${state.brush.lineWidth}px`;
  elements.opacityValue.textContent = state.brush.opacity.toFixed(1);
  updateBrushPreview();
  updateBrushCursorStyle();

  renderAll();
  pushHistory();          // 初始空状态，保证首次撤销回到空白
  updateHistoryButtons();

  // 首次访问自动展开使用说明（看过一次后不再打扰）
  let seenHelp = false;
  try {
    seenHelp = localStorage.getItem(HELP_SEEN_KEY) === '1';
  } catch (err) {
    seenHelp = true;      // localStorage 不可用（隐私模式）时不再反复弹
  }
  if (!seenHelp) toggleHelp(true);
}

document.addEventListener('DOMContentLoaded', init);

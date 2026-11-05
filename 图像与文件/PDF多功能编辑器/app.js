let pdfDoc = null;
let loadedFileName = '';

// 历史快照：每一步存一份 PDF 字节，回退/前进即重新载入其中一份
const history = [];
let historyIndex = -1;
let navigating = false;
const MAX_HISTORY_STEPS = 8;
const HISTORY_BUDGET = 200 * 1024 * 1024; // 快照总字节上限，避免大文件把内存吃满

const $ = (id) => document.getElementById(id);

const dropZone = $('dropZone');
const previewEmpty = $('previewEmpty');

/* ---------- 轻提示 ---------- */
function toast(message, type) {
  const box = document.createElement('div');
  box.className = 'toast' + (type ? ' toast-' + type : '');
  box.textContent = message;
  $('toasts').appendChild(box);

  requestAnimationFrame(() => box.classList.add('is-in'));
  setTimeout(() => {
    box.classList.remove('is-in');
    setTimeout(() => box.remove(), 220);
  }, 2600);
}

/* ---------- 载入遮罩 ---------- */
function showBusy(text, sub) {
  if (text) $('busyText').textContent = text;
  // 不传副标题就保留上一步的（例如文件名），避免阶段切换时丢信息
  if (sub) $('busySub').textContent = sub;
  $('busyOverlay').hidden = false;
}

function hideBusy() {
  $('busyOverlay').hidden = true;
}

// 大文件解析是同步阻塞的，先让浏览器把遮罩画出来；后台标签页 rAF 会暂停，直接放行
function nextFrame() {
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 60);
  });
}

async function setBusy(text, sub) {
  showBusy(text, sub);
  await nextFrame();
}

/* ---------- 内置预览（pdf.js 自绘，不用浏览器自带 PDF 查看器） ---------- */
const PDF_WORKER_SRC = new URL('./压缩/pdf.worker.min.js', location.href).href;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

const pdfView = {
  doc: null,
  token: 0,
  scale: 1,
  fitScale: 1,
  fitWidth: true,
  page: 1,
  rotation: 0,
  showThumbs: true,
  thumbsTouched: false,
  twoUp: false,
  showAnnotations: true,
  annotating: false,
  presenting: false,
  presentPage: 1,
  shells: [],
  observer: null,
  thumbs: [],
  thumbToken: 0,
  thumbObserver: null,
  byteLength: 0,
  pdfVersion: '',
  pageSize: ''
};

const THUMB_WIDTH = 92;

// 页面自带旋转 + 用户手动旋转，传给 pdf.js 的 rotation 必须是 90 的倍数
function viewportOf(page, scale) {
  return page.getViewport({scale, rotation: (page.rotate + pdfView.rotation) % 360});
}

function detectPdfVersion(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 24));
  const match = /%PDF-(\d+\.\d+)/.exec(head);
  return match ? match[1] : '';
}

// file:// 下浏览器不允许创建 Worker，改为把 worker 脚本载入主线程当假 Worker
function ensurePdfWorker() {
  if (location.protocol !== 'file:' || window.pdfjsWorker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDF_WORKER_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('PDF 渲染引擎加载失败'));
    document.head.appendChild(script);
  });
}

// worker 脚本有 1MB 多，编译会卡主线程；空闲时先载入，第一次导入就不用再等
function preloadPdfWorker() {
  if (location.protocol !== 'file:' || window.pdfjsWorker) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => {
    ensurePdfWorker().catch(() => { /* 预载失败不影响正式导入时的报错 */ });
  });
}

function setViewerStatus(message) {
  const box = $('viewerStatus');
  box.textContent = message || '';
  box.hidden = !message;
}

async function renderPreview(pdfBytes, options) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('PDF 渲染引擎未加载');

  // 导入时是 File.arrayBuffer()，编辑后是 pdf-lib save() 的 Uint8Array，统一成字节视图再往下用
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  await ensurePdfWorker();
  lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

  // 增删页后有页码对照表，就按它把标注搬到新页码；
  // 历史回退已经还原过标注快照，原样保留；换文件才清空
  const pageMap = options && options.pageMap;
  if (pageMap) {
    remapAnnotations(pageMap);
  } else if (!(options && options.keepAnnotations) && annotations.size) {
    clearAnnotations();
    toast('页面已改动，标注已清空', 'err');
  }

  destroyPreview();
  const token = ++pdfView.token;

  pdfView.byteLength = bytes.byteLength;
  pdfView.pdfVersion = detectPdfVersion(bytes);

  // pdf.js 会把数据转移给 worker，必须传副本，否则历史快照的字节会被分离
  const copy = bytes.slice();
  const doc = await lib.getDocument({data: copy, verbosity: 0}).promise;
  if (token !== pdfView.token) {
    doc.destroy();
    return;
  }

  pdfView.doc = doc;
  pdfView.page = 1;
  pdfView.rotation = 0;
  pdfView.fitWidth = true;
  $('viewPageTotal').textContent = doc.numPages;
  $('viewPageInput').max = String(doc.numPages);
  $('viewerBar').hidden = false;
  $('viewerBody').hidden = false;
  previewEmpty.hidden = true;
  setViewerStatus('');

  await setBusy('正在排版页面…', '共 ' + doc.numPages + ' 页');
  buildThumbs();
  await layoutPreview();
}

function destroyPreview() {
  pdfView.token += 1;
  pdfView.thumbToken += 1;
  disconnectObserver();
  pdfView.shells.forEach(cancelRenderTask);
  pdfView.thumbs.forEach(cancelRenderTask);
  pdfView.shells = [];
  pdfView.thumbs = [];
  $('viewerPages').textContent = '';
  $('viewerThumbList').textContent = '';
  if (pdfView.doc) {
    try { pdfView.doc.destroy(); } catch (error) { /* 忽略销毁异常 */ }
    pdfView.doc = null;
  }
  $('viewerBar').hidden = true;
  $('viewerBody').hidden = true;
  $('infoPanel').hidden = true;
  stopPresent();
  setViewerStatus('');
}

function showPreviewError(message) {
  destroyPreview();
  previewEmpty.hidden = true;
  setViewerStatus(message);
}

function cancelRenderTask(host) {
  if (!host._task) return;
  try { host._task.cancel(); } catch (error) { /* 忽略取消异常 */ }
  host._task = null;
}

function disconnectObserver() {
  if (!pdfView.observer) return;
  pdfView.observer.disconnect();
  pdfView.observer = null;
}

// 重建所有页面占位块：换文件、缩放都走这里
async function layoutPreview() {
  const doc = pdfView.doc;
  if (!doc) return;

  const token = ++pdfView.token;
  disconnectObserver();
  pdfView.shells.forEach(cancelRenderTask);
  pdfView.shells = [];

  const scroll = $('viewerScroll');
  const container = $('viewerPages');
  const first = await doc.getPage(1);
  if (token !== pdfView.token) return;

  const base = viewportOf(first, 1);
  // 排版时页面高度还会变，滚动条可能尚未出现，始终预留它的宽度
  const scrollbar = Math.max(16, scroll.offsetWidth - scroll.clientWidth);
  const available = Math.max(120, scroll.clientWidth - scrollbar - 24);
  const perRow = pdfView.twoUp ? 2 : 1;
  const gap = 12;
  // 两页并排时留 1px 余量，避免亚像素舍入把第二页挤到下一行
  pdfView.fitScale = (available - (perRow - 1) * gap - 1) / (perRow * base.width);
  const scale = pdfView.fitWidth ? pdfView.fitScale : pdfView.scale;
  pdfView.scale = scale;
  pdfView.pageSize = Math.round(base.width) + ' × ' + Math.round(base.height) + ' pt';

  const width = Math.floor(base.width * scale);
  const height = Math.floor(base.height * scale);

  container.classList.toggle('two-up', pdfView.twoUp);
  container.textContent = '';
  for (let index = 1; index <= doc.numPages; index++) {
    const shell = document.createElement('div');
    shell.className = 'viewer-page';
    shell.dataset.page = String(index);
    shell.style.width = width + 'px';
    shell.style.height = height + 'px';

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    // 页面位图上面再叠一层透明文字，选中/复制靠它
    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    const annotCanvas = document.createElement('canvas');
    annotCanvas.className = 'annot-canvas';
    shell.append(canvas, textLayer, annotCanvas);
    shell._canvas = canvas;
    shell._text = textLayer;
    shell._annot = annotCanvas;

    container.appendChild(shell);
    pdfView.shells.push(shell);
  }

  pdfView.observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) renderShell(entry.target);
    });
  }, {root: scroll, rootMargin: '320px 0px'});
  pdfView.shells.forEach((shell) => pdfView.observer.observe(shell));

  scrollToPage(pdfView.page, false);
}

// 按需渲染：滚动到附近才开始画，大文件不会一次性铺满画布
async function renderShell(shell) {
  if (!pdfView.doc || shell.dataset.state || !shell.isConnected) return;
  shell.dataset.state = 'loading';

  const token = pdfView.token;
  try {
    const page = await pdfView.doc.getPage(Number(shell.dataset.page));
    if (token !== pdfView.token || !shell.isConnected) return;

    const scale = pdfView.scale;
    const viewport = viewportOf(page, scale);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = shell._canvas;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);

    shell.style.width = Math.floor(viewport.width) + 'px';
    shell.style.height = Math.floor(viewport.height) + 'px';
    shell._viewport = viewport;

    shell._task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: viewportOf(page, scale * ratio),
      annotationMode: annotationMode()
    });
    await shell._task.promise;
    shell._task = null;
    if (token !== pdfView.token || !shell.isConnected) return;

    await paintTextLayer(shell, page, viewport, token);
    if (token !== pdfView.token || !shell.isConnected) return;

    shell.dataset.state = 'done';
    redrawAnnot(shell);
  } catch (error) {
    if (error && error.name === 'RenderingCancelledException') return;
    if (token !== pdfView.token) return;
    console.error(error);
    shell.textContent = '第 ' + shell.dataset.page + ' 页渲染失败';
    shell.dataset.state = 'error';
  }
}

// PDF 里的文字本来就画在位图上，这里再叠一层透明文字，才能选中、复制和双击取词
async function paintTextLayer(shell, page, viewport, token) {
  const lib = window.pdfjsLib;
  const layer = shell._text;
  if (!layer || !lib || typeof lib.renderTextLayer !== 'function') return;
  try {
    const content = await page.getTextContent();
    if (token !== pdfView.token || !shell.isConnected) return;
    layer.textContent = '';
    layer.style.width = viewport.width + 'px';
    layer.style.height = viewport.height + 'px';
    shell._textTask = lib.renderTextLayer({textContentSource: content, container: layer, viewport});
    await shell._textTask.promise;
    shell._textTask = null;
  } catch (error) {
    shell._textTask = null;
    // 文字层只是锦上添花，失败不影响看图
    if (token === pdfView.token) console.warn('文字层渲染失败', error);
  }
}

// 注释（PDF 内已有的批注、表单、链接框）是否画在画布上
function annotationMode() {
  const lib = window.pdfjsLib;
  if (!lib || !lib.AnnotationMode) return undefined;
  return pdfView.showAnnotations ? lib.AnnotationMode.ENABLE : lib.AnnotationMode.DISABLE;
}

/* ---------- 左侧页面缩略图 ---------- */
function buildThumbs() {
  const doc = pdfView.doc;
  const list = $('viewerThumbList');

  if (pdfView.thumbObserver) {
    pdfView.thumbObserver.disconnect();
    pdfView.thumbObserver = null;
  }
  pdfView.thumbs.forEach(cancelRenderTask);
  pdfView.thumbs = [];
  list.textContent = '';
  pdfView.thumbToken += 1;
  if (!doc) return;

  for (let index = 1; index <= doc.numPages; index++) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'viewer-thumb';
    item.dataset.page = String(index);
    item.title = '第 ' + index + ' 页';

    const no = document.createElement('span');
    no.className = 'viewer-thumb-no';
    no.textContent = String(index);
    item.appendChild(no);

    item.addEventListener('click', () => scrollToPage(index, true));
    list.appendChild(item);
    pdfView.thumbs.push(item);
  }

  pdfView.thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) renderThumb(entry.target);
    });
  }, {root: $('viewerThumbs'), rootMargin: '200px 0px'});
  pdfView.thumbs.forEach((item) => pdfView.thumbObserver.observe(item));

  syncViewerUI();
}

// 缩略图同样按需渲染，只画侧栏附近的几页
async function renderThumb(item) {
  if (!pdfView.doc || item.dataset.state || !item.isConnected) return;
  item.dataset.state = 'loading';

  const token = pdfView.thumbToken;
  try {
    const page = await pdfView.doc.getPage(Number(item.dataset.page));
    if (token !== pdfView.thumbToken || !item.isConnected) return;

    const base = viewportOf(page, 1);
    const scale = THUMB_WIDTH / base.width;
    const viewport = viewportOf(page, scale);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = viewportOf(page, scale * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width * ratio));
    canvas.height = Math.max(1, Math.round(viewport.height * ratio));
    canvas.style.width = Math.round(viewport.width) + 'px';
    canvas.style.height = Math.round(viewport.height) + 'px';

    item._task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: renderViewport
    });
    await item._task.promise;
    item._task = null;
    if (token !== pdfView.thumbToken || !item.isConnected) return;

    drawStrokesOnCanvas(canvas, Number(item.dataset.page), renderViewport, scale * ratio);
    item.insertBefore(canvas, item.firstChild);
    item.dataset.state = 'done';
  } catch (error) {
    if (error && error.name === 'RenderingCancelledException') return;
    if (token !== pdfView.thumbToken) return;
    item.dataset.state = 'error';
  }
}

// 缩略图、演示页都要能看到手绘标注，直接在渲染好的位图上补画
function drawStrokesOnCanvas(canvas, pageNumber, viewport, scale) {
  const strokes = annotations.get(pageNumber);
  if (!strokes || !strokes.length) return;
  const ctx = canvas.getContext('2d');
  strokes.forEach((stroke) => drawStroke(ctx, stroke, viewport, scale));
}

// 滚动主视图时让当前页缩略图保持在侧栏可视范围内
function ensureThumbVisible(item) {
  const box = $('viewerThumbs');
  if (!box || $('viewerBody').classList.contains('thumbs-off')) return;
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top - 8;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 8;
}

function applyThumbsVisibility() {
  $('viewerBody').classList.toggle('thumbs-off', !pdfView.showThumbs);
  $('thumbsBtn').setAttribute('aria-pressed', String(pdfView.showThumbs));
}

function toggleThumbs() {
  pdfView.showThumbs = !pdfView.showThumbs;
  pdfView.thumbsTouched = true;
  applyThumbsVisibility();
  // 侧栏宽度变化会改变可视宽度，重新排版才能算准适应宽度
  layoutPreview();
}

/* ---------- 双页并排 / 注释开关 ---------- */
function toggleTwoUp() {
  if (!pdfView.doc) return;
  pdfView.twoUp = !pdfView.twoUp;
  $('twoUpBtn').setAttribute('aria-pressed', String(pdfView.twoUp));
  layoutPreview();
}

function toggleAnnotations() {
  if (!pdfView.doc) return;
  pdfView.showAnnotations = !pdfView.showAnnotations;
  $('annotationsBtn').setAttribute('aria-pressed', String(pdfView.showAnnotations));
  layoutPreview();
}

/* ---------- 文档属性 ---------- */
function formatPdfDate(value) {
  if (!value) return '';
  // PDF 日期形如 D:20240101123000+08'00'
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!match) return value;
  const [, year, month = '00', day = '00', hour = '00', minute = '00', second = '00'] = match;
  const time = `${hour}:${minute}:${second}`;
  return `${year}-${month}-${day}` + (time === '00:00:00' ? '' : ' ' + time);
}

async function showInfo() {
  if (!pdfView.doc) return;

  let info = {};
  try {
    const meta = await pdfView.doc.getMetadata();
    info = (meta && meta.info) || {};
  } catch (error) {
    console.error(error);
  }

  const rows = [
    ['文件名', loadedFileName || '（未命名）'],
    ['页数', pdfView.doc.numPages + ' 页'],
    ['文件大小', pdfView.byteLength ? formatSize(pdfView.byteLength) : ''],
    ['PDF 版本', pdfView.pdfVersion ? 'PDF ' + pdfView.pdfVersion : ''],
    ['页面尺寸', pdfView.pageSize],
    ['标题', info.Title],
    ['作者', info.Author],
    ['主题', info.Subject],
    ['关键词', info.Keywords],
    ['创建程序', info.Creator],
    ['生成程序', info.Producer],
    ['创建时间', formatPdfDate(info.CreationDate)],
    ['修改时间', formatPdfDate(info.ModDate)]
  ];

  const list = $('infoList');
  list.textContent = '';
  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value || '—';
    list.append(dt, dd);
  });

  $('infoPanel').hidden = false;
}

/* ---------- 全屏演示 ---------- */
async function startPresent() {
  if (!pdfView.doc || pdfView.presenting) return;
  pdfView.presenting = true;
  pdfView.presentPage = pdfView.page || 1;
  $('previewPane').classList.add('is-presenting');
  $('presentStage').hidden = false;

  try {
    await $('previewPane').requestFullscreen();
  } catch (error) {
    // 全屏被拒时仍在预览框内放映
  }
  await drawPresentPage();
}

function stopPresent() {
  if (!pdfView.presenting) return;
  pdfView.presenting = false;
  $('previewPane').classList.remove('is-presenting');
  $('presentStage').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  scrollToPage(pdfView.page, false);
}

function presentStep(delta) {
  if (!pdfView.presenting || !pdfView.doc) return;
  const total = pdfView.doc.numPages;
  pdfView.presentPage = Math.min(Math.max(1, pdfView.presentPage + delta), total);
  drawPresentPage();
}

async function drawPresentPage() {
  const doc = pdfView.doc;
  if (!doc || !pdfView.presenting) return;

  const token = pdfView.token;
  const stage = $('presentStage');
  const page = await doc.getPage(pdfView.presentPage);
  if (token !== pdfView.token) return;

  const base = viewportOf(page, 1);
  const availableWidth = Math.max(160, stage.clientWidth - 40);
  const availableHeight = Math.max(160, stage.clientHeight - 64);
  const scale = Math.min(availableWidth / base.width, availableHeight / base.height);
  const viewport = viewportOf(page, scale);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const renderViewport = viewportOf(page, scale * ratio);

  const canvas = $('presentCanvas');
  canvas.width = Math.round(viewport.width * ratio);
  canvas.height = Math.round(viewport.height * ratio);
  canvas.style.width = Math.round(viewport.width) + 'px';
  canvas.style.height = Math.round(viewport.height) + 'px';

  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport: renderViewport,
    annotationMode: annotationMode()
  }).promise;

  // 放映时同样带上手绘标注
  drawStrokesOnCanvas(canvas, pdfView.presentPage, renderViewport, scale * ratio);

  $('presentPage').textContent = pdfView.presentPage + ' / ' + doc.numPages;
  pdfView.page = pdfView.presentPage;
}

/* ---------- 手绘标注（坐标统一转成 PDF 空间，导出时直接落笔） ---------- */
const annotations = new Map();
const annotOrder = [];
const annotRedo = [];
const annotStyle = {tool: 'ink', color: '#E5484D', width: 4, alpha: 1};
let annotStroke = null;
let annotPage = 0;
let annotColorTouched = false;

// 每种工具记住自己的粗细（CSS 像素）和不透明度，荧光笔单独一套范围
const annotWidths = {pen: 4, marker: 18, text: 14, eraser: 16};
const annotAlphas = {pen: 1, marker: 0.32, text: 1, eraser: 1};
const PEN_WIDTH_RANGE = {min: 1, max: 16};
const MARKER_WIDTH_RANGE = {min: 6, max: 36};
const TEXT_SIZE_RANGE = {min: 8, max: 32};
const ERASER_WIDTH_RANGE = {min: 6, max: 44};
// 每笔画一个递增序号，擦除后撤销时按它插回原来的层级
let annotSeq = 0;

// 荧光笔默认半透明宽笔头，笔画之间不叠加出深色接缝
const MARKER_ALPHA = 0.32;
const MARKER_COLOR = '#F5A524';
// 注释便签字号固定；文字工具的字号走滑杆，单位是 PDF 点
const NOTE_SIZE = 11;
const NOTE_MAX_WIDTH = 190;
const TEXT_MAX_WIDTH = 260;
const TEXT_FONT = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
const isFreehand = (tool) => tool === 'ink' || tool === 'marker';
// 注释与文字不是路径，走文字排版渲染
const isBlockTool = (tool) => tool === 'note' || tool === 'text';
const widthKey = (tool) => (tool === 'marker' || tool === 'text' || tool === 'eraser' ? tool : 'pen');

function toggleAnnotate() {
  if (!pdfView.doc) {
    toast('请先上传 PDF 文件', 'err');
    return;
  }
  pdfView.annotating = !pdfView.annotating;
  $('annotateBtn').setAttribute('aria-pressed', String(pdfView.annotating));
  $('annotBar').hidden = !pdfView.annotating;
  $('viewerScroll').classList.toggle('is-annotating', pdfView.annotating);

  if (!pdfView.annotating) {
    annotStroke = null;
    eraseSession = null;
    closeColorPop();
    closeNoteEditor(false);
    closeNoteList();
    pdfView.shells.forEach(redrawAnnot);
  } else {
    toast('标注模式：在页面上拖动画图', 'ok');
  }
  syncAnnotCursor();
}

function clearAnnotations() {
  annotations.clear();
  annotOrder.length = 0;
  annotRedo.length = 0;
  annotStroke = null;
  eraseSession = null;
  pdfView.shells.forEach((shell) => {
    if (shell._annot) redrawAnnot(shell);
  });
  updateAnnotHistory();
}

// 增删页后按新页码搬标注：pageMap[i] 是新第 i+1 页对应的旧页码，0 表示新插入的页
function remapAnnotations(pageMap) {
  const next = new Map();
  pageMap.forEach((oldPage, index) => {
    const strokes = oldPage ? annotations.get(oldPage) : null;
    if (strokes && strokes.length) next.set(index + 1, strokes);
  });
  annotations.clear();
  next.forEach((strokes, page) => annotations.set(page, strokes));

  // 撤销栈里记的还是旧页码，一并换算；对应页被删掉的记录直接丢掉
  const pageOf = (oldPage) => {
    const index = pageMap.indexOf(oldPage);
    return index < 0 ? 0 : index + 1;
  };
  const rewrite = (entry) => {
    if (!entry.erase) {
      const page = pageOf(entry.page);
      if (!page) return null;
      entry.page = page;
      return entry;
    }
    const items = [];
    entry.items.forEach((item) => {
      const page = pageOf(item.page);
      if (page) items.push({page, stroke: item.stroke});
    });
    if (!items.length) return null;
    entry.items = items;
    entry.pages = [...new Set(items.map((item) => item.page))];
    return entry;
  };
  [annotOrder, annotRedo].forEach((stack) => {
    const kept = stack.map(rewrite).filter(Boolean);
    stack.length = 0;
    kept.forEach((entry) => stack.push(entry));
  });

  // 跳转高亮的块要是被删掉了，就把高亮一起清掉
  if (flashNote && ![...next.values()].some((strokes) => strokes.includes(flashNote))) flashNote = null;
  annotPage = 0;
  annotStroke = null;
  updateAnnotHistory();
  refreshNoteList();
}

// 插入整页后的页码对应关系，和 remapAnnotations 用的 pageMap 同格式
function pageMapAfterInsert(totalPages, insertIndex, count) {
  const map = [];
  for (let page = 1; page <= insertIndex; page += 1) map.push(page);
  for (let index = 0; index < count; index += 1) map.push(0);
  for (let page = insertIndex + 1; page <= totalPages; page += 1) map.push(page);
  return map;
}

function annotPoint(shell, event) {
  const rect = shell.getBoundingClientRect();
  const [x, y] = shell._viewport.convertToPdfPoint(event.clientX - rect.left, event.clientY - rect.top);
  return {x, y};
}

function startStroke(shell, event) {
  if (!shell._viewport) return;
  annotPage = Number(shell.dataset.page);
  annotStroke = {
    type: annotStyle.tool,
    seq: ++annotSeq,
    color: annotStyle.color,
    width: Math.max(0.5, annotStyle.width / pdfView.scale), // CSS 像素转 PDF 点
    alpha: annotStyle.alpha,
    points: [annotPoint(shell, event)]
  };
  redrawAnnot(shell);
}

function extendStroke(shell, event) {
  if (!annotStroke || !shell._viewport) return;
  const point = annotPoint(shell, event);

  if (isFreehand(annotStroke.type)) {
    const last = annotStroke.points[annotStroke.points.length - 1];
    // 太近的点丢掉，减少导出时的线段数量
    if (Math.abs(point.x - last.x) < 0.4 && Math.abs(point.y - last.y) < 0.4) return;
    annotStroke.points.push(point);
  } else {
    annotStroke.points[1] = point;
  }
  redrawAnnot(shell);
}

function finishStroke(shell) {
  const stroke = annotStroke;
  annotStroke = null;
  if (!stroke) return;

  const [first, second] = stroke.points;
  const enough = isFreehand(stroke.type)
    ? stroke.points.length > 1
    : second && Math.abs(second.x - first.x) + Math.abs(second.y - first.y) > 1;

  if (enough) {
    addStroke({page: annotPage, stroke});
    annotRedo.length = 0;
    refreshAnnotPage(annotPage);
    updateAnnotHistory();
  } else {
    redrawAnnot(shell);
  }
}

function addStroke(entry) {
  if (!annotations.has(entry.page)) annotations.set(entry.page, []);
  annotations.get(entry.page).push(entry.stroke);
  annotOrder.push(entry);
}

function removeStroke(entry) {
  detachStroke(entry.page, entry.stroke);
}

function detachStroke(page, stroke) {
  const list = annotations.get(page);
  if (!list) return;
  const index = list.lastIndexOf(stroke);
  if (index >= 0) list.splice(index, 1);
  if (!list.length) annotations.delete(page);
  if (flashNote === stroke) flashNote = null;
}

// 按序号插回去，撤销擦除后层级才不会乱
function attachStroke(page, stroke) {
  if (!annotations.has(page)) annotations.set(page, []);
  const list = annotations.get(page);
  let at = list.length;
  for (let index = 0; index < list.length; index++) {
    if ((list[index].seq || 0) > (stroke.seq || 0)) {
      at = index;
      break;
    }
  }
  list.splice(at, 0, stroke);
}

// 一次擦除（或删除）记成一条可撤销的记录，items 里是被拿掉的笔画
function pushEraseOp(items) {
  if (!items.length) return;
  const pages = [...new Set(items.map((item) => item.page))];
  annotOrder.push({erase: true, pages, items});
  annotRedo.length = 0;
  pages.forEach(refreshAnnotPage);
  updateAnnotHistory();
  refreshNoteList();
}

function applyErase(op) {
  op.items.forEach((item) => detachStroke(item.page, item.stroke));
  op.pages.forEach(refreshAnnotPage);
}

function restoreErase(op) {
  op.items.forEach((item) => attachStroke(item.page, item.stroke));
  op.pages.forEach(refreshAnnotPage);
}

function updateAnnotHistory() {
  $('annotUndoBtn').disabled = !annotOrder.length;
  $('annotRedoBtn').disabled = !annotRedo.length;
}

function undoAnnotation() {
  const last = annotOrder.pop();
  if (!last) return;

  annotRedo.push(last);
  if (last.erase) {
    restoreErase(last);
    toast('已撤销擦除');
  } else {
    removeStroke(last);
    refreshAnnotPage(last.page);
    toast('已撤销一笔标注');
  }
  updateAnnotHistory();
  refreshNoteList();
}

function redoAnnotation() {
  const last = annotRedo.pop();
  if (!last) return;

  if (last.erase) {
    annotOrder.push(last);
    applyErase(last);
    toast('已重新擦除');
  } else {
    // addStroke 会自己压进 annotOrder
    addStroke(last);
    refreshAnnotPage(last.page);
    toast('已恢复一笔标注');
  }
  updateAnnotHistory();
  refreshNoteList();
}

function clearPageAnnotations() {
  const page = annotPage || pdfView.page;
  const list = annotations.get(page) || [];
  if (!list.length) {
    toast('第 ' + page + ' 页还没有标注', 'err');
    return;
  }

  const items = list.map((stroke) => ({page, stroke}));
  // 清空也记成一次擦除，误点了还能撤销回来
  applyErase({items, pages: [page]});
  pushEraseOp(items);
  toast('已清空第 ' + page + ' 页的标注');
}

/* ---------- 橡皮擦：按笔画整体擦掉，按住拖动可以连续擦 ---------- */
let eraseSession = null; // 一次按下到抬起的擦除记录

function segmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

// 笔画任何一部分落在橡皮圆圈里就算命中
function strokeHitsPoint(stroke, point, radius) {
  if (isBlockTool(stroke.type)) {
    const box = textBlockBox(stroke);
    const gapX = Math.max(box.x - point.x, 0, point.x - box.x - box.width);
    const gapY = Math.max(box.y - point.y, 0, point.y - box.y - box.height);
    return Math.hypot(gapX, gapY) <= radius;
  }

  const points = stroke.points || [];
  if (!points.length) return false;
  // 粗笔画多给半个笔宽，细笔尖也擦得中
  const reach = radius + Math.max(0, stroke.width || 0) / 2;
  if (isFreehand(stroke.type)) {
    if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= reach;
    for (let index = 1; index < points.length; index += 1) {
      if (segmentDistance(point, points[index - 1], points[index]) <= reach) return true;
    }
    return false;
  }

  const [first, second] = points;
  if (!second) return false;
  if (stroke.type === 'line') return segmentDistance(point, first, second) <= reach;

  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const bottom = Math.max(first.y, second.y);
  if (stroke.type === 'rect') {
    return segmentDistance(point, {x: left, y: top}, {x: right, y: top}) <= reach
      || segmentDistance(point, {x: right, y: top}, {x: right, y: bottom}) <= reach
      || segmentDistance(point, {x: right, y: bottom}, {x: left, y: bottom}) <= reach
      || segmentDistance(point, {x: left, y: bottom}, {x: left, y: top}) <= reach;
  }

  // 椭圆沿边界采样，精度够用
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const steps = 64;
  let previous = {x: cx + rx, y: cy};
  for (let index = 1; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const next = {x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle)};
    if (segmentDistance(point, previous, next) <= reach) return true;
    previous = next;
  }
  return false;
}

// 橡皮半径按屏幕像素给，换算成 PDF 点后和笔画同坐标系比较
function eraseRadius() {
  return Math.max(3, annotStyle.width / 2) / (pdfView.scale || 1);
}

function eraseAt(shell, event) {
  const page = Number(shell.dataset.page);
  const list = annotations.get(page);
  if (!list || !list.length) return false;
  const point = annotPoint(shell, event);
  const radius = eraseRadius();
  // 倒序遍历：压在上面的笔画先被擦掉
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const stroke = list[index];
    if (!strokeHitsPoint(stroke, point, radius)) continue;
    if (!eraseSession) eraseSession = {items: []};
    eraseSession.items.push({page, stroke});
    detachStroke(page, stroke);
    return true;
  }
  return false;
}

function finishErase() {
  const session = eraseSession;
  eraseSession = null;
  if (!session || !session.items.length) return;
  pushEraseOp(session.items);
  toast('已擦除 ' + session.items.length + ' 处标注');
}

/* ---------- 注释（便签）与页面文字的文字排版 ---------- */
const measureCtx = document.createElement('canvas').getContext('2d');
// 注释列表跳转后短暂高亮的块
let flashNote = null;

// 逐字累加宽度折行；遇到空格优先在此断开，英文单词不会从中间被切断
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  String(text || '').split(/\r?\n/).forEach((paragraph) => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    let line = '';
    for (const char of paragraph) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) {
        const space = line.lastIndexOf(' ');
        if (space > 0 && /[A-Za-z0-9]/.test(char)) {
          lines.push(line.slice(0, space));
          line = line.slice(space + 1) + char;
        } else {
          lines.push(line);
          line = char;
        }
      } else {
        line = next;
      }
    }
    lines.push(line);
  });
  return lines;
}

// 按 PDF 点排版；pxPerPt 只影响渲染精度，不改变导出尺寸
function textBlockMetrics(stroke, pxPerPt) {
  const note = stroke.type === 'note';
  const fontPx = Math.max(1, stroke.size * pxPerPt);
  const limit = (note ? NOTE_MAX_WIDTH : TEXT_MAX_WIDTH) * pxPerPt;
  const ctx = measureCtx;
  ctx.font = '500 ' + fontPx + 'px ' + TEXT_FONT;
  const lines = wrapText(ctx, stroke.text, limit);
  let textWidth = 0;
  lines.forEach((line) => {
    textWidth = Math.max(textWidth, ctx.measureText(line).width);
  });
  const lineHeight = fontPx * 1.45;
  const padX = note ? 6 * pxPerPt : 0;
  const padY = note ? 5 * pxPerPt : 0;
  const bar = note ? 3 * pxPerPt : 0;
  return {
    note,
    lines,
    fontPx,
    lineHeight,
    padX,
    padY,
    bar,
    width: textWidth + padX * 2 + bar,
    height: Math.max(lineHeight, lines.length * lineHeight) + padY * 2
  };
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// 预览、缩略图、演示、导出位图共用这一套画法，保证所见即所得
function paintTextBlock(ctx, stroke, x, y, pxPerPt) {
  const box = textBlockMetrics(stroke, pxPerPt);

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = '500 ' + box.fontPx + 'px ' + TEXT_FONT;

  if (box.note) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, box.width, box.height, 4 * pxPerPt);
    ctx.fillStyle = colorWithAlpha(stroke.color, .13);
    ctx.fill();
    // 左侧色条裁进圆角里，卡片边角才干净
    ctx.save();
    ctx.clip();
    ctx.fillStyle = colorWithAlpha(stroke.color, .92);
    ctx.fillRect(x, y, box.bar, box.height);
    ctx.restore();
    ctx.fillStyle = '#211C2B';
  } else {
    ctx.fillStyle = colorWithAlpha(stroke.color, stroke.alpha);
  }

  const textX = x + box.padX + box.bar;
  const textY = y + box.padY;
  box.lines.forEach((line, index) => {
    ctx.fillText(line, textX, textY + index * box.lineHeight);
  });
  ctx.restore();
  return box;
}

function drawTextStroke(ctx, stroke, viewport, scale) {
  const [x, y] = viewport.convertToViewportPoint(stroke.x, stroke.y);
  paintTextBlock(ctx, stroke, x, y, scale);
}

// PDF 空间下的外框（左下角 + 宽高），用于命中判断与高亮
function textBlockBox(stroke) {
  const box = textBlockMetrics(stroke, 1);
  return {x: stroke.x, y: stroke.y - box.height, width: box.width, height: box.height};
}

// 贴着页面边缘点下去时把块整体拉回页面内，导出才不会被裁掉
function fitBlockToPage(pageNumber, stroke) {
  const shell = pdfView.shells[pageNumber - 1];
  if (!shell || !shell._viewport || !pdfView.scale) return;
  const pageWidth = shell._viewport.width / pdfView.scale;
  const pageHeight = shell._viewport.height / pdfView.scale;
  const box = textBlockMetrics(stroke, 1);
  const margin = 2;
  stroke.x = Math.min(Math.max(margin, stroke.x), Math.max(margin, pageWidth - box.width - margin));
  stroke.y = Math.min(Math.max(box.height + margin, stroke.y), Math.max(box.height + margin, pageHeight - margin));
}

function hitTextBlock(pageNumber, point) {
  const list = annotations.get(pageNumber) || [];
  for (let index = list.length - 1; index >= 0; index--) {
    const stroke = list[index];
    if (!isBlockTool(stroke.type)) continue;
    const box = textBlockBox(stroke);
    // 外扩 2pt，小字也好点中
    if (point.x >= box.x - 2 && point.x <= box.x + box.width + 2
      && point.y >= box.y - 2 && point.y <= box.y + box.height + 2) {
      return stroke;
    }
  }
  return null;
}

function collectBlocks() {
  const items = [];
  annotations.forEach((strokes, page) => {
    strokes.forEach((stroke) => {
      if (isBlockTool(stroke.type)) items.push({page, stroke});
    });
  });
  return items.sort((a, b) => a.page - b.page);
}

function drawStroke(ctx, stroke, viewport, scale) {
  // 注释便签与页面文字不是路径，走文字渲染
  if (isBlockTool(stroke.type)) {
    drawTextStroke(ctx, stroke, viewport, scale);
    return;
  }

  const points = stroke.points.map((point) => viewport.convertToViewportPoint(point.x, point.y));
  if (!points.length) return;

  ctx.save();
  ctx.strokeStyle = stroke.color;
  // 荧光笔靠透明度出高亮效果，普通笔完全不透明
  ctx.globalAlpha = stroke.alpha == null ? 1 : stroke.alpha;
  ctx.lineWidth = Math.max(0.5, stroke.width * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (isFreehand(stroke.type)) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
    ctx.stroke();
  } else if (points.length > 1) {
    const [x1, y1] = points[0];
    const [x2, y2] = points[1];
    if (stroke.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (stroke.type === 'rect') {
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (stroke.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function redrawAnnot(shell) {
  const canvas = shell._annot;
  const viewport = shell._viewport;
  if (!canvas || !viewport) return;

  const width = shell.clientWidth;
  const height = shell.clientHeight;
  if (!width || !height) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pageNumber = Number(shell.dataset.page);
  (annotations.get(pageNumber) || []).forEach((stroke) => drawStroke(ctx, stroke, viewport, pdfView.scale));
  if (annotStroke && annotPage === pageNumber) drawStroke(ctx, annotStroke, viewport, pdfView.scale);

  // 从注释列表跳过来的块用虚线圈一下，方便在页面上找到
  if (flashNote && isBlockTool(flashNote.type) && (annotations.get(pageNumber) || []).includes(flashNote)) {
    const box = textBlockBox(flashNote);
    const [left, top] = viewport.convertToViewportPoint(box.x, box.y + box.height);
    const [right, bottom] = viewport.convertToViewportPoint(box.x + box.width, box.y);
    ctx.save();
    ctx.strokeStyle = '#7048E8';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(left - 3, top - 3, right - left + 6, bottom - top + 6);
    ctx.restore();
  }
}

// 标注变了：主视图重画叠加层，缩略图重渲染一页（缩略图把笔画画在同一张位图上）
function refreshAnnotPage(pageNumber) {
  const shell = pdfView.shells[pageNumber - 1];
  if (shell) redrawAnnot(shell);
  refreshThumbAnnot(pageNumber);
}

function refreshThumbAnnot(pageNumber) {
  const item = pdfView.thumbs[pageNumber - 1];
  if (!item || item.dataset.state !== 'done') return;
  const canvas = item.querySelector('canvas');
  if (canvas) canvas.remove();
  delete item.dataset.state;
  renderThumb(item);
}

const PRESET_COLORS = ['#E5484D', '#211C2B', '#2F6FEB', '#F5A524'];

function selectAnnotColor(color) {
  annotStyle.color = color;
  const lower = color.toLowerCase();
  $('annotColors').querySelectorAll('.annot-color').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.color.toLowerCase() === lower);
  });
  // 不是四个预设色就点亮取色盘入口
  $('annotCustomBtn').classList.toggle('is-active', !PRESET_COLORS.some((item) => item.toLowerCase() === lower));
  syncAnnotSizeLabel();
  syncAnnotCursor();
}

/* ---------- 自定义取色盘（色相/明度 + 透明度） ---------- */
let customColor = '#8B5CF6';
const cpState = {h: 270, s: 80, v: 95};

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// 取色盘按色相/饱和度/明度工作，和实体 hex 互相换算
function hexToHsv(hex) {
  const {r, g, b} = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return {h, s: max ? (delta / max) * 100 : 0, v: max * 100};
}

function hsvToHex(h, s, v) {
  const chroma = (v / 100) * (s / 100);
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  const m = v / 100 - chroma;
  let rgb;
  if (hp < 1) rgb = [chroma, x, 0];
  else if (hp < 2) rgb = [x, chroma, 0];
  else if (hp < 3) rgb = [0, chroma, x];
  else if (hp < 4) rgb = [0, x, chroma];
  else if (hp < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

// 按当前 cpState / 透明度重绘面板，返回当前的 hex
function paintColorPop() {
  const pop = $('colorPop');
  const hex = hsvToHex(cpState.h, cpState.s, cpState.v);
  // 色域背景需要纯色相的右边缘；直接写 hsl(var(--hue)) 部分 IDE 会报解析错误
  pop.style.setProperty('--hue-color', hsvToHex(cpState.h, 100, 100));
  pop.style.setProperty('--c', hex);
  $('cpThumb').style.left = cpState.s + '%';
  $('cpThumb').style.top = (100 - cpState.v) + '%';
  $('cpAlphaText').textContent = Math.round(annotStyle.alpha * 100) + '%';
  if (document.activeElement !== $('cpHex')) $('cpHex').value = hex;
  return hex;
}

function setAnnotAlpha(alpha) {
  annotStyle.alpha = Math.min(1, Math.max(0.05, alpha));
  annotAlphas[widthKey(annotStyle.tool)] = annotStyle.alpha;
  syncAnnotSizeLabel();
  syncAnnotCursor();
}

function applyCustomColor(hex) {
  annotColorTouched = true;
  customColor = hex;
  $('annotCustomDot').style.background = hex;
  selectAnnotColor(hex);
  paintColorPop();
}

function positionColorPop() {
  const pop = $('colorPop');
  const rect = $('annotCustomBtn').getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
}

function openColorPop() {
  const pop = $('colorPop');
  // 保留小数，不然从 hex 反算再转回来会偏色（红会变成 #E6474C）
  const hsv = hexToHsv(annotStyle.color);
  cpState.h = Math.round(hsv.h * 10) / 10;
  cpState.s = Math.round(hsv.s * 10) / 10;
  cpState.v = Math.round(hsv.v * 10) / 10;
  $('cpHue').value = String(Math.round(cpState.h));
  $('cpAlpha').value = String(Math.round(annotStyle.alpha * 100));
  $('annotCustomDot').style.background = customColor;
  pop.hidden = false;
  paintColorPop();
  positionColorPop();
  $('annotCustomBtn').setAttribute('aria-expanded', 'true');
}

function closeColorPop() {
  const pop = $('colorPop');
  if (pop.hidden) return;
  pop.hidden = true;
  $('annotCustomBtn').setAttribute('aria-expanded', 'false');
}

function bindColorPop() {
  // 按钮里的小圆点就是上次自选的颜色
  $('annotCustomDot').style.background = customColor;
  $('annotCustomBtn').addEventListener('click', () => {
    if ($('colorPop').hidden) openColorPop();
    else closeColorPop();
  });

  // 色域里拖动取饱和度（横）与明度（纵）
  const sv = $('cpSv');
  const pickSv = (event) => {
    const rect = sv.getBoundingClientRect();
    cpState.s = Math.round(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
    cpState.v = Math.round(Math.min(100, Math.max(0, (1 - (event.clientY - rect.top) / rect.height) * 100)));
    applyCustomColor(paintColorPop());
  };
  sv.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try { sv.setPointerCapture(event.pointerId); } catch (error) { /* 忽略捕获失败 */ }
    pickSv(event);
  });
  sv.addEventListener('pointermove', (event) => {
    if (!sv.hasPointerCapture(event.pointerId)) return;
    pickSv(event);
  });

  $('cpHue').addEventListener('input', (event) => {
    cpState.h = Math.round(Number(event.target.value) || 0);
    applyCustomColor(paintColorPop());
  });

  $('cpAlpha').addEventListener('input', (event) => {
    setAnnotAlpha((Number(event.target.value) || 0) / 100);
    paintColorPop();
  });

  $('cpHex').addEventListener('change', (event) => {
    const value = event.target.value.trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) {
      paintColorPop();
      return;
    }
    const hex = '#' + value.toUpperCase();
    const hsv = hexToHsv(hex);
    cpState.h = Math.round(hsv.h * 10) / 10;
    cpState.s = Math.round(hsv.s * 10) / 10;
    cpState.v = Math.round(hsv.v * 10) / 10;
    $('cpHue').value = String(Math.round(cpState.h));
    applyCustomColor(hex);
  });

  $('cpDone').addEventListener('click', closeColorPop);

  // 点面板外面或按 Esc 收起
  document.addEventListener('pointerdown', (event) => {
    const pop = $('colorPop');
    if (pop.hidden) return;
    if (pop.contains(event.target) || $('annotCustomBtn').contains(event.target)) return;
    closeColorPop();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('colorPop').hidden) closeColorPop();
  });
  // 面板是按视口坐标定位的，滚动或缩放后容易错位，直接收起
  window.addEventListener('resize', closeColorPop);
  window.addEventListener('scroll', closeColorPop, true);
}

/* ---------- 注释（便签）与页面文字的编辑 ---------- */
let noteEdit = null;           // 正在编辑的块：{page, stroke|null, tool, x, y, size}
let noteSuppressClick = false; // 点浮层外面关掉编辑框时，别把这一下再当成新建

function positionNoteEditor(clientX, clientY) {
  const box = $('noteEditor');
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const left = Math.min(Math.max(8, clientX + 12), window.innerWidth - width - 8);
  let top = clientY + 10;
  if (top + height > window.innerHeight - 8) top = Math.max(8, clientY - height - 10);
  box.style.left = Math.round(left) + 'px';
  box.style.top = Math.round(top) + 'px';
}

function syncNoteSizes(size) {
  $('neSizes').querySelectorAll('.ne-size').forEach((item) => {
    item.classList.toggle('is-active', Number(item.dataset.size) === size);
  });
}

function openNoteEditor(shell, stroke, point, clientX, clientY) {
  const page = Number(shell.dataset.page);
  // 记下点击位置，输入法把视口顶起来后要靠它重新贴回去
  noteEdit = stroke
    ? {page, stroke, tool: stroke.type, size: stroke.size, anchorX: clientX, anchorY: clientY}
    : {page, stroke: null, tool: annotStyle.tool, x: point.x, y: point.y, size: annotStyle.width, anchorX: clientX, anchorY: clientY};

  $('neTitle').textContent = stroke
    ? (stroke.type === 'note' ? '编辑注释' : '编辑文字')
    : (noteEdit.tool === 'note' ? '新建注释' : '新建文字');
  $('neText').value = stroke ? stroke.text : '';
  // 便签字号固定，只有文字工具给字号档位
  $('neSizes').hidden = noteEdit.tool !== 'text';
  syncNoteSizes(noteEdit.tool === 'text' ? noteEdit.size : 0);
  $('neDelete').hidden = !stroke;
  $('noteEditor').hidden = false;
  positionNoteEditor(clientX, clientY);
  requestAnimationFrame(() => $('neText').focus());
}

function closeNoteEditor(commit) {
  const state = noteEdit;
  if (!state) return;
  noteEdit = null;
  $('noteEditor').hidden = true;
  if (commit) commitNote(state);
}

// 内容为空就当作删除；编辑已有块时保留原有颜色，新建时用当前画笔色
function commitNote(state) {
  const text = $('neText').value.replace(/\s+$/, '');
  if (!text.trim()) {
    if (state.stroke) {
      deleteBlock(state.page, state.stroke);
      toast('已删除该条注释');
    }
    refreshNoteList();
    return;
  }

  if (state.stroke) {
    state.stroke.text = text;
    if (state.stroke.type === 'text') {
      state.stroke.size = state.size;
      annotWidths.text = state.size;
      annotStyle.width = state.size;
      syncWidthControl();
    }
    fitBlockToPage(state.page, state.stroke);
    refreshAnnotPage(state.page);
  } else {
    const stroke = {
      type: state.tool,
      seq: ++annotSeq,
      x: state.x,
      y: state.y,
      text,
      size: state.tool === 'note' ? NOTE_SIZE : state.size,
      color: annotStyle.color,
      alpha: annotStyle.alpha
    };
    if (state.tool === 'text') {
      annotWidths.text = state.size;
      annotStyle.width = state.size;
      syncWidthControl();
    }
    fitBlockToPage(state.page, stroke);
    addStroke({page: state.page, stroke});
    annotRedo.length = 0;
    refreshAnnotPage(state.page);
    updateAnnotHistory();
    toast(state.tool === 'note' ? '已添加注释' : '已添加文字', 'ok');
  }
  refreshNoteList();
}

// 删除一个便签/文字也记成擦除记录，删错了还能撤销回来
function deleteBlock(page, stroke) {
  const list = annotations.get(page);
  if (!list || !list.includes(stroke)) return;
  const items = [{page, stroke}];
  applyErase({items, pages: [page]});
  pushEraseOp(items);
}

function bindNoteEditor() {
  $('neSave').addEventListener('click', () => closeNoteEditor(true));
  $('neCancel').addEventListener('click', () => closeNoteEditor(false));
  $('neDelete').addEventListener('click', () => {
    const state = noteEdit;
    if (!state || !state.stroke) return;
    noteEdit = null;
    $('noteEditor').hidden = true;
    deleteBlock(state.page, state.stroke);
    refreshNoteList();
    toast('已删除该条注释');
  });

  $('neSizes').addEventListener('click', (event) => {
    const btn = event.target.closest('.ne-size');
    if (!btn || !noteEdit) return;
    noteEdit.size = Number(btn.dataset.size);
    syncNoteSizes(noteEdit.size);
  });

  $('neText').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeNoteEditor(false);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      closeNoteEditor(true);
    }
  });

  // 点浮层外面按保存处理；捕获阶段先关掉，免得这一下又在页面上新建一条
  document.addEventListener('pointerdown', (event) => {
    if (!noteEdit || $('noteEditor').contains(event.target)) return;
    noteSuppressClick = true;
    closeNoteEditor(true);
    setTimeout(() => { noteSuppressClick = false; }, 0);
  }, true);

  // 输入法弹出会触发 resize，只重新贴位置，别把刚写的字一起丢掉
  window.addEventListener('resize', () => {
    if (noteEdit) positionNoteEditor(noteEdit.anchorX, noteEdit.anchorY);
  });
  // 页面本身滚动了就取消编辑；textarea 内部滚动不算
  window.addEventListener('scroll', (event) => {
    if (!noteEdit || $('noteEditor').contains(event.target)) return;
    closeNoteEditor(false);
  }, true);
}

/* ---------- 注释列表 ---------- */
function renderNoteList() {
  const list = $('noteList');
  list.textContent = '';
  const items = collectBlocks();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'note-empty';
    empty.textContent = '还没有注释或文字，用标注栏里的「注释」「文字」工具添加';
    list.appendChild(empty);
    return;
  }

  items.forEach(({page, stroke}) => {
    const row = document.createElement('div');
    row.className = 'note-item';

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'note-jump';
    const badge = document.createElement('span');
    badge.className = 'note-badge';
    badge.textContent = 'P' + page;
    const text = document.createElement('span');
    text.className = 'note-text';
    text.textContent = stroke.text;
    const kind = document.createElement('span');
    kind.className = 'note-kind';
    kind.textContent = stroke.type === 'note' ? '注释' : '文字';
    jump.append(badge, text, kind);
    jump.addEventListener('click', () => {
      closeNoteList();
      scrollToPage(page, true);
      flashNoteBlock(page, stroke);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'note-del';
    del.title = '删除';
    del.setAttribute('aria-label', '删除');
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>'
      + '<path d="M9 7V4h6v3"/></svg>';
    del.addEventListener('click', () => {
      deleteBlock(page, stroke);
      renderNoteList();
      toast('已删除该条注释');
    });

    row.append(jump, del);
    list.appendChild(row);
  });
}

function refreshNoteList() {
  if (!$('notePanel').hidden) renderNoteList();
}

function showNoteList() {
  renderNoteList();
  $('notePanel').hidden = false;
}

function closeNoteList() {
  $('notePanel').hidden = true;
}

function flashNoteBlock(page, stroke) {
  flashNote = stroke;
  refreshAnnotPage(page);
  setTimeout(() => {
    if (flashNote !== stroke) return;
    flashNote = null;
    refreshAnnotPage(page);
  }, 1600);
}

function bindNoteList() {
  $('annotListBtn').addEventListener('click', showNoteList);
  $('noteCloseBtn').addEventListener('click', closeNoteList);
  $('notePanel').addEventListener('click', (event) => {
    if (event.target === $('notePanel')) closeNoteList();
  });
}

// 滑块的范围随工具变化：荧光笔要粗得多；数值同步显示在滑块左边
function syncWidthControl() {
  const tool = annotStyle.tool;
  const marker = tool === 'marker';
  const text = tool === 'text';
  const eraser = tool === 'eraser';
  const range = marker ? MARKER_WIDTH_RANGE : text ? TEXT_SIZE_RANGE : eraser ? ERASER_WIDTH_RANGE : PEN_WIDTH_RANGE;
  const input = $('annotWidthRange');
  input.min = String(range.min);
  input.max = String(range.max);
  input.value = String(annotStyle.width);
  // 便签字号固定，滑杆不参与
  input.disabled = tool === 'note';
  input.title = marker ? '荧光笔粗细' : text ? '文字字号' : eraser ? '橡皮大小' : '笔画粗细';
  // 橡皮不落色，颜色一排暂时不可用
  $('annotColors').classList.toggle('is-muted', eraser);
  syncAnnotSizeLabel();
  syncAnnotCursor();
}

// 滑杆左边：数值 + 一个按实际大小缩放的小圆点
function syncAnnotSizeLabel() {
  const tool = annotStyle.tool;
  const note = tool === 'note';
  $('annotSizeText').textContent = note
    ? '固定 ' + NOTE_SIZE + ' pt'
    : annotStyle.width + (tool === 'text' ? ' pt' : ' px');
  const dot = $('annotDot');
  // 便签没有笔头、橡皮不落色，圆点都没有意义
  dot.hidden = note || tool === 'eraser';
  if (note || tool === 'eraser') return;
  const size = Math.min(20, Math.max(4, annotStyle.width));
  dot.style.width = size + 'px';
  dot.style.height = size + 'px';
  // 圆点保持一定浓度，太透明就看不清粗细了
  dot.style.background = colorWithAlpha(annotStyle.color, Math.max(0.45, Math.min(0.85, annotStyle.alpha)));
}

// 鼠标笔头预览：直径就是落笔粗细，颜色/透明度跟当前设置一致；橡皮则显示擦除范围
function syncAnnotCursor() {
  const cursor = $('annotCursor');
  const eraser = pdfView.annotating && annotStyle.tool === 'eraser';
  const freehand = pdfView.annotating && isFreehand(annotStyle.tool);
  const show = freehand || eraser;
  $('viewerScroll').classList.toggle('is-freetool', freehand);
  $('viewerScroll').classList.toggle('is-erasertool', eraser);
  $('viewerScroll').classList.toggle('is-texttool', pdfView.annotating && annotStyle.tool === 'text');
  if (!show) {
    cursor.hidden = true;
    return;
  }

  // 直径就是落笔粗细（box-sizing: border-box，含边框）
  const size = Math.max(3, annotStyle.width);
  cursor.style.width = size + 'px';
  cursor.style.height = size + 'px';
  if (eraser) {
    // 橡皮画成灰色空心圈，看得清要擦掉的笔画
    cursor.style.borderWidth = '1.5px';
    cursor.style.color = '#8A8298';
    cursor.style.background = 'rgba(255, 255, 255, .45)';
    return;
  }
  // 半透明笔画用真实透明度，实心笔画压淡一点以便看清底下的内容
  const fill = annotStyle.alpha >= 0.99 ? 0.18 : Math.max(0.12, annotStyle.alpha);
  cursor.style.borderWidth = (size >= 14 ? 2 : 1) + 'px';
  cursor.style.color = annotStyle.color;
  cursor.style.background = colorWithAlpha(annotStyle.color, fill);
}

function moveAnnotCursor(event) {
  const cursor = $('annotCursor');
  if (cursor.hidden) {
    // 拖到窗口外松手时可能收不到 pointerup，这里兜底恢复预览
    if (annotStroke || eraseSession || !pdfView.annotating) return;
    if (!isFreehand(annotStyle.tool) && annotStyle.tool !== 'eraser') return;
    cursor.hidden = false;
  }

  const box = $('viewerScroll').getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom;
  cursor.style.visibility = inside ? 'visible' : 'hidden';
  cursor.style.left = event.clientX + 'px';
  cursor.style.top = event.clientY + 'px';
}

function showAnnotCursor(show) {
  const cursor = $('annotCursor');
  const showable = pdfView.annotating && (isFreehand(annotStyle.tool) || annotStyle.tool === 'eraser');
  if (show && showable) {
    cursor.hidden = false;
    cursor.style.visibility = 'visible';
  } else {
    cursor.hidden = true;
  }
}

function selectAnnotTool(tool) {
  // 记住当前工具调好的粗细和透明度，切到目标工具时恢复它上次的值
  annotWidths[widthKey(annotStyle.tool)] = annotStyle.width;
  annotAlphas[widthKey(annotStyle.tool)] = annotStyle.alpha;
  annotStyle.tool = tool;
  annotStyle.width = annotWidths[widthKey(tool)];
  annotStyle.alpha = annotAlphas[widthKey(tool)];
  syncWidthControl();
}

// 重置编辑器时让标注工具回到初始状态（画笔 / 红色 / 4px / 不透明）
function resetAnnotTools() {
  annotStyle.tool = 'ink';
  annotWidths.pen = 4;
  annotWidths.marker = 18;
  annotWidths.text = 14;
  annotWidths.eraser = 16;
  annotAlphas.pen = 1;
  annotAlphas.marker = MARKER_ALPHA;
  annotAlphas.text = 1;
  annotAlphas.eraser = 1;
  annotStyle.width = annotWidths.pen;
  annotStyle.alpha = annotAlphas.pen;
  annotColorTouched = false;
  annotStroke = null;
  eraseSession = null;
  closeColorPop();
  closeNoteEditor(false);
  closeNoteList();
  syncWidthControl();
  selectAnnotColor('#E5484D');
  $('annotTools').querySelectorAll('.annot-tool').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.tool === 'ink');
  });
}

function bindAnnotEvents() {
  const scroll = $('viewerScroll');

  scroll.addEventListener('pointerdown', (event) => {
    if (!pdfView.annotating || !pdfView.doc || event.button !== 0) return;
    // 刚点浮层外面关掉编辑框，这一下不再当成新建
    if (noteSuppressClick) {
      noteSuppressClick = false;
      return;
    }
    const shell = event.target.closest('.viewer-page');
    if (!shell || !shell._viewport) return;
    event.preventDefault();

    // 注释 / 文字：点已有内容就编辑，点空白处新建
    if (isBlockTool(annotStyle.tool)) {
      const point = annotPoint(shell, event);
      const hit = hitTextBlock(Number(shell.dataset.page), point);
      openNoteEditor(shell, hit, point, event.clientX, event.clientY);
      return;
    }

    // 橡皮：按一下就擦，按住拖动可以连着擦
    if (annotStyle.tool === 'eraser') {
      annotPage = Number(shell.dataset.page);
      try { scroll.setPointerCapture(event.pointerId); } catch (error) { /* 忽略捕获失败 */ }
      eraseSession = {items: []};
      if (eraseAt(shell, event)) redrawAnnot(shell);
      return;
    }

    try { scroll.setPointerCapture(event.pointerId); } catch (error) { /* 忽略捕获失败 */ }
    // 落笔时收起笔头预览，免得挡住正在画的线
    showAnnotCursor(false);
    startStroke(shell, event);
  });

  scroll.addEventListener('pointermove', (event) => {
    moveAnnotCursor(event);
    // 擦除时指针被捕获，按坐标找当前落在哪一页
    if (eraseSession) {
      const host = document.elementFromPoint(event.clientX, event.clientY);
      const shell = host ? host.closest('.viewer-page') : null;
      if (shell && shell._viewport) {
        event.preventDefault();
        if (eraseAt(shell, event)) redrawAnnot(shell);
      }
      return;
    }
    if (!annotStroke) return;
    const shell = pdfView.shells[annotPage - 1];
    if (!shell) return;
    event.preventDefault();
    extendStroke(shell, event);
  });

  const finish = (event) => {
    // 一次擦除在抬手时统一入栈，撤销一次就能整段还原
    if (eraseSession) finishErase();
    if (!annotStroke) return;
    const shell = pdfView.shells[annotPage - 1];
    if (shell) finishStroke(shell);
    if (event && event.type === 'pointerup') {
      showAnnotCursor(true);
      moveAnnotCursor(event);
    }
  };
  scroll.addEventListener('pointerup', finish);
  scroll.addEventListener('pointercancel', finish);

  scroll.addEventListener('pointerleave', () => showAnnotCursor(false));
  scroll.addEventListener('pointerenter', (event) => {
    syncAnnotCursor();
    showAnnotCursor(true);
    moveAnnotCursor(event);
  });

  $('annotTools').addEventListener('click', (event) => {
    const btn = event.target.closest('.annot-tool');
    if (!btn) return;
    selectAnnotTool(btn.dataset.tool);
    $('annotTools').querySelectorAll('.annot-tool').forEach((item) => {
      item.classList.toggle('is-active', item === btn);
    });
    // 头一次切到荧光笔顺带给黄色；用户自己选过颜色就不再干预
    if (annotStyle.tool === 'marker' && !annotColorTouched) selectAnnotColor(MARKER_COLOR);
  });

  $('annotColors').addEventListener('click', (event) => {
    const btn = event.target.closest('.annot-color');
    if (!btn) return;
    annotColorTouched = true;
    selectAnnotColor(btn.dataset.color);
  });

  $('annotWidthRange').addEventListener('input', (event) => {
    annotStyle.width = Math.max(1, Number(event.target.value) || 4);
    annotWidths[widthKey(annotStyle.tool)] = annotStyle.width;
    syncAnnotSizeLabel();
    syncAnnotCursor();
  });

  $('annotUndoBtn').addEventListener('click', undoAnnotation);
  $('annotRedoBtn').addEventListener('click', redoAnnotation);
  $('annotClearBtn').addEventListener('click', clearPageAnnotations);
}

function visiblePage() {
  const scroll = $('viewerScroll');
  const line = scroll.scrollTop + 60;
  let top = 0;
  for (const shell of pdfView.shells) {
    if (shell.offsetTop > line) break;
    top = shell.offsetTop;
  }
  // 双页并排时同一行有两页，取行首那页作为当前页
  const first = pdfView.shells.find((shell) => shell.offsetTop === top);
  return first ? Number(first.dataset.page) : 1;
}

function scrollToPage(page, smooth) {
  if (!pdfView.doc) return;
  const total = pdfView.doc.numPages;
  const target = Math.min(Math.max(1, Math.round(page) || 1), total);
  pdfView.page = target;

  const shell = pdfView.shells[target - 1];
  if (shell) {
    $('viewerScroll').scrollTo({
      top: Math.max(0, shell.offsetTop - 12),
      behavior: smooth ? 'smooth' : 'auto'
    });
  }
  syncViewerUI();
}

function zoomPreview(factor) {
  if (!pdfView.doc) return;
  pdfView.fitWidth = false;
  pdfView.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pdfView.scale * factor));
  layoutPreview();
}

function fitPreviewWidth() {
  if (!pdfView.doc) return;
  pdfView.fitWidth = true;
  layoutPreview();
}

// 旋转只影响预览显示，不会写回 PDF；旋转后页面宽高互换，需要重新排版
function rotatePreview(delta) {
  if (!pdfView.doc) return;
  pdfView.rotation = (pdfView.rotation + delta + 360) % 360;
  buildThumbs();
  layoutPreview();
}

function syncViewerUI() {
  const total = pdfView.doc ? pdfView.doc.numPages : 0;
  const input = $('viewPageInput');
  if (document.activeElement !== input) input.value = String(pdfView.page);
  $('prevPageBtn').disabled = !total || pdfView.page <= 1;
  $('nextPageBtn').disabled = !total || pdfView.page >= total;
  $('zoomLabel').textContent = Math.round(pdfView.scale * 100) + '%';

  const active = pdfView.thumbs[pdfView.page - 1];
  pdfView.thumbs.forEach((item) => item.classList.toggle('is-active', item === active));
  if (active) ensureThumbVisible(active);
}

let scrollPending = false;
$('viewerScroll').addEventListener('scroll', () => {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    if (!pdfView.doc) return;
    pdfView.page = visiblePage();
    syncViewerUI();
  });
});

$('prevPageBtn').addEventListener('click', () => scrollToPage(pdfView.page - 1, true));
$('nextPageBtn').addEventListener('click', () => scrollToPage(pdfView.page + 1, true));
$('zoomInBtn').addEventListener('click', () => zoomPreview(1.25));
$('zoomOutBtn').addEventListener('click', () => zoomPreview(1 / 1.25));
$('fitBtn').addEventListener('click', fitPreviewWidth);
$('thumbsBtn').addEventListener('click', toggleThumbs);
$('twoUpBtn').addEventListener('click', toggleTwoUp);
$('annotationsBtn').addEventListener('click', toggleAnnotations);
$('rotateLeftBtn').addEventListener('click', () => rotatePreview(-90));
$('rotateRightBtn').addEventListener('click', () => rotatePreview(90));
$('annotateBtn').addEventListener('click', toggleAnnotate);
$('presentBtn').addEventListener('click', startPresent);
$('infoBtn').addEventListener('click', showInfo);
$('infoCloseBtn').addEventListener('click', () => { $('infoPanel').hidden = true; });
$('infoPanel').addEventListener('click', (event) => {
  if (event.target === $('infoPanel')) $('infoPanel').hidden = true;
});
bindAnnotEvents();
bindColorPop();
bindNoteEditor();
bindNoteList();
syncWidthControl();
updateAnnotHistory();

// 演示模式的翻页与退出；其它情况不拦截按键
document.addEventListener('keydown', (event) => {
  if (!pdfView.presenting) return;
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault();
    presentStep(1);
  } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    presentStep(-1);
  } else if (event.key === 'Escape') {
    stopPresent();
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && pdfView.presenting) stopPresent();
});

function commitPageInput(input) {
  scrollToPage(Number(input.value), true);
}
$('viewPageInput').addEventListener('change', (event) => commitPageInput(event.target));
$('viewPageInput').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  commitPageInput(event.target);
  event.target.blur();
});

// 容器宽度变化后重新按宽度排版
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!pdfView.doc || !pdfView.fitWidth) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => layoutPreview(), 200);
});

/* ---------- 回退 / 前进 ---------- */
function recordHistory(bytes, label, previousAnnotations) {
  // 从历史中间继续操作时，丢弃后面的重做分支
  if (historyIndex < history.length - 1) history.length = historyIndex + 1;
  // 操作前的标注属于上一版：补记进上一版快照，回退时才能看到当时的画面
  if (previousAnnotations && history[historyIndex]) history[historyIndex].annotations = previousAnnotations;
  // 新快照记下这一版页面对齐后的标注
  history.push({bytes, label, annotations: snapshotAnnotations()});
  historyIndex = history.length - 1;
  trimHistory();
  updateHistoryUI();
}

// 标注是纯数据，复制一份，历史快照和当前编辑互不影响
function cloneStrokes(strokes) {
  return JSON.parse(JSON.stringify(strokes));
}

function snapshotAnnotations() {
  const copy = new Map();
  annotations.forEach((strokes, page) => {
    copy.set(page, cloneStrokes(strokes));
  });
  return copy;
}

function restoreAnnotations(snapshot) {
  annotations.clear();
  if (snapshot) snapshot.forEach((strokes, page) => annotations.set(page, cloneStrokes(strokes)));
  annotPage = 0;
  annotStroke = null;
  flashNote = null;
  annotOrder.length = 0;
  annotRedo.length = 0;
  updateAnnotHistory();
  refreshNoteList();
}

// 超出步数或字节预算时，丢弃最早的快照（至少保留一份）
function trimHistory() {
  let total = history.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  while (history.length > 1 && (history.length > MAX_HISTORY_STEPS || total > HISTORY_BUDGET)) {
    total -= history.shift().bytes.byteLength;
    historyIndex -= 1;
  }
  if (historyIndex < 0) historyIndex = 0;
}

function updateHistoryUI() {
  const step = $('histStep');
  $('undoBtn').disabled = navigating || historyIndex <= 0;
  $('redoBtn').disabled = navigating || historyIndex >= history.length - 1;

  if (!history.length) {
    step.textContent = '未载入';
    step.removeAttribute('title');
    return;
  }
  step.textContent = `${historyIndex + 1}/${history.length} · ${history[historyIndex].label}`;
  step.title = history[historyIndex].label;
}

async function goToHistory(target, message) {
  if (navigating || target < 0 || target >= history.length) return;
  navigating = true;
  updateHistoryUI();
  try {
    // 先还原这一版的标注快照，再让预览按原页码重画
    restoreAnnotations(history[target].annotations);
    await loadAndDisplayPdf(history[target].bytes, undefined, {keepAnnotations: true});
    historyIndex = target;
    toast(message + '：' + history[target].label, 'ok');
  } catch (error) {
    toast('切换历史失败: ' + error.message, 'err');
  } finally {
    navigating = false;
    updateHistoryUI();
    hideBusy();
  }
}

function undo() {
  return goToHistory(historyIndex - 1, '已回退');
}

function redo() {
  return goToHistory(historyIndex + 1, '已前进');
}

// 输入框内保留浏览器原生撤销
const isTyping = (target) => /^(input|textarea|select)$/i.test(target.tagName || '');

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || isTyping(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault();
    redo();
  }
});

/* ---------- 操作切换 ---------- */
const panes = {
  delete: $('deleteSection'),
  insertPdf: $('insertPdfSection'),
  insertImage: $('insertImageSection')
};
const tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));

function setOperation(op) {
  tabs.forEach((tab) => {
    const active = tab.dataset.op === op;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  Object.keys(panes).forEach((key) => {
    panes[key].hidden = key !== op;
  });
}

tabs.forEach((tab) => tab.addEventListener('click', () => setOperation(tab.dataset.op)));

/* ---------- 上传主文件（点击 + 拖放） ---------- */
$('mainPdfFileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  await loadMainFile(file);
});

let dragDepth = 0;
dropZone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropZone.classList.add('is-over');
});
dropZone.addEventListener('dragover', (event) => event.preventDefault());
dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropZone.classList.remove('is-over');
});
dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('is-over');
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) await loadMainFile(file);
});
// 避免拖到页面其他区域时浏览器直接打开文件
['dragover', 'drop'].forEach((type) => {
  document.addEventListener(type, (event) => {
    if (!dropZone.contains(event.target)) event.preventDefault();
  });
});

async function loadMainFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    toast('请选择 PDF 文件', 'err');
    return;
  }
  const hint = file.name + ' · ' + formatSize(file.size);
  try {
    await setBusy('正在读取文件…', hint);
    const bytes = await file.arrayBuffer();
    // 换文件时上一份文档的标注没有意义，静默清掉
    if (annotations.size) clearAnnotations();
    await loadAndDisplayPdf(bytes, hint);
    loadedFileName = file.name;
    history.length = 0;
    historyIndex = -1;
    recordHistory(bytes, file.name);
    setDropLoaded(file.name, file.size);
    toast('已载入 ' + file.name, 'ok');
  } catch (error) {
    toast('加载 PDF 失败: ' + error.message, 'err');
  } finally {
    hideBusy();
  }
}

function setDropLoaded(name, size) {
  dropZone.classList.add('is-loaded');
  $('dropTitle').textContent = name;
  $('dropSub').textContent = formatSize(size) + ' · 点击可重新选择';
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function loadAndDisplayPdf(pdfBytes, hint, options) {
  await setBusy('正在解析 PDF 结构…', hint);
  pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  $('currentTotalPages').textContent = totalPages;

  // 插入页码上限跟随当前文档页数
  ['insertPageNumberPdf', 'insertPageNumberImage'].forEach((id) => {
    const input = $(id);
    input.max = String(totalPages);
    if (Number(input.value) > totalPages) input.value = String(totalPages);
  });

  // 自绘预览渲染失败不影响导出，只提示错误
  try {
    await setBusy('正在生成预览…', '共 ' + totalPages + ' 页');
    await renderPreview(pdfBytes, options);
  } catch (error) {
    console.error(error);
    showPreviewError('预览渲染失败：' + error.message);
  }

  $('downloadBtn').disabled = false;
}

// 处理中锁定按钮，避免重复点击；耗时操作期间盖住遮罩，避免看起来像卡死
async function withBusy(button, task) {
  if (!button) return task();
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '处理中…';
  const heavy = pdfView.byteLength > 1.5 * 1024 * 1024;
  try {
    await setBusy('正在处理…', heavy ? '大文件需要多等几秒，请不要关闭页面' : '处理中，请稍候');
    return await task();
  } finally {
    hideBusy();
    button.disabled = false;
    button.textContent = label;
  }
}

// 解析页面范围字符串，例如 "1,3-5,7" -> [1,3,4,5,7]
function parsePageRanges(rangeStr, totalPages) {
  const pages = [];
  const ranges = rangeStr.split(/[,，]/).map((r) => r.trim()).filter(Boolean);

  for (const range of ranges) {
    if (range.includes('-')) {
      // 处理范围，如 "3-5"
      const [start, end] = range.split('-').map(Number);

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`无效的页面范围: ${range}`);
      }

      if (start < 1 || end > totalPages || start > end) {
        throw new Error(`页面范围超出有效范围: ${range} (总页数: ${totalPages})`);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    } else {
      // 处理单个页面
      const pageNum = Number(range);

      if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
        throw new Error(`页面号无效: ${pageNum} (总页数: ${totalPages})`);
      }

      pages.push(pageNum);
    }
  }

  // 去重并排序
  return [...new Set(pages)].sort((a, b) => a - b);
}

function describePages(pages) {
  return pages.length > 12 ? `共 ${pages.length} 页` : pages.join(', ');
}

async function deletePages(button) {
  if (!pdfDoc) {
    toast('请先上传 PDF 文件', 'err');
    return;
  }

  const pageRangeStr = $('pageNumbersInput').value.trim();
  if (!pageRangeStr) {
    toast('请输入要删除的页面号', 'err');
    return;
  }

  await withBusy(button, async () => {
    try {
      const totalPages = pdfDoc.getPageCount();
      const pagesToDelete = parsePageRanges(pageRangeStr, totalPages);

      // 删页前的标注状态属于上一版，回退时要用
      const beforeAnnotations = snapshotAnnotations();

      // 删除前先记下"新第几页 = 旧第几页"，重建预览时按它把标注搬过去
      const removed = new Set(pagesToDelete);
      const pageMap = [];
      for (let page = 1; page <= totalPages; page += 1) {
        if (!removed.has(page)) pageMap.push(page);
      }

      // 按降序删除，避免索引位移
      const sortedPages = [...pagesToDelete].sort((a, b) => b - a);
      for (const pageNum of sortedPages) {
        pdfDoc.removePage(pageNum - 1); // pdf-lib 中页面索引从 0 开始
      }

      const bytes = await pdfDoc.save();
      await loadAndDisplayPdf(bytes, undefined, {pageMap});
      recordHistory(bytes, `删除 ${describePages(pagesToDelete)} 页`, beforeAnnotations);
      $('pageNumbersInput').value = '';
      toast(`成功删除页面: ${describePages(pagesToDelete)}` + (annotations.size ? '，原有标注已按页保留' : ''), 'ok');
    } catch (error) {
      toast('删除页面失败: ' + error.message, 'err');
    }
  });
}

async function insertPdf(button) {
  if (!pdfDoc) {
    toast('请先上传主 PDF 文件', 'err');
    return;
  }

  const insertPdfFile = $('insertPdfFileInput').files[0];
  if (!insertPdfFile) {
    toast('请选择要插入的 PDF 文件', 'err');
    return;
  }

  const position = $('insertPositionPdf').value;
  const targetPage = parseInt($('insertPageNumberPdf').value, 10);
  const totalPages = pdfDoc.getPageCount();

  if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
    toast(`页面号无效 (1-${totalPages})`, 'err');
    return;
  }

  await withBusy(button, async () => {
    try {
      const insertPdfBytes = await insertPdfFile.arrayBuffer();
      const insertPdfDoc = await PDFLib.PDFDocument.load(insertPdfBytes);
      // 插入前的标注状态属于上一版，回退时要用
      const beforeAnnotations = snapshotAnnotations();

      // 计算插入位置的索引
      let insertIndex = targetPage - 1;
      if (position === 'after') insertIndex += 1;

      const copiedPages = await pdfDoc.copyPages(insertPdfDoc, insertPdfDoc.getPageIndices());
      for (let i = 0; i < copiedPages.length; i++) {
        pdfDoc.insertPage(insertIndex + i, copiedPages[i]);
      }

      const bytes = await pdfDoc.save();
      await loadAndDisplayPdf(bytes, undefined, {pageMap: pageMapAfterInsert(totalPages, insertIndex, copiedPages.length)});
      recordHistory(bytes, `插入 PDF ${copiedPages.length} 页`, beforeAnnotations);
      toast(`成功在第${targetPage}页${position === 'before' ? '前' : '后'}插入了 ${copiedPages.length} 页`
        + (annotations.size ? '，原有标注已按页保留' : ''), 'ok');
    } catch (error) {
      toast('插入 PDF 失败: ' + error.message, 'err');
    }
  });
}

async function insertImage(button) {
  if (!pdfDoc) {
    toast('请先上传主 PDF 文件', 'err');
    return;
  }

  const insertImageFile = $('insertImageFileInput').files[0];
  if (!insertImageFile) {
    toast('请选择要插入的图片文件', 'err');
    return;
  }

  const position = $('insertPositionImage').value;
  const targetPage = parseInt($('insertPageNumberImage').value, 10);
  const totalPages = pdfDoc.getPageCount();

  if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
    toast(`页面号无效 (1-${totalPages})`, 'err');
    return;
  }

  if (!insertImageFile.type.startsWith('image/jpeg') && !insertImageFile.type.startsWith('image/png')) {
    toast('仅支持 JPG 和 PNG 格式的图片', 'err');
    return;
  }

  await withBusy(button, async () => {
    try {
      const imageBytes = await insertImageFile.arrayBuffer();
      // 插入前的标注状态属于上一版，回退时要用
      const beforeAnnotations = snapshotAnnotations();

      // 新建一个只放图片的 PDF，再整页复制进主文档
      const imagePdfDoc = await PDFLib.PDFDocument.create();
      const embeddedImage = insertImageFile.type.startsWith('image/jpeg')
        ? await imagePdfDoc.embedJpg(imageBytes)
        : await imagePdfDoc.embedPng(imageBytes);

      const imagePage = imagePdfDoc.addPage();
      const {width, height} = embeddedImage.scale(1);

      const maxWidth = 500;
      const maxHeight = 700;
      const scale = Math.min(maxWidth / width, maxHeight / height, 1);

      const scaledWidth = width * scale;
      const scaledHeight = height * scale;

      imagePage.setSize(scaledWidth, scaledHeight);
      imagePage.drawImage(embeddedImage, {
        x: (scaledWidth - width * scale) / 2,
        y: (scaledHeight - height * scale) / 2,
        width: width * scale,
        height: height * scale
      });

      const imagePdfDocLoaded = await PDFLib.PDFDocument.load(await imagePdfDoc.save());

      let insertIndex = targetPage - 1;
      if (position === 'after') insertIndex += 1;

      const copiedPages = await pdfDoc.copyPages(imagePdfDocLoaded, imagePdfDocLoaded.getPageIndices());
      for (let i = 0; i < copiedPages.length; i++) {
        pdfDoc.insertPage(insertIndex + i, copiedPages[i]);
      }

      const bytes = await pdfDoc.save();
      await loadAndDisplayPdf(bytes, undefined, {pageMap: pageMapAfterInsert(totalPages, insertIndex, copiedPages.length)});
      recordHistory(bytes, '插入图片', beforeAnnotations);
      toast(`成功在第${targetPage}页${position === 'before' ? '前' : '后'}插入了图片`
        + (annotations.size ? '，原有标注已按页保留' : ''), 'ok');
    } catch (error) {
      toast('插入图片失败: ' + error.message, 'err');
    }
  });
}

async function downloadPdf(button) {
  if (!pdfDoc) {
    toast('没有可下载的 PDF', 'err');
    return;
  }

  await withBusy(button, async () => {
    try {
      const pdfBytes = await buildExportBytes();
      const url = URL.createObjectURL(new Blob([pdfBytes], {type: 'application/pdf'}));

      const a = document.createElement('a');
      a.href = url;
      a.download = (loadedFileName ? loadedFileName.replace(/\.pdf$/i, '') : 'edited-pdf') + '.pdf';
      document.body.appendChild(a);
      a.click();

      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(annotations.size ? '已把标注一同写入 PDF' : '已开始下载', 'ok');
    } catch (error) {
      toast('下载失败: ' + error.message, 'err');
    }
  });
}

/* ---------- 导出：把标注画进 PDF ---------- */
function hexToRgb(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const int = parseInt(full, 16) || 0;
  return {r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255};
}

// 笔头预览的半透明填充色
function colorWithAlpha(hex, alpha) {
  const {r, g, b} = hexToRgb(hex);
  return 'rgba(' + Math.round(r * 255) + ', ' + Math.round(g * 255) + ', ' + Math.round(b * 255) + ', ' + alpha + ')';
}

async function drawStrokeOnPage(page, stroke) {
  // 注释与文字按位图落笔：pdf-lib 的内置字体不支持中文
  if (isBlockTool(stroke.type)) {
    await drawTextOnPage(page, stroke);
    return;
  }

  const {r, g, b} = hexToRgb(stroke.color);
  const color = PDFLib.rgb(r, g, b);
  const thickness = Math.max(0.5, stroke.width);
  const alpha = stroke.alpha == null ? 1 : stroke.alpha;
  const points = stroke.points;

  // 手绘笔画：半透明时整条路径一次描边（ExtGState），否则逐段画
  if (isFreehand(stroke.type)) {
    if (alpha >= 0.999) {
      drawSegments(page, points, thickness, color);
      return;
    }
    try {
      drawHighlighterOnPage(page, stroke, thickness, r, g, b);
    } catch (error) {
      // 低层描边不可用时退回逐段绘制，至少保证导出不中断
      console.error(error);
      drawSegments(page, points, thickness, color);
    }
    return;
  }

  if (points.length < 2) return;
  const [first, second] = points;
  // 全不透明时不传透明度参数，免得给 PDF 多塞一份 ExtGState
  const faded = alpha < 0.999;

  if (stroke.type === 'line') {
    page.drawLine({
      start: first,
      end: second,
      thickness,
      color,
      lineCap: PDFLib.LineCapStyle.Round,
      ...(faded ? {opacity: alpha} : {})
    });
  } else if (stroke.type === 'rect') {
    page.drawRectangle({
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      width: Math.abs(second.x - first.x),
      height: Math.abs(second.y - first.y),
      borderColor: color,
      borderWidth: thickness,
      ...(faded ? {borderOpacity: alpha} : {})
    });
  } else if (stroke.type === 'ellipse') {
    page.drawEllipse({
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      xScale: Math.abs(second.x - first.x) / 2,
      yScale: Math.abs(second.y - first.y) / 2,
      borderColor: color,
      borderWidth: thickness,
      ...(faded ? {borderOpacity: alpha} : {})
    });
  }
}

const TEXT_EXPORT_SCALE = 3;

// 注释与文字渲染成透明 PNG 再贴回页面，中文和换行都不用担心字体编码
async function drawTextOnPage(page, stroke) {
  const box = textBlockMetrics(stroke, TEXT_EXPORT_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(box.width));
  canvas.height = Math.max(1, Math.ceil(box.height));
  paintTextBlock(canvas.getContext('2d'), stroke, 0, 0, TEXT_EXPORT_SCALE);

  const bytes = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('文字位图生成失败'));
        return;
      }
      blob.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });

  const image = await page.doc.embedPng(bytes);
  const width = canvas.width / TEXT_EXPORT_SCALE;
  const height = canvas.height / TEXT_EXPORT_SCALE;
  page.drawImage(image, {x: stroke.x, y: stroke.y - height, width, height});
}

function drawSegments(page, points, thickness, color) {
  for (let index = 1; index < points.length; index++) {
    page.drawLine({
      start: points[index - 1],
      end: points[index],
      thickness,
      color,
      lineCap: PDFLib.LineCapStyle.Round
    });
  }
}

// 半透明描边需要 ExtGState：同一页同一透明度只注册一次
const alphaStates = new WeakMap();

function ensureAlphaState(page, alpha) {
  let names = alphaStates.get(page);
  if (!names) {
    names = new Map();
    alphaStates.set(page, names);
  }
  const cached = names.get(alpha);
  if (cached) return cached;

  const context = page.doc.context;
  const name = 'AnnotAlpha' + Math.round(alpha * 100);
  const state = context.register(context.obj({Type: 'ExtGState', ca: alpha, CA: alpha}));
  const resources = page.node.Resources();
  const existing = resources.get(PDFLib.PDFName.of('ExtGState'));
  let states = existing ? context.lookup(existing) : undefined;
  if (!states) {
    states = context.obj({});
    resources.set(PDFLib.PDFName.of('ExtGState'), states);
  }
  states.set(PDFLib.PDFName.of(name), state);

  names.set(alpha, name);
  return name;
}

// 荧光笔整条笔画只描边一次，避免逐段半透明叠加出现一串深色接缝
function drawHighlighterOnPage(page, stroke, thickness, r, g, b) {
  const points = stroke.points;
  if (points.length < 2) return;

  const alpha = stroke.alpha == null ? 1 : stroke.alpha;
  const stateName = ensureAlphaState(page, alpha);

  const operators = [
    PDFLib.pushGraphicsState(),
    PDFLib.setGraphicsState(stateName),
    PDFLib.setStrokingRgbColor(r, g, b),
    PDFLib.setLineWidth(thickness),
    PDFLib.setLineCap(PDFLib.LineCapStyle.Round),
    PDFLib.moveTo(points[0].x, points[0].y)
  ];
  for (let index = 1; index < points.length; index++) {
    operators.push(PDFLib.lineTo(points[index].x, points[index].y));
  }
  operators.push(PDFLib.stroke(), PDFLib.popGraphicsState());

  page.pushOperators(...operators);
}

// 在副本上落笔，避免重复下载时同一笔被画多次
async function buildExportBytes() {
  const bytes = await pdfDoc.save();
  if (!annotations.size) return bytes;

  const copy = await PDFLib.PDFDocument.load(bytes);
  for (const [pageNumber, strokes] of annotations) {
    const page = copy.getPage(pageNumber - 1);
    if (!page) continue;
    for (const stroke of strokes) await drawStrokeOnPage(page, stroke);
  }
  return copy.save();
}

function resetEditor() {
  $('mainPdfFileInput').value = '';
  $('pageNumbersInput').value = '';
  $('insertPageNumberPdf').value = '1';
  $('insertPdfFileInput').value = '';
  $('insertPageNumberImage').value = '1';
  $('insertImageFileInput').value = '';

  pdfDoc = null;
  loadedFileName = '';
  history.length = 0;
  historyIndex = -1;
  updateHistoryUI();
  $('currentTotalPages').textContent = '0';

  destroyPreview();
  clearAnnotations();
  resetAnnotTools();
  $('annotBar').hidden = true;
  $('annotateBtn').setAttribute('aria-pressed', 'false');
  $('viewerScroll').classList.remove('is-annotating');
  pdfView.annotating = false;
  syncAnnotCursor();
  $('twoUpBtn').setAttribute('aria-pressed', 'false');
  pdfView.twoUp = false;
  previewEmpty.hidden = false;

  $('downloadBtn').disabled = true;

  dropZone.classList.remove('is-loaded');
  $('dropTitle').textContent = '点击或拖入 PDF 文件';
  $('dropSub').textContent = '文件只在本地处理，不会上传';
  setOperation('delete');
  toast('已重置编辑器');
}

// 首屏同步回退/前进按钮的可用状态
updateHistoryUI();

// 浏览器空闲时预载 pdf.js 的 worker，缩短第一次导入的等待
preloadPdfWorker();

// 窄屏空间不够，默认收起缩略图侧栏
const narrowQuery = window.matchMedia('(max-width: 640px)');
pdfView.showThumbs = !narrowQuery.matches;
applyThumbsVisibility();
// 跨越断点时跟随默认值，但用户手动切过就不再干预
narrowQuery.addEventListener('change', (event) => {
  if (pdfView.thumbsTouched) return;
  pdfView.showThumbs = !event.matches;
  applyThumbsVisibility();
  layoutPreview();
});
syncViewerUI();

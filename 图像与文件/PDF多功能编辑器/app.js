let pdfDoc = null;
let previewUrl = null;
let loadedFileName = '';

// 历史快照：每一步存一份 PDF 字节，回退/前进即重新载入其中一份
const history = [];
let historyIndex = -1;
let navigating = false;
const MAX_HISTORY_STEPS = 8;
const HISTORY_BUDGET = 200 * 1024 * 1024; // 快照总字节上限，避免大文件把内存吃满

const $ = (id) => document.getElementById(id);

const dropZone = $('dropZone');
const previewFrame = $('pdfPreview');
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

/* ---------- 回退 / 前进 ---------- */
function recordHistory(bytes, label) {
  // 从历史中间继续操作时，丢弃后面的重做分支
  if (historyIndex < history.length - 1) history.length = historyIndex + 1;
  history.push({bytes, label});
  historyIndex = history.length - 1;
  trimHistory();
  updateHistoryUI();
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
    await loadAndDisplayPdf(history[target].bytes);
    historyIndex = target;
    toast(message + '：' + history[target].label, 'ok');
  } catch (error) {
    toast('切换历史失败: ' + error.message, 'err');
  } finally {
    navigating = false;
    updateHistoryUI();
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
  try {
    const bytes = await file.arrayBuffer();
    await loadAndDisplayPdf(bytes);
    loadedFileName = file.name;
    history.length = 0;
    historyIndex = -1;
    recordHistory(bytes, file.name);
    setDropLoaded(file.name, file.size);
    toast('已载入 ' + file.name, 'ok');
  } catch (error) {
    toast('加载 PDF 失败: ' + error.message, 'err');
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

async function loadAndDisplayPdf(pdfBytes) {
  pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();

  $('currentTotalPages').textContent = totalPages;

  // 插入页码上限跟随当前文档页数
  ['insertPageNumberPdf', 'insertPageNumberImage'].forEach((id) => {
    const input = $(id);
    input.max = String(totalPages);
    if (Number(input.value) > totalPages) input.value = String(totalPages);
  });

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(new Blob([pdfBytes], {type: 'application/pdf'}));
  previewFrame.src = previewUrl;
  previewEmpty.hidden = true;

  $('downloadBtn').disabled = false;
}

// 处理中锁定按钮，避免重复点击
async function withBusy(button, task) {
  if (!button) return task();
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '处理中…';
  try {
    return await task();
  } finally {
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

      // 按降序删除，避免索引位移
      const sortedPages = [...pagesToDelete].sort((a, b) => b - a);
      for (const pageNum of sortedPages) {
        pdfDoc.removePage(pageNum - 1); // pdf-lib 中页面索引从 0 开始
      }

      const bytes = await pdfDoc.save();
      await loadAndDisplayPdf(bytes);
      recordHistory(bytes, `删除 ${describePages(pagesToDelete)} 页`);
      $('pageNumbersInput').value = '';
      toast(`成功删除页面: ${describePages(pagesToDelete)}`, 'ok');
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

      // 计算插入位置的索引
      let insertIndex = targetPage - 1;
      if (position === 'after') insertIndex += 1;

      const copiedPages = await pdfDoc.copyPages(insertPdfDoc, insertPdfDoc.getPageIndices());
      for (let i = 0; i < copiedPages.length; i++) {
        pdfDoc.insertPage(insertIndex + i, copiedPages[i]);
      }

      const bytes = await pdfDoc.save();
      await loadAndDisplayPdf(bytes);
      recordHistory(bytes, `插入 PDF ${copiedPages.length} 页`);
      toast(`成功在第${targetPage}页${position === 'before' ? '前' : '后'}插入了 ${copiedPages.length} 页`, 'ok');
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
      await loadAndDisplayPdf(bytes);
      recordHistory(bytes, '插入图片');
      toast(`成功在第${targetPage}页${position === 'before' ? '前' : '后'}插入了图片`, 'ok');
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
      const pdfBytes = await pdfDoc.save();
      const url = URL.createObjectURL(new Blob([pdfBytes], {type: 'application/pdf'}));

      const a = document.createElement('a');
      a.href = url;
      a.download = (loadedFileName ? loadedFileName.replace(/\.pdf$/i, '') : 'edited-pdf') + '.pdf';
      document.body.appendChild(a);
      a.click();

      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('已开始下载', 'ok');
    } catch (error) {
      toast('下载失败: ' + error.message, 'err');
    }
  });
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

  previewFrame.removeAttribute('src');
  previewEmpty.hidden = false;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  $('downloadBtn').disabled = true;

  dropZone.classList.remove('is-loaded');
  $('dropTitle').textContent = '点击或拖入 PDF 文件';
  $('dropSub').textContent = '文件只在本地处理，不会上传';
  setOperation('delete');
  toast('已重置编辑器');
}

// 首屏同步回退/前进按钮的可用状态
updateHistoryUI();

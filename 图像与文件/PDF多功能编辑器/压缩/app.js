(function () {
  'use strict';

  var PRESETS = {
    low: { dpi: 144, quality: 85 },
    medium: { dpi: 108, quality: 70 },
    high: { dpi: 84, quality: 55 }
  };

  // 单页画布的安全上限，避免超大版面撑爆内存
  var MAX_CANVAS_SIDE = 2600;
  // 页面尺寸上限保护（pt），超过则强制按 1 像素 = 1 点渲染
  var MAX_SCALE = 4;

  // 两种压缩方式的文案：raster = 整页转图片，image = 只重压内嵌图片
  var MODE_TEXT = {
    raster: {
      note: '每页重新渲染成一整张图片再封装：体积下降最多，但文字会变成图像，不能再选中或搜索。',
      tip: '扫描件、图片型 PDF 效果最好；纯文字 PDF 反而可能变大。',
      dpiLabel: '渲染清晰度'
    },
    image: {
      note: '保留原有文字与矢量内容，只把内嵌的 JPEG 图片重新压缩（降分辨率 + 降质量），文字仍可选中搜索。',
      tip: '体积下降幅度取决于图片占比：扫描件通常能降 40%~80%，纯文字 PDF 几乎没有变化。仅处理 JPEG 图片，带透明通道、PNG/JPEG2000/灰度1位等图片会被跳过。',
      dpiLabel: '图片分辨率上限'
    }
  };

  var state = {
    file: null,
    pdfDoc: null,
    loadToken: 0,
    pageCount: 0,
    busy: false,
    cancelled: false,
    compressedBytes: null,
    originalUrl: null,
    compressedUrl: null,
    level: 'medium',
    mode: 'raster',
    startedAt: 0
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  var els = {
    fileInput: $('fileInput'),
    dropzone: $('dropzone'),
    dzTitle: $('dzTitle'),
    fileMeta: $('fileMeta'),
    metaName: $('metaName'),
    metaSize: $('metaSize'),
    metaPages: $('metaPages'),
    presets: $('presets'),
    qualityRange: $('qualityRange'),
    qualityValue: $('qualityValue'),
    dpiSelect: $('dpiSelect'),
    dpiLabel: $('dpiLabel'),
    grayToggle: $('grayToggle'),
    advSummary: $('advSummary'),
    modes: $('modes'),
    modeNote: $('modeNote'),
    modeTip: $('modeTip'),
    resultNote: $('resultNote'),
    compressBtn: $('compressBtn'),
    cancelBtn: $('cancelBtn'),
    downloadBtn: $('downloadBtn'),
    progressBox: $('progressBox'),
    progressLabel: $('progressLabel'),
    progressPercent: $('progressPercent'),
    progressDetail: $('progressDetail'),
    progressEta: $('progressEta'),
    barFill: $('barFill'),
    resultBox: $('resultBox'),
    statBefore: $('statBefore'),
    statAfter: $('statAfter'),
    statRatio: $('statRatio'),
    statRatioCard: $('statRatioCard'),
    statTime: $('statTime'),
    errorBox: $('errorBox'),
    pdfPreview: $('pdfPreview'),
    previewEmpty: $('previewEmpty'),
    tabOriginal: $('tabOriginal'),
    tabCompressed: $('tabCompressed')
  };

  /* ---------------- 工具函数 ---------------- */

  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    i = Math.min(i, units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
  }

  function formatDuration(ms) {
    var sec = Math.round(ms / 1000);
    if (sec < 60) return sec + ' 秒';
    var min = Math.floor(sec / 60);
    var rest = sec % 60;
    return min + ' 分 ' + rest + ' 秒';
  }

  // 让浏览器先把进度条画出来，再执行下面的同步耗时操作。
  // 注意不能用纯 requestAnimationFrame：后台标签页的 rAF 会被暂停，
  // 导致压缩挂在最后一步，所以加 150ms 定时器兜底
  function yieldToUI() {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(function () {
        setTimeout(finish, 0);
      });
      setTimeout(finish, 150);
    });
  }

  function showNotice(message, type) {
    els.errorBox.className = 'notice ' + (type || 'error');
    els.errorBox.textContent = message;
    els.errorBox.hidden = false;
  }

  function showError(message) {
    showNotice(message, 'error');
  }

  function clearError() {
    els.errorBox.hidden = true;
    els.errorBox.textContent = '';
  }

  function setProgress(percent, label, detail, eta) {
    var pct = Math.max(0, Math.min(100, percent));
    els.progressBox.hidden = false;
    els.barFill.classList.remove('indeterminate');
    els.barFill.style.width = pct.toFixed(1) + '%';
    els.progressPercent.textContent = Math.round(pct) + '%';
    if (label !== undefined) els.progressLabel.textContent = label;
    els.progressDetail.textContent = detail || '\u00a0';
    els.progressEta.textContent = eta || '\u00a0';
  }

  function setIndeterminate(label, detail) {
    els.progressBox.hidden = false;
    els.barFill.classList.add('indeterminate');
    els.progressLabel.textContent = label;
    els.progressPercent.textContent = '…';
    els.progressDetail.textContent = detail || '\u00a0';
    els.progressEta.textContent = '\u00a0';
  }

  function hideProgress() {
    els.progressBox.hidden = true;
    els.barFill.classList.remove('indeterminate');
    els.barFill.style.width = '0%';
    els.progressDetail.textContent = '\u00a0';
    els.progressEta.textContent = '\u00a0';
  }

  /* ---------------- 预览 ---------------- */

  function revokeUrl(key) {
    if (state[key]) {
      URL.revokeObjectURL(state[key]);
      state[key] = null;
    }
  }

  function showPreview(kind) {
    var url = kind === 'compressed' ? state.compressedUrl : state.originalUrl;
    if (!url) return;
    els.pdfPreview.src = url;
    els.pdfPreview.hidden = false;
    els.previewEmpty.hidden = true;
    els.tabOriginal.classList.toggle('active', kind === 'original');
    els.tabCompressed.classList.toggle('active', kind === 'compressed');
  }

  /* ---------------- 选择文件 ---------------- */

  async function loadFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showError('请选择 PDF 格式的文件。');
      return;
    }
    if (state.busy) return;

    clearError();
    resetResult();

    // 重新解析期间先禁用压缩，避免用旧文档误触发
    var previousDoc = state.pdfDoc;
    state.pdfDoc = null;
    state.pageCount = 0;
    els.compressBtn.disabled = true;
    els.compressBtn.textContent = '开始压缩';

    // 释放上一个文档
    if (previousDoc) {
      try { await previousDoc.destroy(); } catch (e) { /* ignore */ }
    }

    // 连续选择文件时只认最后一次解析结果
    state.loadToken += 1;
    var token = state.loadToken;
    revokeUrl('originalUrl');
    revokeUrl('compressedUrl');
    state.compressedBytes = null;
    els.downloadBtn.disabled = true;
    els.tabCompressed.disabled = true;

    state.file = file;

    els.dzTitle.textContent = file.name;
    els.metaName.textContent = file.name;
    els.metaSize.textContent = formatFileSize(file.size);
    els.metaPages.textContent = '解析中…';
    els.fileMeta.hidden = false;

    state.originalUrl = URL.createObjectURL(file);
    els.tabOriginal.disabled = false;
    showPreview('original');

    setIndeterminate('正在解析 PDF…', '读取并分析文档结构');

    try {
      var pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
      pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';

      // 直接把 ArrayBuffer 交给 pdf.js（会被转移到 worker），
      // 不再额外 slice 一份 100MB+ 的副本
      var buffer = await file.arrayBuffer();
      var task = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        verbosity: 0
      });
      var doc = await task.promise;

      if (token !== state.loadToken) {
        try { doc.destroy(); } catch (e) { /* ignore */ }
        return;
      }

      state.pdfDoc = doc;
      state.pageCount = doc.numPages;
      els.metaPages.textContent = doc.numPages + ' 页';
      els.compressBtn.disabled = false;
      hideProgress();
    } catch (error) {
      console.error(error);
      els.metaPages.textContent = '解析失败';
      els.compressBtn.disabled = true;
      hideProgress();
      showError('PDF 解析失败：' + (error && error.message ? error.message : error));
    }
  }

  function resetResult() {
    state.compressedBytes = null;
    els.resultBox.hidden = true;
    els.resultNote.hidden = true;
    els.resultNote.textContent = '';
    els.downloadBtn.disabled = true;
    els.tabCompressed.disabled = true;
    els.statRatioCard.classList.remove('good', 'bad');
  }

  /* ---------------- 设置 ---------------- */

  function getSettings() {
    var dpi = parseInt(els.dpiSelect.value, 10) || 108;
    var quality = (parseInt(els.qualityRange.value, 10) || 70) / 100;
    return {dpi: dpi, quality: quality, grayscale: els.grayToggle.checked};
  }

  function applyPreset(level) {
    state.level = level;
    var preset = PRESETS[level];
    els.qualityRange.value = String(preset.quality);
    els.qualityValue.textContent = String(preset.quality);
    els.dpiSelect.value = String(preset.dpi);

    Array.prototype.forEach.call(els.presets.querySelectorAll('.preset'), function (btn) {
      var active = btn.dataset.level === level;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function markCustom() {
    state.level = 'custom';
    Array.prototype.forEach.call(els.presets.querySelectorAll('.preset'), function (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
  }

  // 切换压缩方式：更新文案与按钮选中态
  function applyMode(mode) {
    var text = MODE_TEXT[mode] ? mode : 'raster';
    state.mode = text;
    var info = MODE_TEXT[text];

    els.modeNote.textContent = info.note;
    els.modeTip.textContent = info.tip;
    els.dpiLabel.textContent = info.dpiLabel;

    Array.prototype.forEach.call(els.modes.querySelectorAll('.mode'), function (btn) {
      var active = btn.dataset.mode === text;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /* ---------------- 压缩主流程 ---------------- */

  function updateRenderProgress(done, total, startAt) {
    var ratio = total ? done / total : 0;
    var percent = 8 + ratio * 84;
    var elapsed = performance.now() - startAt;
    var eta = '';
    if (done >= 2 && done < total) {
      var perPage = elapsed / done;
      eta = '预计剩余 ' + formatDuration(perPage * (total - done));
    } else if (done >= total) {
      eta = '渲染完成';
    }
    setProgress(
      percent,
      '正在压缩页面 ' + done + ' / ' + total,
      '已用时 ' + formatDuration(elapsed),
      eta
    );
  }

  // 去色：把 R/G/B 都写成同一个亮度值。
  // JPEG 的色度通道随之变得极平坦，编码后能再省一截体积
  function toGray(canvas) {
    var ctx = canvas.getContext('2d', {alpha: false});
    var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = image.data;
    for (var i = 0; i < data.length; i += 4) {
      // 0.299/0.587/0.114 用整数近似（77+150+29 = 256），避免逐像素浮点运算
      var v = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    ctx.putImageData(image, 0, 0);
  }

  // 把一页的 JPEG 写入新 PDF：pdf-lib 直接嵌入原始字节，不会二次编码
  async function embedPage(doc, item) {
    var blob = await item.job;
    if (!blob) throw new Error('第 ' + item.index + ' 页图片编码失败');
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var image = await doc.embedJpg(bytes);
    var page = doc.addPage([item.width, item.height]);
    page.drawImage(image, {x: 0, y: 0, width: item.width, height: item.height});
  }

  function compressPdf() {
    if (state.busy) return;
    if (!state.pdfDoc) {
      showError('请先选择 PDF 文件。');
      return;
    }

    clearError();
    resetResult();
    if (state.originalUrl) showPreview('original');

    var settings = getSettings();
    var startAt = performance.now();

    state.busy = true;
    state.cancelled = false;
    els.compressBtn.disabled = true;
    els.compressBtn.textContent = '压缩中…';
    els.cancelBtn.hidden = false;
    els.downloadBtn.disabled = true;

    var runner = state.mode === 'image' ? compressImagesPdf : compressRasterPdf;
    setProgress(3, '读取文件…', '准备压缩', '');

    runner(settings, startAt).then(function (result) {
      if (state.cancelled) throw {__cancel: true};
      state.compressedBytes = result.bytes;
      finishSuccess(result.bytes.byteLength, performance.now() - startAt, result.note);
    }).catch(function (error) {
      if (error && error.__cancel) {
        hideProgress();
        clearError();
        els.compressBtn.textContent = '开始压缩';
        els.compressBtn.disabled = false;
        els.cancelBtn.hidden = true;
        state.busy = false;
        return;
      }
      console.error('压缩失败:', error);
      hideProgress();
      showError('压缩失败：' + (error && error.message ? error.message : error));
      els.compressBtn.textContent = '开始压缩';
      els.compressBtn.disabled = false;
      els.cancelBtn.hidden = true;
      state.busy = false;
    });
  }

  /* ---------------- 方式一：整页转图片 ---------------- */

  async function compressRasterPdf(settings, startAt) {
    var PDFLib = window.PDFLib;
    if (!PDFLib) throw new Error('PDF 组件加载失败，请检查 ../pdf-lib.js 是否存在');

    var total = state.pageCount;

    // 两块画布交替使用：上一页的 JPEG 编码（toBlob 在线程外异步完成）期间，
    // 可以继续渲染下一页，渲染与编码重叠执行
    var canvases = [document.createElement('canvas'), document.createElement('canvas')];
    var inflight = [];
    var placed = 0;

    var outDoc = await PDFLib.PDFDocument.create();
    if (outDoc.setCreationDate) outDoc.setCreationDate(new Date());

    setProgress(8, '开始渲染页面…', '共 ' + total + ' 页', '');

    for (var i = 1; i <= total; i++) {
      if (state.cancelled) throw {__cancel: true};

      var page = await state.pdfDoc.getPage(i);
      var base = page.getViewport({scale: 1});

      // 按 DPI 换算缩放比例，并限制单页画布尺寸，避免超大版面拖慢渲染
      var longSide = Math.max(base.width, base.height);
      var scale = settings.dpi / 72;
      if (longSide * scale > MAX_CANVAS_SIDE) {
        scale = MAX_CANVAS_SIDE / longSide;
      }
      scale = Math.min(scale, MAX_SCALE);
      scale = Math.max(scale, 0.2);

      var viewport = page.getViewport({scale: scale});
      var w = Math.max(1, Math.round(viewport.width));
      var h = Math.max(1, Math.round(viewport.height));

      var canvas = canvases[(i - 1) % 2];
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', {alpha: false});
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      await page.render({canvasContext: ctx, viewport: viewport}).promise;
      page.cleanup();

      if (settings.grayscale) toGray(canvas);

      // 异步编码当前页（toBlob 在渲染线程外完成），同时继续渲染下一页
      inflight.push({
        index: i,
        width: base.width,
        height: base.height,
        job: new Promise(function (resolve) {
          canvas.toBlob(resolve, 'image/jpeg', settings.quality);
        })
      });

      // 队列满 2 个就写入最早的一页，既保证页序又把内存控制在两页以内
      if (inflight.length >= 2) {
        await embedPage(outDoc, inflight.shift());
        placed++;
        updateRenderProgress(placed, total, startAt);
      }
    }

    // 收尾：把队列里剩下的最后一页写完
    while (inflight.length) {
      await embedPage(outDoc, inflight.shift());
      placed++;
      updateRenderProgress(placed, total, startAt);
    }

    setIndeterminate('正在生成 PDF 文件…', '写入 ' + placed + ' 页，请稍候');
    await yieldToUI();

    var bytes = await outDoc.save({useObjectStreams: true});
    return {
      bytes: bytes,
      note: settings.grayscale ? '已按灰度输出，每页仍是一整张图片。' : undefined
    };
  }

  /* ---------------- 方式二：只重压内嵌图片 ---------------- */

  // 找出页面上所有可处理的 JPEG 图片 XObject（按对象号去重，同一图可能被多页引用）
  function collectJpegImages(doc, PDFLib) {
    var PDFName = PDFLib.PDFName;
    var PDFDict = PDFLib.PDFDict;
    var PDFRawStream = PDFLib.PDFRawStream;
    var PDFNumber = PDFLib.PDFNumber;

    var seen = Object.create(null);
    var jobs = [];
    var skipped = 0;

    doc.getPages().forEach(function (page) {
      var pageMaxPt = Math.max(page.getWidth(), page.getHeight());
      var resources = page.node.Resources();
      if (!resources) return;

      var xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
      if (!xobjects) return;

      xobjects.entries().forEach(function (entry) {
        var ref = entry[1];
        if (!ref || typeof ref.objectNumber !== 'number') return;

        var key = ref.objectNumber + ' ' + ref.generationNumber;
        if (seen[key]) return;
        seen[key] = true;

        var obj = doc.context.lookup(ref);
        if (!(obj instanceof PDFRawStream)) return;

        var dict = obj.dict;
        var subtype = dict.lookup(PDFName.of('Subtype'));
        if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') return;

        var width = dict.lookup(PDFName.of('Width'));
        var height = dict.lookup(PDFName.of('Height'));
        var filter = dict.lookup(PDFName.of('Filter'));
        var colorSpace = dict.lookup(PDFName.of('ColorSpace'));
        var bpc = dict.lookup(PDFName.of('BitsPerComponent'));
        var mask = dict.lookup(PDFName.of('SMask')) || dict.lookup(PDFName.of('Mask'));
        var imageMask = dict.lookup(PDFName.of('ImageMask'));
        // 带 Decode 反相数组的图片，重写后颜色会反过来，直接跳过
        var decode = dict.lookup(PDFName.of('Decode'));

        var isJpeg = filter instanceof PDFName && filter.asString() === '/DCTDecode';
        var csName = colorSpace instanceof PDFName ? colorSpace.asString() : null;
        // 只处理 DeviceRGB / DeviceGray：CMYK 与 ICC 的 JPEG 在浏览器里解码颜色会错
        var okCs = csName === '/DeviceRGB' || csName === '/DeviceGray';
        var okBpc = bpc instanceof PDFNumber && bpc.asNumber() === 8;
        var isStencil = imageMask && typeof imageMask.asBoolean === 'function' && imageMask.asBoolean();

        if (!isJpeg || !okCs || !okBpc || mask || isStencil || decode ||
          !(width instanceof PDFNumber) || !(height instanceof PDFNumber)) {
          skipped++;
          return;
        }

        jobs.push({
          ref: ref,
          contents: obj.contents,
          width: width.asNumber(),
          height: height.asNumber(),
          pageMaxPt: pageMaxPt
        });
      });
    });

    return {jobs: jobs, skipped: skipped};
  }

  async function compressImagesPdf(settings, startAt) {
    var PDFLib = window.PDFLib;
    if (!PDFLib) throw new Error('PDF 组件加载失败，请检查 ../pdf-lib.js 是否存在');

    var PDFName = PDFLib.PDFName;
    var PDFNumber = PDFLib.PDFNumber;
    var PDFRawStream = PDFLib.PDFRawStream;

    setProgress(5, '读取文件…', '解析 PDF 结构', '');
    await yieldToUI();

    var source = new Uint8Array(await state.file.arrayBuffer());
    if (state.cancelled) throw {__cancel: true};

    var doc = await PDFLib.PDFDocument.load(source, {
      updateMetadata: false,
      throwOnInvalidObject: false
    });

    var found = collectJpegImages(doc, PDFLib);
    var jobs = found.jobs;
    var skipped = found.skipped;

    // 没有可处理的图片：直接返回原文件，避免用户以为“什么都没发生”
    if (!jobs.length) {
      setIndeterminate('没有可压缩的图片', '已跳过 ' + skipped + ' 张', '');
      await yieldToUI();
      var passthrough = await doc.save({useObjectStreams: true});
      var emptyNote = '没有找到可压缩的 JPEG 图片';
      if (skipped) emptyNote += '（另有 ' + skipped + ' 张非 JPEG 或带透明通道的图片被跳过）';
      return {
        bytes: passthrough,
        note: emptyNote + '，文件内容保持原样。建议改用「整页转图片」模式。'
      };
    }

    var canvas = document.createElement('canvas');
    var processed = 0;
    var skippedTiny = 0;
    var skippedError = 0;
    var savedBytes = 0;

    for (var i = 0; i < jobs.length; i++) {
      if (state.cancelled) throw {__cancel: true};

      var job = jobs[i];

      // 目标像素：按页面尺寸与 DPI 估算，只降不升
      var maxSidePx = Math.min(Math.round(settings.dpi / 72 * job.pageMaxPt), MAX_CANVAS_SIDE);
      var scale = Math.min(1, maxSidePx / Math.max(job.width, job.height));
      var targetW = Math.max(1, Math.round(job.width * scale));
      var targetH = Math.max(1, Math.round(job.height * scale));

      try {
        var bitmap = await createImageBitmap(new Blob([job.contents], {type: 'image/jpeg'}));
        targetW = Math.max(1, Math.round(bitmap.width * scale));
        targetH = Math.max(1, Math.round(bitmap.height * scale));

        canvas.width = targetW;
        canvas.height = targetH;
        var ctx = canvas.getContext('2d', {alpha: false});
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        bitmap.close();

        if (settings.grayscale) toGray(canvas);

        var outBlob = await new Promise(function (resolve) {
          canvas.toBlob(resolve, 'image/jpeg', settings.quality);
        });

        // 压不下来就保留原图，避免越压越大
        if (!outBlob || outBlob.size >= job.contents.length) {
          skippedTiny++;
        } else {
          var bytes = new Uint8Array(await outBlob.arrayBuffer());

          // 构造新的图片流，指回原来那个对象号，内容流无需改动
          var dict = doc.context.obj({});
          dict.set(PDFName.of('Type'), PDFName.of('XObject'));
          dict.set(PDFName.of('Subtype'), PDFName.of('Image'));
          dict.set(PDFName.of('Width'), PDFNumber.of(targetW));
          dict.set(PDFName.of('Height'), PDFNumber.of(targetH));
          dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
          dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
          dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));

          doc.context.assign(job.ref, PDFRawStream.of(dict, bytes));
          savedBytes += job.contents.length - bytes.length;
          processed++;
        }
      } catch (e) {
        skippedError++;
      }

      var ratio = (i + 1) / jobs.length;
      var elapsed = performance.now() - startAt;
      var eta = '';
      if (i >= 1 && i + 1 < jobs.length) {
        eta = '预计剩余 ' + formatDuration((elapsed / (i + 1)) * (jobs.length - i - 1));
      }
      setProgress(
        8 + ratio * 84,
        '正在压缩图片 ' + (i + 1) + ' / ' + jobs.length,
        '已节省 ' + formatFileSize(Math.max(0, savedBytes)),
        eta
      );
    }

    setIndeterminate('正在生成 PDF 文件…', '重压 ' + processed + ' 张图片，请稍候');
    await yieldToUI();

    var output = await doc.save({useObjectStreams: true});

    var note = '共重压 ' + processed + ' 张图片';
    if (settings.grayscale) note += '（已转为灰度）';
    if (skippedTiny) note += '，' + skippedTiny + ' 张压缩后反而更大已保留原图';
    if (skippedError) note += '，' + skippedError + ' 张解码失败';
    if (skipped) note += '，' + skipped + ' 张非 JPEG 或带透明通道已跳过';

    return {bytes: output, note: note + '。文字与矢量内容未改动。'};
  }

  function finishSuccess(size, elapsed, note) {
    setProgress(100, '压缩完成', '共 ' + state.pageCount + ' 页', '');

    els.compressBtn.textContent = '重新压缩';
    els.compressBtn.disabled = false;
    els.cancelBtn.hidden = true;
    els.downloadBtn.disabled = false;
    state.busy = false;

    var before = state.file ? state.file.size : 0;
    var ratio = before > 0 ? (1 - size / before) * 100 : 0;
    // 体积几乎没变时不写 “-0.0%”
    var tiny = Math.abs(ratio) < 0.05;

    els.statBefore.textContent = formatFileSize(before);
    els.statAfter.textContent = formatFileSize(size);
    els.statRatio.textContent = tiny
      ? '0.0%'
      : (ratio > 0 ? '-' : '+') + Math.abs(ratio).toFixed(1) + '%';
    els.statTime.textContent = formatDuration(elapsed);
    els.statRatioCard.classList.toggle('good', ratio > 0.05);
    els.statRatioCard.classList.toggle('bad', ratio <= 0.05);
    els.resultBox.hidden = false;

    if (note) {
      els.resultNote.textContent = note;
      els.resultNote.hidden = false;
    }

    if (ratio <= 0) {
      var advice = state.mode === 'image'
        ? '这份 PDF 里几乎没有可压缩的 JPEG 图片，建议改用「整页转图片」。'
        : '这份 PDF 可能本来就是文字型文档，建议改用「只压缩图片」或直接使用原文件。';
      // 体积没变化时不提“变大”，结果区备注已说明原因
      if (size > before) {
        showNotice('压缩后体积反而变大了 ' + formatFileSize(size - before) + '。' + advice, 'warn');
      }
    }

    revokeUrl('compressedUrl');
    state.compressedUrl = URL.createObjectURL(new Blob([state.compressedBytes], {type: 'application/pdf'}));
    els.tabCompressed.disabled = false;
    showPreview('compressed');
  }

  function downloadCompressedPdf() {
    if (!state.compressedBytes) return;
    var name = (state.file && state.file.name ? state.file.name : 'document.pdf').replace(/\.pdf$/i, '');
    var blob = new Blob([state.compressedBytes], {type: 'application/pdf'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name + '-压缩.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 3000);
  }

  /* ---------------- 事件绑定 ---------------- */

  els.fileInput.addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    loadFile(file);
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    els.dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      els.dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(function (type) {
    els.dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      els.dropzone.classList.remove('dragover');
    });
  });

  els.dropzone.addEventListener('drop', function (event) {
    var files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) loadFile(files[0]);
  });

  els.modes.addEventListener('click', function (event) {
    var btn = event.target.closest('.mode');
    if (!btn || state.busy) return;
    applyMode(btn.dataset.mode);
  });

  els.presets.addEventListener('click', function (event) {
    var btn = event.target.closest('.preset');
    if (!btn) return;
    applyPreset(btn.dataset.level);
  });

  els.qualityRange.addEventListener('input', function () {
    els.qualityValue.textContent = els.qualityRange.value;
    markCustom();
  });

  els.dpiSelect.addEventListener('change', markCustom);

  // 折叠状态下也能一眼看出灰度是否生效
  els.grayToggle.addEventListener('change', function () {
    els.advSummary.textContent = els.grayToggle.checked ? '高级设置 · 灰度已开' : '高级设置';
  });

  els.compressBtn.addEventListener('click', compressPdf);
  els.downloadBtn.addEventListener('click', downloadCompressedPdf);

  els.cancelBtn.addEventListener('click', function () {
    state.cancelled = true;
    els.cancelBtn.disabled = true;
    els.progressLabel.textContent = '正在取消…';
    setTimeout(function () {
      els.cancelBtn.disabled = false;
    }, 800);
  });

  els.tabOriginal.addEventListener('click', function () {
    if (!els.tabOriginal.disabled) showPreview('original');
  });

  els.tabCompressed.addEventListener('click', function () {
    if (!els.tabCompressed.disabled) showPreview('compressed');
  });

  window.addEventListener('beforeunload', function () {
    revokeUrl('originalUrl');
    revokeUrl('compressedUrl');
  });

  // 浏览器会对后台标签页的定时器和画布光栅化降速，压缩会慢很多，提醒用户
  document.addEventListener('visibilitychange', function () {
    if (!state.busy) return;
    if (document.hidden) {
      showNotice('已切到其他标签页，浏览器会降低本页的处理速度（可能慢好几倍），切回本页即可恢复。', 'warn');
    } else {
      clearError();
    }
  });

  applyMode('raster');
  applyPreset('medium');
})();

/**
 * stencil.js —— 图案写入位平面页面控制器
 * 与 lsb.js 共用位平面渲染；写入逻辑与 LSB1 载荷无关：
 * 把文字/图片二值化成图案，直接覆盖指定通道的指定位平面，
 * 这样在分析页查看该位平面就能肉眼看到图案。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var CH_INDEX = { r: 0, g: 1, b: 2, a: 3 };
  var CH_NAME = { r: '红 (R)', g: '绿 (G)', b: '蓝 (B)', a: '透明度 (A)' };
  var LINE_H = 1.25;
  var HANDLE_GAP = 26;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var state = {
    carrier: null,        // 载体 ImageData
    carrierCanvas: null,  // 载体离屏画布（重绘编辑视图时直接 drawImage，比 putImageData 快）
    carrierName: '',
    carrierSize: 0,
    layers: [],
    selected: 0,
    nextId: 1,
    outBlob: null,
    outMask: null,
    outOpts: null,
    previewTimer: 0
  };

  var scratch = document.createElement('canvas').getContext('2d');
  var maskCanvas = document.createElement('canvas');

  /* ---------------- 图片解码 ---------------- */
  function decodeImage(source) {
    if (window.createImageBitmap) {
      return createImageBitmap(source).then(function (bmp) { return bmp; });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(source);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('浏览器无法解码该图片')); };
      img.src = url;
    });
  }

  function toImageData(bmp) {
    var cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return { imageData: ctx.getImageData(0, 0, cv.width, cv.height), canvas: cv };
  }
  /* ---------------- 图层模型 ---------------- */
  function selected() {
    for (var i = 0; i < state.layers.length; i++) {
      if (state.layers[i].id === state.selected) return state.layers[i];
    }
    return null;
  }

  function fontOf(layer) {
    return (layer.bold ? '700 ' : '400 ') + Math.max(4, Math.round(layer.size)) + 'px ' + layer.font;
  }

  /* 图层在载体坐标系里的包围盒（未旋转） */
  function layerBox(layer) {
    if (layer.type === 'text') {
      scratch.font = fontOf(layer);
      var lines = (layer.text || ' ').split('\n');
      var w = 0;
      lines.forEach(function (line) {
        w = Math.max(w, scratch.measureText(line || ' ').width);
      });
      return { w: Math.max(8, w) + layer.size * 0.2, h: lines.length * layer.size * LINE_H };
    }
    return { w: layer.img.width * layer.scale, h: layer.img.height * layer.scale };
  }

  function drawLayer(ctx, layer) {
    var box = layerBox(layer);
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate(layer.rot * Math.PI / 180);
    if (layer.type === 'text') {
      ctx.font = fontOf(layer);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = layer.color;
      var lines = (layer.text || '').split('\n');
      var lh = layer.size * LINE_H;
      var top = -((lines.length - 1) * lh) / 2;
      lines.forEach(function (line, i) { ctx.fillText(line, 0, top + i * lh); });
    } else {
      // 放大时关掉平滑，二值化后边缘更利落
      ctx.imageSmoothingEnabled = layer.scale < 1;
      ctx.drawImage(layer.img, -box.w / 2, -box.h / 2, box.w, box.h);
    }
    ctx.restore();
  }
  function addTextLayer() {
    if (!state.carrier) return;
    var h = state.carrier.height;
    var layer = {
      id: state.nextId++, type: 'text', text: '隐藏文字',
      font: 'sans-serif', size: Math.max(12, Math.round(h / 6)), bold: true,
      color: '#ffffff', scale: 1, rot: 0,
      x: state.carrier.width / 2, y: h / 2
    };
    state.layers.push(layer);
    state.selected = layer.id;
    syncLayers();
    refresh();
  }

  function addImageLayer(bmp, name) {
    var cw = state.carrier.width;
    var ch = state.carrier.height;
    var fit = Math.min(cw * 0.6 / bmp.width, ch * 0.6 / bmp.height);
    var layer = {
      id: state.nextId++, type: 'image', img: bmp, name: name || '图片',
      scale: clamp(fit, 0.01, 8), rot: 0, x: cw / 2, y: ch / 2
    };
    state.layers.push(layer);
    state.selected = layer.id;
    syncLayers();
    refresh();
  }

  function layerLabel(layer) {
    if (layer.type === 'text') {
      var t = (layer.text || '').replace(/\n/g, ' ').trim();
      return '文字：' + (t.length > 10 ? t.slice(0, 10) + '…' : t || '（空）');
    }
    return '图片：' + layer.name + '（' + layer.img.width + '×' + layer.img.height + '）';
  }

  function moveLayer(id, dir) {
    var i = state.layers.findIndex(function (l) { return l.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= state.layers.length) return;
    var tmp = state.layers[i];
    state.layers[i] = state.layers[j];
    state.layers[j] = tmp;
    syncLayers();
    refresh();
  }

  function removeLayer(id) {
    state.layers = state.layers.filter(function (l) { return l.id !== id; });
    if (state.selected === id) {
      state.selected = state.layers.length ? state.layers[state.layers.length - 1].id : 0;
    }
    syncLayers();
    refresh();
  }
  /* ---------------- 图层列表与属性栏 ---------------- */
  function syncLayers() {
    var box = $('layerList');
    if (!state.layers.length) {
      box.innerHTML = '<div class="layer-empty">还没有图层，先添加文字或图片。</div>';
      $('props').hidden = true;
      updateActions();
      return;
    }
    // 列表从上层到下层排列，和「谁盖住谁」的直觉一致
    var rows = state.layers.slice().reverse().map(function (l) {
      return '<div class="layer-row' + (l.id === state.selected ? ' is-active' : '') +
        '" data-id="' + l.id + '">' +
        '<span class="layer-name">' + esc(layerLabel(l)) + '</span>' +
        '<button class="mini" type="button" data-act="up" title="上移一层">↑</button>' +
        '<button class="mini" type="button" data-act="down" title="下移一层">↓</button>' +
        '<button class="mini del" type="button" data-act="del" title="删除">✕</button>' +
        '</div>';
    }).join('');
    box.innerHTML = rows;
    Array.prototype.forEach.call(box.querySelectorAll('.layer-row'), function (row) {
      var id = +row.getAttribute('data-id');
      row.addEventListener('click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'up') { moveLayer(id, 1); return; }
        if (act === 'down') { moveLayer(id, -1); return; }
        if (act === 'del') { removeLayer(id); return; }
        state.selected = id;
        syncLayers();
        renderEdit();
      });
    });
    syncProps();
    updateActions();
  }

  function syncProps() {
    var l = selected();
    $('props').hidden = !l;
    if (!l) return;
    var isText = l.type === 'text';
    $('fieldText').hidden = !isText;
    $('fieldFont').hidden = !isText;
    $('fieldColor').hidden = !isText;
    $('fieldScale').hidden = isText;
    if (isText) {
      $('pText').value = l.text;
      $('pFont').value = l.font;
      $('pSize').max = String(Math.max(64, Math.round(state.carrier.height * 1.2)));
      $('pSize').value = String(Math.round(l.size));
      $('pSizeLabel').textContent = Math.round(l.size);
      $('pBold').checked = l.bold;
      $('pColor').value = l.color;
    } else {
      $('pScale').value = String(Math.round(l.scale * 100));
      $('pScaleLabel').textContent = Math.round(l.scale * 100) + '%';
    }
    $('pRot').value = String(Math.round(l.rot));
    $('pRotLabel').textContent = Math.round(l.rot) + '°';
  }
  /* ---------------- 编辑视图 ---------------- */
  function displayScale() {
    var cv = $('editCanvas');
    var rect = cv.getBoundingClientRect();
    return rect.width && cv.width ? rect.width / cv.width : 1;
  }

  function renderEdit() {
    var cv = $('editCanvas');
    var ctx = cv.getContext('2d');
    if (!state.carrier) {
      cv.width = 1;
      cv.height = 1;
      ctx.clearRect(0, 0, 1, 1);
      return;
    }
    if (cv.width !== state.carrier.width || cv.height !== state.carrier.height) {
      cv.width = state.carrier.width;
      cv.height = state.carrier.height;
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(state.carrierCanvas, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.9;
    state.layers.forEach(function (l) { drawLayer(ctx, l); });
    ctx.restore();
    var sel = selected();
    if (sel) drawSelection(ctx, sel);
  }

  function drawSelection(ctx, layer) {
    var box = layerBox(layer);
    var s = 1 / displayScale();   // 手柄按屏幕像素画，缩略显示时也好点
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate(layer.rot * Math.PI / 180);
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.6 * s;
    ctx.setLineDash([7 * s, 5 * s]);
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.setLineDash([]);
    var ry = -box.h / 2 - HANDLE_GAP * s;
    ctx.beginPath();
    ctx.moveTo(0, -box.h / 2);
    ctx.lineTo(0, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, ry, 7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    var hs = 6 * s;
    ctx.beginPath();
    ctx.rect(box.w / 2 - hs, box.h / 2 - hs, hs * 2, hs * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  /* ---------------- 拖动 / 缩放 / 旋转 ---------------- */
  var drag = null;

  function toImg(e) {
    var cv = $('editCanvas');
    var rect = cv.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * cv.width / (rect.width || 1),
      y: (e.clientY - rect.top) * cv.height / (rect.height || 1)
    };
  }

  /* 把画布坐标换算到图层自身（去掉平移与旋转）的坐标系 */
  function localPoint(layer, p) {
    var dx = p.x - layer.x;
    var dy = p.y - layer.y;
    var a = -layer.rot * Math.PI / 180;
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
  }

  function hitTest(layer, p) {
    var box = layerBox(layer);
    var lp = localPoint(layer, p);
    var s = 1 / displayScale();
    var pad = 10 * s;
    var ry = -box.h / 2 - HANDLE_GAP * s;
    if (Math.abs(lp.x) <= pad && Math.abs(lp.y - ry) <= pad) return 'rotate';
    if (Math.abs(lp.x - box.w / 2) <= pad && Math.abs(lp.y - box.h / 2) <= pad) return 'scale';
    if (Math.abs(lp.x) <= box.w / 2 && Math.abs(lp.y) <= box.h / 2) return 'move';
    return null;
  }

  function pickLayer(p) {
    var sel = selected();
    if (sel) {
      var hit = hitTest(sel, p);
      if (hit) return { layer: sel, mode: hit };
    }
    for (var i = state.layers.length - 1; i >= 0; i--) {
      if (hitTest(state.layers[i], p) === 'move') return { layer: state.layers[i], mode: 'move' };
    }
    return null;
  }

  function baseSize(layer) {
    return layer.type === 'text' ? layer.size : layer.scale;
  }

  function setBaseSize(layer, v) {
    if (layer.type === 'text') layer.size = clamp(v, 4, state.carrier.height * 3);
    else layer.scale = clamp(v, 0.01, 12);
  }
  function onPointerDown(e) {
    if (!state.carrier || !state.layers.length) return;
    var p = toImg(e);
    var pick = pickLayer(p);
    if (!pick) return;
    e.preventDefault();
    $('editCanvas').focus();
    if (pick.layer.id !== state.selected) {
      state.selected = pick.layer.id;
      syncLayers();
    }
    var l = pick.layer;
    drag = {
      mode: pick.mode, layer: l, start: p,
      ox: l.x, oy: l.y, orot: l.rot, osize: baseSize(l),
      dist: Math.hypot(p.x - l.x, p.y - l.y) || 1,
      angle: Math.atan2(p.y - l.y, p.x - l.x)
    };
    try { $('editCanvas').setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    renderEdit();
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    var p = toImg(e);
    var l = drag.layer;
    if (drag.mode === 'move') {
      l.x = drag.ox + (p.x - drag.start.x);
      l.y = drag.oy + (p.y - drag.start.y);
    } else if (drag.mode === 'scale') {
      var d = Math.hypot(p.x - l.x, p.y - l.y);
      setBaseSize(l, drag.osize * (d / drag.dist));
    } else {
      var a = Math.atan2(p.y - l.y, p.x - l.x);
      var deg = drag.orot + (a - drag.angle) * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;      // 按住 Shift 吸附 15°
      l.rot = ((deg + 180) % 360 + 360) % 360 - 180;
    }
    syncProps();
    renderEdit();
    queuePreview();
  }

  function onPointerUp(e) {
    if (!drag) return;
    try { $('editCanvas').releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    drag = null;
    syncLayers();
    refresh();
  }
  /* ---------------- 图案二值化 ---------------- */
  /* Floyd–Steinberg 误差扩散：把灰阶变成网点，照片放进 1 位平面才看得清 */
  function ditherPlane(val, stride, offset, w, h, thr) {
    var n = w * h;
    var f = new Float32Array(n);
    for (var i = 0; i < n; i++) f[i] = val[i * stride + offset];
    var out = new Uint8Array(n);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var k = y * w + x;
        var old = f[k];
        var on = old >= thr ? 1 : 0;
        out[k] = on;
        var err = old - (on ? 255 : 0);
        if (x + 1 < w) f[k + 1] += err * 7 / 16;
        if (y + 1 < h) {
          if (x > 0) f[k + w - 1] += err * 3 / 16;
          f[k + w] += err * 5 / 16;
          if (x + 1 < w) f[k + w + 1] += err * 1 / 16;
        }
      }
    }
    return out;
  }

  function buildMask() {
    var w = state.carrier.width;
    var h = state.carrier.height;
    if (maskCanvas.width !== w || maskCanvas.height !== h) {
      maskCanvas.width = w;
      maskCanvas.height = h;
    }
    var ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    state.layers.forEach(function (l) { drawLayer(ctx, l); });
    var comp = ctx.getImageData(0, 0, w, h).data;
    var n = w * h;
    var color = $('writeMode').value === 'color';
    var thr = +$('threshold').value;
    var useDither = $('dither').checked;
    var inv = $('maskInvert').checked;
    var stride = color ? 3 : 1;
    var val = new Float32Array(n * stride);
    var covered = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * 4;
      var a = comp[p + 3] / 255;
      covered[i] = comp[p + 3] >= 8 ? 1 : 0;
      if (color) {
        val[i * 3] = comp[p] * a;
        val[i * 3 + 1] = comp[p + 1] * a;
        val[i * 3 + 2] = comp[p + 2] * a;
      } else {
        val[i] = (comp[p] * 0.299 + comp[p + 1] * 0.587 + comp[p + 2] * 0.114) * a;
      }
    }
    return finishMask(val, covered, n, w, h, stride, thr, useDither, inv);
  }
  function finishMask(val, covered, n, w, h, stride, thr, useDither, inv) {
    var bits = new Uint8Array(n * 3);
    var on = 0;
    for (var c = 0; c < stride; c++) {
      var plane = useDither ? ditherPlane(val, stride, c, w, h, thr) : null;
      for (var i = 0; i < n; i++) {
        var b = plane ? plane[i] : (val[i * stride + c] >= thr ? 1 : 0);
        if (!covered[i]) b = 0;      // 抖动的误差会溢出图案边界，这里统一夹回去
        if (inv) b ^= 1;
        if (stride === 1) {
          bits[i * 3] = bits[i * 3 + 1] = bits[i * 3 + 2] = b;
        } else {
          bits[i * 3 + c] = b;
        }
        if (b && c === 0) on++;
      }
    }
    return { bits: bits, covered: covered, on: on, pixels: n };
  }

  function targetChannels() {
    if ($('writeMode').value === 'color') return [0, 1, 2];
    return [CH_INDEX[$('channel').value]];
  }

  function currentOpts() {
    return {
      color: $('writeMode').value === 'color',
      channel: $('channel').value,
      chans: targetChannels(),
      plane: +$('plane').value,
      whole: $('bgMode').value === 'whole',
      flatten: $('flatten').checked
    };
  }

  /* ---------------- 写入位平面 ---------------- */
  function applyStencil(mask, opts) {
    var src = state.carrier;
    var n = src.width * src.height;
    var out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    var d = out.data;
    if (opts.flatten) {
      for (var q = 3; q < d.length; q += 4) d[q] = 255;
    }
    var keep = ~(1 << opts.plane);
    var changed = 0;
    var samples = 0;
    for (var i = 0; i < n; i++) {
      if (!opts.whole && !mask.covered[i]) continue;
      for (var k = 0; k < opts.chans.length; k++) {
        var t = opts.chans[k];
        var p = i * 4 + t;
        var prev = d[p];
        d[p] = (prev & keep) | (mask.bits[i * 3 + (opts.color ? t : 0)] << opts.plane);
        samples++;
        if (d[p] !== prev) changed++;
      }
    }
    return { imageData: out, changed: changed, samples: samples };
  }
  function psnr(a, b) {
    var sum = 0;
    var count = 0;
    for (var i = 0; i < a.length; i += 4) {
      for (var k = 0; k < 3; k++) {
        var diff = a[i + k] - b[i + k];
        sum += diff * diff;
        count++;
      }
    }
    if (!count || !sum) return Infinity;
    return 10 * Math.log10(255 * 255 / (sum / count));
  }

  /* ---------------- 位平面预览 ---------------- */
  function queuePreview() {
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(renderPreview, 90);
  }

  function renderPreview() {
    state.previewTimer = 0;
    var cv = $('planeCanvas');
    var badge = $('planeBadge');
    if (!state.carrier) {
      cv.width = cv.height = 1;
      badge.className = 'badge';
      badge.textContent = '等待载体与图层';
      return;
    }
    var opts = currentOpts();
    var mask = buildMask();
    var res = applyStencil(mask, opts);
    var plane = window.LSBKit.renderPlane(res.imageData, {
      bit: opts.plane, channel: opts.color ? 'rgb' : opts.channel, mode: 'bw'
    });
    cv.width = plane.width;
    cv.height = plane.height;
    cv.getContext('2d').putImageData(plane, 0, 0);
    var ratio = mask.pixels ? mask.on / mask.pixels : 0;
    badge.className = 'badge' + (state.layers.length ? (ratio > 0.0002 ? ' ok' : ' warn') : '');
    badge.textContent = state.layers.length
      ? '图案占画面 ' + (ratio * 100).toFixed(2) + '% ｜ 预览：' +
        (opts.color ? 'RGB 合成' : CH_NAME[opts.channel]) + ' 第 ' + opts.plane + ' 位'
      : '还没有图层，位平面就是载体原样';
    state.preview = { mask: mask, opts: opts, result: res };
  }

  function refresh() {
    renderEdit();
    queuePreview();
    updateActions();
  }
  function syncChannelUi() {
    var color = $('writeMode').value === 'color';
    $('fieldChannel').hidden = color;
    var alpha = !color && $('channel').value === 'a';
    var f = $('flatten');
    // 图案写在 A 通道时不能再展平透明度，否则图案会被一起抹平
    if (alpha) {
      f.checked = false;
      f.disabled = true;
    } else if (f.disabled) {
      f.disabled = false;
      f.checked = true;
    }
    updateActions();
  }

  function updateActions() {
    var hasCarrier = !!state.carrier;
    var ok = hasCarrier && state.layers.length > 0;
    $('embedBtn').disabled = !ok;
    $('addTextBtn').disabled = !hasCarrier;
    $('addImageBtn').disabled = !hasCarrier;
    $('editHint').className = 'badge' + (ok ? ' ok' : hasCarrier ? ' info' : '');
    $('editHint').textContent = !hasCarrier ? '先选择载体图片'
      : state.layers.length ? '拖动图案移动，右下角缩放，上方圆点旋转'
        : '再添加一个文字或图片图层';
    var plane = +$('plane').value;
    var alpha = $('writeMode').value === 'mono' && $('channel').value === 'a';
    var tips = [];
    if (!hasCarrier) tips.push('选择载体图片后即可摆放图案。');
    else if (!state.layers.length) tips.push('添加文字或图片图层后即可写入。');
    else tips.push('将写入 ' + ($('writeMode').value === 'color' ? 'R/G/B 三个通道'
      : CH_NAME[$('channel').value] + ' 通道') + ' 的第 ' + plane + ' 位。');
    if (plane >= 4) tips.push('第 ' + plane + ' 位属于高位，图案会直接显示在原图上（等于给图片加水印）。');
    else if (plane >= 2) tips.push('第 ' + plane + ' 位在纯色区域可能看出轻微色块。');
    if (alpha) tips.push('写在透明度通道：已自动关闭「展平透明通道」，但部分查看器会对半透明像素做预乘，导出后请看回读自检结果。');
    $('hint').textContent = tips.join(' ');
  }

  function setCarrier(bmp, file) {
    var conv = toImageData(bmp);
    state.carrier = conv.imageData;
    state.carrierCanvas = conv.canvas;
    state.carrierName = file.name;
    state.carrierSize = file.size;
    $('carrierInfo').className = 'badge ok';
    $('carrierInfo').textContent = file.name + '（' + state.carrier.width + ' × ' +
      state.carrier.height + '，' + humanSize(file.size) + '）';
    if (!state.layers.length) addTextLayer();
    else { syncLayers(); refresh(); }
  }
  function loadCarrier(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) {
      alert('请选择图片文件');
      return;
    }
    $('carrierInfo').className = 'badge info';
    $('carrierInfo').textContent = '解码中…';
    decodeImage(file).then(function (bmp) {
      setCarrier(bmp, file);
    }).catch(function (err) {
      $('carrierInfo').className = 'badge bad';
      $('carrierInfo').textContent = '无法读取此图片：' + err.message;
    });
  }

  function loadLayerImage(file) {
    if (!file || !state.carrier) return;
    decodeImage(file).then(function (bmp) {
      addImageLayer(bmp, file.name);
    }).catch(function (err) {
      alert('无法读取这张图片：' + err.message);
    });
  }

  /* ---------------- 写入并导出 ---------------- */
  function doEmbed() {
    if (!state.carrier || !state.layers.length) return;
    var opts = currentOpts();
    var mask = buildMask();
    var res = applyStencil(mask, opts);
    var cv = $('outCanvas');
    cv.width = res.imageData.width;
    cv.height = res.imageData.height;
    cv.getContext('2d').putImageData(res.imageData, 0, 0);
    $('outStage').hidden = false;
    $('resultBox').className = '';
    $('resultBox').innerHTML = '<div class="note">正在生成 PNG…</div>';
    cv.toBlob(function (blob) {
      if (!blob) {
        $('resultBox').innerHTML = '<div class="note" style="background:#fef2f2;color:#b91c1c">导出 PNG 失败。</div>';
        return;
      }
      if (state.outUrl) URL.revokeObjectURL(state.outUrl);
      state.outUrl = URL.createObjectURL(blob);
      state.outBlob = blob;
      state.outMask = mask;
      state.outOpts = opts;
      var link = $('downloadLink');
      link.href = state.outUrl;
      link.download = state.carrierName.replace(/\.[^.]+$/, '') + '-plane' + opts.plane + '.png';
      $('outActions').hidden = false;
      showResult(res, mask, opts, blob);
      verify();
    }, 'image/png');
  }
  function showResult(res, mask, opts, blob) {
    var q = psnr(state.carrier.data, res.imageData.data);
    var rows = [
      ['输出格式', 'PNG（无损，必须保持原样传输）'],
      ['输出尺寸', res.imageData.width + ' × ' + res.imageData.height],
      ['文件大小', humanSize(blob.size) + '（原图 ' + humanSize(state.carrierSize) + '）'],
      ['写入位置', (opts.color ? 'R / G / B 三通道' : CH_NAME[opts.channel]) + ' 的第 ' + opts.plane + ' 位'],
      ['写入模式', opts.color ? 'RGB 彩色（8 色）' : '单通道黑白'],
      ['背景处理', opts.whole ? '整幅清零' : '只改图案区域'],
      ['图案占比', (mask.on / mask.pixels * 100).toFixed(2) + '% 的像素被点亮'],
      ['实际改动', res.changed.toLocaleString('zh-CN') + ' / ' + res.samples.toLocaleString('zh-CN') +
        ' 个采样点（' + (res.samples ? (res.changed / res.samples * 100).toFixed(1) : 0) + '%）'],
      ['画质 PSNR', q === Infinity ? '无差异' : q.toFixed(2) + ' dB' +
        (q >= 45 ? '（肉眼不可见）' : q >= 35 ? '（仔细看能发现）' : '（明显可见）')]
    ];
    $('resultBox').className = '';
    $('resultBox').innerHTML = '<table class="kv compact">' + rows.map(function (r) {
      return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>';
    }).join('') + '</table>';
  }

  /* 自检：解码真正导出的 PNG，把目标位平面读回来跟图案逐位比对 */
  function verify() {
    var box = $('verifyBox');
    if (!state.outBlob || !state.outOpts) return;
    var opts = state.outOpts;
    var mask = state.outMask;
    box.innerHTML = '<div class="note">正在从导出的 PNG 回读位平面…</div>';
    decodeImage(state.outBlob).then(function (bmp) {
      var got = toImageData(bmp).imageData;
      var d = got.data;
      var n = got.width * got.height;
      var bad = 0;
      var total = 0;
      for (var i = 0; i < n; i++) {
        if (!opts.whole && !mask.covered[i]) continue;
        for (var k = 0; k < opts.chans.length; k++) {
          var t = opts.chans[k];
          var want = mask.bits[i * 3 + (opts.color ? t : 0)];
          total++;
          if (((d[i * 4 + t] >> opts.plane) & 1) !== want) bad++;
        }
      }
      var plane = window.LSBKit.renderPlane(got, {
        bit: opts.plane, channel: opts.color ? 'rgb' : opts.channel, mode: 'bw'
      });
      var cv = $('planeCanvas');
      cv.width = plane.width;
      cv.height = plane.height;
      cv.getContext('2d').putImageData(plane, 0, 0);
      $('planeBadge').className = 'badge ' + (bad ? 'bad' : 'ok');
      $('planeBadge').textContent = (bad ? '回读有偏差' : '已从导出的 PNG 回读') + ' ｜ ' +
        (opts.color ? 'RGB 合成' : CH_NAME[opts.channel]) + ' 第 ' + opts.plane + ' 位';
      renderVerify(bad, total, opts);
    }).catch(function (err) {
      box.innerHTML = '<div class="note" style="background:#fef2f2;color:#b91c1c">自检失败：' +
        esc(err.message) + '</div>';
    });
  }
  function renderVerify(bad, total, opts) {
    var box = $('verifyBox');
    var okRatio = total ? (total - bad) / total : 0;
    if (!bad) {
      box.innerHTML = '<div class="note">自检通过：从导出的 PNG 里回读的 ' +
        total.toLocaleString('zh-CN') + ' 个位全部与图案一致。在分析页选「' +
        (opts.color ? 'RGB 合成' : CH_NAME[opts.channel]) + '」+ 第 ' + opts.plane +
        ' 位即可看到它。</div>';
      return;
    }
    var extra = opts.chans.indexOf(3) >= 0
      ? '写在透明度通道时，浏览器对半透明像素的预乘处理可能改动数据，建议换成 R/G/B 通道。'
      : '导出或解码环节改动了像素，建议换一张 PNG 载体重试。';
    box.innerHTML = '<div class="note" style="background:#fffbeb;color:#92400e">自检发现偏差：' +
      bad.toLocaleString('zh-CN') + ' / ' + total.toLocaleString('zh-CN') + ' 个位不一致（一致率 ' +
      (okRatio * 100).toFixed(2) + '%）。' + extra + '</div>';
  }

  function reset() {
    state.layers = [];
    state.selected = 0;
    state.outBlob = null;
    state.outMask = null;
    state.outOpts = null;
    if (state.outUrl) {
      URL.revokeObjectURL(state.outUrl);
      state.outUrl = null;
    }
    $('resultBox').className = 'empty';
    $('resultBox').textContent = '还没有生成结果。';
    $('verifyBox').innerHTML = '';
    $('outStage').hidden = true;
    $('outActions').hidden = true;
    syncLayers();
    refresh();
  }

  function nudge(dx, dy) {
    var l = selected();
    if (!l) return;
    l.x += dx;
    l.y += dy;
    renderEdit();
    queuePreview();
  }
  function fitSelected() {
    var l = selected();
    if (!l) return;
    var cw = state.carrier.width;
    var ch = state.carrier.height;
    if (l.type === 'text') {
      var box = layerBox(l);
      setBaseSize(l, l.size * Math.min(cw * 0.92 / box.w, ch * 0.92 / box.h));
    } else {
      setBaseSize(l, Math.min(cw * 0.95 / l.img.width, ch * 0.95 / l.img.height));
    }
    l.x = cw / 2;
    l.y = ch / 2;
    l.rot = 0;
    syncProps();
    refresh();
  }

  function bindProps() {
    function edit(fn) {
      return function () {
        var l = selected();
        if (!l) return;
        fn(l, this);
        syncProps();
        renderEdit();
        queuePreview();
      };
    }
    $('pText').addEventListener('input', edit(function (l, el) { l.text = el.value; }));
    $('pText').addEventListener('change', syncLayers);
    $('pFont').addEventListener('change', edit(function (l, el) { l.font = el.value; }));
    $('pSize').addEventListener('input', edit(function (l, el) { l.size = +el.value; }));
    $('pBold').addEventListener('change', edit(function (l, el) { l.bold = el.checked; }));
    $('pColor').addEventListener('input', edit(function (l, el) { l.color = el.value; }));
    $('pScale').addEventListener('input', edit(function (l, el) { l.scale = +el.value / 100; }));
    $('pRot').addEventListener('input', edit(function (l, el) { l.rot = +el.value; }));
    $('pCenter').addEventListener('click', edit(function (l) {
      l.x = state.carrier.width / 2;
      l.y = state.carrier.height / 2;
    }));
    $('pFit').addEventListener('click', fitSelected);
    $('pDelete').addEventListener('click', function () {
      if (state.selected) removeLayer(state.selected);
    });
  }
  function bindCanvas() {
    var cv = $('editCanvas');
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointercancel', onPointerUp);
    cv.addEventListener('wheel', function (e) {
      var l = selected();
      if (!l) return;
      e.preventDefault();
      var k = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      setBaseSize(l, baseSize(l) * k);
      syncProps();
      renderEdit();
      queuePreview();
    }, { passive: false });
    cv.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 10 : 1;
      var map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        nudge(map[e.key][0], map[e.key][1]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
        e.preventDefault();
        removeLayer(state.selected);
      }
    });
    window.addEventListener('resize', function () { renderEdit(); });
  }

  function bindSettings() {
    $('writeMode').addEventListener('change', function () { syncChannelUi(); queuePreview(); });
    $('channel').addEventListener('change', function () { syncChannelUi(); queuePreview(); });
    $('plane').addEventListener('input', function () {
      $('planeLabel').textContent = $('plane').value;
      updateActions();
      queuePreview();
    });
    $('threshold').addEventListener('input', function () {
      $('thresholdLabel').textContent = $('threshold').value;
      queuePreview();
    });
    ['bgMode', 'dither', 'maskInvert', 'flatten'].forEach(function (id) {
      $(id).addEventListener('change', queuePreview);
    });
    $('embedBtn').addEventListener('click', doEmbed);
    $('resetBtn').addEventListener('click', reset);
    $('verifyBtn').addEventListener('click', verify);
  }
  function init() {
    var drop = $('dropzone');
    var input = $('fileInput');
    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) loadCarrier(input.files[0]);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      drop.addEventListener(evt, function () { drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) loadCarrier(e.dataTransfer.files[0]);
    });
    $('addTextBtn').addEventListener('click', addTextLayer);
    $('addImageBtn').addEventListener('click', function () { $('layerImageInput').click(); });
    $('layerImageInput').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      loadLayerImage(f);
    });
    bindProps();
    bindCanvas();
    bindSettings();
    syncChannelUi();
    syncLayers();
    updateActions();
  }

  init();
})();

/**
 * write.js —— 写入 LSB 页面控制器
 */
(function () {
  'use strict';

  var state = {
    carrier: null,
    carrierFile: null,
    payloadFile: null,
    payloadFileBytes: null,
    outBlob: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function channels() {
    var spec = '';
    Array.prototype.forEach.call(document.querySelectorAll('.chan'), function (box) {
      if (box.checked) spec += box.value;
    });
    return spec;
  }

  function bits() {
    return +$('bits').value;
  }

  function mode() {
    return document.querySelector('input[name="payloadMode"]:checked').value;
  }

  function payloadBytes() {
    if (mode() === 'file') {
      if (!state.payloadFileBytes) return null;
      return window.LSBKit.fileEnvelope(state.payloadFile.name, state.payloadFileBytes);
    }
    return new TextEncoder().encode($('payloadText').value);
  }

  async function decodeImage(file) {
    var bitmap = null;
    if (window.createImageBitmap) {
      try {
        bitmap = await createImageBitmap(file);
      } catch (e) {
        bitmap = null;
      }
    }
    if (!bitmap) {
      bitmap = await new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('浏览器无法解码该图片')); };
        img.src = url;
      });
    }
    var w = bitmap.width || bitmap.naturalWidth;
    var h = bitmap.height || bitmap.naturalHeight;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    return ctx.getImageData(0, 0, w, h);
  }
  /* ---------------- 容量 ---------------- */
  function updateCapacity() {
    var spec = channels();
    var payload = payloadBytes();
    var used = payload ? payload.length : 0;
    var cap = 0;
    if (state.carrier && spec) {
      cap = window.LSBKit.capacityBytes(state.carrier.width, state.carrier.height, spec, bits());
    }
    $('capUsed').textContent = '载荷 ' + humanSize(used) +
      (used ? '（含 ' + window.LSBKit.HEADER + ' 字节头部）' : '');
    $('capTotal').textContent = '容量 ' + humanSize(cap);
    var pct = cap ? Math.min(100, used / cap * 100) : 0;
    $('capMeter').querySelector('i').style.width = pct + '%';
    $('capMeter').classList.toggle('over', used > cap);

    var problems = [];
    if (!state.carrier) problems.push('请先选择载体图片');
    if (!spec) problems.push('至少选择一个颜色通道');
    if (!used) problems.push('请输入要隐藏的文本或选择文件');
    if (cap && used > cap) problems.push('载荷超出容量 ' + humanSize(used - cap) + '，可增加位数、换更大的图或减少内容');
    $('embedBtn').disabled = problems.length > 0;
    $('hint').textContent = problems.length ? problems.join('；') + '。'
      : '可以写入：' + spec.toUpperCase() + ' 通道，每通道 ' + bits() + ' 位，占用容量 ' + pct.toFixed(1) + '%。';
  }

  function psnr(a, b) {
    var sum = 0;
    var count = 0;
    for (var i = 0; i < a.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var d = a[i + c] - b[i + c];
        sum += d * d;
        count++;
      }
    }
    var mse = sum / count;
    if (!mse) return Infinity;
    return 10 * Math.log10(255 * 255 / mse);
  }

  /* ---------------- 写入 ---------------- */
  async function doEmbed() {
    var spec = channels();
    var payload = payloadBytes();
    if (!state.carrier || !spec || !payload) return;
    var opts = {
      channels: spec,
      bits: bits(),
      password: $('password').value,
      isFile: mode() === 'file',
      flattenAlpha: $('flattenAlpha').checked
    };
    var res = window.LSBKit.embed(state.carrier, payload, opts);
    if (!res.ok) {
      $('resultBox').className = '';
      $('resultBox').innerHTML = '<div class="note" style="background:#fef2f2;color:#b91c1c">写入失败：' + esc(res.error) + '</div>';
      return;
    }
    var canvas = $('outCanvas');
    canvas.width = res.imageData.width;
    canvas.height = res.imageData.height;
    canvas.getContext('2d').putImageData(res.imageData, 0, 0);
    $('outStage').hidden = false;

    var blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png');
    });
    state.outBlob = blob;
    state.outImageData = res.imageData;
    state.outOpts = opts;
    var link = $('downloadLink');
    if (link.href && link.href.indexOf('blob:') === 0) URL.revokeObjectURL(link.href);
    link.href = URL.createObjectURL(blob);
    var baseName = state.carrierFile ? state.carrierFile.name.replace(/\.[^.]+$/, '') : 'image';
    link.download = baseName + '-lsb.png';
    $('outActions').hidden = false;

    var quality = psnr(state.carrier.data, res.imageData.data);
    var rows = [
      ['输出格式', 'PNG（无损）'],
      ['输出尺寸', res.imageData.width + ' × ' + res.imageData.height],
      ['文件大小', humanSize(blob.size)],
      ['写入通道 / 位数', spec.toUpperCase() + ' / 每通道 ' + opts.bits + ' 位'],
      ['载荷', (opts.isFile ? '文件 ' + esc(state.payloadFile.name) : '文本 ' + $('payloadText').value.length + ' 字符') +
        '，打包后 ' + res.used + ' 字节'],
      ['容量占用', (res.used / res.capacity * 100).toFixed(1) + '%（容量 ' + humanSize(res.capacity) + '）'],
      ['密码混淆', opts.password ? '已启用' : '未启用'],
      ['画质 PSNR', quality === Infinity ? '无差异' : quality.toFixed(2) + ' dB' +
        (quality > 45 ? '（肉眼不可见）' : quality > 35 ? '（基本不可见）' : '（可能看出噪点）')]
    ];
    $('resultBox').className = '';
    $('resultBox').innerHTML = '<table class="kv compact">' + rows.map(function (r) {
      return '<tr><th>' + esc(r[0]) + '</th><td>' + r[1] + '</td></tr>';
    }).join('') + '</table><div id="verifyBox"></div>';
    verify();
  }

  function verify() {
    var box = $('verifyBox');
    if (!box || !state.outBlob || !state.outOpts) return;
    var opts = state.outOpts;
    box.innerHTML = '<div class="note">正在从导出的 PNG 中重新读取…</div>';
    // 自检必须解码真正导出的 PNG：canvas 对半透明像素会做预乘，内存里的 ImageData 通过不代表文件通过
    decodeImage(state.outBlob).then(function (imageData) {
      var res = window.LSBKit.extract(imageData, {
        channels: opts.channels,
        bits: opts.bits,
        password: opts.password
      });
      if (res.ok && res.checksumOk) {
        var detail = res.isFile ? '文件 ' + esc(res.fileName) + '（' + humanSize(res.bytes.length) + '）'
          : '文本 ' + res.length + ' 字节';
        box.innerHTML = '<div class="note" style="background:#ecfdf5;color:#166534">自检通过：已从导出的 PNG 中读回 ' + detail + '，校验和一致。</div>' +
          (res.isFile ? '' : '<details class="raw"><summary>读回的文本</summary><pre class="dump">' + esc(res.text) + '</pre></details>');
      } else {
        box.innerHTML = '<div class="note" style="background:#fffbeb;color:#92400e">自检未通过（' +
          esc(res.reason || '校验和不一致') + '）。' +
          (opts.channels.indexOf('a') >= 0 && !opts.flattenAlpha
            ? '写入透明度通道时，浏览器会对半透明像素做预乘处理而破坏低位，请勾选“写入前把所有像素设为不透明”或改用 RGB 通道。'
            : '请换用无损载体、减少位数后重试。') + '</div>';
      }
    }).catch(function (e) {
      box.innerHTML = '<div class="note" style="background:#fffbeb;color:#92400e">自检失败：' + esc(e.message) + '</div>';
    });
  }
  /* ---------------- 载体 / 载荷 加载 ---------------- */
  async function loadCarrier(file) {
    if (!file || !/^image\//.test(file.type)) {
      $('carrierInfo').textContent = '请选择图片文件';
      return;
    }
    $('carrierInfo').textContent = '正在解码…';
    try {
      var imageData = await decodeImage(file);
      state.carrier = imageData;
      state.carrierFile = file;
      var alphaVaries = false;
      for (var i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] !== 255) { alphaVaries = true; break; }
      }
      $('carrierInfo').textContent = file.name + '（' + imageData.width + ' × ' + imageData.height +
        '，' + humanSize(file.size) + '）' + (alphaVaries ? ' · 含透明像素' : '');
    } catch (e) {
      state.carrier = null;
      state.carrierFile = null;
      $('carrierInfo').textContent = '解码失败：' + e.message;
    }
    updateCapacity();
  }

  async function loadPayloadFile(file) {
    if (!file) {
      state.payloadFile = null;
      state.payloadFileBytes = null;
      $('payloadFileInfo').textContent = '未选择文件';
    } else {
      state.payloadFile = file;
      state.payloadFileBytes = new Uint8Array(await file.arrayBuffer());
      $('payloadFileInfo').textContent = file.name + '（' + humanSize(file.size) + '）';
    }
    updateCapacity();
  }

  function switchMode() {
    var isFile = mode() === 'file';
    $('textField').hidden = isFile;
    $('fileField').hidden = !isFile;
    updateCapacity();
  }

  /* ---------------- 重置 ---------------- */
  function reset() {
    state.carrier = null;
    state.carrierFile = null;
    state.payloadFile = null;
    state.payloadFileBytes = null;
    state.outBlob = null;
    state.outImageData = null;
    state.outOpts = null;
    $('fileInput').value = '';
    $('payloadFile').value = '';
    $('payloadText').value = '';
    $('password').value = '';
    $('carrierInfo').textContent = '未选择载体';
    $('payloadFileInfo').textContent = '未选择文件';
    $('outStage').hidden = true;
    $('outActions').hidden = true;
    var link = $('downloadLink');
    if (link.href && link.href.indexOf('blob:') === 0) URL.revokeObjectURL(link.href);
    link.removeAttribute('href');
    $('resultBox').className = 'empty';
    $('resultBox').textContent = '还没有生成结果。';
    updateCapacity();
  }

  /* ---------------- 事件绑定 ---------------- */
  function init() {
    var zone = $('dropzone');
    var input = $('fileInput');
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function (e) {
        e.preventDefault();
        zone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      zone.addEventListener(type, function () { zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadCarrier(file);
    });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) loadCarrier(input.files[0]);
    });
    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) loadCarrier(items[0]);
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="payloadMode"]'), function (radio) {
      radio.addEventListener('change', switchMode);
    });
    $('payloadText').addEventListener('input', updateCapacity);
    $('payloadFile').addEventListener('change', function (e) {
      loadPayloadFile(e.target.files && e.target.files[0]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chan'), function (box) {
      box.addEventListener('change', updateCapacity);
    });
    $('bits').addEventListener('input', function () {
      $('bitsLabel').textContent = bits();
      updateCapacity();
    });
    $('password').addEventListener('input', updateCapacity);
    $('flattenAlpha').addEventListener('change', updateCapacity);
    $('embedBtn').addEventListener('click', doEmbed);
    $('resetBtn').addEventListener('click', reset);
    $('verifyBtn').addEventListener('click', verify);

    switchMode();
  }

  init();
})();

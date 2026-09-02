/**
 * analyze.js —— 图片隐藏数据分析页面控制器
 */
(function () {
  'use strict';

  var state = {
    file: null,
    bytes: null,
    report: null,
    imageData: null,
    password: '',
    fftKey: '',
    fftDirty: true
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function kvTable(rows, compact) {
    if (!rows.length) return '';
    var html = '<table class="kv' + (compact ? ' compact' : '') + '">';
    rows.forEach(function (row) {
      html += '<tr><th>' + esc(row[0]) + '</th><td>' + (row[2] ? row[1] : esc(row[1])) + '</td></tr>';
    });
    return html + '</table>';
  }

  function title(text, badge) {
    return '<div class="section-title">' + esc(text) +
      (badge ? ' <span class="badge ' + badge[1] + '">' + esc(badge[0]) + '</span>' : '') + '</div>';
  }

  /* ---------------- 文件读取 ---------------- */
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

  function sampleSquare(imageData, size) {
    var src = document.createElement('canvas');
    src.width = imageData.width;
    src.height = imageData.height;
    src.getContext('2d').putImageData(imageData, 0, 0);
    var dst = document.createElement('canvas');
    dst.width = size;
    dst.height = size;
    var ctx = dst.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  }
  /* ---------------- 元数据渲染 ---------------- */
  function badges(report) {
    var list = [];
    if (report.hasExif) list.push(['Exif', 'ok']);
    if (report.xmp.length) list.push(['XMP', 'ok']);
    if (report.iptc.length) list.push(['IPTC', 'ok']);
    if (report.icc.length) list.push(['ICC 配置', 'info']);
    if (report.textChunks.length) list.push(['文本块 ×' + report.textChunks.length, 'ok']);
    if (report.comments.length) list.push(['注释', 'ok']);
    if (report.gps) list.push(['GPS 定位', 'bad']);
    if (report.c2pa) list.push(['C2PA 凭证', 'info']);
    if (report.trailing && report.trailing.size) list.push(['尾部附加数据', 'bad']);
    if (report.aiHints.length) list.push(['AI 生成线索', 'warn']);
    if (!list.length) list.push(['未发现附加元数据', '']);
    return '<div class="row" style="margin-bottom:14px">' + list.map(function (b) {
      return '<span class="badge ' + b[1] + '">' + esc(b[0]) + '</span>';
    }).join('') + '</div>';
  }

  function renderMeta(report) {
    var M = window.MetaKit;
    var html = '';
    html += badges(report);

    var base = [
      ['文件名', report.fileName],
      ['识别格式', report.format + (report.progressive ? '（渐进式）' : '') + (report.interlace ? '（隔行）' : '')],
      ['像素尺寸', report.width && report.height ? report.width + ' × ' + report.height : '未解析'],
      ['文件大小', M.humanSize(report.fileSize) + '（' + report.fileSize + ' 字节）'],
      ['MIME', report.fileType || '未知'],
      ['文件修改时间', report.lastModified ? report.lastModified.toLocaleString('zh-CN') : '未知']
    ];
    if (report.bitDepth) base.push(['位深', report.bitDepth + ' bit']);
    if (report.exifByteOrder) base.push(['Exif 字节序', report.exifByteOrder]);
    html += title('文件概要') + kvTable(base);

    if (report.summary.length) {
      html += title('版权 / 来源 / 设备');
      html += '<table class="kv">' + report.summary.map(function (row) {
        return '<tr><th>' + esc(row.name) + '</th><td>' + esc(row.value) +
          (row.level === 'bad' ? ' <span class="badge bad">隐私敏感</span>' : '') + '</td></tr>';
      }).join('') + '</table>';
    } else {
      html += title('版权 / 来源 / 设备') +
        '<p class="note muted">没有找到版权、作者、拍摄设备等常见字段，元数据可能已被清理（社交平台上传通常会剥离）。</p>';
    }

    if (report.privacy.length) {
      html += '<div class="note">隐私提示<ul style="margin:6px 0 0;padding-left:20px">' +
        report.privacy.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    }
    if (report.aiHints.length) {
      html += '<div class="note">AI 生成 / 内容凭证线索<ul style="margin:6px 0 0;padding-left:20px">' +
        report.aiHints.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    }
    if (report.warnings.length) {
      html += '<div class="note" style="background:#fef2f2;color:#b91c1c">解析警告<ul style="margin:6px 0 0;padding-left:20px">' +
        report.warnings.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    }

    if (report.gps) {
      var g = report.gps;
      var q = g.lat + ',' + g.lon;
      html += title('GPS 位置', ['坐标已解析', 'bad']) + kvTable([
        ['纬度', g.lat],
        ['经度', g.lon],
        ['海拔', g.alt === null ? '未记录' : g.alt + ' m'],
        ['GPS 日期', g.date || '未记录'],
        ['地图', '<a href="https://www.openstreetmap.org/?mlat=' + g.lat + '&mlon=' + g.lon +
          '#map=16/' + g.lat + '/' + g.lon + '" target="_blank" rel="noreferrer">OpenStreetMap</a> ｜ ' +
          '<a href="https://uri.amap.com/marker?position=' + g.lon + ',' + g.lat +
          '" target="_blank" rel="noreferrer">高德地图</a> ｜ ' +
          '<a href="https://www.google.com/maps?q=' + q + '" target="_blank" rel="noreferrer">Google Maps</a>', true]
      ]);
    }
    return html + renderMetaTables(report);
  }
  function renderMetaTables(report) {
    var M = window.MetaKit;
    var html = '';

    if (report.tags.length) {
      var groups = {};
      var order = [];
      report.tags.forEach(function (t) {
        if (!groups[t.group]) { groups[t.group] = []; order.push(t.group); }
        groups[t.group].push([t.name, t.value]);
      });
      html += title('Exif 标签', ['共 ' + report.tags.length + ' 项', 'info']);
      order.forEach(function (g) {
        html += '<details class="raw" open><summary>' + esc(g) + '（' + groups[g].length + '）</summary>' +
          kvTable(groups[g]) + '</details>';
      });
    }

    if (report.xmpFields && report.xmpFields.length) {
      html += title('XMP 字段');
      html += kvTable(report.xmpFields.map(function (f) { return [f.name, f.value]; }));
    }
    if (report.xmp.length) {
      html += '<details class="raw"><summary>XMP 原文（' + report.xmp.length + ' 段）</summary><pre class="dump">' +
        esc(report.xmp.join('\n\n').slice(0, 20000)) + '</pre></details>';
    }

    if (report.iptc.length) {
      html += title('IPTC 信息');
      html += kvTable(report.iptc.map(function (f) { return [f.name, f.value]; }));
    }

    if (report.textChunks.length) {
      html += title('PNG 文本块');
      html += report.textChunks.map(function (t) {
        var long = t.value.length > 120;
        return '<details class="raw"' + (long ? '' : ' open') + '><summary>' + esc(t.keyword) +
          '（' + t.kind + '，' + t.value.length + ' 字符）</summary>' +
          (long ? '<pre class="dump">' + esc(t.value.slice(0, 20000)) + '</pre>'
            : '<div style="margin-top:6px">' + esc(t.value) + '</div>') + '</details>';
      }).join('');
    }

    if (report.comments.length) {
      html += title('注释段');
      html += report.comments.map(function (c) {
        return '<pre class="dump">' + esc(c.slice(0, 4000)) + '</pre>';
      }).join('');
    }

    if (report.icc.length) {
      var iccSize = report.icc.reduce(function (n, c) { return n + c.length; }, 0);
      html += title('ICC 色彩配置') + kvTable([['分片数', report.icc.length], ['合计大小', M.humanSize(iccSize)]], true);
    }

    if (report.segments.length) {
      html += title('文件段结构', ['共 ' + report.segments.length + ' 段', 'info']);
      html += '<table class="kv"><tr><th style="width:110px">偏移</th><th style="width:190px">段</th>' +
        '<th style="width:110px">大小</th><th>说明</th></tr>' +
        report.segments.map(function (s) {
          return '<tr><td>0x' + s.offset.toString(16).padStart(6, '0') + '</td><td>' + esc(s.name) +
            (s.marker ? ' <span class="badge">' + esc(s.marker) + '</span>' : '') +
            '</td><td>' + (s.size ? M.humanSize(s.size) : '-') + '</td><td>' + esc(s.note || '') + '</td></tr>';
        }).join('') + '</table>';
    }

    if (report.trailing && report.trailing.size) {
      html += title('图像结束标记之后的附加数据', ['可疑', 'bad']);
      html += kvTable([
        ['起始偏移', '0x' + report.trailing.offset.toString(16)],
        ['数据大小', M.humanSize(report.trailing.size)],
        ['可读文本', report.trailing.text ? esc(M.truncate(report.trailing.text, 200)) : '（无可读文本）', true],
        ['操作', '<button class="btn" id="dumpTrailing" type="button">下载这段数据</button>', true]
      ]);
      html += '<pre class="dump">' + esc(report.trailing.dump) + '</pre>';
    }

    if (report.embedded.length) {
      html += title('内嵌文件签名扫描');
      html += '<table class="kv"><tr><th style="width:110px">偏移</th><th style="width:150px">位置</th><th>可能的内容</th></tr>' +
        report.embedded.map(function (e) {
          return '<tr><td>0x' + e.offset.toString(16) + '</td><td>' +
            (e.inTrailing ? '<span class="badge bad">尾部附加</span>' : '<span class="badge">图像数据内</span>') +
            '</td><td>' + esc(e.name) + '</td></tr>';
        }).join('') + '</table>';
      html += '<p class="stage-tip">图像数据内部的命中多为压缩数据的巧合，尾部附加区的命中才值得重点关注。</p>';
    }

    if (report.strings.length) {
      html += '<details class="raw"><summary>文件中的可打印字符串（' + report.strings.length + ' 条，≥14 字符）</summary><pre class="dump">' +
        report.strings.map(function (s) {
          return '0x' + s.offset.toString(16).padStart(6, '0') + '  ' + esc(s.text);
        }).join('\n') + '</pre></details>';
    }
    return html;
  }
  /* ---------------- LSB ---------------- */
  function renderLsbPlane() {
    if (!state.imageData) return;
    var bit = +$('lsbBit').value;
    $('lsbBitLabel').textContent = bit;
    var plane = window.LSBKit.renderPlane(state.imageData, {
      channel: $('lsbChannel').value,
      bit: bit,
      mode: $('lsbRender').value,
      invert: $('lsbInvert').checked
    });
    var canvas = $('lsbCanvas');
    canvas.width = plane.width;
    canvas.height = plane.height;
    canvas.getContext('2d').putImageData(plane, 0, 0);
  }

  function channelText(spec) {
    var map = { r: '红 R', g: '绿 G', b: '蓝 B', a: 'Alpha' };
    return spec.split('').map(function (c) { return map[c] || c; }).join(' + ');
  }

  function passwordRow() {
    return '<div class="row" style="margin-top:10px">' +
      '<input id="lsbPassword" type="password" placeholder="提取密码（写入时设置过才需要）" value="' + esc(state.password) + '">' +
      '<button id="lsbRetry" class="btn" type="button">用密码重新提取</button></div>';
  }

  function renderPayload() {
    var box = $('lsbPayload');
    state.payload = null;
    if (!state.imageData) {
      box.className = 'empty';
      box.textContent = '像素数据不可用，无法提取。';
      return;
    }
    box.className = '';
    var results = window.LSBKit.sniff(state.imageData, state.password);
    var hit = results.filter(function (r) { return r.ok; })[0];
    var html = '';
    if (hit) {
      state.payload = hit;
      html += '<div class="row"><span class="badge ok">发现 LSB1 隐藏载荷</span>' +
        '<span class="badge info">' + esc(channelText(hit.channels)) + '</span>' +
        '<span class="badge info">每通道 ' + hit.bits + ' 位</span>' +
        '<span class="badge ' + (hit.checksumOk ? 'ok' : 'warn') + '">校验' + (hit.checksumOk ? '通过' : '不一致') + '</span>' +
        (hit.encrypted ? '<span class="badge info">已用密码混淆</span>' : '') + '</div>';
      if (hit.isFile) {
        html += kvTable([
          ['载荷类型', '文件'],
          ['文件名', hit.fileName || '(未命名)'],
          ['大小', window.MetaKit.humanSize(hit.bytes.length)],
          ['操作', '<button class="btn primary" id="savePayload" type="button">下载隐藏文件</button>', true]
        ], true);
      } else {
        html += kvTable([
          ['载荷类型', '文本'],
          ['字节数', hit.length + ' 字节'],
          ['操作', '<button class="btn" id="copyPayload" type="button">复制文本</button>', true]
        ], true);
        html += '<pre class="dump">' + esc(hit.text) + '</pre>';
      }
    } else {
      var pending = results[0];
      if (pending && (pending.reason === 'need-password' || pending.reason === 'bad-password')) {
        html += '<div class="row"><span class="badge warn">发现加密载荷（' +
          esc(channelText(pending.channels)) + '，' + pending.bits + ' 位，' +
          window.MetaKit.humanSize(pending.length) + '）</span></div>' +
          '<p class="note">' + (pending.reason === 'bad-password' ? '密码不正确，校验和不匹配。' : '该载荷写入时使用了密码，请输入密码后重新提取。') + '</p>';
      } else {
        html += '<div class="row"><span class="badge">未发现本站格式（LSB1）的载荷</span></div>';
        var preview = window.LSBKit.rawPreview(state.imageData, {
          channels: $('lsbChannel').value === 'gray' || $('lsbChannel').value === 'rgb' ? 'rgb' : $('lsbChannel').value,
          bits: 1,
          count: 512
        });
        if (preview) {
          html += '<p class="stage-tip">下面是按「' + esc(channelText($('lsbChannel').value === 'gray' || $('lsbChannel').value === 'rgb' ? 'rgb' : $('lsbChannel').value)) +
            '，每通道 1 位」读出的原始位流前 512 字节，其他工具写入的明文有时能直接读出来。</p>';
          if (preview.strings.length) {
            html += '<div style="margin-top:8px"><span class="badge info">位流中的可打印片段</span></div><pre class="dump">' +
              esc(preview.strings.slice(0, 30).map(function (s) {
                return '+' + s.offset + '  ' + s.text;
              }).join('\n')) + '</pre>';
          }
          html += '<details class="raw"><summary>位流十六进制</summary><pre class="dump">' +
            esc(window.MetaKit.hexDump(preview.bytes, 512)) + '</pre></details>';
        }
      }
    }
    box.innerHTML = html + passwordRow();
    wirePayload();
  }

  function wirePayload() {
    var retry = $('lsbRetry');
    if (retry) {
      retry.addEventListener('click', function () {
        state.password = $('lsbPassword').value;
        renderPayload();
      });
      $('lsbPassword').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') retry.click();
      });
    }
    var save = $('savePayload');
    if (save) {
      save.addEventListener('click', function () {
        var hit = state.payload;
        var blob = new Blob([hit.bytes], { type: 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = hit.fileName || 'payload.bin';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      });
    }
    var copy = $('copyPayload');
    if (copy) {
      copy.addEventListener('click', async function () {
        try {
          await navigator.clipboard.writeText(state.payload.text);
          copy.textContent = '已复制';
          setTimeout(function () { copy.textContent = '复制文本'; }, 1500);
        } catch (e) {
          copy.textContent = '复制失败';
        }
      });
    }
  }
  function renderStats() {
    var box = $('lsbStats');
    if (!state.imageData) {
      box.innerHTML = '<p class="empty">像素数据不可用。</p>';
      return;
    }
    var s = window.LSBKit.stats(state.imageData);
    var levelOf = function (v) {
      return v === '高度疑似 LSB 替换' ? 'bad' : v === '可疑' ? 'warn' : 'ok';
    };
    var html = '<table class="kv"><tr><th style="width:110px">通道</th><th style="width:150px">最低位为 1 的比例</th>' +
      '<th style="width:170px">相邻值对 χ²/自由度</th><th>判定</th></tr>' +
      s.channels.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td>' + (c.ratio * 100).toFixed(2) + ' %</td><td>' +
          (c.df ? c.norm.toFixed(2) + '（df=' + c.df + '）' : '样本不足') + '</td><td><span class="badge ' +
          levelOf(c.verdict) + '">' + esc(c.verdict) + '</span></td></tr>';
      }).join('') + '</table>';
    html += '<details class="raw"><summary>各位平面「1」的占比（自然图像里高位有明显偏向，低位接近 50%）</summary>' +
      '<table class="kv"><tr><th style="width:110px">通道</th>' +
      [0, 1, 2, 3, 4, 5, 6, 7].map(function (b) { return '<th>bit ' + b + '</th>'; }).join('') + '</tr>' +
      s.channels.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td>' + c.planeRatios.map(function (r) {
          return '<td>' + (r * 100).toFixed(1) + '%</td>';
        }).join('') + '</tr>';
      }).join('') + '</table></details>';
    var notes = [];
    notes.push('像素总数 ' + s.pixels.toLocaleString('zh-CN') +
      '，1 位/通道时 RGB 三通道理论容量 ' +
      window.MetaKit.humanSize(window.LSBKit.capacityBytes(state.imageData.width, state.imageData.height, 'rgb', 1)) + '。');
    if (s.alphaVaries) {
      notes.push('图片含半透明像素（全透明 ' + s.transparent + ' 个）。浏览器画布对透明像素的 RGB 有精度损失，这类图片的 LSB 结果可能不可靠。');
    }
    if (state.report && (state.report.format === 'JPEG' || state.report.format === 'WebP')) {
      notes.push('注意：' + state.report.format + ' 是有损压缩格式，像素域 LSB 一般无法在压缩后存活；这里分析的是解码后的像素，χ² 结果仅供参考。');
    }
    html += '<p class="note muted">' + notes.map(esc).join('<br>') + '</p>';
    box.innerHTML = html;
  }

  /* ---------------- FFT ---------------- */
  function renderFft() {
    if (!state.spec) return;
    var img = window.FFTKit.render(state.spec, {
      gamma: +$('fftGamma').value,
      palette: $('fftPalette').value
    });
    var canvas = $('fftCanvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').putImageData(img, 0, 0);
    var peaks = state.peaks;
    var tip = '频谱中心是低频，四周是高频。傅里叶盲水印通常表现为中心对称的一对亮斑、亮环，或直接能读出的对称文字。';
    var html = '';
    if (peaks && peaks.peaks.length) {
      html += '<div class="row" style="margin-top:10px"><span class="badge warn">检测到 ' + peaks.peaks.length +
        ' 组显著对称峰值</span></div>' +
        '<table class="kv"><tr><th style="width:150px">频率偏移 (u, v)</th><th style="width:120px">半径</th>' +
        '<th style="width:120px">方向</th><th>强度（高于背景的标准差倍数）</th></tr>' +
        peaks.peaks.map(function (p) {
          return '<tr><td>(' + p.dx + ', ' + p.dy + ')</td><td>' + p.radius + ' px</td><td>' +
            p.angle + '°</td><td>' + p.z.toFixed(1) + ' σ</td></tr>';
        }).join('') + '</table>' +
        '<p class="stage-tip">规则的强对称峰值常见于频域盲水印、扫描/印刷网纹或图片本身的周期性纹理，需要结合画面内容判断。</p>';
    } else if (state.spec) {
      html += '<div class="row" style="margin-top:10px"><span class="badge ok">未检测到明显的孤立频域峰值</span></div>';
    }
    $('fftTip').innerHTML = esc(tip);
    $('fftPeaks').innerHTML = html;
  }

  async function runFft(force) {
    if (!state.imageData) {
      $('fftPeaks').innerHTML = '<p class="empty">像素数据不可用。</p>';
      return;
    }
    var size = +$('fftSize').value;
    var ch = $('fftChannel').value;
    var key = size + '/' + ch;
    if (!force && key === state.fftKey && state.spec) {
      renderFft();
      return;
    }
    $('fftPeaks').innerHTML = '<p class="empty">正在计算 ' + size + '×' + size + ' 傅里叶变换…</p>';
    await new Promise(function (r) { setTimeout(r, 16); });
    var square = sampleSquare(state.imageData, size);
    state.spec = window.FFTKit.spectrum(square, ch);
    state.peaks = window.FFTKit.findPeaks(state.spec);
    state.fftKey = key;
    renderFft();
  }
  /* ---------------- 加载与交互 ---------------- */
  function resetUi() {
    state.file = null;
    state.bytes = null;
    state.report = null;
    state.imageData = null;
    state.spec = null;
    state.peaks = null;
    state.fftKey = '';
    state.password = '';
    $('metaEmpty').hidden = false;
    $('metaResult').hidden = true;
    $('metaResult').innerHTML = '';
    $('metaSearchBar').hidden = true;
    $('metaSearch').value = '';
    $('metaSearchInfo').textContent = '全部标签';
    $('metaSearchInfo').className = 'badge';
    $('lsbPayload').className = 'empty';
    $('lsbPayload').textContent = '等待图片…';
    $('lsbStats').innerHTML = '';
    $('fftPeaks').innerHTML = '';
    [$('lsbCanvas'), $('fftCanvas')].forEach(function (c) {
      c.width = 1;
      c.height = 1;
    });
    $('fileSummary').textContent = '未选择图片';
    $('fileSummary').className = 'badge';
    $('clearBtn').hidden = true;
  }

  async function loadFile(file) {
    if (!file) return;
    var okType = /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic)$/i.test(file.name);
    if (!okType) {
      alert('请选择图片文件');
      return;
    }
    state.file = file;
    state.password = '';
    $('fileSummary').textContent = '解析中…';
    $('fileSummary').className = 'badge info';
    $('clearBtn').hidden = false;
    try {
      var buf = await file.arrayBuffer();
      state.bytes = new Uint8Array(buf);
      state.report = await window.MetaKit.parse(buf, file);
      $('metaEmpty').hidden = true;
      $('metaResult').hidden = false;
      $('metaResult').innerHTML = renderMeta(state.report);
      $('metaSearchBar').hidden = false;
      $('metaSearch').value = '';
      filterMeta();
      wireTrailing();
    } catch (err) {
      $('metaEmpty').hidden = false;
      $('metaEmpty').textContent = '元数据解析失败：' + err.message;
    }
    try {
      state.imageData = await decodeImage(file);
    } catch (err) {
      state.imageData = null;
      $('lsbPayload').className = 'empty';
      $('lsbPayload').textContent = '浏览器无法解码该图片，像素级分析不可用。';
    }
    var r = state.report || {};
    $('fileSummary').className = 'badge ok';
    $('fileSummary').textContent = file.name + ' · ' + (r.format || '') + ' · ' +
      (state.imageData ? state.imageData.width + '×' + state.imageData.height : '?') + ' · ' +
      window.MetaKit.humanSize(file.size);
    if (state.imageData) {
      var px = state.imageData.width * state.imageData.height;
      if (px > 30000000) {
        $('lsbStats').innerHTML = '<p class="note">图片较大（' + (px / 1e6).toFixed(1) + ' MP），逐位分析可能需要几秒。</p>';
      }
      renderLsbPlane();
      renderPayload();
      renderStats();
      state.fftKey = '';
      if ($('tabFft').getAttribute('aria-selected') === 'true') runFft(true);
    }
  }

  /* 元数据标签搜索：按关键字过滤所有 kv 表格的行，整块无命中则隐藏 */
  function filterMeta() {
    var box = $('metaResult');
    var input = $('metaSearch');
    if (!box || !input) return;
    var q = input.value.trim().toLowerCase();
    var tables = box.querySelectorAll('table.kv');
    var shownTotal = 0;
    var total = 0;
    Array.prototype.forEach.call(tables, function (table) {
      var shown = 0;
      var rows = table.rows;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        // 表头行（只有 th）不参与过滤
        var isHead = row.cells.length && row.querySelectorAll('td').length === 0;
        if (isHead) {
          row.hidden = false;
          continue;
        }
        total++;
        var hit = !q || row.textContent.toLowerCase().indexOf(q) >= 0;
        row.hidden = !hit;
        if (hit) shown++;
      }
      shownTotal += shown;
      var block = table.closest('details');
      if (block) {
        block.hidden = !!q && !shown;
        if (q && shown) block.open = true;
      }
    });
    $('metaSearchInfo').textContent = q ? '匹配 ' + shownTotal + ' / ' + total + ' 行' : '全部标签';
    $('metaSearchInfo').className = 'badge' + (q ? (shownTotal ? ' ok' : ' bad') : '');
  }

  function wireTrailing() {
    var btn = $('dumpTrailing');
    if (!btn || !state.report || !state.report.trailing) return;
    btn.addEventListener('click', function () {
      var t = state.report.trailing;
      var blob = new Blob([state.bytes.subarray(t.offset)], { type: 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'image') + '-trailing.bin';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  function switchTab(id) {
    var tabs = [['tabMeta', 'panelMeta'], ['tabLsb', 'panelLsb'], ['tabFft', 'panelFft']];
    tabs.forEach(function (pair) {
      var active = pair[0] === id;
      $(pair[0]).setAttribute('aria-selected', active ? 'true' : 'false');
      $(pair[1]).hidden = !active;
    });
    if (id === 'tabFft' && state.imageData && !state.spec) runFft(true);
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
      if (input.files && input.files[0]) loadFile(input.files[0]);
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
      if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.files;
      if (items && items[0]) loadFile(items[0]);
    });
    $('clearBtn').addEventListener('click', resetUi);
    $('metaSearch').addEventListener('input', filterMeta);
    $('metaSearch').addEventListener('search', filterMeta);
    ['tabMeta', 'tabLsb', 'tabFft'].forEach(function (id) {
      $(id).addEventListener('click', function () { switchTab(id); });
    });
    ['lsbChannel', 'lsbBit', 'lsbRender', 'lsbInvert'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        renderLsbPlane();
        if (id === 'lsbChannel') renderPayload();
      });
    });
    $('fftGamma').addEventListener('input', function () {
      $('fftGammaLabel').textContent = (+$('fftGamma').value).toFixed(1);
      renderFft();
    });
    $('fftPalette').addEventListener('change', renderFft);
    $('fftChannel').addEventListener('change', function () { runFft(true); });
    $('fftSize').addEventListener('change', function () { runFft(true); });
    $('fftRun').addEventListener('click', function () { runFft(true); });
  }

  init();
})();

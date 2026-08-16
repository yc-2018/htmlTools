/* PNG 编解码验证：自造各种颜色类型 / 位深的 PNG，用 png.js 解，再编回去解一次比对 */
'use strict';

var zlibNode = require('zlib');
var png = require('../utils/lsb/png.js');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
}

/* ---------- 用 Node 的 zlib 手工造 PNG，作为“外部编码器”的参照 ---------- */
function crc32(buf) {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  var r = -1;
  for (var i = 0; i < buf.length; i++) r = t[(r ^ buf[i]) & 0xff] ^ (r >>> 8);
  return (r ^ -1) >>> 0;
}
function chunk(type, data) {
  var head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  var body = Buffer.concat([head.slice(4), Buffer.from(data)]);
  var tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.slice(0, 4), body, tail]);
}
// rows: 每行的样本字节（不含 filter 字节）；filterType 用固定值，考验解码端的还原
function buildPng(w, h, depth, ct, rows, filterType, extraChunks) {
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth; ihdr[9] = ct; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var bpr = rows[0].length;
  var chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct];
  var bpp = Math.max(1, Math.ceil(chans * depth / 8));
  var raw = Buffer.alloc((bpr + 1) * h);
  var prev = Buffer.alloc(bpr);
  for (var y = 0; y < h; y++) {
    var line = Buffer.from(rows[y]);
    var ft = typeof filterType === 'function' ? filterType(y) : filterType;
    raw[y * (bpr + 1)] = ft;
    for (var i = 0; i < bpr; i++) {
      var a = i >= bpp ? line[i - bpp] : 0;
      var b = y > 0 ? prev[i] : 0;
      var c = (i >= bpp && y > 0) ? prev[i - bpp] : 0;
      var pred = 0;
      if (ft === 1) pred = a;
      else if (ft === 2) pred = b;
      else if (ft === 3) pred = (a + b) >> 1;
      else if (ft === 4) {
        var pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      raw[y * (bpr + 1) + 1 + i] = (line[i] - pred) & 0xff;
    }
    prev = line;
  }
  var parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr)
  ];
  (extraChunks || []).forEach(function (c) { parts.push(chunk(c[0], c[1])); });
  parts.push(chunk('IDAT', zlibNode.deflateSync(raw, {level: 9})));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}
function packSamples(samples, depth, count) {
  var per = 8 / depth;
  var out = Buffer.alloc(Math.ceil(count * depth / 8));
  for (var i = 0; i < count; i++) {
    out[(i / per) | 0] |= (samples[i] & ((1 << depth) - 1)) << (8 - depth * ((i % per) + 1));
  }
  return out;
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function firstDiff(a, b) {
  if (a.length !== b.length) return 'len ' + a.length + ' vs ' + b.length;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return 'at ' + i + ': ' + a[i] + ' vs ' + b[i];
  return 'equal';
}
var rnd = (function () {                       // 固定种子，方便复现
  var s = 20260816;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >>> 8) & 0xff; };
})();

console.log('== 8 位 RGBA，逐行换 filter 类型 ==');
(function () {
  var w = 37, h = 23;
  var rows = [], expect = new Uint8Array(w * h * 4), o = 0;
  for (var y = 0; y < h; y++) {
    var line = Buffer.alloc(w * 4);
    for (var i = 0; i < w * 4; i++) { line[i] = rnd(); expect[o++] = line[i]; }
    rows.push(line);
  }
  var file = buildPng(w, h, 8, 6, rows, function (y) { return y % 5; });
  var img = png.decode(file);
  ok('尺寸', img.width === w && img.height === h, img.width + 'x' + img.height);
  ok('像素逐字节一致', sameBytes(img.data, expect), firstDiff(img.data, expect));
  ok('识别出 alpha', img.hasAlpha === true);
})();

console.log('== 8 位 RGB（无 alpha），filter=4 ==');
(function () {
  var w = 16, h = 9;
  var rows = [], expect = new Uint8Array(w * h * 4), o = 0;
  for (var y = 0; y < h; y++) {
    var line = Buffer.alloc(w * 3);
    for (var x = 0; x < w; x++) {
      line[x * 3] = rnd(); line[x * 3 + 1] = rnd(); line[x * 3 + 2] = rnd();
      expect[o++] = line[x * 3]; expect[o++] = line[x * 3 + 1]; expect[o++] = line[x * 3 + 2];
      expect[o++] = 255;
    }
    rows.push(line);
  }
  var img = png.decode(buildPng(w, h, 8, 2, rows, 4));
  ok('像素一致', sameBytes(img.data, expect), firstDiff(img.data, expect));
  ok('无 alpha', img.hasAlpha === false);
})();
console.log('== 灰度：位深 1 / 2 / 4 / 8 / 16 ==');
[1, 2, 4, 8, 16].forEach(function (depth) {
  var w = 11, h = 5;
  var maxv = depth === 16 ? 65535 : (1 << depth) - 1;
  var rows = [], expect = new Uint8Array(w * h * 4), o = 0;
  for (var y = 0; y < h; y++) {
    var samples = [];
    for (var x = 0; x < w; x++) {
      var v = (x * 7 + y * 13) % (maxv + 1);
      samples.push(v);
      var g8 = depth === 16 ? (v >>> 8) : (depth === 8 ? v : v * (255 / maxv));
      expect[o++] = g8; expect[o++] = g8; expect[o++] = g8; expect[o++] = 255;
    }
    var line;
    if (depth === 16) {
      line = Buffer.alloc(w * 2);
      for (var i = 0; i < w; i++) { line[i * 2] = samples[i] >>> 8; line[i * 2 + 1] = samples[i] & 0xff; }
    } else if (depth === 8) {
      line = Buffer.from(samples);
    } else {
      line = packSamples(samples, depth, w);
    }
    rows.push(line);
  }
  var img = png.decode(buildPng(w, h, depth, 0, rows, depth >= 8 ? 1 : 0));
  ok('位深 ' + depth + ' 灰度', sameBytes(img.data, expect), firstDiff(img.data, expect));
});

console.log('== 4 位索引色 + tRNS 调色板透明 ==');
(function () {
  var w = 7, h = 3;
  var plte = Buffer.alloc(16 * 3);
  for (var i = 0; i < 16; i++) { plte[i * 3] = i * 16; plte[i * 3 + 1] = 255 - i * 16; plte[i * 3 + 2] = i * 3; }
  var trns = Buffer.from([0, 128, 255]);          // 只给前 3 个索引指定 alpha
  var rows = [], expect = new Uint8Array(w * h * 4), o = 0;
  for (var y = 0; y < h; y++) {
    var samples = [];
    for (var x = 0; x < w; x++) {
      var idx = (x + y * 3) % 16;
      samples.push(idx);
      expect[o++] = plte[idx * 3]; expect[o++] = plte[idx * 3 + 1]; expect[o++] = plte[idx * 3 + 2];
      expect[o++] = idx < trns.length ? trns[idx] : 255;
    }
    rows.push(packSamples(samples, 4, w));
  }
  var img = png.decode(buildPng(w, h, 4, 3, rows, 0, [['PLTE', plte], ['tRNS', trns]]));
  ok('索引色像素与 alpha 一致', sameBytes(img.data, expect), firstDiff(img.data, expect));
})();
console.log('== 灰度+alpha（类型 4）与 16 位 RGB（类型 2）==');
(function () {
  var w = 9, h = 4;
  var rows = [], expect = new Uint8Array(w * h * 4), o = 0;
  for (var y = 0; y < h; y++) {
    var line = Buffer.alloc(w * 2);
    for (var x = 0; x < w; x++) {
      var g = rnd(), a = rnd();
      line[x * 2] = g; line[x * 2 + 1] = a;
      expect[o++] = g; expect[o++] = g; expect[o++] = g; expect[o++] = a;
    }
    rows.push(line);
  }
  var img = png.decode(buildPng(w, h, 8, 4, rows, 3));
  ok('灰度+alpha', sameBytes(img.data, expect), firstDiff(img.data, expect));
})();
(function () {
  var w = 6, h = 3;
  var rows = [], expect = new Uint8Array(w * h * 4), o = 0;
  for (var y = 0; y < h; y++) {
    var line = Buffer.alloc(w * 6);
    for (var x = 0; x < w; x++) {
      for (var c = 0; c < 3; c++) {
        var hi = rnd(), lo = rnd();
        line[x * 6 + c * 2] = hi; line[x * 6 + c * 2 + 1] = lo;
        expect[o++] = hi;                         // 16 位取高字节
      }
      expect[o++] = 255;
    }
    rows.push(line);
  }
  var img = png.decode(buildPng(w, h, 16, 2, rows, 2));
  ok('16 位 RGB 取高字节', sameBytes(img.data, expect), firstDiff(img.data, expect));
})();

console.log('== 多个 IDAT 分片 ==');
(function () {
  var w = 20, h = 12;
  var rows = [];
  for (var y = 0; y < h; y++) {
    var line = Buffer.alloc(w * 4);
    for (var i = 0; i < w * 4; i++) line[i] = rnd();
    rows.push(line);
  }
  var whole = buildPng(w, h, 8, 6, rows, 0);
  var one = png.decode(whole);
  // 把单个 IDAT 拆成三段重新组装
  var buf = Buffer.from(whole);
  var pos = 8, idatStart = -1, idatLen = 0;
  while (pos < buf.length) {
    var len = buf.readUInt32BE(pos);
    var type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') { idatStart = pos + 8; idatLen = len; break; }
    pos += 12 + len;
  }
  var body = buf.slice(idatStart, idatStart + idatLen);
  var cut1 = (idatLen / 3) | 0, cut2 = ((idatLen * 2) / 3) | 0;
  var rebuilt = Buffer.concat([
    buf.slice(0, idatStart - 8),
    chunk('IDAT', body.slice(0, cut1)),
    chunk('IDAT', body.slice(cut1, cut2)),
    chunk('IDAT', body.slice(cut2)),
    buf.slice(idatStart + idatLen + 4)
  ]);
  var multi = png.decode(new Uint8Array(rebuilt));
  ok('三段 IDAT 结果与单段一致', sameBytes(multi.data, one.data), firstDiff(multi.data, one.data));
})();
console.log('== 自家 encode -> 自家 decode 往返 ==');
[[64, 48, true], [64, 48, false], [1, 1, false], [301, 7, true], [7, 301, false]].forEach(function (cfg) {
  var w = cfg[0], h = cfg[1], withAlpha = cfg[2];
  var src = new Uint8Array(w * h * 4);
  for (var i = 0; i < src.length; i += 4) {
    src[i] = rnd(); src[i + 1] = rnd(); src[i + 2] = rnd();
    src[i + 3] = withAlpha ? rnd() : 255;
  }
  var file = png.encode(src, w, h);
  var back = png.decode(file);
  ok(w + 'x' + h + (withAlpha ? ' 带alpha' : ' 不透明') + ' 往返一致',
    back.width === w && back.height === h && sameBytes(back.data, src),
    firstDiff(back.data, src));
  ok('  颜色类型选择正确', back.colorType === (withAlpha ? 6 : 2), 'colorType=' + back.colorType);
  // 我们生成的 IDAT 必须是标准 zlib 流：Node 能解开才算过
  var buf = Buffer.from(file);
  var pos = 8;
  var idat = null;
  while (pos < buf.length) {
    var len = buf.readUInt32BE(pos);
    if (buf.toString('ascii', pos + 4, pos + 8) === 'IDAT') { idat = buf.slice(pos + 8, pos + 8 + len); break; }
    pos += 12 + len;
  }
  var okZlib = false;
  try { zlibNode.inflateSync(idat); okZlib = true; } catch (e) { okZlib = e.message; }
  ok('  Node zlib 能解开我们的 IDAT', okZlib === true, okZlib);
  // 每个块的 CRC 都要对
  var crcOk = true;
  pos = 8;
  while (pos + 12 <= buf.length) {
    var l = buf.readUInt32BE(pos);
    if (crc32(buf.slice(pos + 4, pos + 8 + l)) !== buf.readUInt32BE(pos + 8 + l)) crcOk = false;
    pos += 12 + l;
  }
  ok('  所有块 CRC 正确', crcOk);
});

console.log('== 固定 filter / 强制 alpha / 压缩级别 ==');
(function () {
  var w = 50, h = 40;
  var src = new Uint8Array(w * h * 4);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var p = (y * w + x) * 4;
      src[p] = (x * 5) & 0xff; src[p + 1] = (y * 6) & 0xff; src[p + 2] = 128; src[p + 3] = 255;
    }
  }
  [0, 1, 2, 3, 4].forEach(function (ft) {
    var back = png.decode(png.encode(src, w, h, {filter: ft}));
    ok('固定 filter=' + ft + ' 往返一致', sameBytes(back.data, src), firstDiff(back.data, src));
  });
  [0, 1, 2].forEach(function (lv) {
    var back = png.decode(png.encode(src, w, h, {level: lv}));
    ok('压缩级别 ' + lv + ' 往返一致', sameBytes(back.data, src));
  });
  var forced = png.decode(png.encode(src, w, h, {forceAlpha: true}));
  ok('forceAlpha 保留 RGBA', forced.colorType === 6 && sameBytes(forced.data, src));
  var auto = png.encode(src, w, h);
  var flat = png.encode(src, w, h, {filter: 0});
  ok('逐行择优比不过滤更小', auto.length < flat.length, auto.length + ' vs ' + flat.length);
  var size = png.readSize(auto);
  ok('readSize 正确', size && size.width === w && size.height === h);
})();
console.log('== 位平面无损性：改动最低位后往返 ==');
(function () {
  var w = 120, h = 90;
  var src = new Uint8Array(w * h * 4);
  for (var i = 0; i < src.length; i += 4) {
    src[i] = rnd(); src[i + 1] = rnd(); src[i + 2] = rnd(); src[i + 3] = 255;
  }
  // 在 R 通道第 0 位画一个方块，encode/decode 一圈后必须一位不差
  for (var y = 20; y < 70; y++) {
    for (var x = 30; x < 90; x++) {
      var p = (y * w + x) * 4;
      src[p] = (src[p] & 0xfe) | 1;
    }
  }
  var back = png.decode(png.encode(src, w, h));
  var planeOk = true;
  for (var q = 0; q < w * h; q++) {
    if ((back.data[q * 4] & 1) !== (src[q * 4] & 1)) { planeOk = false; break; }
  }
  ok('第 0 位平面完全保留', planeOk);
  ok('整幅像素完全一致', sameBytes(back.data, src));
})();

console.log('== 异常输入要给出中文报错 ==');
[
  [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), '不是 PNG'],
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), '缺少 IHDR'],
  [(function () {
    var w = 4, h = 2, rows = [];
    for (var y = 0; y < h; y++) rows.push(Buffer.alloc(w * 4));
    var f = Buffer.from(buildPng(w, h, 8, 6, rows, 0));
    f[28] = 1;                                    // IHDR 的 interlace 字节改成 1
    f.writeUInt32BE(crc32(f.slice(12, 29)), 29);  // 重算 IHDR 的 CRC，否则会先报 CRC 错
    return new Uint8Array(f);
  })(), '隔行扫描']
].forEach(function (cfg, i) {
  var msg = '';
  try { png.decode(cfg[0]); } catch (e) { msg = e.message; }
  ok('异常 ' + (i + 1) + ' 提示含「' + cfg[1] + '」', msg.indexOf(cfg[1]) >= 0, msg || '（没有报错）');
});

console.log(fails ? '\n有 ' + fails + ' 项失败' : '\nALL PASS');
process.exit(fails ? 1 : 0);

/**
 * lsbcore.js —— LSB 位平面引擎（无 DOM，可直接在小程序里 require）
 *
 * 从网页版 图片隐藏数据分析/lsb.js + stencil.js 移植而来，两处改动：
 *   1. 用 {width, height, data:Uint8Array} 代替浏览器的 ImageData；
 *   2. 小程序运行时没有 TextEncoder / TextDecoder，UTF-8 编解码自己实现。
 *
 * 载荷格式（LSB1，与网页版完全兼容）：
 *   magic 'LSB1'(4) | flags(1) | 载荷长度 uint32 BE(4) | 校验和 uint16 BE(2) | 载荷
 *   flags: bit0 = 使用密码混淆, bit1 = 文件模式（载荷 = 名长(1)+文件名+文件数据）
 * 位写入顺序：像素光栅顺序 → 选定通道顺序 → 位平面 0..n-1（先低位）；字节内高位先行。
 */
'use strict';

var MAGIC = [0x4c, 0x53, 0x42, 0x31];
var HEADER = 11;                                  // 包头字节数
var CH_INDEX = {r: 0, g: 1, b: 2, a: 3};
var CH_NAME = {r: '红 (R)', g: '绿 (G)', b: '蓝 (B)', a: '透明度 (A)'};

/* ================= UTF-8 编解码（替代 TextEncoder / TextDecoder） ================= */

/** 字符串 -> UTF-8 字节 */
function utf8Encode(str) {
  var s = String(str == null ? '' : str);
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {      // 代理对合成一个码点
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}
/** UTF-8 字节 -> 字符串；非法字节替换成 �，不抛错 */
function utf8Decode(bytes) {
  var parts = [];                                  // 分段拼接，避免超长字符串反复相加
  var buf = [];
  var i = 0;
  var n = bytes.length;
  while (i < n) {
    var b = bytes[i++];
    var cp;
    var need;
    if (b < 0x80) { cp = b; need = 0; }
    else if (b >= 0xc2 && b <= 0xdf) { cp = b & 0x1f; need = 1; }
    else if (b >= 0xe0 && b <= 0xef) { cp = b & 0x0f; need = 2; }
    else if (b >= 0xf0 && b <= 0xf4) { cp = b & 0x07; need = 3; }
    else { buf.push(0xfffd); continue; }
    var bad = false;
    for (var k = 0; k < need; k++) {
      if (i >= n || (bytes[i] & 0xc0) !== 0x80) { bad = true; break; }
      cp = (cp << 6) | (bytes[i++] & 0x3f);
    }
    if (bad || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      buf.push(0xfffd);
    } else if (cp < 0x10000) {
      buf.push(cp);
    } else {
      cp -= 0x10000;
      buf.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
    if (buf.length >= 4096) {
      parts.push(String.fromCharCode.apply(null, buf));
      buf = [];
    }
  }
  if (buf.length) parts.push(String.fromCharCode.apply(null, buf));
  return parts.join('');
}

/* ================= 容量与位游标 ================= */

function channelList(spec) {
  if (Object.prototype.toString.call(spec) === '[object Array]') {
    return spec.map(function (c) { return CH_INDEX[c]; });
  }
  return String(spec).split('').map(function (c) { return CH_INDEX[c]; });
}

function capacityBits(width, height, channels, bits) {
  return width * height * channelList(channels).length * bits;
}

function capacityBytes(width, height, channels, bits) {
  return Math.max(0, Math.floor(capacityBits(width, height, channels, bits) / 8) - HEADER);
}
// 依次走过「像素 -> 通道 -> 位平面」，next() 后 pos / bit 就是当前要读写的位置
function Cursor(data, channels, bits) {
  this.data = data;
  this.chans = channelList(channels);
  this.bits = bits;
  this.pixel = 0;
  this.ci = 0;
  this.bi = 0;
  this.total = Math.floor(data.length / 4);
}

Cursor.prototype.next = function () {
  if (this.pixel >= this.total) return false;
  this.pos = this.pixel * 4 + this.chans[this.ci];
  this.bit = this.bi;
  this.bi++;
  if (this.bi >= this.bits) {
    this.bi = 0;
    this.ci++;
    if (this.ci >= this.chans.length) {
      this.ci = 0;
      this.pixel++;
    }
  }
  return true;
};

function readBits(data, channels, bits, byteCount, skipBytes) {
  var cursor = new Cursor(data, channels, bits);
  var skip = (skipBytes || 0) * 8;
  while (skip-- > 0) {
    if (!cursor.next()) return null;
  }
  var out = new Uint8Array(byteCount);
  for (var i = 0; i < byteCount; i++) {
    var b = 0;
    for (var k = 0; k < 8; k++) {
      if (!cursor.next()) return null;
      b = (b << 1) | ((data[cursor.pos] >> cursor.bit) & 1);
    }
    out[i] = b;
  }
  return out;
}

function writeBits(data, channels, bits, payload) {
  var cursor = new Cursor(data, channels, bits);
  for (var i = 0; i < payload.length; i++) {
    for (var k = 7; k >= 0; k--) {
      if (!cursor.next()) return false;
      var bit = (payload[i] >> k) & 1;
      data[cursor.pos] = (data[cursor.pos] & ~(1 << cursor.bit)) | (bit << cursor.bit);
    }
  }
  return true;
}
/* ================= 校验和与密码混淆 ================= */

function fletcher16(bytes) {
  var s1 = 0;
  var s2 = 0;
  for (var i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % 255;
    s2 = (s2 + s1) % 255;
  }
  return (s2 << 8) | s1;
}

function seedOf(password) {
  var h = 0x811c9dc5;
  for (var i = 0; i < password.length; i++) {
    h ^= password.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h || 0x9e3779b9;
}

function xorMask(bytes, password) {
  var s = seedOf(password);
  for (var i = 0; i < bytes.length; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    bytes[i] ^= s & 0xff;
  }
  return bytes;
}

/* ================= 载荷封装 ================= */

function buildPacket(payload, opts) {
  var body = new Uint8Array(payload);
  var flags = 0;
  // 校验和固定基于明文：提取端先解混淆再校验，因此可用它判断口令是否正确
  var sum = fletcher16(body);
  if (opts.password) {
    flags |= 1;
    xorMask(body, opts.password);
  }
  if (opts.isFile) flags |= 2;
  var packet = new Uint8Array(HEADER + body.length);
  packet.set(MAGIC, 0);
  packet[4] = flags;
  packet[5] = (body.length >>> 24) & 0xff;
  packet[6] = (body.length >>> 16) & 0xff;
  packet[7] = (body.length >>> 8) & 0xff;
  packet[8] = body.length & 0xff;
  packet[9] = (sum >> 8) & 0xff;
  packet[10] = sum & 0xff;
  packet.set(body, HEADER);
  return packet;
}

/** 文件模式的载荷：名长(1) + 文件名(UTF-8) + 文件字节 */
function fileEnvelope(name, bytes) {
  var nameBytes = utf8Encode(name).subarray(0, 255);
  var out = new Uint8Array(1 + nameBytes.length + bytes.length);
  out[0] = nameBytes.length;
  out.set(nameBytes, 1);
  out.set(bytes, 1 + nameBytes.length);
  return out;
}
/* ================= 写入 / 提取 ================= */

/** 把载荷写进像素图（会复制一份，不改原数据） */
function embed(image, payload, opts) {
  var channels = opts.channels || 'rgb';
  var bits = opts.bits || 1;
  var cap = capacityBytes(image.width, image.height, channels, bits);
  if (payload.length > cap) {
    return {ok: false, error: '载荷 ' + payload.length + ' 字节超出容量 ' + cap + ' 字节', capacity: cap};
  }
  var out = {width: image.width, height: image.height, data: new Uint8Array(image.data)};
  var data = out.data;
  if (opts.flattenAlpha) {
    for (var i = 3; i < data.length; i += 4) data[i] = 255;
  }
  var packet = buildPacket(payload, opts);
  if (!writeBits(data, channels, bits, packet)) {
    return {ok: false, error: '像素不足，写入失败', capacity: cap};
  }
  return {ok: true, image: out, used: packet.length, capacity: cap, packet: packet};
}

/** 从像素图里按指定通道 / 位数提取载荷 */
function extract(image, opts) {
  var channels = opts.channels || 'rgb';
  var bits = opts.bits || 1;
  var data = image.data;
  var head = readBits(data, channels, bits, HEADER);
  if (!head) return {ok: false, reason: 'too-small'};
  for (var i = 0; i < 4; i++) {
    if (head[i] !== MAGIC[i]) return {ok: false, reason: 'no-magic'};
  }
  var flags = head[4];
  var len = ((head[5] << 24) | (head[6] << 16) | (head[7] << 8) | head[8]) >>> 0;
  var sum = (head[9] << 8) | head[10];
  var cap = capacityBytes(image.width, image.height, channels, bits);
  if (len > cap) return {ok: false, reason: 'bad-length', length: len, capacity: cap};
  var all = readBits(data, channels, bits, HEADER + len);
  if (!all) return {ok: false, reason: 'truncated'};
  var body = all.slice(HEADER);
  var encrypted = !!(flags & 1);
  var isFile = !!(flags & 2);
  if (encrypted) {
    if (!opts.password) {
      return {ok: false, reason: 'need-password', encrypted: true, length: len, channels: channels, bits: bits};
    }
    xorMask(body, opts.password);
  }
  var checksumOk = fletcher16(body) === sum;
  if (!checksumOk && encrypted) {
    return {ok: false, reason: 'bad-password', encrypted: true, length: len, channels: channels, bits: bits};
  }
  var result = {
    ok: true, encrypted: encrypted, isFile: isFile, length: len,
    checksumOk: checksumOk, channels: channels, bits: bits, bytes: body
  };
  if (isFile) {
    var nameLen = body[0];
    result.fileName = utf8Decode(body.subarray(1, 1 + nameLen));
    result.bytes = body.subarray(1 + nameLen);
  } else {
    result.text = utf8Decode(body);
  }
  return result;
}

// 常见组合优先，其余 rgba 子集兜底；每个组合再试 1~4 位
var SNIFF_CONFIGS = (function () {
  var order = ['rgb', 'r', 'g', 'b', 'a', 'rgba'];
  'rgba'.split('').forEach(function (c1, i) {
    'rgba'.split('').forEach(function (c2, j) {
      if (j <= i) return;
      var pair = c1 + c2;
      if (order.indexOf(pair) < 0) order.push(pair);
    });
  });
  ['rga', 'rba', 'gba'].forEach(function (c) {
    if (order.indexOf(c) < 0) order.push(c);
  });
  var list = [];
  order.forEach(function (ch) {
    [1, 2, 3, 4].forEach(function (bits) {
      list.push({channels: ch, bits: bits});
    });
  });
  return list;
})();

/** 遍历常见通道 / 位数组合去碰运气，返回所有命中的结果 */
function sniff(image, password) {
  var found = [];
  for (var i = 0; i < SNIFF_CONFIGS.length; i++) {
    var cfg = SNIFF_CONFIGS[i];
    var res = extract(image, {channels: cfg.channels, bits: cfg.bits, password: password});
    if (res.ok || res.reason === 'need-password' || res.reason === 'bad-password') {
      res.config = cfg;
      found.push(res);
      if (res.ok) break;
    }
  }
  return found;
}
/* ================= 位平面渲染 ================= */

/**
 * 把某个位平面画成可看的图，同时完成缩放。
 * 缩小时对源像素的位值做面积平均（而不是抽样），细密的图案才不会被丢掉。
 * opts: {bit, channel: r/g/b/a/gray/rgb, mode: bw/amplify, invert}
 * srcRect 可只看原图的一块区域（用来 1:1 放大细看）。
 */
function renderPlaneScaled(image, opts, outW, outH, srcRect) {
  var bit = opts.bit | 0;
  var ch = opts.channel || 'r';
  var mode = opts.mode || 'bw';
  var inv = !!opts.invert;
  var d = image.data;
  var iw = image.width;
  var rx = srcRect ? Math.max(0, Math.min(iw - 1, srcRect.x | 0)) : 0;
  var ry = srcRect ? Math.max(0, Math.min(image.height - 1, srcRect.y | 0)) : 0;
  var rw = srcRect ? Math.max(1, Math.min(iw - rx, srcRect.w | 0)) : iw;
  var rh = srcRect ? Math.max(1, Math.min(image.height - ry, srcRect.h | 0)) : image.height;
  var idx = CH_INDEX[ch] === undefined ? 0 : CH_INDEX[ch];
  var out = new Uint8Array(outW * outH * 4);
  var o = 0;
  for (var oy = 0; oy < outH; oy++) {
    var y0 = ry + ((oy * rh / outH) | 0);
    var y1 = ry + (((oy + 1) * rh / outH) | 0);
    if (y1 <= y0) y1 = y0 + 1;
    for (var ox = 0; ox < outW; ox++) {
      var x0 = rx + ((ox * rw / outW) | 0);
      var x1 = rx + (((ox + 1) * rw / outW) | 0);
      if (x1 <= x0) x1 = x0 + 1;
      var s0 = 0;
      var s1 = 0;
      var s2 = 0;
      var cnt = 0;
      for (var y = y0; y < y1; y++) {
        var row = y * iw;
        for (var x = x0; x < x1; x++) {
          var p = (row + x) * 4;
          if (ch === 'rgb') {
            s0 += (d[p] >> bit) & 1;
            s1 += (d[p + 1] >> bit) & 1;
            s2 += (d[p + 2] >> bit) & 1;
          } else if (ch === 'gray') {
            s0 += (((d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0) >> bit) & 1;
          } else {
            s0 += (d[p + idx] >> bit) & 1;
          }
          cnt++;
        }
      }
      var r;
      var g;
      var b;
      if (ch === 'rgb') {
        r = (s0 * 255 / cnt) | 0;
        g = (s1 * 255 / cnt) | 0;
        b = (s2 * 255 / cnt) | 0;
      } else {
        var v = (s0 * 255 / cnt) | 0;
        if (mode === 'amplify' && ch !== 'gray' && idx < 3) {
          r = idx === 0 ? v : 0;
          g = idx === 1 ? v : 0;
          b = idx === 2 ? v : 0;
        } else {
          r = g = b = v;
        }
      }
      if (inv) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }
      out[o++] = r;
      out[o++] = g;
      out[o++] = b;
      out[o++] = 255;
    }
  }
  return {width: outW, height: outH, data: out};
}

/** 原尺寸渲染位平面 */
function renderPlane(image, opts) {
  return renderPlaneScaled(image, opts, image.width, image.height, null);
}

/** 把像素图按面积平均缩到指定尺寸（原图预览用） */
function downscale(image, outW, outH) {
  var d = image.data;
  var iw = image.width;
  var out = new Uint8Array(outW * outH * 4);
  var o = 0;
  for (var oy = 0; oy < outH; oy++) {
    var y0 = (oy * image.height / outH) | 0;
    var y1 = ((oy + 1) * image.height / outH) | 0;
    if (y1 <= y0) y1 = y0 + 1;
    for (var ox = 0; ox < outW; ox++) {
      var x0 = (ox * iw / outW) | 0;
      var x1 = ((ox + 1) * iw / outW) | 0;
      if (x1 <= x0) x1 = x0 + 1;
      var sr = 0;
      var sg = 0;
      var sb = 0;
      var sa = 0;
      var cnt = 0;
      for (var y = y0; y < y1; y++) {
        for (var x = x0; x < x1; x++) {
          var p = (y * iw + x) * 4;
          sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; sa += d[p + 3];
          cnt++;
        }
      }
      out[o++] = (sr / cnt) | 0;
      out[o++] = (sg / cnt) | 0;
      out[o++] = (sb / cnt) | 0;
      out[o++] = (sa / cnt) | 0;
    }
  }
  return {width: outW, height: outH, data: out};
}
/* ================= 统计分析 ================= */

function chiSquare(h) {
  var chi = 0;
  var df = 0;
  for (var i = 0; i < 128; i++) {
    var a = h[2 * i];
    var b = h[2 * i + 1];
    var e = (a + b) / 2;
    if (e < 5) continue;
    chi += 2 * (a - e) * (a - e) / e;
    df++;
  }
  return {chi: chi, df: df, norm: df ? chi / df : 0};
}

/** 逐通道直方图 + 8 个位平面的 1 占比 + 卡方判断 */
function stats(image) {
  var d = image.data;
  var n = image.width * image.height;
  var hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  var alphaVaries = false;                          // 是否存在非全不透明的像素
  var transparent = 0;                              // 完全透明的像素数
  for (var p = 0; p < d.length; p += 4) {
    hist[0][d[p]]++;
    hist[1][d[p + 1]]++;
    hist[2][d[p + 2]]++;
    if (d[p + 3] !== 255) {
      alphaVaries = true;
      if (d[p + 3] === 0) transparent++;
    }
  }
  var names = ['红 (R)', '绿 (G)', '蓝 (B)'];
  var channels = [];
  for (var i = 0; i < 3; i++) {
    var ones = new Float64Array(8);
    for (var v = 0; v < 256; v++) {
      var cnt = hist[i][v];
      if (!cnt) continue;
      for (var b = 0; b < 8; b++) {
        if ((v >> b) & 1) ones[b] += cnt;
      }
    }
    var cs = chiSquare(hist[i]);
    var planeRatios = [];
    for (var k = 0; k < 8; k++) planeRatios.push(n ? ones[k] / n : 0);
    channels.push({
      name: names[i],
      ratio: planeRatios[0],
      planeRatios: planeRatios,
      chi: cs.chi,
      df: cs.df,
      norm: cs.norm,
      verdict: cs.df < 8 ? '样本不足' : cs.norm < 1.6 ? '高度疑似 LSB 替换' : cs.norm < 6 ? '可疑' : '未见明显 LSB 替换'
    });
  }
  return {pixels: n, channels: channels, alphaVaries: alphaVaries, transparent: transparent};
}
/* ================= 原始位流预览 ================= */

/** 直接把位流当字节读出来，找可打印字符串（判断有没有明文藏在里面） */
function rawPreview(image, opts) {
  var channels = opts.channels || 'rgb';
  var bits = opts.bits || 1;
  var count = Math.min(opts.count || 512, Math.floor(capacityBits(image.width, image.height, channels, bits) / 8));
  var bytes = readBits(image.data, channels, bits, count);
  if (!bytes) return null;
  var strings = [];
  var start = -1;
  for (var i = 0; i <= bytes.length; i++) {
    var c = i < bytes.length ? bytes[i] : 0;
    var printable = c >= 32 && c < 127;
    if (printable) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= 4) {
        strings.push({offset: start, text: String.fromCharCode.apply(null, bytes.subarray(start, i))});
      }
      start = -1;
    }
  }
  return {bytes: bytes, strings: strings, text: utf8Decode(bytes)};
}

/* ================= 图案（stencil）写入位平面 ================= */

// Floyd–Steinberg 抖动：把灰阶摊成黑白网点，照片当图案时更清楚
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
function finishMask(val, covered, n, w, h, stride, thr, useDither, inv) {
  var bits = new Uint8Array(n * stride);            // 二值化后的图案位；stride=1 单色，3 彩色
  var on = 0;                                       // 图案里为 1 的像素数
  for (var c = 0; c < stride; c++) {
    var plane = useDither ? ditherPlane(val, stride, c, w, h, thr) : null;
    for (var i = 0; i < n; i++) {
      var b = plane ? plane[i] : (val[i * stride + c] >= thr ? 1 : 0);
      if (!covered[i]) b = 0;      // 抖动的误差会溢出图案边界，这里统一夹回去
      if (inv) b ^= 1;
      bits[i * stride + c] = b;
      if (b && c === 0) on++;
    }
  }
  return {bits: bits, stride: stride, covered: covered, on: on, pixels: n};
}

/**
 * 把「画好图案的 RGBA 图层」二值化成掩膜。
 * comp 是图案层的 RGBA 像素（透明处 alpha=0），尺寸必须和载体一致。
 * opts: {color 三通道彩色, threshold 阈值, dither 抖动, invert 反色}
 */
function buildMask(comp, w, h, opts) {
  var n = w * h;
  var color = !!opts.color;
  var thr = opts.threshold === undefined ? 128 : opts.threshold;
  var stride = color ? 3 : 1;
  var val = new Uint8Array(n * stride);             // 二值化前的灰度 / 彩色分量
  var covered = new Uint8Array(n);                  // 图案覆盖到的像素
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
  return finishMask(val, covered, n, w, h, stride, thr, !!opts.dither, !!opts.invert);
}
/**
 * 把掩膜写进载体的指定位平面（返回新图，不改原图）。
 * opts: {chans 目标通道下标数组, plane 位号, color 彩色模式, whole 整幅清零, flatten 抹平 alpha}
 */
function applyStencil(image, mask, opts) {
  var n = image.width * image.height;
  var out = {width: image.width, height: image.height, data: new Uint8Array(image.data)};
  var d = out.data;
  if (opts.flatten) {
    for (var q = 3; q < d.length; q += 4) d[q] = 255;
  }
  var keep = ~(1 << opts.plane);                    // 保留其它位的掩码
  var stride = mask.stride || 1;
  var changed = 0;                                  // 真正被改动的样本数
  var samples = 0;                                  // 写入过的样本总数
  for (var i = 0; i < n; i++) {
    if (!opts.whole && !mask.covered[i]) continue;
    for (var k = 0; k < opts.chans.length; k++) {
      var t = opts.chans[k];
      var p = i * 4 + t;
      var prev = d[p];
      d[p] = (prev & keep) | (mask.bits[i * stride + (stride === 3 ? t : 0)] << opts.plane);
      samples++;
      if (d[p] !== prev) changed++;
    }
  }
  return {image: out, changed: changed, samples: samples};
}

/** 峰值信噪比，用来说明改动有多轻微（只比 RGB） */
function psnr(a, b) {
  var sum = 0;
  var count = 0;
  for (var i = 0; i < a.length; i += 4) {
    for (var c = 0; c < 3; c++) {
      var diff = a[i + c] - b[i + c];
      sum += diff * diff;
      count++;
    }
  }
  if (!count || sum === 0) return Infinity;
  return 10 * Math.log(255 * 255 / (sum / count)) / Math.LN10;
}

/** 回读校验：确认位平面里的图案和掩膜一致，返回不一致的样本数 */
function verifyStencil(image, mask, opts) {
  var n = image.width * image.height;
  var d = image.data;
  var stride = mask.stride || 1;
  var bad = 0;
  var total = 0;
  for (var i = 0; i < n; i++) {
    if (!opts.whole && !mask.covered[i]) continue;
    for (var k = 0; k < opts.chans.length; k++) {
      var t = opts.chans[k];
      var want = mask.bits[i * stride + (stride === 3 ? t : 0)];
      if (((d[i * 4 + t] >> opts.plane) & 1) !== want) bad++;
      total++;
    }
  }
  return {bad: bad, total: total};
}
module.exports = {
  HEADER: HEADER,
  CH_INDEX: CH_INDEX,
  CH_NAME: CH_NAME,
  utf8Encode: utf8Encode,
  utf8Decode: utf8Decode,
  capacityBits: capacityBits,
  capacityBytes: capacityBytes,
  readBits: readBits,
  writeBits: writeBits,
  fletcher16: fletcher16,
  embed: embed,
  extract: extract,
  sniff: sniff,
  fileEnvelope: fileEnvelope,
  renderPlane: renderPlane,
  renderPlaneScaled: renderPlaneScaled,
  downscale: downscale,
  stats: stats,
  rawPreview: rawPreview,
  buildMask: buildMask,
  ditherPlane: ditherPlane,
  applyStencil: applyStencil,
  verifyStencil: verifyStencil,
  psnr: psnr
};

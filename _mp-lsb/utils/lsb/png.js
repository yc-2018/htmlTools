/**
 * png.js —— 纯 JS 的 PNG 解码 / 编码
 *
 * 位平面里藏的东西只要有一个像素被改写就全毁了，而小程序里 canvas 取像素、
 * wx.canvasToTempFilePath 导出都做不到逐位无损，所以 PNG 自己解、自己编。
 *   decode —— 颜色类型 0/2/3/4/6，位深 1/2/4/8/16，支持 tRNS，统一输出 8 位 RGBA
 *   encode —— 输出 8 位 RGB / RGBA 无损 PNG，逐行挑选最省体积的 filter
 * 隔行扫描（Adam7）的 PNG 极少见，这里直接报错，不去猜。
 * 依赖 ./zlibmini.js。
 */
'use strict';

var zlib = require('./zlibmini.js');

var SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
var CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};    // 颜色类型 -> 每像素样本数
var ALLOWED_DEPTH = {                             // 各颜色类型允许的位深（PNG 规范 11.2.2）
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16]
};

/* ================= CRC32 / 字节读写 ================= */

var CRC_TABLE = (function () {
  var table = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf, start, end) {
  var c = -1;
  for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function readU32(buf, p) {
  return ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
}

function writeU32(buf, p, v) {
  buf[p] = (v >>> 24) & 0xff;
  buf[p + 1] = (v >>> 16) & 0xff;
  buf[p + 2] = (v >>> 8) & 0xff;
  buf[p + 3] = v & 0xff;
}
/** 只看 8 字节魔数判断是不是 PNG */
function isPng(bytes) {
  if (!bytes || bytes.length < 8) return false;
  for (var i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return false;
  return true;
}

function chunkType(buf, p) {
  return String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
}

/* ================= 解码：行 filter 还原 ================= */

// raw 里每行是「1 字节 filter 类型 + bpr 字节数据」，就地还原成未过滤的样本字节
function unfilter(raw, height, bpr, bpp) {
  var p = 0;
  for (var y = 0; y < height; y++) {
    var ft = raw[p++];
    var row = p;                  // 本行数据起点
    var up = row - bpr - 1;       // 上一行同列起点（减掉上一行的 filter 字节）
    var i;
    var a;
    var b;
    if (ft === 1) {
      for (i = bpp; i < bpr; i++) raw[row + i] = (raw[row + i] + raw[row + i - bpp]) & 0xff;
    } else if (ft === 2) {
      if (y > 0) for (i = 0; i < bpr; i++) raw[row + i] = (raw[row + i] + raw[up + i]) & 0xff;
    } else if (ft === 3) {
      for (i = 0; i < bpr; i++) {
        a = i >= bpp ? raw[row + i - bpp] : 0;
        b = y > 0 ? raw[up + i] : 0;
        raw[row + i] = (raw[row + i] + ((a + b) >> 1)) & 0xff;
      }
    } else if (ft === 4) {
      for (i = 0; i < bpr; i++) {
        a = i >= bpp ? raw[row + i - bpp] : 0;
        b = y > 0 ? raw[up + i] : 0;
        var c = (i >= bpp && y > 0) ? raw[up + i - bpp] : 0;
        var pa = b - c < 0 ? c - b : b - c;          // |p-a|
        var pb = a - c < 0 ? c - a : a - c;          // |p-b|
        var pc = a + b - c - c;                      // p-c
        if (pc < 0) pc = -pc;
        var pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        raw[row + i] = (raw[row + i] + pred) & 0xff;
      }
    } else if (ft !== 0) {
      throw new Error('PNG 行 filter 类型无效：' + ft);
    }
    p += bpr;
  }
}
/* ================= 解码：样本 -> 8 位 RGBA ================= */

// 取第 index 个样本；位深小于 8 时按高位在前的顺序在字节里拆
function sampleAt(raw, rowStart, index, depth) {
  if (depth === 8) return raw[rowStart + index];
  if (depth === 16) return (raw[rowStart + index * 2] << 8) | raw[rowStart + index * 2 + 1];
  var per = 8 / depth;                                    // 每字节装几个样本
  var byte = raw[rowStart + ((index / per) | 0)];
  var shift = 8 - depth * ((index % per) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

// 把任意位深的样本拉伸到 0～255
function scaleUp(v, depth) {
  if (depth === 8) return v;
  if (depth === 16) return v >>> 8;
  if (depth === 1) return v ? 255 : 0;
  if (depth === 2) return v * 85;
  return v * 17;                                          // depth 4
}

function toRgba(raw, w, h, bpr, ct, depth, palette, trns) {
  var out = new Uint8Array(w * h * 4);
  var chans = CHANNELS[ct];
  var stride = bpr + 1;                                   // 每行含 filter 字节的长度
  var y;
  var x;
  var rowStart;
  var o = 0;

  // 最常见的 8 位 RGBA / RGB 走直路，省掉逐样本的函数调用
  if (depth === 8 && ct === 6) {
    for (y = 0; y < h; y++) {
      rowStart = y * stride + 1;
      out.set(raw.subarray(rowStart, rowStart + w * 4), y * w * 4);
    }
    return out;
  }
  if (depth === 8 && ct === 2 && !trns) {
    for (y = 0; y < h; y++) {
      rowStart = y * stride + 1;
      for (x = 0; x < w; x++) {
        var s = rowStart + x * 3;
        out[o++] = raw[s];
        out[o++] = raw[s + 1];
        out[o++] = raw[s + 2];
        out[o++] = 255;
      }
    }
    return out;
  }
  for (y = 0; y < h; y++) {
    rowStart = y * stride + 1;
    for (x = 0; x < w; x++) {
      var base = x * chans;
      var r;
      var g;
      var b;
      var a = 255;
      if (ct === 3) {
        var idx = sampleAt(raw, rowStart, base, depth);
        r = palette[idx * 3];
        g = palette[idx * 3 + 1];
        b = palette[idx * 3 + 2];
        if (trns && trns.alphas && idx < trns.alphas.length) a = trns.alphas[idx];
      } else if (ct === 0 || ct === 4) {
        var gv = sampleAt(raw, rowStart, base, depth);
        r = g = b = scaleUp(gv, depth);
        if (ct === 4) a = scaleUp(sampleAt(raw, rowStart, base + 1, depth), depth);
        else if (trns && trns.gray === gv) a = 0;
      } else {
        var rv = sampleAt(raw, rowStart, base, depth);
        var gvv = sampleAt(raw, rowStart, base + 1, depth);
        var bv = sampleAt(raw, rowStart, base + 2, depth);
        r = scaleUp(rv, depth);
        g = scaleUp(gvv, depth);
        b = scaleUp(bv, depth);
        if (ct === 6) a = scaleUp(sampleAt(raw, rowStart, base + 3, depth), depth);
        else if (trns && trns.r === rv && trns.g === gvv && trns.b === bv) a = 0;
      }
      out[o++] = r;
      out[o++] = g;
      out[o++] = b;
      out[o++] = a;
    }
  }
  return out;
}
/* ================= 解码入口 ================= */

/**
 * 解码 PNG。opts.maxPixels 可限制像素总数，超了直接报错而不是把内存吃光。
 * 返回 {width, height, data(8 位 RGBA), bitDepth, colorType, hasAlpha}
 */
function decode(bytes, opts) {
  opts = opts || {};
  if (!isPng(bytes)) throw new Error('不是 PNG 文件（文件头不匹配）。');
  var pos = 8;
  var ihdr = null;
  var palette = null;
  var trns = null;
  var idats = [];
  var idatLen = 0;
  while (pos + 8 <= bytes.length) {
    var len = readU32(bytes, pos);
    var type = chunkType(bytes, pos + 4);
    var dataStart = pos + 8;
    if (dataStart + len + 4 > bytes.length) throw new Error('PNG 数据块 ' + type + ' 不完整。');
    if (type === 'IHDR') {
      if (crc32(bytes, pos + 4, dataStart + len) !== readU32(bytes, dataStart + len)) {
        throw new Error('PNG 头部 CRC 校验失败，文件已损坏。');
      }
      ihdr = {
        width: readU32(bytes, dataStart),
        height: readU32(bytes, dataStart + 4),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        compression: bytes[dataStart + 10],
        filter: bytes[dataStart + 11],
        interlace: bytes[dataStart + 12]
      };
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataStart, dataStart + len);
    } else if (type === 'tRNS') {
      if (!ihdr) throw new Error('PNG 结构异常：tRNS 出现在 IHDR 之前。');
      if (ihdr.colorType === 3) trns = {alphas: bytes.subarray(dataStart, dataStart + len)};
      else if (ihdr.colorType === 0) trns = {gray: (bytes[dataStart] << 8) | bytes[dataStart + 1]};
      else if (ihdr.colorType === 2) {
        trns = {
          r: (bytes[dataStart] << 8) | bytes[dataStart + 1],
          g: (bytes[dataStart + 2] << 8) | bytes[dataStart + 3],
          b: (bytes[dataStart + 4] << 8) | bytes[dataStart + 5]
        };
      }
    } else if (type === 'IDAT') {
      idats.push([dataStart, len]);
      idatLen += len;
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4;
  }
  if (!ihdr) throw new Error('PNG 缺少 IHDR 头部。');
  if (!ihdr.width || !ihdr.height) throw new Error('PNG 尺寸为 0。');
  if (ihdr.compression !== 0) throw new Error('PNG 压缩方法不支持：' + ihdr.compression);
  if (ihdr.filter !== 0) throw new Error('PNG filter 方法不支持：' + ihdr.filter);
  if (ihdr.interlace !== 0) throw new Error('这是隔行扫描（Adam7）的 PNG，暂不支持，请换普通 PNG。');
  var allow = ALLOWED_DEPTH[ihdr.colorType];
  if (!allow) throw new Error('PNG 颜色类型不支持：' + ihdr.colorType);
  if (allow.indexOf(ihdr.bitDepth) < 0) {
    throw new Error('PNG 位深 ' + ihdr.bitDepth + ' 与颜色类型 ' + ihdr.colorType + ' 不匹配。');
  }
  if (ihdr.colorType === 3 && !palette) throw new Error('索引色 PNG 缺少调色板。');
  if (!idats.length) throw new Error('PNG 缺少像素数据（IDAT）。');
  var pixels = ihdr.width * ihdr.height;
  if (opts.maxPixels && pixels > opts.maxPixels) {
    throw new Error('图片太大（' + ihdr.width + '×' + ihdr.height + '），请换小一点的图片。');
  }

  var compressed = idats.length === 1
    ? bytes.subarray(idats[0][0], idats[0][0] + idats[0][1])
    : (function () {
        var buf = new Uint8Array(idatLen);                // 多个 IDAT 要先拼成一条流
        var at = 0;
        for (var i = 0; i < idats.length; i++) {
          buf.set(bytes.subarray(idats[i][0], idats[i][0] + idats[i][1]), at);
          at += idats[i][1];
        }
        return buf;
      })();

  var chans = CHANNELS[ihdr.colorType];
  var bpr = Math.ceil(ihdr.width * chans * ihdr.bitDepth / 8);   // 每行样本字节数
  var bpp = Math.max(1, Math.ceil(chans * ihdr.bitDepth / 8));   // filter 用的像素字节数
  var raw = zlib.inflate(compressed, (bpr + 1) * ihdr.height);
  if (raw.length < (bpr + 1) * ihdr.height) throw new Error('PNG 像素数据不完整。');
  unfilter(raw, ihdr.height, bpr, bpp);
  return {
    width: ihdr.width,
    height: ihdr.height,
    data: toRgba(raw, ihdr.width, ihdr.height, bpr, ihdr.colorType, ihdr.bitDepth, palette, trns),
    bitDepth: ihdr.bitDepth,
    colorType: ihdr.colorType,
    hasAlpha: ihdr.colorType === 4 || ihdr.colorType === 6 || !!trns
  };
}
/* ================= 编码 ================= */

// 按指定 filter 类型过滤一行，结果写入 out
function filterRow(line, prev, bpp, ft, out, hasPrev) {
  var n = line.length;
  var i;
  var a;
  var b;
  if (ft === 0) {
    out.set(line);
  } else if (ft === 1) {
    for (i = 0; i < n; i++) out[i] = (line[i] - (i >= bpp ? line[i - bpp] : 0)) & 0xff;
  } else if (ft === 2) {
    for (i = 0; i < n; i++) out[i] = (line[i] - (hasPrev ? prev[i] : 0)) & 0xff;
  } else if (ft === 3) {
    for (i = 0; i < n; i++) {
      a = i >= bpp ? line[i - bpp] : 0;
      b = hasPrev ? prev[i] : 0;
      out[i] = (line[i] - ((a + b) >> 1)) & 0xff;
    }
  } else {
    for (i = 0; i < n; i++) {
      a = i >= bpp ? line[i - bpp] : 0;
      b = hasPrev ? prev[i] : 0;
      var c = (i >= bpp && hasPrev) ? prev[i - bpp] : 0;
      var pa = b - c < 0 ? c - b : b - c;
      var pb = a - c < 0 ? c - a : a - c;
      var pc = a + b - c - c;
      if (pc < 0) pc = -pc;
      out[i] = (line[i] - ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 0xff;
    }
  }
}

// 把字节当成有符号数求绝对值和，越小说明这行越好压
function scoreRow(buf) {
  var s = 0;
  for (var i = 0; i < buf.length; i++) s += buf[i] < 128 ? buf[i] : 256 - buf[i];
  return s;
}

function makeChunk(type, data) {
  var out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
/**
 * 把 8 位 RGBA 像素编码成无损 PNG。
 * opts.forceAlpha 为真时强制保留 alpha 通道（默认全不透明就丢掉 alpha 省体积）；
 * opts.filter 传 0～4 可固定 filter 类型（大图想快一点就传 1 或 0），默认逐行择优；
 * opts.level 透传给 deflate（0 最快 / 2 默认）。
 */
function encode(rgba, width, height, opts) {
  opts = opts || {};
  if (rgba.length < width * height * 4) throw new Error('像素数据长度与尺寸不符。');
  var hasAlpha = !!opts.forceAlpha;
  if (!hasAlpha) {
    for (var q = 3; q < rgba.length; q += 4) {
      if (rgba[q] !== 255) { hasAlpha = true; break; }
    }
  }
  var chans = hasAlpha ? 4 : 3;
  var bpr = width * chans;
  var raw = new Uint8Array((bpr + 1) * height);
  var line = new Uint8Array(bpr);                 // 当前行原始字节
  var prev = new Uint8Array(bpr);                 // 上一行原始字节
  var cand = new Uint8Array(bpr);                 // filter 候选结果
  var fixed = typeof opts.filter === 'number' ? opts.filter : -1;
  var at = 0;
  for (var y = 0; y < height; y++) {
    var src = y * width * 4;
    var i;
    if (hasAlpha) {
      line.set(rgba.subarray(src, src + bpr));
    } else {
      for (i = 0; i < width; i++) {
        line[i * 3] = rgba[src + i * 4];
        line[i * 3 + 1] = rgba[src + i * 4 + 1];
        line[i * 3 + 2] = rgba[src + i * 4 + 2];
      }
    }
    var bestFt = fixed >= 0 ? fixed : 0;    // 本行最终采用的 filter 类型
    if (fixed >= 0) {
      filterRow(line, prev, chans, fixed, cand, y > 0);
      raw[at] = fixed;
      raw.set(cand, at + 1);
    } else {
      var bestScore = Infinity;
      for (var ft = 0; ft < 5; ft++) {
        filterRow(line, prev, chans, ft, cand, y > 0);
        var score = scoreRow(cand);
        if (score < bestScore) {
          bestScore = score;
          bestFt = ft;
          raw[at] = ft;
          raw.set(cand, at + 1);
        }
      }
    }    prev.set(line);
    at += bpr + 1;
  }
  var idat = zlib.deflate(raw, opts.level === undefined ? 2 : opts.level);
  var ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8;                       // 位深固定 8
  ihdr[9] = hasAlpha ? 6 : 2;        // 颜色类型：RGBA / RGB
  ihdr[10] = 0;                      // 压缩方法 deflate
  ihdr[11] = 0;                      // filter 方法 0
  ihdr[12] = 0;                      // 不隔行
  var parts = [
    new Uint8Array(SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', new Uint8Array(0))
  ];
  var total = 0;
  var k;
  for (k = 0; k < parts.length; k++) total += parts[k].length;
  var out = new Uint8Array(total);
  var off = 0;
  for (k = 0; k < parts.length; k++) {
    out.set(parts[k], off);
    off += parts[k].length;
  }
  return out;
}

/** 只读尺寸，不解像素（用来在解码前判断图片大小） */
function readSize(bytes) {
  if (!isPng(bytes) || bytes.length < 24) return null;
  if (chunkType(bytes, 12) !== 'IHDR') return null;
  return {width: readU32(bytes, 16), height: readU32(bytes, 20)};
}

module.exports = {
  isPng: isPng,
  decode: decode,
  encode: encode,
  readSize: readSize,
  crc32: crc32
};

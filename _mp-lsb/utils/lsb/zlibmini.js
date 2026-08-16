/**
 * zlibmini.js —— 纯 JS 的 DEFLATE 解压 / 压缩（RFC1950 / RFC1951）
 *
 * 小程序里 canvas 的像素往返和 wx.canvasToTempFilePath 都无法保证逐位无损，
 * 所以 PNG 必须自己解、自己编，这个文件是底层的压缩层。
 *   inflate  —— 完整实现，动态 / 固定 / 存储三种块
 *   deflate  —— 固定 Huffman + LZ77（hash chain），压缩率够用且实现短
 * 无任何依赖，可直接 require。
 */
'use strict';

/* ================= 公共表 ================= */

var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43,
  51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
  4, 4, 4, 4, 5, 5, 5, 5, 0];
var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257,
  385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
  9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/* ================= 位读取 ================= */

function BitReader(src) {
  this.src = src;
  this.pos = 0;
  this.acc = 0;
  this.n = 0;
}

BitReader.prototype.need = function (n) {
  while (this.n < n) {
    if (this.pos >= this.src.length) throw new Error('压缩数据提前结束');
    this.acc |= this.src[this.pos++] << this.n;
    this.n += 8;
  }
};

BitReader.prototype.take = function (n) {
  if (n === 0) return 0;
  this.need(n);
  var v = this.acc & ((1 << n) - 1);
  this.acc >>>= n;
  this.n -= n;
  return v;
};

BitReader.prototype.align = function () {
  this.acc = 0;
  this.n = 0;
};

/* ================= Huffman 解码 ================= */

// 规范 Huffman：只存每个码长的符号数量 + 按码长排序的符号表，
// 解码时逐位下降，不建大表，省内存也够快。
function Huffman(lengths, count) {
  var counts = new Int32Array(16);
  var i;
  for (i = 0; i < count; i++) counts[lengths[i]]++;
  counts[0] = 0;
  var offsets = new Int32Array(16);
  var total = 0;
  for (i = 1; i < 16; i++) {
    offsets[i] = total;
    total += counts[i];
  }
  var symbols = new Int32Array(total);
  for (i = 0; i < count; i++) {
    if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  }
  this.counts = counts;
  this.symbols = symbols;
}

function decodeSymbol(reader, table) {
  var code = 0;
  var first = 0;
  var index = 0;
  for (var len = 1; len < 16; len++) {
    code |= reader.take(1);
    var count = table.counts[len];
    if (code - first < count) return table.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('无效的 Huffman 编码');
}

var FIXED_LIT = null;
var FIXED_DIST = null;

function fixedTables() {
  if (FIXED_LIT) return;
  var lit = new Uint8Array(288);
  var i = 0;
  for (; i < 144; i++) lit[i] = 8;
  for (; i < 256; i++) lit[i] = 9;
  for (; i < 280; i++) lit[i] = 7;
  for (; i < 288; i++) lit[i] = 8;
  FIXED_LIT = new Huffman(lit, 288);
  var dist = new Uint8Array(30);
  for (i = 0; i < 30; i++) dist[i] = 5;
  FIXED_DIST = new Huffman(dist, 30);
}

/* ================= 输出缓冲 ================= */

function OutBuffer(hint) {
  this.data = new Uint8Array(Math.max(1024, hint | 0));
  this.len = 0;
}

OutBuffer.prototype.reserve = function (extra) {
  var need = this.len + extra;
  if (need <= this.data.length) return;
  var cap = this.data.length;
  while (cap < need) cap *= 2;
  var next = new Uint8Array(cap);
  next.set(this.data.subarray(0, this.len));
  this.data = next;
};

OutBuffer.prototype.byte = function (b) {
  this.reserve(1);
  this.data[this.len++] = b;
};

OutBuffer.prototype.result = function () {
  return this.data.subarray(0, this.len);
};

/* ================= inflate ================= */

function readDynamicTables(reader) {
  var hlit = reader.take(5) + 257;
  var hdist = reader.take(5) + 1;
  var hclen = reader.take(4) + 4;
  var clen = new Uint8Array(19);
  for (var i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = reader.take(3);
  var clTable = new Huffman(clen, 19);

  var lengths = new Uint8Array(hlit + hdist);
  var pos = 0;
  while (pos < lengths.length) {
    var sym = decodeSymbol(reader, clTable);
    if (sym < 16) {
      lengths[pos++] = sym;
    } else if (sym === 16) {
      if (pos === 0) throw new Error('码长表以重复标记开头');
      var prev = lengths[pos - 1];
      var rep = 3 + reader.take(2);
      while (rep-- > 0 && pos < lengths.length) lengths[pos++] = prev;
    } else if (sym === 17) {
      var r17 = 3 + reader.take(3);
      while (r17-- > 0 && pos < lengths.length) lengths[pos++] = 0;
    } else {
      var r18 = 11 + reader.take(7);
      while (r18-- > 0 && pos < lengths.length) lengths[pos++] = 0;
    }
  }
  return {
    lit: new Huffman(lengths.subarray(0, hlit), hlit),
    dist: new Huffman(lengths.subarray(hlit), hdist)
  };
}

function inflateBlock(reader, out, litTable, distTable) {
  for (;;) {
    var sym = decodeSymbol(reader, litTable);
    if (sym === 256) return;
    if (sym < 256) {
      out.byte(sym);
      continue;
    }
    sym -= 257;
    if (sym >= LEN_BASE.length) throw new Error('无效的长度码 ' + sym);
    var length = LEN_BASE[sym] + reader.take(LEN_EXTRA[sym]);
    var dsym = decodeSymbol(reader, distTable);
    if (dsym >= DIST_BASE.length) throw new Error('无效的距离码 ' + dsym);
    var dist = DIST_BASE[dsym] + reader.take(DIST_EXTRA[dsym]);
    if (dist > out.len) throw new Error('回溯距离超出已解出的数据');
    out.reserve(length);
    var from = out.len - dist;
    var data = out.data;
    for (var i = 0; i < length; i++) data[out.len + i] = data[from + i];
    out.len += length;
  }
}

/** 解压裸 DEFLATE 流。expected 为已知的输出长度（用于预分配，可省略） */
function inflateRaw(src, expected) {
  fixedTables();
  var reader = new BitReader(src);
  var out = new OutBuffer(expected || src.length * 4);
  for (;;) {
    var last = reader.take(1);
    var type = reader.take(2);
    if (type === 0) {
      reader.align();
      if (reader.pos + 4 > src.length) throw new Error('存储块头部不完整');
      var len = src[reader.pos] | (src[reader.pos + 1] << 8);
      reader.pos += 4;
      if (reader.pos + len > src.length) throw new Error('存储块数据不完整');
      out.reserve(len);
      out.data.set(src.subarray(reader.pos, reader.pos + len), out.len);
      out.len += len;
      reader.pos += len;
    } else if (type === 1) {
      inflateBlock(reader, out, FIXED_LIT, FIXED_DIST);
    } else if (type === 2) {
      var t = readDynamicTables(reader);
      inflateBlock(reader, out, t.lit, t.dist);
    } else {
      throw new Error('未知的块类型 3');
    }
    if (last) break;
  }
  return out.result();
}

/** 解压 zlib 容器（RFC1950），PNG 的 IDAT 就是这个格式 */
function inflate(src, expected) {
  if (src.length < 2) throw new Error('zlib 数据过短');
  var cmf = src[0];
  var flg = src[1];
  if ((cmf & 0x0f) !== 8) throw new Error('不支持的压缩方法 ' + (cmf & 0x0f));
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error('zlib 头部校验失败');
  if (flg & 0x20) throw new Error('不支持带预置字典的 zlib 流');
  return inflateRaw(src.subarray(2), expected);
}

/* ================= deflate ================= */

// 固定 Huffman 的字面量/长度码表（RFC1951 3.2.6）。Huffman 码要 MSB 先行写出，
// 而位写入器是 LSB 先行的，所以这里直接存反转后的码值。
var LIT_LEN = new Uint8Array(288);
var LIT_RCODE = new Uint16Array(288);
var DIST_RCODE = new Uint8Array(30);
var LEN_SYM = new Uint8Array(259);
var DIST_SYM = new Uint8Array(32769);

function reverseBits(code, len) {
  var r = 0;
  for (var i = 0; i < len; i++) r |= ((code >> i) & 1) << (len - 1 - i);
  return r;
}

(function buildDeflateTables() {
  var sym;
  for (sym = 0; sym < 288; sym++) {
    var code;
    var len;
    if (sym < 144) { code = 0x30 + sym; len = 8; }
    else if (sym < 256) { code = 0x190 + sym - 144; len = 9; }
    else if (sym < 280) { code = sym - 256; len = 7; }
    else { code = 0xc0 + sym - 280; len = 8; }
    LIT_LEN[sym] = len;
    LIT_RCODE[sym] = reverseBits(code, len);
  }
  for (sym = 0; sym < 30; sym++) DIST_RCODE[sym] = reverseBits(sym, 5);
  for (sym = 0; sym < LEN_BASE.length; sym++) {
    var hi = sym + 1 < LEN_BASE.length ? LEN_BASE[sym + 1] : 259;
    for (var l = LEN_BASE[sym]; l < hi && l < 259; l++) LEN_SYM[l] = sym;
  }
  LEN_SYM[258] = 28;
  for (sym = 0; sym < DIST_BASE.length; sym++) {
    var dhi = sym + 1 < DIST_BASE.length ? DIST_BASE[sym + 1] : 32769;
    for (var d = DIST_BASE[sym]; d < dhi && d < 32769; d++) DIST_SYM[d] = sym;
  }
})();

function BitWriter(hint) {
  this.out = new OutBuffer(hint);
  this.acc = 0;
  this.n = 0;
}

BitWriter.prototype.put = function (v, n) {
  this.acc |= (v << this.n);
  this.n += n;
  while (this.n >= 8) {
    this.out.byte(this.acc & 0xff);
    this.acc >>>= 8;
    this.n -= 8;
  }
};

BitWriter.prototype.finish = function () {
  if (this.n > 0) this.out.byte(this.acc & 0xff);
  this.acc = 0;
  this.n = 0;
  return this.out.result();
};

var HASH_BITS = 15;
var HASH_SIZE = 1 << HASH_BITS;
var HASH_MASK = HASH_SIZE - 1;
var MAX_DIST = 32768;
var MAX_MATCH = 258;
var MIN_MATCH = 3;

function hash3(src, i) {
  return ((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & HASH_MASK;
}

/**
 * 压缩成裸 DEFLATE 流（单个固定 Huffman 块）。
 * level: 0 = 只存字面量（最快，几乎不压缩），1 = 短链，2 = 长链（默认）
 */
function deflateRaw(src, level) {
  var n = src.length;
  var chainLimit = level === 0 ? 0 : level === 1 ? 16 : 128;
  var bw = new BitWriter(Math.max(64, n >> 1));
  bw.put(1, 1);   // BFINAL
  bw.put(1, 2);   // BTYPE = 01 固定 Huffman

  var head = new Int32Array(HASH_SIZE).fill(-1);
  var prev = n ? new Int32Array(n).fill(-1) : null;
  var i = 0;

  function literal(byte) {
    bw.put(LIT_RCODE[byte], LIT_LEN[byte]);
  }

  while (i < n) {
    if (chainLimit === 0 || i + MIN_MATCH > n) {
      literal(src[i++]);
      continue;
    }
    var h = hash3(src, i);
    var best = 0;
    var bestDist = 0;
    var chain = chainLimit;
    var limit = i - MAX_DIST;
    var maxLen = n - i < MAX_MATCH ? n - i : MAX_MATCH;
    var j = head[h];
    while (j > limit && j >= 0 && chain-- > 0) {
      if (src[j + best] === src[i + best]) {
        var len = 0;
        while (len < maxLen && src[j + len] === src[i + len]) len++;
        if (len > best) {
          best = len;
          bestDist = i - j;
          if (len >= maxLen) break;
        }
      }
      j = prev[j];
    }
    prev[i] = head[h];
    head[h] = i;

    if (best >= MIN_MATCH) {
      var lsym = LEN_SYM[best];
      bw.put(LIT_RCODE[257 + lsym], LIT_LEN[257 + lsym]);
      if (LEN_EXTRA[lsym]) bw.put(best - LEN_BASE[lsym], LEN_EXTRA[lsym]);
      var dsym = DIST_SYM[bestDist];
      bw.put(DIST_RCODE[dsym], 5);
      if (DIST_EXTRA[dsym]) bw.put(bestDist - DIST_BASE[dsym], DIST_EXTRA[dsym]);
      // 被匹配吃掉的位置也要入链，否则后面很难再找到长匹配
      for (var k = 1; k < best; k++) {
        var p = i + k;
        if (p + MIN_MATCH > n) break;
        var hk = hash3(src, p);
        prev[p] = head[hk];
        head[hk] = p;
      }
      i += best;
    } else {
      literal(src[i]);
      i++;
    }
  }

  bw.put(LIT_RCODE[256], LIT_LEN[256]);   // 块结束
  return bw.finish();
}

/* ================= zlib 容器 ================= */

/** 全部用存储块输出（不压缩）。噪点很重的图用固定 Huffman 反而会变大，这里兜底 */
function deflateStored(src) {
  var n = src.length;
  var blocks = Math.max(1, Math.ceil(n / 65535));
  var out = new Uint8Array(n + blocks * 5);
  var sp = 0;
  var dp = 0;
  do {
    var len = n - sp;
    if (len > 65535) len = 65535;
    var last = sp + len >= n ? 1 : 0;
    out[dp++] = last;                       // BFINAL, BTYPE=00，其余位补零即字节对齐
    out[dp++] = len & 0xff;
    out[dp++] = (len >>> 8) & 0xff;
    out[dp++] = ~len & 0xff;
    out[dp++] = (~len >>> 8) & 0xff;
    out.set(src.subarray(sp, sp + len), dp);
    dp += len;
    sp += len;
  } while (sp < n);
  return out.subarray(0, dp);
}

function adler32(buf) {
  var a = 1;
  var b = 0;
  var i = 0;
  var n = buf.length;
  while (i < n) {
    var end = i + 5552 < n ? i + 5552 : n;   // 5552 次内不会溢出 32 位
    while (i < end) {
      a += buf[i++];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** 压缩成 zlib 流（RFC1950），PNG 的 IDAT 需要这个格式 */
function deflate(src, level) {
  var body = deflateRaw(src, level === undefined ? 2 : level);
  if (body.length >= src.length + 8) body = deflateStored(src);
  var sum = adler32(src);
  var out = new Uint8Array(2 + body.length + 4);
  out[0] = 0x78;                 // CM=8, CINFO=7（32K 窗口）
  out[1] = 0x01;                 // FCHECK 使 (0x78<<8|0x01) % 31 === 0
  out.set(body, 2);
  var p = 2 + body.length;
  out[p] = (sum >>> 24) & 0xff;
  out[p + 1] = (sum >>> 16) & 0xff;
  out[p + 2] = (sum >>> 8) & 0xff;
  out[p + 3] = sum & 0xff;
  return out;
}

module.exports = {
  inflate: inflate,
  inflateRaw: inflateRaw,
  deflate: deflate,
  deflateRaw: deflateRaw,
  deflateStored: deflateStored,
  adler32: adler32
};

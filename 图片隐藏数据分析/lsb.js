/**
 * lsb.js —— LSB 位平面渲染、统计分析、载荷提取与写入
 * 分析页与写入页共用；载荷格式（LSB1）：
 *   magic 'LSB1'(4) | flags(1) | 载荷长度 uint32 BE(4) | 校验和 uint16 BE(2) | 载荷
 *   flags: bit0 = 使用密码混淆, bit1 = 文件模式（载荷 = 名长(1)+文件名+文件数据）
 * 位写入顺序：按像素光栅顺序 → 选定通道顺序 → 位平面 0..n-1（先低位）；字节内高位先行。
 */
window.LSBKit = (function () {
  'use strict';

  var MAGIC = [0x4c, 0x53, 0x42, 0x31];
  var HEADER = 11;
  var CH_INDEX = { r: 0, g: 1, b: 2, a: 3 };
  var utf8Decode = new TextDecoder('utf-8', { fatal: false });

  function channelList(spec) {
    if (Array.isArray(spec)) return spec.map(function (c) { return CH_INDEX[c]; });
    return spec.split('').map(function (c) { return CH_INDEX[c]; });
  }

  function capacityBits(width, height, channels, bits) {
    return width * height * channelList(channels).length * bits;
  }

  function capacityBytes(width, height, channels, bits) {
    return Math.max(0, Math.floor(capacityBits(width, height, channels, bits) / 8) - HEADER);
  }

  /* ---------------- 位游标 ---------------- */
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

  /* ---------------- 校验和与密码混淆 ---------------- */
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

  /* ---------------- 载荷封装 ---------------- */
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

  function fileEnvelope(name, bytes) {
    var nameBytes = new TextEncoder().encode(name).subarray(0, 255);
    var out = new Uint8Array(1 + nameBytes.length + bytes.length);
    out[0] = nameBytes.length;
    out.set(nameBytes, 1);
    out.set(bytes, 1 + nameBytes.length);
    return out;
  }

  /* ---------------- 写入 ---------------- */
  function embed(imageData, payload, opts) {
    var channels = opts.channels || 'rgb';
    var bits = opts.bits || 1;
    var cap = capacityBytes(imageData.width, imageData.height, channels, bits);
    if (payload.length > cap) {
      return { ok: false, error: '载荷 ' + payload.length + ' 字节超出容量 ' + cap + ' 字节', capacity: cap };
    }
    var out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    var data = out.data;
    if (opts.flattenAlpha) {
      for (var i = 3; i < data.length; i += 4) data[i] = 255;
    }
    var packet = buildPacket(payload, opts);
    if (!writeBits(data, channels, bits, packet)) {
      return { ok: false, error: '像素不足，写入失败', capacity: cap };
    }
    return { ok: true, imageData: out, used: packet.length, capacity: cap, packet: packet };
  }

  /* ---------------- 提取 ---------------- */
  function extract(imageData, opts) {
    var channels = opts.channels || 'rgb';
    var bits = opts.bits || 1;
    var data = imageData.data;
    var head = readBits(data, channels, bits, HEADER);
    if (!head) return { ok: false, reason: 'too-small' };
    for (var i = 0; i < 4; i++) {
      if (head[i] !== MAGIC[i]) return { ok: false, reason: 'no-magic' };
    }
    var flags = head[4];
    var len = ((head[5] << 24) | (head[6] << 16) | (head[7] << 8) | head[8]) >>> 0;
    var sum = (head[9] << 8) | head[10];
    var cap = capacityBytes(imageData.width, imageData.height, channels, bits);
    if (len > cap) return { ok: false, reason: 'bad-length', length: len, capacity: cap };
    var all = readBits(data, channels, bits, HEADER + len);
    if (!all) return { ok: false, reason: 'truncated' };
    var body = all.slice(HEADER);
    var encrypted = !!(flags & 1);
    var isFile = !!(flags & 2);
    if (encrypted) {
      if (!opts.password) {
        return { ok: false, reason: 'need-password', encrypted: true, length: len, channels: channels, bits: bits };
      }
      xorMask(body, opts.password);
    }
    var checksumOk = fletcher16(body) === sum;
    if (!checksumOk && encrypted) {
      return { ok: false, reason: 'bad-password', encrypted: true, length: len, channels: channels, bits: bits };
    }
    var result = {
      ok: true, encrypted: encrypted, isFile: isFile, length: len,
      checksumOk: checksumOk, channels: channels, bits: bits, bytes: body
    };
    if (isFile) {
      var nameLen = body[0];
      result.fileName = utf8Decode.decode(body.subarray(1, 1 + nameLen));
      result.bytes = body.subarray(1 + nameLen);
    } else {
      result.text = utf8Decode.decode(body);
    }
    return result;
  }

  var SNIFF_CONFIGS = (function () {
    // 常见组合优先，其余 rgba 子集兜底；每个组合再试 1~4 位
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
        list.push({ channels: ch, bits: bits });
      });
    });
    return list;
  })();

  function sniff(imageData, password) {
    var found = [];
    for (var i = 0; i < SNIFF_CONFIGS.length; i++) {
      var cfg = SNIFF_CONFIGS[i];
      var res = extract(imageData, { channels: cfg.channels, bits: cfg.bits, password: password });
      if (res.ok || res.reason === 'need-password' || res.reason === 'bad-password') {
        res.config = cfg;
        found.push(res);
        if (res.ok) break;
      }
    }
    return found;
  }

  /* ---------------- 位平面渲染 ---------------- */
  function renderPlane(src, opts) {
    var bit = opts.bit | 0;
    var ch = opts.channel || 'r';
    var mode = opts.mode || 'bw';
    var inv = !!opts.invert;
    var d = src.data;
    var out = new ImageData(src.width, src.height);
    var o = out.data;
    for (var p = 0; p < d.length; p += 4) {
      var v;
      if (ch === 'rgb') {
        o[p] = ((d[p] >> bit) & 1) ? 255 : 0;
        o[p + 1] = ((d[p + 1] >> bit) & 1) ? 255 : 0;
        o[p + 2] = ((d[p + 2] >> bit) & 1) ? 255 : 0;
      } else if (ch === 'gray') {
        var g = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
        v = ((g >> bit) & 1) ? 255 : 0;
        o[p] = o[p + 1] = o[p + 2] = v;
      } else {
        var idx = CH_INDEX[ch] === undefined ? 0 : CH_INDEX[ch];
        v = ((d[p + idx] >> bit) & 1) ? 255 : 0;
        if (mode === 'amplify' && idx < 3) {
          o[p] = idx === 0 ? v : 0;
          o[p + 1] = idx === 1 ? v : 0;
          o[p + 2] = idx === 2 ? v : 0;
        } else {
          o[p] = o[p + 1] = o[p + 2] = v;
        }
      }
      if (inv) {
        o[p] = 255 - o[p];
        o[p + 1] = 255 - o[p + 1];
        o[p + 2] = 255 - o[p + 2];
      }
      o[p + 3] = 255;
    }
    return out;
  }

  /* ---------------- 统计分析 ---------------- */
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
    return { chi: chi, df: df, norm: df ? chi / df : 0 };
  }

  function stats(src) {
    var d = src.data;
    var n = src.width * src.height;
    var hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    var alphaVaries = false;
    var transparent = 0;
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
    return { pixels: n, channels: channels, alphaVaries: alphaVaries, transparent: transparent };
  }

  /* ---------------- 原始位流预览 ---------------- */
  function rawPreview(src, opts) {
    var count = Math.min(opts.count || 512, Math.floor(capacityBits(src.width, src.height, opts.channels || 'rgb', opts.bits || 1) / 8));
    var bytes = readBits(src.data, opts.channels || 'rgb', opts.bits || 1, count);
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
          strings.push({ offset: start, text: String.fromCharCode.apply(null, bytes.subarray(start, i)) });
        }
        start = -1;
      }
    }
    return { bytes: bytes, strings: strings, text: utf8Decode.decode(bytes) };
  }

  return {
    HEADER: HEADER,
    capacityBytes: capacityBytes,
    capacityBits: capacityBits,
    renderPlane: renderPlane,
    stats: stats,
    extract: extract,
    sniff: sniff,
    embed: embed,
    fileEnvelope: fileEnvelope,
    rawPreview: rawPreview,
    readBits: readBits
  };
})();

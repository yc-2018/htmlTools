/**
 * metadata.js —— 图片元数据解析（JPEG / PNG / WebP / GIF / BMP）
 * 纯前端实现：段结构、Exif(TIFF) 标签、GPS、XMP、IPTC、ICC、注释、
 * 文件尾部附加数据与内嵌文件签名扫描。
 */
window.MetaKit = (function () {
  'use strict';

  var utf8 = new TextDecoder('utf-8', { fatal: false });
  var utf16be = new TextDecoder('utf-16be', { fatal: false });
  var CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

  // 逐字节映射成码位（真正的 ISO-8859-1）。不能用 TextDecoder('latin1')：
  // 按规范它其实是 windows-1252，浏览器会把 0x89 解成 U+2030，导致 PNG 签名等
  // 含高位字节的比较全部失配（Node 的实现恰好不这样，只有真实浏览器里才暴露）。
  function str(bytes, start, len) {
    var end = len === undefined ? bytes.length : Math.min(bytes.length, start + len);
    var out = '';
    for (var i = start; i < end; i += 4096) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + 4096)));
    }
    return out;
  }

  function cleanText(text) {
    return String(text).replace(/\0+$/, '').replace(CTRL, ' ').trim();
  }

  function hexDump(bytes, max) {
    var lines = [];
    var limit = Math.min(bytes.length, max || 256);
    for (var i = 0; i < limit; i += 16) {
      var hex = [];
      var ascii = '';
      for (var j = i; j < Math.min(i + 16, limit); j++) {
        hex.push(bytes[j].toString(16).padStart(2, '0'));
        ascii += bytes[j] >= 32 && bytes[j] < 127 ? String.fromCharCode(bytes[j]) : '.';
      }
      lines.push(i.toString(16).padStart(8, '0') + '  ' + hex.join(' ').padEnd(47, ' ') + '  ' + ascii);
    }
    if (bytes.length > limit) lines.push('… 共 ' + bytes.length + ' 字节');
    return lines.join('\n');
  }

  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /* ---------------- Exif / TIFF 标签字典 ---------------- */
  var TIFF_TAGS = {
    0x0100: 'ImageWidth', 0x0101: 'ImageLength', 0x0102: 'BitsPerSample',
    0x0103: 'Compression', 0x0106: 'PhotometricInterpretation',
    0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model',
    0x0112: 'Orientation', 0x0115: 'SamplesPerPixel', 0x011a: 'XResolution',
    0x011b: 'YResolution', 0x011c: 'PlanarConfiguration', 0x0128: 'ResolutionUnit',
    0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x013e: 'WhitePoint',
    0x013f: 'PrimaryChromaticities', 0x0201: 'JPEGInterchangeFormat',
    0x0202: 'JPEGInterchangeFormatLength', 0x0211: 'YCbCrCoefficients',
    0x0212: 'YCbCrSubSampling', 0x0213: 'YCbCrPositioning',
    0x0214: 'ReferenceBlackWhite', 0x8298: 'Copyright', 0x83bb: 'IPTC-NAA',
    0x8769: 'ExifIFDPointer', 0x8773: 'InterColorProfile',
    0x8825: 'GPSInfoIFDPointer', 0x02bc: 'XMP', 0xc4a5: 'PrintIM',
    0x9c9b: 'XPTitle', 0x9c9c: 'XPComment', 0x9c9d: 'XPAuthor',
    0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject'
  };

  var EXIF_TAGS = {
    0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram',
    0x8824: 'SpectralSensitivity', 0x8827: 'ISOSpeedRatings',
    0x8830: 'SensitivityType', 0x8832: 'RecommendedExposureIndex',
    0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
    0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x9101: 'ComponentsConfiguration',
    0x9102: 'CompressedBitsPerPixel', 0x9201: 'ShutterSpeedValue',
    0x9202: 'ApertureValue', 0x9203: 'BrightnessValue', 0x9204: 'ExposureBiasValue',
    0x9205: 'MaxApertureValue', 0x9206: 'SubjectDistance', 0x9207: 'MeteringMode',
    0x9208: 'LightSource', 0x9209: 'Flash', 0x920a: 'FocalLength',
    0x9214: 'SubjectArea', 0x927c: 'MakerNote', 0x9286: 'UserComment',
    0x9290: 'SubSecTime', 0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized',
    0xa000: 'FlashpixVersion', 0xa001: 'ColorSpace', 0xa002: 'ExifImageWidth',
    0xa003: 'ExifImageHeight', 0xa004: 'RelatedSoundFile', 0xa005: 'InteroperabilityPointer',
    0xa20e: 'FocalPlaneXResolution', 0xa20f: 'FocalPlaneYResolution',
    0xa210: 'FocalPlaneResolutionUnit', 0xa217: 'SensingMethod', 0xa300: 'FileSource',
    0xa301: 'SceneType', 0xa302: 'CFAPattern', 0xa401: 'CustomRendered',
    0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa404: 'DigitalZoomRatio',
    0xa405: 'FocalLengthIn35mmFilm', 0xa406: 'SceneCaptureType', 0xa407: 'GainControl',
    0xa408: 'Contrast', 0xa409: 'Saturation', 0xa40a: 'Sharpness',
    0xa40c: 'SubjectDistanceRange', 0xa420: 'ImageUniqueID', 0xa430: 'CameraOwnerName',
    0xa431: 'BodySerialNumber', 0xa432: 'LensSpecification', 0xa433: 'LensMake',
    0xa434: 'LensModel', 0xa435: 'LensSerialNumber', 0xa500: 'Gamma'
  };
  var GPS_TAGS = {
    0x0000: 'GPSVersionID', 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude', 0x0007: 'GPSTimeStamp', 0x0008: 'GPSSatellites',
    0x0009: 'GPSStatus', 0x000a: 'GPSMeasureMode', 0x000b: 'GPSDOP',
    0x000c: 'GPSSpeedRef', 0x000d: 'GPSSpeed', 0x000e: 'GPSTrackRef',
    0x000f: 'GPSTrack', 0x0010: 'GPSImgDirectionRef', 0x0011: 'GPSImgDirection',
    0x0012: 'GPSMapDatum', 0x0013: 'GPSDestLatitudeRef', 0x0014: 'GPSDestLatitude',
    0x0015: 'GPSDestLongitudeRef', 0x0016: 'GPSDestLongitude', 0x001b: 'GPSProcessingMethod',
    0x001c: 'GPSAreaInformation', 0x001d: 'GPSDateStamp', 0x001e: 'GPSDifferential'
  };

  var ENUMS = {
    Orientation: { 1: '正常', 2: '水平翻转', 3: '旋转 180°', 4: '垂直翻转', 5: '转置', 6: '顺时针 90°', 7: '反转置', 8: '逆时针 90°' },
    ResolutionUnit: { 1: '无', 2: '英寸', 3: '厘米' },
    ColorSpace: { 1: 'sRGB', 2: 'Adobe RGB', 65535: '未校准' },
    ExposureProgram: { 0: '未定义', 1: '手动', 2: '程序自动', 3: '光圈优先', 4: '快门优先', 5: '创意', 6: '运动', 7: '人像', 8: '风景' },
    MeteringMode: { 0: '未知', 1: '平均', 2: '中央重点', 3: '点测光', 4: '多点', 5: '多区域评价', 6: '局部' },
    LightSource: { 0: '未知', 1: '日光', 2: '荧光灯', 3: '钨丝灯', 4: '闪光灯', 9: '晴天', 10: '阴天', 11: '阴影' },
    SensingMethod: { 1: '未定义', 2: '单芯片彩色', 3: '双芯片彩色', 4: '三芯片彩色', 7: '三线性', 8: '彩色顺序线性' },
    CustomRendered: { 0: '常规', 1: '自定义处理' },
    ExposureMode: { 0: '自动', 1: '手动', 2: '自动包围' },
    WhiteBalance: { 0: '自动', 1: '手动' },
    SceneCaptureType: { 0: '标准', 1: '风景', 2: '人像', 3: '夜景' },
    GainControl: { 0: '无', 1: '低增益上调', 2: '高增益上调', 3: '低增益下调', 4: '高增益下调' },
    Contrast: { 0: '正常', 1: '柔和', 2: '强烈' },
    Saturation: { 0: '正常', 1: '低', 2: '高' },
    Sharpness: { 0: '正常', 1: '柔和', 2: '强烈' },
    SubjectDistanceRange: { 0: '未知', 1: '微距', 2: '近景', 3: '远景' },
    YCbCrPositioning: { 1: '中心', 2: '共位' },
    FileSource: { 1: '胶片扫描', 2: '反射扫描', 3: '数码相机' },
    SceneType: { 1: '直接拍摄' },
    Compression: { 1: '未压缩', 6: 'JPEG(旧)', 7: 'JPEG', 8: 'Deflate' }
  };

  var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  /* ---------------- TIFF / Exif ---------------- */
  function readValue(view, bytes, little, type, num, off) {
    var vals = [];
    var i;
    if (type === 2) {
      return { text: cleanText(str(bytes, off, num)), vals: [] };
    }
    if (type === 7 || type === 1 || type === 6) {
      for (i = 0; i < num; i++) vals.push(bytes[off + i]);
      return { vals: vals, bytes: bytes.subarray(off, off + num) };
    }
    for (i = 0; i < num; i++) {
      var p = off + i * TYPE_SIZE[type];
      switch (type) {
        case 3: vals.push(view.getUint16(p, little)); break;
        case 4: vals.push(view.getUint32(p, little)); break;
        case 8: vals.push(view.getInt16(p, little)); break;
        case 9: vals.push(view.getInt32(p, little)); break;
        case 11: vals.push(view.getFloat32(p, little)); break;
        case 12: vals.push(view.getFloat64(p, little)); break;
        case 5:
          vals.push([view.getUint32(p, little), view.getUint32(p + 4, little)]);
          break;
        case 10:
          vals.push([view.getInt32(p, little), view.getInt32(p + 4, little)]);
          break;
        default: break;
      }
    }
    return { vals: vals };
  }

  function ratio(v) {
    if (!Array.isArray(v)) return Number(v);
    return v[1] ? v[0] / v[1] : 0;
  }

  function num1(raw) {
    return raw.vals.length ? ratio(raw.vals[0]) : NaN;
  }

  function round(n, d) {
    var f = Math.pow(10, d === undefined ? 2 : d);
    return Math.round(n * f) / f;
  }

  function flashText(v) {
    if (v === undefined) return '';
    var out = [v & 1 ? '已闪光' : '未闪光'];
    if ((v >> 1 & 3) === 2) out.push('回闪未检测到');
    if ((v >> 1 & 3) === 3) out.push('检测到回闪');
    if ((v >> 3 & 3) === 1) out.push('强制闪光');
    if ((v >> 3 & 3) === 2) out.push('禁用闪光');
    if ((v >> 3 & 3) === 3) out.push('自动');
    if (v >> 5 & 1) out.push('无闪光功能');
    if (v >> 6 & 1) out.push('红眼消除');
    return out.join(' / ') + '（0x' + v.toString(16) + '）';
  }
  function decodeUserComment(raw) {
    var b = raw.bytes;
    if (!b || b.length < 8) return '';
    var head = str(b, 0, 8);
    var body = b.subarray(8);
    if (/^ASCII/.test(head)) return cleanText(str(body, 0, body.length));
    if (/^UNICODE/.test(head)) return cleanText(utf16be.decode(body));
    if (/^JIS/.test(head)) return '（JIS 编码，' + body.length + ' 字节）';
    return cleanText(utf8.decode(body));
  }

  function decodeXP(raw) {
    if (!raw.bytes) return '';
    var out = '';
    for (var i = 0; i + 1 < raw.bytes.length; i += 2) {
      var code = raw.bytes[i] | (raw.bytes[i + 1] << 8);
      if (!code) break;
      out += String.fromCharCode(code);
    }
    return out.trim();
  }

  function formatTag(name, raw) {
    if (raw.text !== undefined) return raw.text;
    var vals = raw.vals;
    var first = vals.length ? vals[0] : undefined;
    if (ENUMS[name] && typeof first === 'number' && ENUMS[name][first] !== undefined) {
      return ENUMS[name][first] + '（' + first + '）';
    }
    switch (name) {
      case 'ExposureTime': {
        var t = num1(raw);
        return (t > 0 && t < 1 ? '1/' + Math.round(1 / t) : round(t, 3)) + ' 秒';
      }
      case 'FNumber':
      case 'ApertureValue':
      case 'MaxApertureValue':
        return 'f/' + round(num1(raw));
      case 'FocalLength':
      case 'FocalLengthIn35mmFilm':
        return round(num1(raw), 1) + ' mm';
      case 'ExposureBiasValue': {
        var ev = num1(raw);
        return (ev > 0 ? '+' : '') + round(ev, 2) + ' EV';
      }
      case 'ShutterSpeedValue': {
        var apex = num1(raw);
        var sec = Math.pow(2, -apex);
        return (sec < 1 ? '1/' + Math.round(1 / sec) : round(sec, 2)) + ' 秒';
      }
      case 'Flash':
        return flashText(first);
      case 'UserComment':
        return decodeUserComment(raw) || '（空）';
      case 'MakerNote':
        return '（厂商私有数据 ' + (raw.bytes ? raw.bytes.length : 0) + ' 字节）';
      case 'ExifVersion':
      case 'FlashpixVersion':
        return raw.bytes ? str(raw.bytes, 0, raw.bytes.length) : '';
      case 'ComponentsConfiguration':
        return vals.map(function (v) {
          return ['-', 'Y', 'Cb', 'Cr', 'R', 'G', 'B'][v] || v;
        }).join(' ');
      case 'GPSVersionID':
        return vals.join('.');
      case 'GPSTimeStamp':
        return vals.map(function (v) {
          return String(Math.round(ratio(v))).padStart(2, '0');
        }).join(':') + ' UTC';
      case 'XPTitle':
      case 'XPComment':
      case 'XPAuthor':
      case 'XPKeywords':
      case 'XPSubject':
        return decodeXP(raw);
      default:
        break;
    }
    if (name.indexOf('XResolution') === 0 || name.indexOf('YResolution') === 0) {
      return String(round(num1(raw), 1));
    }
    if (raw.bytes && raw.bytes.length > 64) {
      return '（二进制数据 ' + raw.bytes.length + ' 字节）';
    }
    return vals.map(function (v) {
      return Array.isArray(v) ? (v[1] === 1 ? String(v[0]) : v[0] + '/' + v[1]) : String(round(v, 4));
    }).join(', ');
  }
  function dmsToDeg(raw, ref) {
    if (!raw || raw.vals.length < 1) return null;
    var d = ratio(raw.vals[0]);
    var m = raw.vals.length > 1 ? ratio(raw.vals[1]) : 0;
    var s = raw.vals.length > 2 ? ratio(raw.vals[2]) : 0;
    var deg = d + m / 60 + s / 3600;
    if (ref === 'S' || ref === 'W') deg = -deg;
    return deg;
  }

  function parseTiff(bytes, tiffStart, report, label) {
    if (tiffStart + 8 > bytes.length) return;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var bo = view.getUint16(tiffStart, false);
    var little = bo === 0x4949;
    if (!little && bo !== 0x4d4d) {
      report.warnings.push('Exif 头字节序标记无效，跳过解析');
      return;
    }
    if (view.getUint16(tiffStart + 2, little) !== 42) {
      report.warnings.push('TIFF 魔数不是 42，Exif 可能被改写过');
    }
    report.exifByteOrder = little ? '小端 (II)' : '大端 (MM)';
    var gpsRaw = {};
    var queue = [{ off: view.getUint32(tiffStart + 4, little), group: (label || '') + '主图 IFD0', dict: TIFF_TAGS, chain: true }];
    var visited = {};
    var guard = 0;
    while (queue.length && guard++ < 24) {
      var job = queue.shift();
      if (!job.off || visited[job.off]) continue;
      visited[job.off] = 1;
      var p = tiffStart + job.off;
      if (p + 2 > bytes.length) continue;
      var count = view.getUint16(p, little);
      p += 2;
      for (var i = 0; i < count; i++, p += 12) {
        if (p + 12 > bytes.length) break;
        var tag = view.getUint16(p, little);
        var type = view.getUint16(p + 2, little);
        var num = view.getUint32(p + 4, little);
        var unit = TYPE_SIZE[type];
        if (!unit) continue;
        var size = unit * num;
        if (size > bytes.length) continue;
        var off = size <= 4 ? p + 8 : tiffStart + view.getUint32(p + 8, little);
        if (off < 0 || off + size > bytes.length) continue;
        var isGps = job.dict === GPS_TAGS;
        var name = job.dict[tag] || (isGps ? null : TIFF_TAGS[tag] || EXIF_TAGS[tag]);
        if (!name) name = '未知标签 0x' + tag.toString(16).padStart(4, '0');
        var raw = readValue(view, bytes, little, type, num, off);
        if (tag === 0x8769) {
          queue.push({ off: raw.vals[0], group: (label || '') + 'Exif 子 IFD', dict: EXIF_TAGS });
          continue;
        }
        if (tag === 0x8825) {
          queue.push({ off: raw.vals[0], group: (label || '') + 'GPS IFD', dict: GPS_TAGS });
          continue;
        }
        if (tag === 0xa005) {
          queue.push({ off: raw.vals[0], group: (label || '') + '互操作 IFD', dict: { 1: 'InteroperabilityIndex', 2: 'InteroperabilityVersion' } });
          continue;
        }
        if (tag === 0x02bc && raw.bytes) {
          // TIFF 里的 XMP 是 UTF-8
          report.xmp.push(utf8.decode(raw.bytes));
          continue;
        }
        if (tag === 0x83bb && raw.bytes) {
          parseIptc(raw.bytes, report);
          continue;
        }
        if (isGps) gpsRaw[name] = raw;
        report.tags.push({ group: job.group, name: name, value: formatTag(name, raw) });
      }
      if (job.chain && p + 4 <= bytes.length) {
        var next = view.getUint32(p, little);
        if (next) queue.push({ off: next, group: (label || '') + '缩略图 IFD1', dict: TIFF_TAGS });
      }
    }
    var lat = dmsToDeg(gpsRaw.GPSLatitude, gpsRaw.GPSLatitudeRef && gpsRaw.GPSLatitudeRef.text);
    var lon = dmsToDeg(gpsRaw.GPSLongitude, gpsRaw.GPSLongitudeRef && gpsRaw.GPSLongitudeRef.text);
    if (lat !== null && lon !== null && (lat || lon)) {
      var alt = gpsRaw.GPSAltitude ? ratio(gpsRaw.GPSAltitude.vals[0]) : null;
      var altRef = gpsRaw.GPSAltitudeRef ? gpsRaw.GPSAltitudeRef.vals[0] : 0;
      report.gps = {
        lat: round(lat, 6),
        lon: round(lon, 6),
        alt: alt === null ? null : round(altRef === 1 ? -alt : alt, 1),
        date: gpsRaw.GPSDateStamp ? gpsRaw.GPSDateStamp.text : ''
      };
    }
  }
  /* ---------------- IPTC / Photoshop ---------------- */
  var IPTC_TAGS = {
    5: '标题 (ObjectName)', 10: '紧急度', 15: '类别', 20: '补充类别', 25: '关键词',
    40: '特别说明', 55: '创建日期', 60: '创建时间', 65: '生成程序', 80: '作者 (By-line)',
    85: '作者职务', 90: '城市', 92: '具体地点', 95: '省/州', 100: '国家代码',
    101: '国家', 103: '原始传输参考', 105: '标题行 (Headline)', 110: '供图方 (Credit)',
    115: '来源 (Source)', 116: '版权声明 (Copyright)', 118: '联系方式',
    120: '说明 (Caption)', 122: '撰稿人', 221: 'Photoshop 状态'
  };

  function parseIptcIim(bytes, report) {
    var i = 0;
    var found = 0;
    while (i + 5 <= bytes.length) {
      if (bytes[i] !== 0x1c) { i++; continue; }
      var record = bytes[i + 1];
      var dataset = bytes[i + 2];
      var len = (bytes[i + 3] << 8) | bytes[i + 4];
      i += 5;
      if (len & 0x8000) break;
      if (i + len > bytes.length) break;
      if (record === 2) {
        var name = IPTC_TAGS[dataset] || 'IPTC 2:' + dataset;
        var text = cleanText(utf8.decode(bytes.subarray(i, i + len)));
        if (text) {
          report.iptc.push({ name: name, value: text });
          found++;
        }
      }
      i += len;
    }
    return found;
  }

  function parseIptc(bytes, report) {
    var head = str(bytes, 0, 14);
    if (head.indexOf('Photoshop 3.0') === 0) {
      var p = 14;
      while (p + 12 <= bytes.length) {
        if (str(bytes, p, 4) !== '8BIM') break;
        var id = (bytes[p + 4] << 8) | bytes[p + 5];
        var nameLen = bytes[p + 6];
        var q = p + 7 + nameLen;
        if ((nameLen + 1) % 2) q++;
        if (q + 4 > bytes.length) break;
        var size = (bytes[q] << 24 | bytes[q + 1] << 16 | bytes[q + 2] << 8 | bytes[q + 3]) >>> 0;
        q += 4;
        if (q + size > bytes.length) break;
        if (id === 0x0404) parseIptcIim(bytes.subarray(q, q + size), report);
        if (id === 0x040c) report.photoshop.push('内含 Photoshop 缩略图（' + humanSize(size) + '）');
        if (id === 0x0425) report.photoshop.push('Photoshop 文档 ID');
        p = q + size + (size % 2);
      }
      return;
    }
    parseIptcIim(bytes, report);
  }
  /* ---------------- JPEG ---------------- */
  var JPEG_NAMES = {
    0xc0: 'SOF0 基线 DCT', 0xc1: 'SOF1 扩展顺序', 0xc2: 'SOF2 渐进式 DCT',
    0xc3: 'SOF3 无损', 0xc4: 'DHT 霍夫曼表', 0xc5: 'SOF5', 0xc6: 'SOF6', 0xc7: 'SOF7',
    0xc8: 'JPG', 0xc9: 'SOF9 算术编码', 0xca: 'SOF10', 0xcb: 'SOF11', 0xcc: 'DAC',
    0xcd: 'SOF13', 0xce: 'SOF14', 0xcf: 'SOF15', 0xd9: 'EOI 图像结束',
    0xda: 'SOS 扫描开始', 0xdb: 'DQT 量化表', 0xdc: 'DNL', 0xdd: 'DRI 重启间隔',
    0xde: 'DHP', 0xdf: 'EXP', 0xfe: 'COM 注释'
  };

  function markerName(m) {
    if (JPEG_NAMES[m]) return JPEG_NAMES[m];
    if (m >= 0xe0 && m <= 0xef) return 'APP' + (m - 0xe0);
    return '未知标记';
  }

  function truncate(text, n) {
    text = String(text).replace(/\s+/g, ' ');
    return text.length > (n || 60) ? text.slice(0, n || 60) + '…' : text;
  }

  function handleApp(marker, data, seg, report) {
    var head = str(data, 0, Math.min(40, data.length));
    if (marker === 0xe0 && head.indexOf('JFIF') === 0) {
      seg.note = 'JFIF ' + data[5] + '.' + String(data[6]).padStart(2, '0') +
        '，密度 ' + ((data[8] << 8) | data[9]) + '×' + ((data[10] << 8) | data[11]);
      return;
    }
    if (marker === 0xe1 && head.indexOf('Exif') === 0) {
      seg.note = 'Exif / TIFF 数据块';
      report.hasExif = true;
      parseTiff(data, 6, report, '');
      return;
    }
    if (marker === 0xe1 && head.indexOf('http://ns.adobe.com/xap/1.0/') === 0) {
      seg.note = 'XMP 数据包';
      report.xmp.push(utf8.decode(data.subarray(29)));
      return;
    }
    if (marker === 0xe1 && head.indexOf('http://ns.adobe.com/xmp/extension/') === 0) {
      seg.note = '扩展 XMP 分片';
      report.xmp.push(utf8.decode(data.subarray(75)));
      return;
    }
    if (marker === 0xe2 && head.indexOf('ICC_PROFILE') === 0) {
      seg.note = 'ICC 色彩配置分片 ' + data[12] + '/' + data[13];
      report.icc.push(data.subarray(14));
      return;
    }
    if (marker === 0xe2 && head.indexOf('MPF') === 0) {
      seg.note = 'MPF 多图（可能内嵌另一张 JPEG）';
      return;
    }
    if (marker === 0xed && head.indexOf('Photoshop') === 0) {
      seg.note = 'Photoshop / IPTC 资源块';
      parseIptc(data, report);
      return;
    }
    if (marker === 0xeb || head.indexOf('JUMBF') >= 0 || head.indexOf('c2pa') >= 0 || head.indexOf('jumb') >= 0) {
      seg.note = 'JUMBF / C2PA 内容凭证数据';
      report.c2pa = true;
      return;
    }
    if (marker === 0xee && head.indexOf('Adobe') === 0) {
      seg.note = 'Adobe 色彩变换标记';
      return;
    }
    var printable = cleanText(head);
    seg.note = printable ? '起始标识：' + truncate(printable, 40) : '二进制数据';
  }
  function parseJpeg(bytes, report) {
    report.format = 'JPEG';
    var i = 2;
    report.segments.push({ name: 'SOI 图像开始', marker: 'FFD8', offset: 0, size: 2, note: '' });
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xff) {
        report.warnings.push('偏移 0x' + i.toString(16) + ' 处段结构异常，停止解析段');
        break;
      }
      var m = bytes[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m === 0xd9) {
        report.segments.push({ name: 'EOI 图像结束', marker: 'FFD9', offset: i, size: 2, note: '' });
        report.imageEnd = i + 2;
        break;
      }
      var len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) {
        report.warnings.push('偏移 0x' + i.toString(16) + ' 处段长度非法');
        break;
      }
      var dataStart = i + 4;
      var dataEnd = Math.min(dataStart + len - 2, bytes.length);
      var data = bytes.subarray(dataStart, dataEnd);
      var seg = {
        name: markerName(m),
        marker: 'FF' + m.toString(16).toUpperCase().padStart(2, '0'),
        offset: i,
        size: len + 2,
        note: ''
      };
      if (m >= 0xe0 && m <= 0xef) {
        handleApp(m, data, seg, report);
      } else if (m === 0xfe) {
        var comment = cleanText(utf8.decode(data));
        if (comment) report.comments.push(comment);
        seg.note = comment ? '“' + truncate(comment) + '”' : '空注释';
      } else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        report.bitDepth = data[0];
        report.height = (data[1] << 8) | data[2];
        report.width = (data[3] << 8) | data[4];
        report.progressive = m === 0xc2;
        seg.note = report.width + '×' + report.height + '，' + data[5] + ' 个分量，精度 ' + data[0] + ' bit';
      }
      report.segments.push(seg);
      if (m === 0xda) {
        var scanStart = dataEnd;
        var eoi = -1;
        for (var k = scanStart; k + 1 < bytes.length; k++) {
          if (bytes[k] === 0xff && bytes[k + 1] === 0xd9) { eoi = k; break; }
        }
        seg.note = '压缩数据从 0x' + scanStart.toString(16) +
          (eoi >= 0 ? ' 到 0x' + eoi.toString(16) : '（未找到 EOI）');
        report.imageEnd = eoi >= 0 ? eoi + 2 : bytes.length;
        if (eoi < 0) report.warnings.push('未找到 EOI(FFD9) 结束标记，文件可能被截断');
        break;
      }
      i = dataEnd;
    }
  }
  /* ---------------- PNG ---------------- */
  var PNG_DESC = {
    IHDR: '图像头', PLTE: '调色板', IDAT: '像素数据', IEND: '结束',
    tRNS: '透明度', cHRM: '色度', gAMA: 'Gamma', iCCP: 'ICC 配置',
    sBIT: '有效位', sRGB: 'sRGB 意图', tEXt: '文本', zTXt: '压缩文本',
    iTXt: '国际化文本', bKGD: '背景色', hIST: '直方图', pHYs: '物理尺寸',
    sPLT: '建议调色板', tIME: '修改时间', eXIf: 'Exif 数据',
    acTL: 'APNG 动画控制', fcTL: 'APNG 帧控制', fdAT: 'APNG 帧数据',
    caBX: 'C2PA 内容凭证'
  };
  var PNG_COLOR = { 0: '灰度', 2: '真彩色 RGB', 3: '索引色', 4: '灰度+Alpha', 6: '真彩色+Alpha' };

  async function inflate(bytes, raw) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      var stream = new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream(raw ? 'deflate-raw' : 'deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  function splitNul(bytes, from, max) {
    for (var i = from; i < bytes.length && (max === undefined || i - from < max); i++) {
      if (bytes[i] === 0) return i;
    }
    return -1;
  }

  async function parsePng(bytes, report) {
    report.format = 'PNG';
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var i = 8;
    var idat = { count: 0, size: 0, offset: 0 };
    while (i + 8 <= bytes.length) {
      var len = view.getUint32(i);
      var type = str(bytes, i + 4, 4);
      if (!/^[a-zA-Z]{4}$/.test(type) || i + 12 + len > bytes.length + 4) {
        report.warnings.push('偏移 0x' + i.toString(16) + ' 处 chunk 结构异常');
        break;
      }
      var ds = i + 8;
      var data = bytes.subarray(ds, Math.min(ds + len, bytes.length));
      var seg = {
        name: type + (PNG_DESC[type] ? ' ' + PNG_DESC[type] : ''),
        marker: type,
        offset: i,
        size: len + 12,
        note: ''
      };
      if (type === 'IHDR') {
        report.width = view.getUint32(ds);
        report.height = view.getUint32(ds + 4);
        report.bitDepth = data[8];
        report.colorType = data[9];
        report.interlace = data[12];
        seg.note = report.width + '×' + report.height + '，' + (PNG_COLOR[data[9]] || '类型' + data[9]) +
          '，' + data[8] + ' bit' + (data[12] ? '，Adam7 隔行' : '');
      } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        await readPngText(type, data, report, seg);
      } else if (type === 'eXIf') {
        report.hasExif = true;
        seg.note = 'Exif / TIFF 数据块';
        parseTiff(data, 0, report, '');
      } else if (type === 'iCCP') {
        var nul = splitNul(data, 0, 80);
        seg.note = 'ICC 配置：' + (nul > 0 ? cleanText(str(data, 0, nul)) : '未命名');
      } else if (type === 'tIME') {
        seg.note = view.getUint16(ds) + '-' + String(data[2]).padStart(2, '0') + '-' +
          String(data[3]).padStart(2, '0') + ' ' + String(data[4]).padStart(2, '0') + ':' +
          String(data[5]).padStart(2, '0') + ':' + String(data[6]).padStart(2, '0');
        report.tags.push({ group: 'PNG', name: '修改时间 (tIME)', value: seg.note });
      } else if (type === 'pHYs') {
        seg.note = view.getUint32(ds) + '×' + view.getUint32(ds + 4) +
          (data[8] === 1 ? ' 像素/米' : ' 像素/单位');
      } else if (type === 'gAMA') {
        seg.note = 'Gamma ' + view.getUint32(ds) / 100000;
      } else if (type === 'caBX') {
        report.c2pa = true;
        seg.note = 'C2PA / JUMBF 内容凭证';
      } else if (type === 'IDAT') {
        idat.count++;
        idat.size += len;
        if (!idat.offset) idat.offset = i;
      }
      if (type !== 'IDAT') report.segments.push(seg);
      if (type === 'IEND') {
        report.imageEnd = i + 12;
        break;
      }
      i = ds + len + 4;
    }
    if (idat.count) {
      report.segments.push({
        name: 'IDAT 像素数据 ×' + idat.count,
        marker: 'IDAT',
        offset: idat.offset,
        size: idat.size,
        note: '压缩像素数据合计 ' + humanSize(idat.size)
      });
    }
    if (!report.imageEnd) report.warnings.push('未找到 IEND，PNG 可能被截断');
  }
  async function readPngText(type, data, report, seg) {
    var nul = splitNul(data, 0, 80);
    if (nul < 0) { seg.note = '格式异常'; return; }
    var keyword = cleanText(str(data, 0, nul));
    var value = '';
    var extra = '';
    if (type === 'tEXt') {
      value = cleanText(utf8.decode(data.subarray(nul + 1)));
    } else if (type === 'zTXt') {
      var out = await inflate(data.subarray(nul + 2));
      value = out ? cleanText(utf8.decode(out)) : '（zlib 解压失败）';
      extra = '压缩';
    } else {
      var compressed = data[nul + 1] === 1;
      var langEnd = splitNul(data, nul + 3, 60);
      var transEnd = langEnd < 0 ? -1 : splitNul(data, langEnd + 1, 200);
      var textStart = transEnd < 0 ? nul + 3 : transEnd + 1;
      var body = data.subarray(textStart);
      if (compressed) {
        var inflated = await inflate(body);
        value = inflated ? cleanText(utf8.decode(inflated)) : '（zlib 解压失败）';
        extra = '压缩 UTF-8';
      } else {
        value = cleanText(utf8.decode(body));
        extra = 'UTF-8';
      }
      var lang = langEnd > nul + 3 ? cleanText(str(data, nul + 3, langEnd - nul - 3)) : '';
      if (lang) extra += ' / ' + lang;
    }
    seg.note = keyword + (extra ? '（' + extra + '）' : '') + '：' + truncate(value, 50);
    report.textChunks.push({ keyword: keyword || '(无关键字)', value: value, kind: type });
    if (/xmp/i.test(keyword) || /<x:xmpmeta/.test(value)) report.xmp.push(value);
  }

  /* ---------------- WebP / GIF / BMP ---------------- */
  function parseWebp(bytes, report) {
    report.format = 'WebP';
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var i = 12;
    while (i + 8 <= bytes.length) {
      var type = str(bytes, i, 4);
      var len = view.getUint32(i + 4, true);
      var ds = i + 8;
      var data = bytes.subarray(ds, Math.min(ds + len, bytes.length));
      var seg = { name: type.trim(), marker: type.trim(), offset: i, size: len + 8, note: '' };
      if (type === 'VP8X') {
        seg.note = '扩展格式：' +
          [(data[0] & 2 ? 'ICC' : ''), (data[0] & 8 ? 'Alpha' : ''),
            (data[0] & 4 ? 'Exif' : ''), (data[0] & 1 ? 'XMP' : ''),
            (data[0] & 16 ? '动画' : '')].filter(Boolean).join(' / ');
        report.width = (data[4] | data[5] << 8 | data[6] << 16) + 1;
        report.height = (data[7] | data[8] << 8 | data[9] << 16) + 1;
      } else if (type === 'EXIF') {
        report.hasExif = true;
        seg.note = 'Exif 数据块';
        var skip = str(data, 0, 6).indexOf('Exif') === 0 ? 6 : 0;
        parseTiff(data, skip, report, '');
      } else if (type === 'XMP ') {
        seg.note = 'XMP 数据包';
        report.xmp.push(utf8.decode(data));
      } else if (type === 'ICCP') {
        report.icc.push(data);
        seg.note = 'ICC 配置 ' + humanSize(len);
      } else if (type === 'VP8 ' || type === 'VP8L') {
        seg.note = '图像数据 ' + humanSize(len);
      } else if (type === 'ANMF') {
        report.animFrames = (report.animFrames || 0) + 1;
      }
      report.segments.push(seg);
      i = ds + len + (len % 2);
    }
    if (report.animFrames) {
      report.tags.push({ group: 'WebP', name: '动画帧数', value: String(report.animFrames) });
    }
    report.imageEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));
  }
  function parseGif(bytes, report) {
    report.format = 'GIF';
    report.width = bytes[6] | (bytes[7] << 8);
    report.height = bytes[8] | (bytes[9] << 8);
    report.segments.push({
      name: '文件头 ' + str(bytes, 0, 6), marker: 'HEAD', offset: 0, size: 13,
      note: report.width + '×' + report.height
    });
    var i = 13;
    if (bytes[10] & 0x80) i += 3 * Math.pow(2, (bytes[10] & 7) + 1);
    var frames = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      if (b === 0x3b) {
        report.imageEnd = i + 1;
        break;
      }
      if (b === 0x21) {
        var label = bytes[i + 1];
        var p = i + 2;
        var chunks = [];
        while (p < bytes.length && bytes[p]) {
          chunks.push(bytes.subarray(p + 1, p + 1 + bytes[p]));
          p += bytes[p] + 1;
        }
        var total = chunks.reduce(function (n, c) { return n + c.length; }, 0);
        var merged = new Uint8Array(total);
        var at = 0;
        chunks.forEach(function (c) { merged.set(c, at); at += c.length; });
        var text = cleanText(utf8.decode(merged));
        var names = { 0xf9: '图形控制扩展', 0xfe: '注释扩展', 0x01: '纯文本扩展', 0xff: '应用扩展' };
        var seg = {
          name: (names[label] || '扩展 0x' + label.toString(16)), marker: '21' + label.toString(16),
          offset: i, size: p + 1 - i, note: label === 0xf9 ? '' : truncate(text, 60)
        };
        report.segments.push(seg);
        if (label === 0xfe && text) report.comments.push(text);
        i = p + 1;
        continue;
      }
      if (b === 0x2c) {
        frames++;
        var q = i + 10;
        if (bytes[q - 1] & 0x80) q += 3 * Math.pow(2, (bytes[q - 1] & 7) + 1);
        q++;
        while (q < bytes.length && bytes[q]) q += bytes[q] + 1;
        i = q + 1;
        continue;
      }
      i++;
    }
    if (frames) {
      report.segments.push({ name: '图像块 ×' + frames, marker: '2C', offset: 0, size: 0, note: '帧数据' });
    }
  }

  function parseBmp(bytes, report) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    report.format = 'BMP';
    report.width = view.getInt32(18, true);
    report.height = Math.abs(view.getInt32(22, true));
    report.bitDepth = view.getUint16(28, true);
    report.imageEnd = Math.min(bytes.length, view.getUint32(2, true));
    report.segments.push({
      name: 'BITMAPFILEHEADER', marker: 'BM', offset: 0, size: 14,
      note: '声明文件大小 ' + humanSize(view.getUint32(2, true))
    });
    report.segments.push({
      name: 'DIB 信息头', marker: 'DIB', offset: 14, size: view.getUint32(14, true),
      note: report.width + '×' + report.height + '，' + report.bitDepth + ' bit'
    });
  }
  /* ---------------- 内嵌文件签名 / 字符串 ---------------- */
  var SIGS = [
    { name: 'ZIP / Office / APK 压缩包', hex: '504b0304' },
    { name: 'ZIP 空归档', hex: '504b0506' },
    { name: 'RAR 压缩包', hex: '526172211a07' },
    { name: '7-Zip 压缩包', hex: '377abcaf271c' },
    { name: 'GZIP 数据', hex: '1f8b08' },
    { name: 'BZip2 数据', hex: '425a68' },
    { name: 'PDF 文档', hex: '25504446' },
    { name: 'PNG 图片', hex: '89504e470d0a1a0a' },
    { name: 'JPEG 图片', hex: 'ffd8ffe0' },
    { name: 'JPEG 图片', hex: 'ffd8ffe1' },
    { name: 'JPEG 图片', hex: 'ffd8ffdb' },
    { name: 'GIF 图片', hex: '474946383961' },
    { name: 'MP4 / MOV 视频 (ftyp)', hex: '66747970' },
    { name: 'MP3 音频 (ID3)', hex: '494433' },
    { name: 'RIFF 容器 (WAV/AVI/WebP)', hex: '52494646' },
    { name: 'ELF 可执行文件', hex: '7f454c46' },
    { name: 'Windows PE (MZ)', hex: '4d5a90' },
    { name: 'SQLite 数据库', hex: '53514c69746520' },
    { name: 'PEM 密钥/证书', hex: '2d2d2d2d2d424547494e' }
  ];

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function indexOfBytes(hay, needle, from) {
    outer:
    for (var i = from; i + needle.length <= hay.length; i++) {
      for (var j = 0; j < needle.length; j++) {
        if (hay[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  function scanSignatures(bytes, report) {
    var hits = [];
    SIGS.forEach(function (sig) {
      var needle = hexToBytes(sig.hex);
      var from = 1;
      var guard = 0;
      while (hits.length < 24 && guard++ < 40) {
        var at = indexOfBytes(bytes, needle, from);
        if (at < 0) break;
        // ftyp 的签名从 box 起始偏移 +4，做一次修正
        var offset = sig.hex === '66747970' ? Math.max(0, at - 4) : at;
        hits.push({ name: sig.name, offset: offset, inTrailing: report.imageEnd ? offset >= report.imageEnd : false });
        from = at + needle.length;
      }
    });
    hits.sort(function (a, b) { return a.offset - b.offset; });
    return hits.slice(0, 24);
  }

  function extractStrings(bytes, minLen, limit) {
    var out = [];
    var seen = {};
    var start = -1;
    for (var i = 0; i <= bytes.length; i++) {
      var c = i < bytes.length ? bytes[i] : 0;
      var printable = c === 9 || (c >= 32 && c < 127);
      if (printable) {
        if (start < 0) start = i;
        continue;
      }
      if (start >= 0 && i - start >= minLen) {
        var text = str(bytes, start, i - start).trim();
        var letters = (text.match(/[A-Za-z0-9 ._:/\\-]/g) || []).length;
        if (/[A-Za-z]{4}/.test(text) && letters / text.length > 0.8 && !seen[text]) {
          seen[text] = 1;
          out.push({ offset: start, text: text });
          if (out.length >= limit) return out;
        }
      }
      start = -1;
    }
    return out;
  }
  /* ---------------- XMP ---------------- */
  var XMP_FIELDS = [
    ['dc:title', '标题'], ['dc:description', '描述'], ['dc:creator', '作者'],
    ['dc:rights', '版权'], ['dc:subject', '关键词'], ['xmp:CreatorTool', '创作工具'],
    ['xmp:CreateDate', '创建时间'], ['xmp:ModifyDate', '修改时间'],
    ['photoshop:Credit', '供图方'], ['photoshop:Source', '来源'],
    ['photoshop:DateCreated', '拍摄日期'], ['xmpRights:Marked', '版权标记'],
    ['xmpRights:WebStatement', '版权声明网址'], ['xmpRights:UsageTerms', '使用条款'],
    ['xmpMM:DocumentID', '文档 ID'], ['xmpMM:OriginalDocumentID', '原始文档 ID'],
    ['xmpMM:InstanceID', '实例 ID'], ['tiff:Make', '厂商'], ['tiff:Model', '型号'],
    ['exif:GPSLatitude', 'XMP 纬度'], ['exif:GPSLongitude', 'XMP 经度'],
    ['GCamera:MicroVideoOffset', '实况视频偏移'], ['GCamera:MotionPhoto', '动态照片标记'],
    ['Camera:MotionPhoto', '动态照片标记'], ['digitalSourceType', '数字来源类型'],
    ['Iptc4xmpExt:DigitalSourceType', '数字来源类型']
  ];

  function decodeEntities(text) {
    return String(text)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function xmpValue(xml, key) {
    var esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var m = new RegExp(esc + '\\s*=\\s*"([^"]*)"').exec(xml);
    if (m && m[1]) return decodeEntities(m[1]);
    m = new RegExp('<' + esc + '[^>]*>([\\s\\S]*?)</' + esc + '>').exec(xml);
    if (m) {
      var lis = m[1].match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g);
      if (lis) {
        return lis.map(function (li) {
          return decodeEntities(li.replace(/<[^>]+>/g, ''));
        }).filter(Boolean).join('；');
      }
      return decodeEntities(m[1].replace(/<[^>]+>/g, ''));
    }
    return '';
  }

  var AI_TOOLS = /(stable diffusion|automatic1111|comfyui|midjourney|dall[·\-\s]?e|firefly|nano ?banana|imagen|gemini|sora|flux|novelai|wanx|通义万相|即梦|文心一格|可灵|liblib|sdxl|dreamstudio)/i;

  function detectAi(report) {
    var xml = report.xmp.join('\n');
    var hints = [];
    if (/compositeWithTrainedAlgorithmicMedia/i.test(xml)) {
      hints.push('XMP 标注含 AI 生成成分（compositeWithTrainedAlgorithmicMedia）');
    } else if (/trainedAlgorithmicMedia/i.test(xml)) {
      hints.push('XMP digitalSourceType 标注为 AI 生成（trainedAlgorithmicMedia）');
    }
    if (report.c2pa) hints.push('存在 C2PA / JUMBF 内容凭证，可用官方校验器查看来源链');
    report.textChunks.forEach(function (t) {
      if (/^parameters$/i.test(t.keyword)) hints.push('PNG 文本块 parameters：Stable Diffusion WebUI 生成参数');
      if (/^(prompt|workflow)$/i.test(t.keyword)) hints.push('PNG 文本块 ' + t.keyword + '：ComfyUI 工作流数据');
      if (/^(sd-metadata|invokeai_metadata|Dream)$/i.test(t.keyword)) hints.push('PNG 文本块 ' + t.keyword + '：AI 绘图元数据');
    });
    var toolText = [xmpValue(xml, 'xmp:CreatorTool'), findTag(report, ['Software']), report.textChunks.map(function (t) { return t.value; }).join(' ')].join(' ');
    var m = AI_TOOLS.exec(toolText);
    if (m) hints.push('元数据中出现 AI 工具关键字：' + m[0]);
    return hints;
  }

  function findTag(report, names) {
    for (var i = 0; i < report.tags.length; i++) {
      if (names.indexOf(report.tags[i].name) >= 0 && report.tags[i].value) return report.tags[i].value;
    }
    return '';
  }
  /* ---------------- 概要 ---------------- */
  function iptcValue(report, keyPart) {
    for (var i = 0; i < report.iptc.length; i++) {
      if (report.iptc[i].name.indexOf(keyPart) >= 0) return report.iptc[i].value;
    }
    return '';
  }

  function buildSummary(report) {
    var xml = report.xmp.join('\n');
    var rows = [];
    function add(name, value, level) {
      if (value) rows.push({ name: name, value: value, level: level || '' });
    }
    add('版权 (Copyright)', findTag(report, ['Copyright']) || xmpValue(xml, 'dc:rights') ||
      iptcValue(report, '版权声明'), 'info');
    add('作者 / 拍摄者', findTag(report, ['Artist', 'XPAuthor', 'CameraOwnerName']) ||
      xmpValue(xml, 'dc:creator') || iptcValue(report, '作者 (By-line)'), 'info');
    add('使用条款', xmpValue(xml, 'xmpRights:UsageTerms') || xmpValue(xml, 'xmpRights:WebStatement'), 'info');
    var make = findTag(report, ['Make']);
    var model = findTag(report, ['Model']);
    add('拍摄设备', [make, model].filter(Boolean).join(' '));
    add('镜头', findTag(report, ['LensModel', 'LensMake']));
    add('拍摄时间', findTag(report, ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']) ||
      xmpValue(xml, 'xmp:CreateDate'));
    add('修改软件', findTag(report, ['Software']) || xmpValue(xml, 'xmp:CreatorTool'), 'warn');
    if (report.gps) {
      add('GPS 定位', report.gps.lat + ', ' + report.gps.lon +
        (report.gps.alt !== null ? '（海拔 ' + report.gps.alt + ' m）' : ''), 'bad');
    }
    var serial = findTag(report, ['BodySerialNumber', 'LensSerialNumber', 'ImageUniqueID']);
    add('设备序列号 / 唯一 ID', serial, 'bad');
    add('图像描述', findTag(report, ['ImageDescription', 'XPTitle', 'XPComment']) ||
      xmpValue(xml, 'dc:description') || xmpValue(xml, 'dc:title'));
    add('关键词', findTag(report, ['XPKeywords']) || xmpValue(xml, 'dc:subject') || iptcValue(report, '关键词'));
    add('数字来源类型', xmpValue(xml, 'digitalSourceType') || xmpValue(xml, 'Iptc4xmpExt:DigitalSourceType'), 'warn');
    add('动态照片 (实况)', xmpValue(xml, 'GCamera:MicroVideoOffset') ||
      xmpValue(xml, 'GCamera:MotionPhoto') || xmpValue(xml, 'Camera:MotionPhoto'), 'info');
    return rows;
  }

  function privacyNotes(report) {
    var notes = [];
    if (report.gps) notes.push('图片带有 GPS 坐标，直接分享会暴露拍摄地点。');
    if (findTag(report, ['BodySerialNumber', 'LensSerialNumber'])) notes.push('包含相机/镜头序列号，可用于关联同一台设备拍摄的其他照片。');
    if (findTag(report, ['CameraOwnerName', 'Artist', 'XPAuthor'])) notes.push('包含拍摄者姓名字段。');
    if (report.trailing && report.trailing.size > 0) notes.push('图像结束标记之后还有 ' + humanSize(report.trailing.size) + ' 额外数据，常见于隐藏文件、实况视频或水印工具。');
    if (report.embedded.some(function (e) { return e.inTrailing; })) notes.push('尾部数据里出现了完整文件的签名，可尝试改扩展名或用解压工具提取。');
    return notes;
  }
  /* ---------------- 入口 ---------------- */
  function detectFormat(bytes) {
    if (bytes.length < 12) return '文件过小';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
    if (str(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'PNG';
    if (str(bytes, 0, 4) === 'RIFF' && str(bytes, 8, 4) === 'WEBP') return 'WebP';
    if (str(bytes, 0, 4) === 'GIF8') return 'GIF';
    if (str(bytes, 0, 2) === 'BM') return 'BMP';
    if (str(bytes, 0, 4) === 'II*\0' || str(bytes, 0, 4) === 'MM\0*') return 'TIFF';
    var brand = str(bytes, 4, 8);
    if (brand.indexOf('ftyp') === 0) {
      var sub = str(bytes, 8, 4);
      if (/heic|heix|hevc|mif1|msf1/.test(sub)) return 'HEIC';
      if (/avif|avis/.test(sub)) return 'AVIF';
      return 'ISO BMFF';
    }
    return '未知';
  }

  async function parse(buffer, file) {
    var bytes = new Uint8Array(buffer);
    var report = {
      fileName: file ? file.name : '',
      fileSize: bytes.length,
      fileType: file ? file.type : '',
      lastModified: file && file.lastModified ? new Date(file.lastModified) : null,
      format: detectFormat(bytes),
      width: 0, height: 0, bitDepth: 0, colorType: null, interlace: 0,
      progressive: false, hasExif: false, c2pa: false, exifByteOrder: '',
      segments: [], tags: [], iptc: [], xmp: [], icc: [], comments: [],
      textChunks: [], photoshop: [], warnings: [], embedded: [], strings: [],
      gps: null, imageEnd: 0, trailing: null
    };
    try {
      if (report.format === 'JPEG') parseJpeg(bytes, report);
      else if (report.format === 'PNG') await parsePng(bytes, report);
      else if (report.format === 'WebP') parseWebp(bytes, report);
      else if (report.format === 'GIF') parseGif(bytes, report);
      else if (report.format === 'BMP') parseBmp(bytes, report);
      else if (report.format === 'TIFF') {
        report.hasExif = true;
        parseTiff(bytes, 0, report, '');
        report.imageEnd = bytes.length;
      } else {
        report.warnings.push(report.format + ' 格式暂不支持段级解析，仅做尾部数据与字符串扫描。');
      }
    } catch (err) {
      report.warnings.push('解析中断：' + err.message);
    }
    if (report.imageEnd && bytes.length > report.imageEnd) {
      var extra = bytes.subarray(report.imageEnd);
      report.trailing = {
        offset: report.imageEnd,
        size: extra.length,
        dump: hexDump(extra, 512),
        text: cleanText(utf8.decode(extra.subarray(0, 400)))
      };
    }
    report.embedded = scanSignatures(bytes, report);
    report.strings = extractStrings(bytes, 14, 40);
    report.xmpFields = [];
    var xml = report.xmp.join('\n');
    XMP_FIELDS.forEach(function (pair) {
      var v = xmpValue(xml, pair[0]);
      if (v) report.xmpFields.push({ name: pair[1] + ' (' + pair[0] + ')', value: v });
    });
    report.aiHints = detectAi(report);
    report.summary = buildSummary(report);
    report.privacy = privacyNotes(report);
    report.segments.sort(function (a, b) { return a.offset - b.offset; });
    return report;
  }

  return {
    parse: parse,
    humanSize: humanSize,
    hexDump: hexDump,
    truncate: truncate,
    cleanText: cleanText
  };
})();

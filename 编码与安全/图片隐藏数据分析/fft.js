/**
 * fft.js —— 二维快速傅里叶变换与频谱可视化（检测频域盲水印）
 * 输入正方形 ImageData（边长为 2 的幂），输出对数幅度谱、fftshift 后的图像与可疑峰值。
 */
window.FFTKit = (function () {
  'use strict';

  function transform(re, im) {
    var n = re.length;
    var i, j, bit;
    for (i = 1, j = 0; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var half = len >> 1;
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang);
      var wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1;
        var ci = 0;
        for (var k = 0; k < half; k++) {
          var ar = re[i + k];
          var ai = im[i + k];
          var br = re[i + k + half];
          var bi = im[i + k + half];
          var vr = br * cr - bi * ci;
          var vi = br * ci + bi * cr;
          re[i + k] = ar + vr;
          im[i + k] = ai + vi;
          re[i + k + half] = ar - vr;
          im[i + k + half] = ai - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  function toPlane(imageData, channel) {
    var size = imageData.width;
    var d = imageData.data;
    var out = new Float64Array(size * size);
    var sum = 0;
    for (var i = 0, p = 0; i < out.length; i++, p += 4) {
      var v;
      if (channel === 'r') v = d[p];
      else if (channel === 'g') v = d[p + 1];
      else if (channel === 'b') v = d[p + 2];
      else v = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
      out[i] = v;
      sum += v;
    }
    var mean = sum / out.length;
    for (var k = 0; k < out.length; k++) out[k] -= mean;
    return out;
  }

  /**
   * 计算 fftshift 之后的对数幅度谱。
   * @returns {{size:number, log:Float32Array, max:number, min:number}}
   */
  function spectrum(imageData, channel) {
    var size = imageData.width;
    var re = toPlane(imageData, channel);
    var im = new Float64Array(size * size);
    var rowR = new Float64Array(size);
    var rowI = new Float64Array(size);
    var y, x, i;
    for (y = 0; y < size; y++) {
      var off = y * size;
      for (x = 0; x < size; x++) {
        rowR[x] = re[off + x];
        rowI[x] = im[off + x];
      }
      transform(rowR, rowI);
      for (x = 0; x < size; x++) {
        re[off + x] = rowR[x];
        im[off + x] = rowI[x];
      }
    }
    for (x = 0; x < size; x++) {
      for (y = 0; y < size; y++) {
        rowR[y] = re[y * size + x];
        rowI[y] = im[y * size + x];
      }
      transform(rowR, rowI);
      for (y = 0; y < size; y++) {
        re[y * size + x] = rowR[y];
        im[y * size + x] = rowI[y];
      }
    }
    var half = size >> 1;
    var log = new Float32Array(size * size);
    var max = -Infinity;
    var min = Infinity;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        i = y * size + x;
        var mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
        var v = Math.log(1 + mag);
        // fftshift：把零频移到中心
        var sy = (y + half) % size;
        var sx = (x + half) % size;
        log[sy * size + sx] = v;
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    return { size: size, log: log, max: max, min: min };
  }

  var HEAT = [
    [0, 0, 8], [22, 8, 76], [70, 8, 120], [122, 30, 110],
    [176, 54, 78], [220, 92, 40], [248, 152, 18], [252, 214, 80], [255, 255, 235]
  ];

  function heat(t) {
    var s = Math.max(0, Math.min(0.999999, t)) * (HEAT.length - 1);
    var i = Math.floor(s);
    var f = s - i;
    var a = HEAT[i];
    var b = HEAT[i + 1];
    return [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f
    ];
  }

  function render(spec, opts) {
    var size = spec.size;
    var out = new ImageData(size, size);
    var o = out.data;
    var range = spec.max - spec.min || 1;
    var gamma = opts && opts.gamma ? opts.gamma : 1;
    var palette = opts && opts.palette === 'heat';
    for (var i = 0, p = 0; i < spec.log.length; i++, p += 4) {
      var v = (spec.log[i] - spec.min) / range;
      v = Math.pow(v, 1 / gamma);
      if (palette) {
        var c = heat(v);
        o[p] = c[0];
        o[p + 1] = c[1];
        o[p + 2] = c[2];
      } else {
        var g = v * 255;
        o[p] = o[p + 1] = o[p + 2] = g;
      }
      o[p + 3] = 255;
    }
    return out;
  }

  /** 在频谱中寻找显著的对称峰值——傅里叶盲水印常表现为成对亮点 */
  function findPeaks(spec) {
    var size = spec.size;
    var half = size >> 1;
    var log = spec.log;
    var sum = 0;
    var sum2 = 0;
    var count = 0;
    var x, y, i, dx, dy;
    for (y = 1; y < size - 1; y++) {
      dy = y - half;
      for (x = 1; x < size - 1; x++) {
        dx = x - half;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) continue;
        if (dx === 0 || dy === 0) continue;
        var v = log[y * size + x];
        sum += v;
        sum2 += v * v;
        count++;
      }
    }
    if (!count) return { peaks: [], mean: 0, std: 0 };
    var mean = sum / count;
    var std = Math.sqrt(Math.max(0, sum2 / count - mean * mean)) || 1;
    var peaks = [];
    for (y = 2; y < size - 2; y++) {
      dy = y - half;
      for (x = 2; x < size - 2; x++) {
        dx = x - half;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) continue;
        if (dx === 0 || dy === 0) continue;
        i = y * size + x;
        var val = log[i];
        var z = (val - mean) / std;
        if (z < 5) continue;
        var isMax = true;
        for (var oy = -1; oy <= 1 && isMax; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            if ((ox || oy) && log[(y + oy) * size + x + ox] > val) { isMax = false; break; }
          }
        }
        if (!isMax) continue;
        if (dy < 0 || (dy === 0 && dx < 0)) continue; // 只保留对称对中的一个
        peaks.push({
          dx: dx, dy: dy, z: z,
          radius: Math.round(Math.sqrt(dx * dx + dy * dy)),
          angle: Math.round(Math.atan2(-dy, dx) * 180 / Math.PI)
        });
      }
    }
    peaks.sort(function (a, b) { return b.z - a.z; });
    return { peaks: peaks.slice(0, 8), mean: mean, std: std, total: peaks.length };
  }

  return {
    spectrum: spectrum,
    render: render,
    findPeaks: findPeaks
  };
})();

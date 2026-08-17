/**
 * imageio.js —— 小程序侧的图片进出：选图、解码、把像素画到 canvas、导出 PNG、存相册
 *
 * 关键约定：真正要参与位运算的像素只信任 png.js 解出来的结果。
 * 只有非 PNG（相册里的 JPG 等）才退回用 canvas 解码，此时 exact 会返回 false，
 * 页面必须把「数据可能已被压缩破坏」这件事告诉用户。
 * 依赖 ./png.js。
 */
'use strict';

var png = require('./png.js');

var CANVAS_MAX_SIDE = 4096;                         // canvas type=2d 的单边上限

/** 调起微信选图，返回 {path, size} */
function chooseImage(sourceType) {
  return new Promise(function (resolve, reject) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: sourceType || ['album', 'camera'],
      sizeType: ['original'],
      success: function (res) {
        var file = res.tempFiles && res.tempFiles[0];
        if (!file) return reject(new Error('未选择图片。'));
        resolve({path: file.tempFilePath, size: file.size || 0});
      },
      fail: reject
    });
  });
}

/** 读取本地文件为 Uint8Array */
function readFileBytes(filePath) {
  return new Promise(function (resolve, reject) {
    // 直接使用原始路径，微信会自动处理
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      success: function (res) { resolve(new Uint8Array(res.data)); },
      fail: function(err) {
        // 如果失败，打印详细错误信息方便调试
        console.error('readFileBytes fail:', err, 'path:', filePath);
        reject(err);
      }
    });
  });
}

/** 取页面里的 canvas 节点，返回 {canvas, ctx} */
function getCanvas(selector) {
  return new Promise(function (resolve, reject) {
    wx.createSelectorQuery().select(selector)
      .fields({node: true, size: true})
      .exec(function (res) {
        var canvas = res && res[0] && res[0].node;  // 绘图 canvas 节点
        if (!canvas) return reject(new Error('绘图画布初始化失败，请退出重进页面。'));
        resolve({canvas: canvas, ctx: canvas.getContext('2d')});
      });
  });
}
/** 用 canvas 解码任意格式图片（JPG 等），像素不保证与原文件逐位一致 */
function decodeByCanvas(canvas, ctx, src, maxPixels) {
  return new Promise(function (resolve, reject) {
    var img = canvas.createImage();                 // canvas 可绘制图片对象
    img.onload = function () {
      var w = img.width;
      var h = img.height;
      var scale = 1;                                // 需要缩小的比例
      if (w > CANVAS_MAX_SIDE || h > CANVAS_MAX_SIDE) {
        scale = Math.min(CANVAS_MAX_SIDE / w, CANVAS_MAX_SIDE / h);
      }
      if (maxPixels && w * h * scale * scale > maxPixels) {
        scale = Math.min(scale, Math.sqrt(maxPixels / (w * h)));
      }
      var dw = Math.max(1, Math.floor(w * scale));
      var dh = Math.max(1, Math.floor(h * scale));
      try {
        canvas.width = dw;
        canvas.height = dh;
        ctx.clearRect(0, 0, dw, dh);
        ctx.drawImage(img, 0, 0, dw, dh);
        var got = ctx.getImageData(0, 0, dw, dh);
        resolve({
          image: {width: dw, height: dh, data: new Uint8Array(got.data)},
          exact: false,
          scaled: scale !== 1,
          originWidth: w,
          originHeight: h
        });
      } catch (err) {
        reject(new Error('图片解码失败：' + (err && err.message ? err.message : err)));
      }
    };
    img.onerror = function () { reject(new Error('图片读取失败，请换一张试试。')); };
    img.src = src;
  });
}

/**
 * 统一解码入口。PNG 走纯 JS 解码（逐位精确），其它格式退回 canvas。
 * opts: {bytes, path, canvas, ctx, maxPixels, pngOnly}
 * 返回 {image, exact, note}
 */
function decodeImage(opts) {
  var bytes = opts.bytes;
  if (png.isPng(bytes)) {
    var size = png.readSize(bytes);
    if (size && opts.maxPixels && size.width * size.height > opts.maxPixels) {
      return Promise.reject(new Error('图片 ' + size.width + '×' + size.height
        + ' 超过处理上限，请换小一点的图片。'));
    }
    try {
      return Promise.resolve({
        image: png.decode(bytes, {maxPixels: opts.maxPixels}),
        exact: true,
        note: ''
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }
  if (opts.pngOnly) {
    return Promise.reject(new Error('这不是 PNG 图片。JPG 等有损格式里的位平面数据已经被压缩破坏，读不出来。'));
  }
  if (!opts.canvas) return Promise.reject(new Error('绘图画布未就绪，请稍后重试。'));
  return decodeByCanvas(opts.canvas, opts.ctx, opts.path, opts.maxPixels).then(function (res) {
    var note = '非 PNG 图片走 canvas 解码，像素可能与原文件有出入';
    if (res.scaled) {
      note += '；已从 ' + res.originWidth + '×' + res.originHeight
        + ' 缩小到 ' + res.image.width + '×' + res.image.height;
    }
    return {image: res.image, exact: false, note: note + '。'};
  });
}
/** 把像素图画到 canvas 上显示（canvas 尺寸会被改成像素图的尺寸） */
function drawImageData(canvas, ctx, image) {
  canvas.width = image.width;
  canvas.height = image.height;
  var target = null;                                // 待填充的 ImageData
  try {
    if (typeof ctx.createImageData === 'function') target = ctx.createImageData(image.width, image.height);
  } catch (err) {
    target = null;
  }
  if (!target) target = ctx.getImageData(0, 0, image.width, image.height);
  target.data.set(image.data);
  ctx.putImageData(target, 0, 0);
}

/** 去掉文件名里不能落地的字符 */
function safeFileName(name) {
  var text = String(name || 'image.png').replace(/[\\/:*?"<>|\s]+/g, '_');
  return text || 'image.png';
}

/** 把字节写进本地临时目录，返回文件路径 */
function writeTempFile(bytes, fileName) {
  var data = bytes;
  if (data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength) {
    data = new Uint8Array(bytes);                   // 视图要先拷成独立 buffer 再写
  }
  var filePath = wx.env.USER_DATA_PATH + '/' + Date.now() + '-' + safeFileName(fileName); // 导出结果路径
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().writeFile({
      filePath: filePath,
      data: data.buffer,
      success: function () { resolve(filePath); },
      fail: reject
    });
  });
}

/** 保存图片到系统相册 */
function saveToAlbum(filePath) {
  return new Promise(function (resolve, reject) {
    wx.saveImageToPhotosAlbum({filePath: filePath, success: resolve, fail: reject});
  });
}

/** 按最长边把尺寸等比缩到不超过 limit，返回 {width, height} */
function fitSize(width, height, limit) {
  var scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/** 字节数转成好读的文案 */
function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

module.exports = {
  CANVAS_MAX_SIDE: CANVAS_MAX_SIDE,
  chooseImage: chooseImage,
  readFileBytes: readFileBytes,
  getCanvas: getCanvas,
  decodeImage: decodeImage,
  decodeByCanvas: decodeByCanvas,
  drawImageData: drawImageData,
  writeTempFile: writeTempFile,
  saveToAlbum: saveToAlbum,
  safeFileName: safeFileName,
  fitSize: fitSize,
  humanSize: humanSize
};

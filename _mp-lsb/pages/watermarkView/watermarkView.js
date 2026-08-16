/**
 * 查看页 —— 从图里读出隐藏的图案水印
 */
const png = require('../../utils/lsb/png.js');
const lsb = require('../../utils/lsb/lsbcore.js');
const io  = require('../../utils/lsb/imageio.js');

const MAX_WORK_PIXELS = 16000000;  // 查看页像素上限放宽些，只读不写，不怕卡
const PREVIEW_MAX_SIDE = 720;

/** 按图片比例算出预览框的 rpx 尺寸 */
function boxStyle(width, height) {
  const maxW = 660;
  const maxH = 880;
  let w = maxW;
  let h = Math.round(maxW * height / width);
  if (h > maxH) {
    h = maxH;
    w = Math.round(maxH * width / height);
  }
  return `width:${w}rpx;height:${h}rpx`;
}

Page({
  data: {
    hasImage: false,
    imagePath: '',
    imageInfo: '',
    imageWarn: '',

    // 位平面查看
    planeChannel: 'r',
    planeBit: 0,
    planeMode: 'bw',       // bw / amplify
    planeInvert: false,
    hasPlane: false,
    planeStyle: '',

    // 统计
    hasStats: false,
    statsChannels: [],
    alphaVaries: false,
    transparent: 0,

    isWorking: false,
    statusText: '',
    statusError: false,
  },

  /** 页面卸载时释放图片和 canvas */
  onUnload() {
    if (this.image) {
      this.image.data = null;
      this.image = null;
    }
    if (this.planeCanvas) {
      this.planeCanvas.width = 1;
      this.planeCanvas.height = 1;
      this.planeCanvas = null;
      this.planeCtx = null;
    }
  },

  setStatus(text, isError) {
    this.setData({statusText: text || '', statusError: !!isError});
  },

  /** 拿到位平面预览 canvas（懒加载） */
  getPlaneCanvas() {
    if (this.planeCanvas) return Promise.resolve({canvas: this.planeCanvas, ctx: this.planeCtx});
    return io.getCanvas('#planeCanvas').then(({canvas, ctx}) => {
      this.planeCanvas = canvas;
      this.planeCtx = ctx;
      return {canvas, ctx};
    });
  },

  /** 拿到工作 canvas（用于解码 JPG） */
  getWorkCanvas() {
    if (this.workCanvas) return Promise.resolve({canvas: this.workCanvas, ctx: this.workCtx});
    return io.getCanvas('#workCanvas').then(({canvas, ctx}) => {
      this.workCanvas = canvas;
      this.workCtx = ctx;
      return {canvas, ctx};
    });
  },

  /** 开关、滑块 */
  onSwitch(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({[field]: e.detail.value});
    if (field === 'planeInvert') this.drawPlane();
  },

  /** 一组按钮里选一个 */
  pickOption(e) {
    const {field, value} = e.currentTarget.dataset;
    if (!field) return;
    const isNum = field === 'planeBit';
    this.setData({[field]: isNum ? Number(value) : value});
    if (field === 'planeChannel' || field === 'planeBit' || field === 'planeMode') this.drawPlane();
  },

  /** 选择图片 */
  chooseImage() {
    io.chooseImage(['album', 'chat']).then(file => {
      // 清理旧的 canvas，强制重新初始化
      if (this.planeCanvas) {
        this.planeCanvas.width = 1;
        this.planeCanvas.height = 1;
        this.planeCanvas = null;
        this.planeCtx = null;
      }
      this.setData({
        hasImage: false, imagePath: '', imageInfo: '', imageWarn: '',
        hasPlane: false, hasStats: false, statusText: '', statusError: false,
      });
      this.setStatus('正在读取图片...', false);
      return this.loadImage(file.path);
    }).catch(err => {
      if (err.errMsg && err.errMsg.includes('cancel')) return;
      this.setStatus('选择图片失败：' + (err.errMsg || err.message || err), true);
    });
  },

  /** 加载图片 */
  loadImage(path) {
    return io.readFileBytes(path).then(bytes => {
      const isPng = png.isPng(bytes);

      // 只接受 PNG 格式
      if (!isPng) {
        return Promise.reject(new Error('只支持 PNG 格式。JPG 等有损格式会破坏隐藏水印，无法读取。'));
      }

      const maxPx = MAX_WORK_PIXELS;
      return io.decodeImage({bytes: bytes, maxPixels: maxPx, pngOnly: true}).then(({image, exact, note}) => {
        this.image = image;
        const {width, height} = image;
        const n = width * height;
        let info = `${width} × ${height} (${(n / 1e6).toFixed(2)}M 像素)`;
        if (note) info += '\n' + note;
        let warn = '';
        if (!exact) {
          warn = '图片过大被缩小了，隐藏信息可能丢失。';
        }
        this.setData({hasImage: true, imagePath: path, imageInfo: info, imageWarn: warn});
        this.setStatus('', false);
        this.drawStats();
        // 延迟一下再画位平面，等 DOM 渲染完成
        setTimeout(() => {
          this.drawPlane();
        }, 100);
      });
    }).catch(err => {
      this.setStatus('读取图片失败：' + (err.message || err), true);
    });
  },

  /** 画位平面 */
  drawPlane() {
    if (!this.image) return;
    const {planeChannel, planeBit, planeMode, planeInvert} = this.data;
    this.setData({hasPlane: false});
    this.getPlaneCanvas().then(({canvas, ctx}) => {
      const size = io.fitSize(this.image.width, this.image.height, PREVIEW_MAX_SIDE);
      const plane = lsb.renderPlaneScaled(this.image, {
        bit: planeBit, channel: planeChannel, mode: planeMode, invert: planeInvert,
      }, size.width, size.height, null);
      io.drawImageData(canvas, ctx, plane);
      this.setData({hasPlane: true, planeStyle: boxStyle(size.width, size.height)});
    }).catch(err => {
      this.setStatus('位平面绘制失败：' + (err.message || err), true);
    });
  },

  /** 画统计图（直方图 + 卡方 + 位占比） */
  drawStats() {
    if (!this.image) return;
    const st = lsb.stats(this.image);
    // 把数值格式化成字符串，wxml 里不能直接调 .toFixed()
    const channels = st.channels.map(ch => ({
      name: ch.name,
      verdict: ch.verdict,
      ratioText: (ch.ratio * 100).toFixed(2),
      normText: ch.norm.toFixed(3),
      df: ch.df,
      planeRatios: ch.planeRatios.map(r => ({
        value: r,
        percent: (r * 100).toFixed(1),
      })),
    }));
    this.setData({
      hasStats: true,
      statsChannels: channels,
      alphaVaries: st.alphaVaries,
      transparent: st.transparent,
    });
  },

  /** 预览原图 */
  previewImage() {
    if (!this.data.imagePath) return;
    wx.previewImage({current: this.data.imagePath, urls: [this.data.imagePath]});
  },
});

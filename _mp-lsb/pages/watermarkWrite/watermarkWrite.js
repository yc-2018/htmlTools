/**
 * 隐藏水印写入
 * 两种写法：
 *   图案水印 —— 把文字二值化后直接画进某个颜色通道的某一位，用「隐藏水印查看」能肉眼看到；
 *   文字水印 —— 按 LSB1 格式把文字（可加口令）编码进低位，需要用查看页提取。
 * 所有像素运算都在纯 JS 里完成，导出的 PNG 也是自己编码的，
 * 因为 canvas 取像素和 wx.canvasToTempFilePath 都做不到逐位无损。
 */
const png = require('../../utils/lsb/png.js');
const lsb = require('../../utils/lsb/lsbcore.js');
const io = require('../../utils/lsb/imageio.js');

const MAX_WORK_PIXELS = 4000000;      // 载体最大像素数，再大内存和耗时都扛不住
const PREVIEW_MAX_SIDE = 720;         // 位平面预览图的最长边
const LINE_HEIGHT = 1.25;             // 多行文字的行距倍数
const CHANNEL_LABEL = {r: '红 (R)', g: '绿 (G)', b: '蓝 (B)', a: '透明度 (A)'}; // 通道文案
const COLOR_SWATCHES = [              // 彩色模式可用的颜色（正好是 RGB 三位的组合）
  {value: '#ffffff', label: '白'},
  {value: '#ff0000', label: '红'},
  {value: '#00ff00', label: '绿'},
  {value: '#0000ff', label: '蓝'},
  {value: '#ffff00', label: '黄'},
  {value: '#00ffff', label: '青'},
  {value: '#ff00ff', label: '品红'},
];
const PREVIEW_BOX_W = 660;            // 预览框宽度（rpx）
const PREVIEW_BOX_H = 880;            // 预览框最大高度（rpx）

/** 按图片比例算出预览框的 rpx 尺寸，免得画面被拉伸 */
function boxStyle(width, height) {
  let w = PREVIEW_BOX_W;              // 预览框宽
  let h = Math.round(PREVIEW_BOX_W * height / width); // 预览框高
  if (h > PREVIEW_BOX_H) {
    h = PREVIEW_BOX_H;
    w = Math.round(PREVIEW_BOX_H * width / height);
  }
  return `width:${w}rpx;height:${h}rpx`;
}

Page({

  data: {
    mode: 'stencil',                  // stencil 图案水印 / text 文字水印
    hasCarrier: false,
    carrierPath: '',                  // 载体图预览路径
    carrierInfo: '',                  // 载体尺寸等信息
    carrierWarn: '',                  // 载体来源风险提示
    patternText: '',
    fontSize: 96,
    bold: true,
    rotate: 0,
    tile: false,                      // 平铺铺满整幅
    colorMode: false,                 // RGB 三通道彩色
    patternColor: '#ffffff',
    colorSwatches: COLOR_SWATCHES,
    channel: 'r',
    plane: 0,
    threshold: 128,
    dither: false,
    invert: false,
    wholeClear: true,                 // 整幅清零，图案更干净
    hiddenText: '',
    password: '',
    textChannels: 'rgb',
    textBits: 1,
    capacityText: '',                 // 文字水印容量提示
    isBuilding: false,
    statusText: '',
    statusError: false,
    resultPath: '',                   // 生成结果的本地路径
    resultInfo: '',
    hasPreview: false,                // 位平面预览是否已经画出来
    previewStyle: '',                 // 预览框尺寸，跟着图片比例走
  },

  /** 生命周期函数--监听页面卸载，及时释放大块像素内存 */
  onUnload() {
    this.carrier = null;
    this.workCanvas = null;
    this.workCtx = null;
    this.planeCanvas = null;
    this.planeCtx = null;
  },

  /** 切换「图案水印 / 文字水印」 */
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode; // 目标模式
    if (!mode || mode === this.data.mode) return;
    this.setData({mode, statusText: '', statusError: false});
    this.syncCapacity();
  },

  /** 统一更新状态行 */
  setStatus(text, isError) {
    this.setData({statusText: text || '', statusError: !!isError});
  },

  /** 取隐藏的绘图 canvas（画文字图案、解码非 PNG 图片用） */
  getWorkCanvas() {
    if (this.workCanvas) return Promise.resolve({canvas: this.workCanvas, ctx: this.workCtx});
    return io.getCanvas('#workCanvas').then((res) => {
      this.workCanvas = res.canvas;
      this.workCtx = res.ctx;
      return res;
    });
  },

  /** 取展示位平面预览的 canvas */
  getPlaneCanvas() {
    if (this.planeCanvas) return Promise.resolve({canvas: this.planeCanvas, ctx: this.planeCtx});
    return io.getCanvas('#planeCanvas').then((res) => {
      this.planeCanvas = res.canvas;
      this.planeCtx = res.ctx;
      return res;
    });
  },

  /** switch 组件通用处理，字段名写在 data-field 上 */
  onSwitch(e) {
    const field = e.currentTarget.dataset.field; // 要更新的 data 字段名
    if (!field) return;
    this.setData({[field]: e.detail.value});
  },

  /** slider 组件通用处理 */
  onSlider(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({[field]: e.detail.value});
  },

  /** input / textarea 通用处理 */
  onInputField(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({[field]: e.detail.value});
    if (field === 'hiddenText') this.syncCapacity();
  },

  /** 一组按钮里选一个（通道、位数、颜色等） */
  pickOption(e) {
    const {field, value} = e.currentTarget.dataset;
    if (!field) return;
    const isNum = field === 'textBits' || field === 'plane'; // 这几个字段要存成数字，wxml 里才比得上
    this.setData({[field]: isNum ? Number(value) : value});
    if (field === 'textChannels' || field === 'textBits') this.syncCapacity();
  },

  /** 刷新文字水印的容量提示 */
  syncCapacity() {
    if (!this.carrier) {
      this.setData({capacityText: ''});
      return;
    }
    const {textChannels, textBits, hiddenText} = this.data;
    const cap = lsb.capacityBytes(this.carrier.width, this.carrier.height, textChannels, textBits); // 可写字节数
    const used = lsb.utf8Encode(hiddenText || '').length; // 当前文字占的字节数
    this.setData({capacityText: `已用 ${used} / 可用 ${cap} 字节（约 ${Math.floor(cap / 3)} 个汉字）`});
  },

  /** 选择载体图片 */
  chooseCarrier() {
    if (this.data.isBuilding) return;
    io.chooseImage()
      .then((file) => this.loadCarrier(file))
      .catch((err) => {
        if (err && /cancel/.test(err.errMsg || '')) return;
        console.error('选择载体图片失败', err);
        this.setStatus(err && err.message ? err.message : '选择图片失败。', true);
      });
  },

  /** 读取并解码载体图片 */
  loadCarrier(file) {
    wx.showLoading({title: '读取图片…', mask: true});
    return this.getWorkCanvas()
      .then(({canvas, ctx}) => io.readFileBytes(file.path).then((bytes) => io.decodeImage({
        bytes, canvas, ctx, path: file.path, maxPixels: MAX_WORK_PIXELS,
      })))
      .then((res) => {
        this.carrier = res.image;
        this.setData({
          hasCarrier: true,
          carrierPath: file.path,
          carrierInfo: `${res.image.width} × ${res.image.height}，${io.humanSize(file.size)}`,
          carrierWarn: res.exact ? '' : res.note,
          resultPath: '',
          resultInfo: '',
          hasPreview: false,
        });
        this.syncCapacity();
        this.setStatus('载体已就绪，设置好参数后点下面的按钮写入。', false);
      })
      .catch((err) => {
        console.error('载体图片解码失败', err);
        this.carrier = null;
        this.setData({hasCarrier: false, carrierPath: '', carrierInfo: '', carrierWarn: ''});
        this.setStatus(err && err.message ? err.message : '图片解码失败。', true);
      })
      .then(() => wx.hideLoading());
  },

  /**
   * 把文字画成图案层，返回与载体同尺寸的 RGBA 数据。
   * 文字只在一块小 canvas 上画一次，再按位置盖到大图里，
   * 这样载体多大都不受 canvas 4096 单边上限的影响。
   */
  buildPatternLayer(canvas, ctx) {
    const {patternText, fontSize, bold, rotate, tile, colorMode, patternColor} = this.data;
    const text = String(patternText || '').trim();
    if (!text) throw new Error('请先填写要写入的文字。');
    const size = Number(fontSize);
    const lines = text.split('\n');
    ctx.font = `${bold ? '700 ' : '400 '}${size}px sans-serif`;
    let textW = 8;
    lines.forEach((line) => {
      textW = Math.max(textW, ctx.measureText(line || ' ').width || 0);
    });
    textW += size * 0.4;
    const textH = lines.length * size * LINE_HEIGHT;
    const rad = Number(rotate) * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const pw = Math.ceil(textW * cos + textH * sin); // 旋转后图案块的宽
    const ph = Math.ceil(textW * sin + textH * cos); // 旋转后图案块的高
    if (pw > io.CANVAS_MAX_SIDE || ph > io.CANVAS_MAX_SIDE) {
      throw new Error('字号太大或文字太长，请调小字号。');
    }

    canvas.width = pw;
    canvas.height = ph;
    ctx.clearRect(0, 0, pw, ph);
    ctx.save();
    ctx.translate(pw / 2, ph / 2);
    ctx.rotate(rad);
    ctx.font = `${bold ? '700 ' : '400 '}${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colorMode ? patternColor : '#ffffff';
    const lineH = size * LINE_HEIGHT;
    const top = -((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 0, top + i * lineH));
    ctx.restore();
    const patch = ctx.getImageData(0, 0, pw, ph).data; // 图案块像素

    const w = this.carrier.width;
    const h = this.carrier.height;
    const comp = new Uint8Array(w * h * 4);
    const stamp = (ox, oy) => {
      const x0 = Math.max(0, -ox);
      const y0 = Math.max(0, -oy);
      const x1 = Math.min(pw, w - ox);
      const y1 = Math.min(ph, h - oy);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const s = (y * pw + x) * 4;
          if (!patch[s + 3]) continue;              // 透明处不覆盖，避免相邻图案互相擦掉
          const d = ((oy + y) * w + (ox + x)) * 4;
          comp[d] = patch[s];
          comp[d + 1] = patch[s + 1];
          comp[d + 2] = patch[s + 2];
          comp[d + 3] = patch[s + 3];
        }
      }
    };

    if (tile) {
      const gap = Math.max(8, Math.round(size * 0.5)); // 平铺间距
      const stepX = pw + gap;
      const stepY = ph + gap;
      if ((w / stepX + 2) * (h / stepY + 2) > 4000) throw new Error('字号太小，平铺份数太多，请调大字号。');
      let row = 0;
      for (let oy = -stepY; oy < h + stepY; oy += stepY, row++) {
        const shift = row % 2 ? Math.round(stepX / 2) : 0; // 隔行错位，铺起来更自然
        for (let ox = -stepX + shift; ox < w + stepX; ox += stepX) stamp(ox, oy);
      }
    } else {
      stamp(Math.round((w - pw) / 2), Math.round((h - ph) / 2));
    }
    return comp;
  },

  /** 点「写入」：按当前模式跑完整条链路 */
  doWrite() {
    if (this.data.isBuilding) return;
    if (!this.carrier) {
      this.setStatus('请先选择载体图片。', true);
      return;
    }
    const isStencil = this.data.mode === 'stencil';
    this.setData({isBuilding: true, resultPath: '', resultInfo: '', hasPreview: false});
    this.setStatus('正在写入，图片越大越慢，请稍候…', false);
    wx.showLoading({title: '写入中…', mask: true});
    // 先让 loading 渲染出来，再干这一大堆同步计算
    new Promise((resolve) => setTimeout(resolve, 60))
      .then(() => (isStencil ? this.writeStencil() : this.writeText()))
      .then((res) => this.exportResult(res))
      .catch((err) => {
        console.error('写入水印失败', err);
        this.setStatus(err && err.message ? err.message : '写入失败。', true);
      })
      .then(() => {
        wx.hideLoading();
        this.setData({isBuilding: false});
      });
  },

  /** 图案水印：文字 -> 二值掩膜 -> 写进指定位平面 */
  writeStencil() {
    return this.getWorkCanvas().then(({canvas, ctx}) => {
      const {colorMode, threshold, dither, invert, channel, plane, wholeClear} = this.data;
      const w = this.carrier.width;
      const h = this.carrier.height;
      const comp = this.buildPatternLayer(canvas, ctx);
      const mask = lsb.buildMask(comp, w, h, {
        color: colorMode, threshold: Number(threshold), dither, invert,
      });
      if (!mask.on) throw new Error('二值化之后图案是空的，把阈值调低一点，或关掉反色再试。');
      const opts = {
        chans: colorMode ? [0, 1, 2] : [lsb.CH_INDEX[channel]],
        plane: Number(plane),
        color: colorMode,
        whole: wholeClear,
        flatten: true,
      };
      const res = lsb.applyStencil(this.carrier, mask, opts);
      const check = lsb.verifyStencil(res.image, mask, opts); // 写完立刻在内存里自检
      if (check.bad) throw new Error(`写入自检失败：${check.bad} / ${check.total} 个采样点不对。`);
      const ratio = mask.pixels ? (mask.on * 100 / mask.pixels).toFixed(1) : '0';
      const quality = lsb.psnr(this.carrier.data, res.image.data); // 改动幅度
      return {
        image: res.image,
        planeOpts: {bit: opts.plane, channel: colorMode ? 'rgb' : channel},
        summary: `图案占 ${ratio}% 像素，改了 ${check.total} 个采样点中的 ${res.changed} 个，`
          + `PSNR ${quality === Infinity ? '∞' : quality.toFixed(1)} dB`,
        verify: {kind: 'stencil', mask, opts},
      };
    });
  },

  /** 文字水印：按 LSB1 格式写进低位 */
  writeText() {
    const {hiddenText, password, textChannels, textBits} = this.data;
    const text = String(hiddenText || '').trim();
    if (!text) return Promise.reject(new Error('请先填写要隐藏的文字。'));
    const bits = Number(textBits);
    const res = lsb.embed(this.carrier, lsb.utf8Encode(text), {
      channels: textChannels, bits, password, flattenAlpha: true,
    });
    if (!res.ok) return Promise.reject(new Error(res.error));
    return Promise.resolve({
      image: res.image,
      planeOpts: {bit: 0, channel: textChannels === 'rgb' ? 'rgb' : textChannels[0]},
      summary: `写入 ${res.used} 字节（含 ${lsb.HEADER} 字节包头），容量 ${res.capacity} 字节`
        + `，通道 ${textChannels.toUpperCase()} / ${bits} 位${password ? '，已加口令' : ''}`,
      verify: {kind: 'text', channels: textChannels, bits, password, text},
    });
  },

  /** 编码成 PNG 落地，再从文件回读一次做真·自检，最后画出位平面预览 */
  exportResult(res) {
    const {width, height} = res.image;
    const pixels = width * height;
    const encodeOpts = {level: pixels > 2000000 ? 1 : 2}; // 大图降一档压缩，免得等太久
    if (pixels > 3000000) encodeOpts.filter = 1;          // 更大就固定 filter，省一遍逐行择优
    const bytes = png.encode(res.image.data, width, height, encodeOpts);
    return io.writeTempFile(bytes, 'watermark.png')
      .then((filePath) => io.readFileBytes(filePath).then((raw) => {
        const reread = png.decode(raw);                   // 从落地文件回读，确认写进去的东西还在
        const same = reread.width === width && reread.height === height
          && this.samePixels(reread.data, res.image.data);
        if (!same) throw new Error('导出的 PNG 回读后与内存不一致，请重试。');
        let verifyText;
        if (res.verify.kind === 'stencil') {
          const check = lsb.verifyStencil(reread, res.verify.mask, res.verify.opts);
          if (check.bad) throw new Error(`导出文件回读自检失败：${check.bad} 个采样点不对。`);
          verifyText = '回读自检通过：文件里的位平面与写入的图案完全一致。';
        } else {
          const got = lsb.extract(reread, {
            channels: res.verify.channels, bits: res.verify.bits, password: res.verify.password,
          });
          if (!got.ok || got.text !== res.verify.text) {
            throw new Error('导出文件回读自检失败：读不回原文。');
          }
          verifyText = '回读自检通过：从导出的文件里成功读回了原文。';
        }
        this.setData({
          resultPath: filePath,
          resultInfo: `${width} × ${height}，${io.humanSize(bytes.length)}\n${res.summary}`,
        });
        return this.drawPlanePreview(reread, res.planeOpts).then(() => {
          this.setStatus(`${verifyText}\n${this.planeHintOf(res.planeOpts)}`, false);
        });
      }));
  },

  /** 两块像素是否逐字节相同 */
  samePixels(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  },

  /** 生成“去哪儿看”的提示文案 */
  planeHintOf(planeOpts) {
    const name = planeOpts.channel === 'rgb' ? 'RGB 合成' : (CHANNEL_LABEL[planeOpts.channel] || planeOpts.channel);
    return `到「隐藏水印查看」里选 ${name}、第 ${planeOpts.bit} 位，就能看到它。`;
  },

  /** 把位平面画到预览 canvas 上 */
  drawPlanePreview(image, planeOpts) {
    return this.getPlaneCanvas().then(({canvas, ctx}) => {
      const size = io.fitSize(image.width, image.height, PREVIEW_MAX_SIDE); // 预览位图尺寸
      const plane = lsb.renderPlaneScaled(image, {
        bit: planeOpts.bit, channel: planeOpts.channel, mode: 'bw',
      }, size.width, size.height, null);
      io.drawImageData(canvas, ctx, plane);
      this.setData({hasPreview: true, previewStyle: boxStyle(size.width, size.height)});
    });
  },

  /** 保存生成的 PNG 到系统相册 */
  saveResult() {
    const filePath = this.data.resultPath; // 生成结果路径
    if (!filePath) return;
    wx.showLoading({title: '保存中…', mask: true});
    io.saveToAlbum(filePath)
      .then(() => {
        wx.showToast({title: '已存到相册', icon: 'success'});
        this.setStatus('已保存到相册。注意：再经微信聊天、朋友圈等转发时可能被转成 JPG，'
          + '水印就没了，要传给别人建议用「原图 / 文件」方式发送。', false);
      })
      .catch((err) => {
        console.error('保存到相册失败', err);
        const denied = /auth|permission/i.test(err && (err.errMsg || err.message) || '');
        this.setStatus(denied ? '没有相册权限，请到右上角「…」-「设置」里打开保存到相册。'
          : '保存失败，请重试。', true);
      })
      .then(() => wx.hideLoading());
  },

  /** 预览生成的图片 */
  previewResult() {
    if (!this.data.resultPath) return;
    wx.previewImage({urls: [this.data.resultPath], current: this.data.resultPath});
  },
});

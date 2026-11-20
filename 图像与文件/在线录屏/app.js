(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------------- 元素 ---------------- */
  const el = {
    stage: $('stage'),
    preview: $('previewVideo'),
    stageEmpty: $('stageEmpty'),
    freeze: $('freezeFrame'),
    pip: $('pipPreview'),
    cam: $('camPreview'),
    hud: $('stageHud'),
    hudTimer: $('hudTimer'),
    hudSize: $('hudSize'),
    clockOverlay: $('clockOverlay'),
    countdown: $('countdown'),
    btnStart: $('btnStart'),
    btnPause: $('btnPause'),
    btnStop: $('btnStop'),
    btnClear: $('btnClear'),
    meterFill: $('meterFill'),
    meterLabel: $('meterLabel'),
    status: $('status'),
    warn: $('warn'),
    systemAudio: $('optSystemAudio'),
    mic: $('optMic'),
    micSelect: $('micSelect'),
    micSelectRow: $('micSelectRow'),
    camToggle: $('optCam'),
    camSelect: $('camSelect'),
    camSelectRow: $('camSelectRow'),
    refreshDevices: $('btnRefreshDevices'),
    pipGroup: $('pipGroup'),
    pipPos: $('pipPos'),
    pipSize: $('pipSize'),
    pipSizeOut: $('pipSizeOut'),
    pipCircle: $('optPipCircle'),
    pipMirror: $('optPipMirror'),
    fps: $('optFps'),
    bitrate: $('optBitrate'),
    format: $('optFormat'),
    maxHeight: $('optMaxHeight'),
    maxHeightHint: $('maxHeightHint'),
    cursor: $('optCursor'),
    clock: $('optClock'),
    countdownOpt: $('optCountdown'),
    autoDownload: $('optAutoDownload'),
    resultCount: $('resultCount'),
    resultEmpty: $('resultEmpty'),
    resultList: $('resultList'),
    btnDownloadAll: $('btnDownloadAll'),
    editorMask: $('editorMask'),
    editor: $('editorVideo'),
    editorClose: $('editorClose'),
    editorTitle: $('editorTitle'),
    editorRangeText: $('editorRangeText'),
    editorRangeLen: $('editorRangeLen'),
    timeline: $('timeline'),
    timelineSelected: $('timelineSelected'),
    handleStart: $('handleStart'),
    handleEnd: $('handleEnd'),
    timelineEndLabel: $('timelineEndLabel'),
    trimStart: $('trimStart'),
    trimEnd: $('trimEnd'),
    editFormat: $('editFormat'),
    editFps: $('editFps'),
    editMaxHeight: $('editMaxHeight'),
    editQuality: $('editQuality'),
    editQualityOut: $('editQualityOut'),
    editQualityRow: $('editQualityRow'),
    editBitrate: $('editBitrate'),
    editBitrateRow: $('editBitrateRow'),
    editorHint: $('editorHint'),
    editorProgress: $('editorProgress'),
    editorProgressFill: $('editorProgressFill'),
    editorProgressText: $('editorProgressText'),
    editorWarn: $('editorWarn'),
    btnEditorCancel: $('btnEditorCancel'),
    btnEditorAbort: $('btnEditorAbort'),
    btnEditorExport: $('btnEditorExport')
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    supported: true,
    starting: false,
    recording: false,
    paused: false,
    stopping: false,
    finalized: true,
    screenStream: null,
    camStream: null,
    camOpening: null,
    micStream: null,
    canvasStream: null,
    outStream: null,
    recorder: null,
    chunks: [],
    recordedSize: 0,
    mime: '',
    ext: 'webm',
    audioCtx: null,
    mixNode: null,
    analyser: null,
    canvas: null,
    ctx: null,
    drawRaf: 0,
    drawTimer: 0,
    meterRaf: 0,
    meterTimer: 0,
    tickTimer: 0,
    stopToken: 0,
    startedAt: 0,
    elapsedBase: 0,
    countdownTimer: 0,
    countdownDone: null,
    results: [],
    hasAudio: false,
    editor: null,
    pip: { x: 0.84, y: 0.84 },
    lastVideoSize: ''
  };

  /* ---------------- 小工具 ---------------- */
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + units[i];
  }

  function buildFileName(ext, prefix) {
    const d = new Date();
    const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    return (prefix || '录屏') + '-' + stamp + '.' + ext;
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  function setWarn(text) {
    if (!text) {
      el.warn.hidden = true;
      el.warn.textContent = '';
      return;
    }
    el.warn.textContent = text;
    el.warn.hidden = false;
  }

  function explainError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return '权限被拒绝或取消（也可能当前页面不是 https / localhost）';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没有找到可用设备';
    if (name === 'NotReadableError' || name === 'TrackStartError') return '设备被其他程序占用';
    if (name === 'OverconstrainedError') return '设备不支持所请求的参数';
    if (name === 'AbortError') return '已取消';
    return (err && err.message) || '未知错误';
  }

  /* ---------------- 格式探测 ---------------- */
  const MIME_LIST = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', label: 'MP4（H.264 + AAC）' },
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'MP4（H.264）' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM（VP9，体积更小）' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM（VP8）' },
    { mime: 'video/webm', ext: 'webm', label: 'WebM（浏览器默认）' }
  ];

  function supportedMimes() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return [];
    return MIME_LIST.filter((f) => {
      try {
        return MediaRecorder.isTypeSupported(f.mime);
      } catch (e) {
        return false;
      }
    });
  }

  function fillFormatOptions() {
    const list = supportedMimes();
    const keep = el.format.value;
    el.format.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = list.length ? '自动（' + list[0].ext.toUpperCase() + '）' : '自动（浏览器默认）';
    el.format.appendChild(auto);
    list.forEach((f, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = f.label;
      el.format.appendChild(opt);
    });
    const values = Array.prototype.map.call(el.format.options, (o) => o.value);
    el.format.value = values.indexOf(keep) >= 0 ? keep : 'auto';
  }

  function chooseMime() {
    const list = supportedMimes();
    if (!list.length) return { mime: '', ext: 'webm' };
    const picked = el.format.value;
    if (picked !== 'auto' && list[Number(picked)]) return list[Number(picked)];
    return list[0];
  }

  /* ---------------- 设置持久化 ---------------- */
  const STORE_KEY = 'html-tools.recorder.v1';

  function collectSettings() {
    return {
      systemAudio: el.systemAudio.checked,
      mic: el.mic.checked,
      cam: el.camToggle.checked,
      pipPos: el.pipPos.value,
      pipSize: el.pipSize.value,
      pipCircle: el.pipCircle.checked,
      pipMirror: el.pipMirror.checked,
      pipX: state.pip.x,
      pipY: state.pip.y,
      fps: el.fps.value,
      bitrate: el.bitrate.value,
      format: el.format.value,
      maxHeight: el.maxHeight.value,
      cursor: el.cursor.value,
      clock: el.clock.checked,
      countdown: el.countdownOpt.value,
      autoDownload: el.autoDownload.checked,
      micDevice: el.micSelect.value,
      camDevice: el.camSelect.value
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(collectSettings()));
    } catch (e) {
      /* 隐私模式或 file:// 下可能不可用，忽略 */
    }
  }

  function loadSettings() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    if (!saved) return;
    const bool = (input, key) => {
      if (typeof saved[key] === 'boolean') input.checked = saved[key];
    };
    const value = (input, key) => {
      if (typeof saved[key] === 'string') input.value = saved[key];
    };
    bool(el.systemAudio, 'systemAudio');
    bool(el.mic, 'mic');
    bool(el.camToggle, 'cam');
    bool(el.pipCircle, 'pipCircle');
    bool(el.pipMirror, 'pipMirror');
    bool(el.clock, 'clock');
    bool(el.autoDownload, 'autoDownload');
    value(el.pipPos, 'pipPos');
    value(el.pipSize, 'pipSize');
    value(el.fps, 'fps');
    value(el.bitrate, 'bitrate');
    value(el.maxHeight, 'maxHeight');
    value(el.cursor, 'cursor');
    value(el.countdownOpt, 'countdown');
    if (typeof saved.pipX === 'number' && typeof saved.pipY === 'number') {
      state.pip.x = saved.pipX;
      state.pip.y = saved.pipY;
    }
    if (saved.format) {
      const values = Array.prototype.map.call(el.format.options, (o) => o.value);
      if (values.indexOf(saved.format) >= 0) el.format.value = saved.format;
    }
    // 设备选择等刷新列表后再恢复
    state.pendingDevices = { mic: saved.micDevice || '', cam: saved.camDevice || '' };
  }

  /* ---------------- 设备 ---------------- */
  function fillDeviceSelect(select, devices, pendingValue) {
    const keep = select.value || pendingValue || '';
    select.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = '默认设备';
    select.appendChild(def);
    devices.forEach((device, index) => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.textContent = device.label || ('设备 ' + (index + 1));
      select.appendChild(opt);
    });
    const values = Array.prototype.map.call(select.options, (o) => o.value);
    select.value = values.indexOf(keep) >= 0 ? keep : '';
  }

  async function refreshDeviceList(askPermission) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    if (askPermission) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        tmp.getTracks().forEach((track) => track.stop());
      } catch (e) {
        /* 拒绝了也可以列出没有名字的设备 */
      }
    }
    let devices = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) {
      return;
    }
    const pending = state.pendingDevices || {};
    fillDeviceSelect(el.micSelect, devices.filter((d) => d.kind === 'audioinput'), pending.mic);
    fillDeviceSelect(el.camSelect, devices.filter((d) => d.kind === 'videoinput'), pending.cam);
    state.pendingDevices = null;
  }

  async function openCamera() {
    if (!el.camToggle.checked || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return null;
    }
    const deviceId = el.camSelect.value;
    const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const constraints = { audio: false, video: base };
    if (deviceId) constraints.video = Object.assign({ deviceId: { exact: deviceId } }, base);
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (deviceId) {
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: false, video: base });
        } catch (e2) {
          /* 继续走向下的提示 */
        }
      }
      setWarn('摄像头打开失败：' + explainError(err) + '，本次不会叠加画中画。');
      return null;
    }
  }

  /* ---------------- 画中画预览 ---------------- */
  /* 勾选后立刻打开摄像头：未开始录制也能在舞台里看到小窗，先把位置和大小调好 */
  function camStreamLive() {
    return !!state.camStream && state.camStream.getVideoTracks().some((track) => track.readyState === 'live');
  }

  function attachCamStream(stream) {
    state.camStream = stream;
    el.cam.srcObject = stream;
    el.cam.play().catch(() => {});
    syncPipPreview();
    return stream;
  }

  function ensureCamStream() {
    if (!el.camToggle.checked) return Promise.resolve(null);
    if (camStreamLive()) return Promise.resolve(state.camStream);
    if (state.camOpening) return state.camOpening;
    state.camOpening = openCamera()
      .then((stream) => {
        state.camOpening = null;
        if (!stream) return null;
        // 授权弹窗期间用户可能又取消了勾选，此时直接把流关掉
        if (!el.camToggle.checked) {
          stream.getTracks().forEach((track) => {
            try { track.stop(); } catch (e) { /* 忽略 */ }
          });
          return null;
        }
        return attachCamStream(stream);
      })
      .catch(() => {
        state.camOpening = null;
        return null;
      });
    return state.camOpening;
  }

  function stopCamStream() {
    if (state.camStream) {
      state.camStream.getTracks().forEach((track) => {
        try { track.stop(); } catch (e) { /* 忽略 */ }
      });
    }
    state.camStream = null;
    el.cam.srcObject = null;
    el.pip.hidden = true;
  }

  /* 录制结束或取消后把预览小窗找回来，方便继续调位置 */
  function restoreCamPreview() {
    if (el.camToggle.checked) ensureCamStream();
  }

  async function openMic() {
    if (!el.mic.checked || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return null;
    }
    const deviceId = el.micSelect.value;
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const constraints = { video: false, audio: base };
    if (deviceId) constraints.audio = Object.assign({ deviceId: { exact: deviceId } }, base);
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (deviceId) {
        try {
          return await navigator.mediaDevices.getUserMedia({ video: false, audio: base });
        } catch (e2) {
          /* 继续走向下的提示 */
        }
      }
      setWarn('麦克风打开失败：' + explainError(err) + '，本次录制没有解说声音。');
      return null;
    }
  }

  /* ---------------- 音频混音 ---------------- */
  function ensureAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!state.audioCtx) {
      try {
        state.audioCtx = new Ctx();
      } catch (e) {
        return null;
      }
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    return state.audioCtx;
  }

  async function buildAudioTrack(screenStream, micStream) {
    const screenAudio = screenStream.getAudioTracks();
    const micAudio = micStream ? micStream.getAudioTracks() : [];
    if (!screenAudio.length && !micAudio.length) return null;

    const ctx = ensureAudioContext();
    if (!ctx) return screenAudio[0] || micAudio[0] || null;

    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch (e) {
      /* 某些浏览器需要用户手势，开始按钮本身就是手势 */
    }
    const dest = ctx.createMediaStreamDestination();
    const mix = ctx.createGain();
    mix.gain.value = 1;
    mix.connect(dest);

    if (screenAudio.length) {
      const screenSrc = ctx.createMediaStreamSource(new MediaStream(screenAudio));
      screenSrc.connect(mix);
    }
    if (micAudio.length) {
      const micSrc = ctx.createMediaStreamSource(new MediaStream(micAudio));
      const micGain = ctx.createGain();
      micGain.gain.value = 1;
      micSrc.connect(micGain);
      micGain.connect(mix);
    }
    state.mixNode = mix;
    return dest.stream.getAudioTracks()[0] || null;
  }

  function startMeter() {
    stopMeter();
    const ctx = state.audioCtx;
    const mix = state.mixNode;
    if (!ctx || !mix) {
      el.meterLabel.textContent = '音频电平（无音轨）';
      return;
    }
    el.meterLabel.textContent = '音频电平';
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    mix.connect(analyser);
    state.analyser = analyser;
    const buf = new Uint8Array(analyser.fftSize);
    const draw = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      el.meterFill.style.width = Math.min(100, rms * 340).toFixed(1) + '%';
    };
    const raf = () => {
      draw();
      state.meterRaf = requestAnimationFrame(raf);
    };
    state.meterRaf = requestAnimationFrame(raf);
    state.meterTimer = setInterval(() => {
      if (document.hidden) draw();
    }, 200);
  }

  function stopMeter() {
    if (state.meterRaf) cancelAnimationFrame(state.meterRaf);
    if (state.meterTimer) clearInterval(state.meterTimer);
    state.meterRaf = 0;
    state.meterTimer = 0;
    el.meterFill.style.width = '0%';
  }

  /* ---------------- 画布合成 ---------------- */
  function applyCanvasSize(canvas) {
    const vw = el.preview.videoWidth || 1280;
    const vh = el.preview.videoHeight || 720;
    const limit = Number(el.maxHeight.value) || 0;
    let w = vw;
    let h = vh;
    if (limit && h > limit) {
      const k = limit / h;
      w = Math.round(vw * k);
      h = limit;
    }
    w -= w % 2;
    h -= h % 2;
    canvas.width = Math.max(2, w);
    canvas.height = Math.max(2, h);
  }

  function pipGeometry(W, H) {
    const base = Math.min(W, H);
    const sizePct = Number(el.pipSize.value) / 100;
    const circle = el.pipCircle.checked;
    const pad = Math.max(2, base * 0.012);
    const camW = el.cam.videoWidth;
    const camH = el.cam.videoHeight;
    const ar = camW && camH ? camW / camH : 4 / 3;
    const w = base * sizePct;
    const h = circle ? w : w / ar;
    const cx = clamp(state.pip.x * W, w / 2 + pad, W - w / 2 - pad);
    const cy = clamp(state.pip.y * H, h / 2 + pad, H - h / 2 - pad);
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, circle, base };
  }

  function drawPip(ctx, W, H) {
    const cam = el.cam;
    if (!cam.videoWidth) return;
    const g = pipGeometry(W, H);
    const radius = Math.min(g.w, g.h) * 0.12;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.38)';
    ctx.shadowBlur = g.base * 0.018;
    ctx.shadowOffsetY = g.base * 0.006;
    if (g.circle) {
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.w / 2, 0, Math.PI * 2);
    } else {
      roundRect(ctx, g.x, g.y, g.w, g.h, radius);
    }
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (g.circle) {
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.w / 2, 0, Math.PI * 2);
    } else {
      roundRect(ctx, g.x, g.y, g.w, g.h, radius);
    }
    ctx.clip();
    if (el.pipMirror.checked) {
      ctx.translate(g.x + g.w, g.y);
      ctx.scale(-1, 1);
      ctx.drawImage(cam, 0, 0, g.w, g.h);
    } else {
      ctx.drawImage(cam, g.x, g.y, g.w, g.h);
    }
    ctx.restore();

    ctx.save();
    if (g.circle) {
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.w / 2 - 1, 0, Math.PI * 2);
    } else {
      roundRect(ctx, g.x + 1, g.y + 1, g.w - 2, g.h - 2, radius);
    }
    ctx.lineWidth = Math.max(2, g.base * 0.004);
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.stroke();
    ctx.restore();
  }

  function drawClock(ctx, W, H) {
    const text = formatDuration(currentElapsed());
    const base = Math.min(W, H);
    const fs = Math.max(13, Math.round(base * 0.026));
    const padX = Math.round(fs * 0.55);
    const padY = Math.round(fs * 0.34);
    ctx.save();
    ctx.font = '600 ' + fs + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = fs + padY * 2;
    const x = Math.round(base * 0.02);
    const y = H - bh - Math.round(base * 0.02);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    roundRect(ctx, x, y, bw, bh, fs * 0.42);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + padX, y + bh / 2 + 1);
    ctx.restore();
  }

  function drawFrame() {
    const canvas = state.canvas;
    const ctx = state.ctx;
    if (!canvas || !ctx) return;
    const video = el.preview;
    if (!video.videoWidth) return;
    const sig = video.videoWidth + 'x' + video.videoHeight;
    if (sig !== state.lastVideoSize) {
      state.lastVideoSize = sig;
      applyCanvasSize(canvas);
    }
    const W = canvas.width;
    const H = canvas.height;
    try {
      ctx.drawImage(video, 0, 0, W, H);
      if (el.camToggle.checked) drawPip(ctx, W, H);
      if (el.clock.checked) drawClock(ctx, W, H);
    } catch (e) {
      /* 视频尚未就绪时忽略 */
    }
  }

  function startDrawLoop() {
    stopDrawLoop();
    drawFrame();
    const raf = () => {
      drawFrame();
      state.drawRaf = requestAnimationFrame(raf);
    };
    state.drawRaf = requestAnimationFrame(raf);
    // 后台标签页里 rAF 会暂停，用定时器兜底保证人像小窗不冻结
    state.drawTimer = setInterval(() => {
      if (document.hidden) drawFrame();
    }, 120);
  }

  function stopDrawLoop() {
    if (state.drawRaf) cancelAnimationFrame(state.drawRaf);
    if (state.drawTimer) clearInterval(state.drawTimer);
    state.drawRaf = 0;
    state.drawTimer = 0;
  }

  /* ---------------- 计时与 UI 同步 ---------------- */
  function currentElapsed() {
    const running = state.recording && !state.paused && state.startedAt;
    return state.elapsedBase + (running ? Date.now() - state.startedAt : 0);
  }

  function updateHud() {
    const text = formatDuration(currentElapsed());
    el.hudTimer.textContent = text;
    el.hudSize.textContent = formatBytes(state.recordedSize);
    const showClock = state.recording && el.clock.checked;
    el.clockOverlay.hidden = !showClock;
    if (showClock) el.clockOverlay.textContent = text;
  }

  function syncControls() {
    const busy = state.recording;
    el.btnStart.disabled = busy || state.starting || !state.supported;
    el.btnPause.disabled = !busy;
    el.btnStop.disabled = !busy;
    el.btnClear.disabled = busy || el.freeze.hidden;
    el.btnPause.textContent = state.paused ? '继续录制' : '暂停';
    document.body.classList.toggle('is-recording', busy);
    document.body.classList.toggle('is-paused', busy && state.paused);
    document.querySelectorAll('.settings .group').forEach((group) => {
      group.classList.toggle('locked', busy && group.id !== 'pipGroup');
    });
    // 录制中只有走画布合成时才能开关摄像头：直出屏幕轨时无法中途再叠加
    const camLocked = busy && !state.canvas;
    el.camToggle.disabled = camLocked;
    el.camSelect.disabled = camLocked;
    el.camToggle.parentElement.title = camLocked
      ? '本次录制用的是原始屏幕画面，无法中途叠加摄像头；下次录制前勾选即可'
      : '';
  }

  function updatePipSizeOut() {
    el.pipSizeOut.textContent = el.pipSize.value + '%';
  }

  function syncCamUI() {
    el.camSelectRow.hidden = !el.camToggle.checked;
  }

  function syncCompositeUI() {
    const composite = el.camToggle.checked || el.clock.checked;
    el.maxHeight.disabled = !composite;
    el.maxHeightHint.textContent = composite
      ? '画布合成的输出上限，越小越省 CPU，超出部分等比缩小。'
      : '只在画布合成时生效（开启摄像头或时间水印）。';
  }

  function updatePipLayout() {
    const rect = el.stage.getBoundingClientRect();
    if (rect.height) {
      el.clockOverlay.style.fontSize = Math.max(10, Math.round(rect.height * 0.026)) + 'px';
    }
    if (el.pip.hidden) return;
    if (!rect.width || !rect.height) return;
    const base = Math.min(rect.width, rect.height);
    const sizePct = Number(el.pipSize.value) / 100;
    const circle = el.pipCircle.checked;
    const camW = el.cam.videoWidth;
    const camH = el.cam.videoHeight;
    const ar = camW && camH ? camW / camH : 4 / 3;
    const w = base * sizePct;
    const h = circle ? w : w / ar;
    const pad = Math.max(2, base * 0.012);
    const x = clamp(state.pip.x * rect.width, w / 2 + pad, rect.width - w / 2 - pad);
    const y = clamp(state.pip.y * rect.height, h / 2 + pad, rect.height - h / 2 - pad);
    el.pip.style.width = w + 'px';
    el.pip.style.height = h + 'px';
    el.pip.style.left = x + 'px';
    el.pip.style.top = y + 'px';
    el.pip.style.borderRadius = circle ? '50%' : Math.round(Math.min(w, h) * 0.12) + 'px';
    el.cam.style.transform = el.pipMirror.checked ? 'scaleX(-1)' : '';
  }

  /* 小窗只在真正有摄像头画面时才显示，避免首帧未到就出现空框占位 */
  function syncPipPreview() {
    if (!el.camToggle.checked || !camStreamLive() || el.cam.videoWidth <= 0) {
      el.pip.hidden = true;
      return;
    }
    el.pip.hidden = false;
    updatePipLayout();
  }

  function applyPipPreset(name) {
    const map = {
      br: [0.84, 0.84],
      bl: [0.16, 0.84],
      tr: [0.84, 0.16],
      tl: [0.16, 0.16],
      center: [0.5, 0.5]
    };
    if (!map[name]) return;
    state.pip.x = map[name][0];
    state.pip.y = map[name][1];
    updatePipLayout();
  }

  function runCountdown(seconds) {
    return new Promise((resolve, reject) => {
      const box = el.countdown;
      box.textContent = '';
      const num = document.createElement('div');
      const tip = document.createElement('small');
      tip.textContent = '倒计时结束后自动开始录制 · 点此取消';
      box.appendChild(num);
      box.appendChild(tip);
      box.hidden = false;

      let left = seconds;
      let timer = 0;
      const cleanup = () => {
        if (timer) clearInterval(timer);
        box.hidden = true;
        box.textContent = '';
        box.onclick = null;
        state.countdownTimer = 0;
        state.countdownDone = null;
      };
      state.countdownDone = () => {
        cleanup();
        reject(new Error('countdown-cancelled'));
      };
      box.onclick = state.countdownDone;
      num.textContent = String(left);
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          cleanup();
          resolve();
          return;
        }
        num.textContent = String(left);
      }, 1000);
      state.countdownTimer = timer;
    });
  }

  /* ---------------- 开始录制 ---------------- */
  async function startRecording() {
    if (state.recording || state.starting || !state.supported) return;
    state.starting = true;
    state.finalized = false;
    state.stopToken += 1;
    ensureAudioContext();
    syncControls();
    setWarn('');
    setStatus('准备开始…');

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('当前浏览器不支持屏幕录制（getDisplayMedia）');
      }
      const fps = Number(el.fps.value);

      setStatus('请在弹窗里选择要共享的屏幕 / 窗口 / 标签页…');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: fps, max: fps },
          cursor: el.cursor.value
        },
        audio: el.systemAudio.checked
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false
      });
      state.screenStream = screenStream;

      el.preview.srcObject = screenStream;
      el.preview.play().catch(() => {});
      el.stageEmpty.hidden = true;
      el.freeze.hidden = true;

      let camStream = null;
      if (el.camToggle.checked) {
        camStream = await ensureCamStream();
      }
      if (!camStream) el.pip.hidden = true;

      let micStream = null;
      if (el.mic.checked) {
        micStream = await openMic();
      }
      if (micStream) state.micStream = micStream;

      const audioTrack = await buildAudioTrack(screenStream, micStream);
      state.hasAudio = !!audioTrack;
      if (!audioTrack && el.warn.hidden) {
        setWarn('本次录制没有音轨：未勾选声音，或共享时没有勾选「分享音频」。');
      }

      const composite = !!camStream || el.clock.checked;
      let videoTrack = null;
      if (composite) {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        state.canvas = canvas;
        state.ctx = canvas.getContext('2d', { alpha: false });
        state.lastVideoSize = '';
        applyCanvasSize(canvas);
        drawFrame();
        state.canvasStream = canvas.captureStream(Math.max(10, Number(el.fps.value)));
        videoTrack = state.canvasStream.getVideoTracks()[0];
        startDrawLoop();
      } else {
        videoTrack = screenStream.getVideoTracks()[0];
      }

      const outStream = new MediaStream();
      if (videoTrack) outStream.addTrack(videoTrack);
      if (audioTrack) outStream.addTrack(audioTrack);
      state.outStream = outStream;

      // 共享画面、摄像头、音量都已就绪，倒计时给用户留出切到待录窗口的时间
      const countdown = Number(el.countdownOpt.value);
      if (countdown > 0) {
        setStatus('共享画面已就绪，倒计时结束后自动开始录制…');
        await runCountdown(countdown);
      }

      const picked = chooseMime();
      state.mime = picked.mime;
      state.ext = picked.ext;
      const options = { videoBitsPerSecond: Number(el.bitrate.value) };
      if (audioTrack) options.audioBitsPerSecond = 128000;
      if (picked.mime) options.mimeType = picked.mime;

      const recorder = new MediaRecorder(outStream, options);
      state.recorder = recorder;
      state.chunks = [];
      state.recordedSize = 0;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) {
          state.chunks.push(event.data);
          state.recordedSize += event.data.size;
        }
      };
      recorder.onerror = (event) => {
        setWarn('录制出错：' + explainError(event.error) + '，已尽量保留已录内容。');
        stopRecording();
      };
      recorder.onstop = () => finalizeRecording();
      recorder.start(1000);

      state.recording = true;
      state.paused = false;
      state.stopping = false;
      state.startedAt = Date.now();
      state.elapsedBase = 0;
      syncPipPreview();
      el.hud.hidden = false;
      updateHud();
      state.tickTimer = setInterval(updateHud, 250);
      startMeter();
      setStatus('正在录制中，切换到其他应用也不会中断。画中画位置与摄像头可实时调整，其余设置已锁定。');

      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (state.recording && !state.stopping) {
          setStatus('共享已结束，正在生成文件…');
          stopRecording();
        }
      });

      saveSettings();
    } catch (err) {
      cleanupMedia();
      /* 没开成录时把舞台还原成空状态，不要留一块黑框 */
      if (el.freeze.hidden) {
        el.stageEmpty.hidden = false;
        el.stage.style.aspectRatio = '16 / 9';
      }
      restoreCamPreview();
      if (err && err.message === 'countdown-cancelled') {
        setWarn('');
        setStatus('已取消，没有开始录制。');
      } else {
        setWarn('录制没有开始：' + explainError(err));
        setStatus('等待开始');
      }
    } finally {
      state.starting = false;
      syncControls();
    }
  }

  function togglePause() {
    if (!state.recording || !state.recorder) return;
    if (state.recorder.state === 'recording') {
      state.recorder.pause();
      state.paused = true;
      state.elapsedBase += Date.now() - state.startedAt;
      setStatus('已暂停。切回本页再点「继续录制」可接着录。');
    } else if (state.recorder.state === 'paused') {
      state.recorder.resume();
      state.paused = false;
      state.startedAt = Date.now();
      setStatus('正在录制中，切换到其他应用也不会中断。画中画位置与摄像头可实时调整，其余设置已锁定。');
    }
    updateHud();
    syncControls();
  }

  function captureFreezeFrame() {
    const useCanvas = !!(state.canvas && state.canvas.width);
    const source = useCanvas ? state.canvas : el.preview;
    const sw = useCanvas ? state.canvas.width : el.preview.videoWidth;
    const sh = useCanvas ? state.canvas.height : el.preview.videoHeight;
    if (!sw || !sh) return;
    const scale = Math.min(1, 1280 / sw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(sw * scale));
    canvas.height = Math.max(2, Math.round(sh * scale));
    try {
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      el.freeze.src = canvas.toDataURL('image/jpeg', 0.82);
      el.freeze.hidden = false;
    } catch (e) {
      /* 截不到就忽略 */
    }
  }

  function stopRecording() {
    if (!state.recording || state.stopping) return;
    state.stopping = true;
    const token = state.stopToken;
    setStatus('正在生成录制文件…');
    captureFreezeFrame();
    const recorder = state.recorder;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (e) {
        finalizeRecording();
      }
    } else {
      finalizeRecording();
    }
    // 兜底：onstop 没有触发时也能收尾
    setTimeout(() => {
      if (state.stopping && state.stopToken === token) finalizeRecording();
    }, 4000);
  }

  function finalizeRecording() {
    if (state.finalized) return;
    state.finalized = true;
    const chunks = state.chunks.slice();
    const size = state.recordedSize;
    const duration = currentElapsed();
    const mime = state.mime;
    const ext = state.ext || 'webm';
    cleanupMedia();
    restoreCamPreview();

    if (!chunks.length || !size) {
      setWarn('这次没有录到内容（可能刚点开始就停止了）。');
      setStatus('等待开始');
      return;
    }
    const blob = new Blob(chunks, { type: mime ? mime.split(';')[0] : 'video/webm' });
    addResult(blob, ext, duration, size, { hasAudio: state.hasAudio, prefix: '录屏' });
    setStatus('已生成录制文件，记得点「下载」保存到本地。');
  }

  function cleanupMedia() {
    stopDrawLoop();
    stopMeter();
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = 0;
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = 0;
    el.countdown.hidden = true;

    [state.screenStream, state.camStream, state.micStream, state.canvasStream].forEach((stream) => {
      if (!stream) return;
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch (e) { /* 忽略 */ }
      });
    });
    if (state.outStream) {
      state.outStream.getTracks().forEach((track) => {
        try { track.stop(); } catch (e) { /* 忽略 */ }
      });
    }
    if (state.audioCtx) {
      try { state.audioCtx.close(); } catch (e) { /* 忽略 */ }
    }

    state.screenStream = null;
    state.camStream = null;
    state.micStream = null;
    state.canvasStream = null;
    state.outStream = null;
    state.audioCtx = null;
    state.mixNode = null;
    state.analyser = null;
    state.canvas = null;
    state.ctx = null;
    state.recorder = null;
    state.lastVideoSize = '';
    state.recording = false;
    state.paused = false;
    state.stopping = false;
    state.startedAt = 0;
    state.elapsedBase = 0;

    el.preview.srcObject = null;
    el.cam.srcObject = null;
    el.pip.hidden = true;
    el.hud.hidden = true;
    el.meterLabel.textContent = '音频电平';
    el.hudTimer.textContent = '00:00:00';
    el.hudSize.textContent = '0 B';
    el.clockOverlay.hidden = true;
    syncControls();
  }

  function clearPreview() {
    if (state.recording) return;
    el.freeze.hidden = true;
    el.freeze.removeAttribute('src');
    el.preview.srcObject = null;
    el.stageEmpty.hidden = false;
    el.stage.style.aspectRatio = '16 / 9';
    el.hud.hidden = true;
    el.hudTimer.textContent = '00:00:00';
    el.hudSize.textContent = '0 B';
    el.clockOverlay.hidden = true;
    setWarn('');
    setStatus('等待开始');
    syncControls();
  }

  /* ---------------- 录制结果 ---------------- */
  function downloadItem(item) {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function formatLabel(mime) {
    if (!mime) return '未知格式';
    if (mime.indexOf('mp4') >= 0) return 'MP4';
    if (mime.indexOf('webm') >= 0) return 'WebM';
    if (mime.indexOf('webp') >= 0) return 'WebP 动图';
    return mime;
  }

  /* MediaRecorder 是边录边写的，WebM 头部没有总时长，浏览器要扫到文件尾才知道，
     这里加载完元数据后偷偷跳到末尾再弹回开头，让控制条立刻显示真实时长 */
  function probeDuration(video) {
    video.addEventListener('loadedmetadata', () => {
      if (video.duration > 0 && isFinite(video.duration)) return;
      const restore = () => {
        video.removeEventListener('seeked', restore);
        try { video.currentTime = 0; } catch (e) { /* 忽略 */ }
      };
      video.addEventListener('seeked', restore);
      try {
        video.currentTime = 1e101;
      } catch (e) {
        video.removeEventListener('seeked', restore);
      }
    }, { once: true });
  }

  function buildResultCard(item) {
    const card = document.createElement('article');
    card.className = 'result';

    if (item.kind === 'image') {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = item.url;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      probeDuration(video);
      card.appendChild(video);
    }

    const body = document.createElement('div');
    body.className = 'result-body';

    const name = document.createElement('div');
    name.className = 'result-name';
    name.textContent = item.name;
    if (item.tag) {
      const tag = document.createElement('span');
      tag.className = 'result-tag';
      tag.textContent = item.tag;
      name.appendChild(tag);
    }
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const parts = [];
    if (item.kind !== 'image' && item.duration) parts.push('时长 ' + formatDuration(item.duration));
    parts.push(formatBytes(item.size));
    parts.push(formatLabel(item.mime));
    if (item.kind === 'image') parts.push('无音频');
    meta.textContent = parts.join(' · ');
    body.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'result-actions';

    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'btn tiny primary';
    dl.textContent = '下载';
    dl.addEventListener('click', () => downloadItem(item));
    actions.appendChild(dl);

    if (item.kind === 'video') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn tiny';
      edit.textContent = '剪辑 / 导出';
      edit.addEventListener('click', () => openEditor(item));
      actions.appendChild(edit);
    }

    const open = document.createElement('a');
    open.className = 'btn tiny';
    open.textContent = '新窗口打开';
    open.href = item.url;
    open.target = '_blank';
    open.rel = 'noopener';
    actions.appendChild(open);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn tiny danger';
    del.textContent = '删除';
    del.addEventListener('click', () => removeResult(item));
    actions.appendChild(del);

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function renderResults() {
    el.resultCount.textContent = String(state.results.length);
    el.resultEmpty.hidden = state.results.length > 0;
    el.btnDownloadAll.disabled = state.results.length === 0;
    el.resultList.textContent = '';
    state.results.forEach((item) => {
      el.resultList.appendChild(buildResultCard(item));
    });
    syncControls();
  }

  function addResult(blob, ext, duration, size, options) {
    const opts = options || {};
    const item = {
      url: URL.createObjectURL(blob),
      name: buildFileName(ext, opts.prefix),
      blob: blob,
      mime: blob.type,
      duration: duration,
      size: size,
      kind: opts.kind || 'video',
      hasAudio: !!opts.hasAudio,
      tag: opts.tag || ''
    };
    state.results.push(item);
    renderResults();
    if (el.autoDownload.checked) downloadItem(item);
    return item;
  }

  function removeResult(item) {
    const index = state.results.indexOf(item);
    if (index >= 0) state.results.splice(index, 1);
    URL.revokeObjectURL(item.url);
    renderResults();
  }

  /* 把最新一条结果滚进视野并高亮一下，避免导出完不知道去哪了 */
  function revealLatestResult() {
    const card = el.resultList.lastElementChild;
    if (!card) return;
    try {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      card.scrollIntoView();
    }
    card.classList.add('fresh');
    setTimeout(() => card.classList.remove('fresh'), 1800);
  }

  /* ---------------- 剪辑 / 导出 ---------------- */
  const editor = {
    item: null,
    duration: 0,
    start: 0,
    end: 0,
    exporting: false,
    cancelled: false,
    dragging: null
  };

  function formatShort(seconds) {
    const total = Math.max(0, Math.round(seconds));
    return Math.floor(total / 60) + ':' + pad2(total % 60);
  }

  function setEditorWarn(text) {
    if (!text) {
      el.editorWarn.hidden = true;
      el.editorWarn.textContent = '';
      return;
    }
    el.editorWarn.textContent = text;
    el.editorWarn.hidden = false;
  }

  function setEditProgress(ratio, text) {
    const pct = clamp(ratio * 100, 0, 100);
    el.editorProgressFill.style.width = pct.toFixed(1) + '%';
    el.editorProgressText.textContent = text || Math.round(pct) + '%';
    el.editorProgress.hidden = !(ratio > 0);
  }

  function syncEditorFormatUI() {
    const isWebp = el.editFormat.value === 'webp';
    el.editQualityRow.hidden = !isWebp;
    el.editBitrateRow.hidden = isWebp;
    el.editQualityOut.textContent = el.editQuality.value;
    el.editFps.value = isWebp ? '12' : '30';
    el.editMaxHeight.value = isWebp ? '480' : '0';
    el.editorHint.textContent = isWebp
      ? '动画 WebP 无音频，逐帧抽帧编码，文件通常比视频小很多，适合做演示动图。'
      : '视频导出按片段时长实时重编码（10 秒片段约需 10 秒），导出期间请保持本页在前台。';
  }

  function updateEditorRange() {
    const d = editor.duration || 1;
    const sPct = (editor.start / d) * 100;
    const ePct = (editor.end / d) * 100;
    el.handleStart.style.left = sPct + '%';
    el.handleEnd.style.left = ePct + '%';
    el.timelineSelected.style.left = sPct + '%';
    el.timelineSelected.style.width = Math.max(0, ePct - sPct) + '%';
    el.editorRangeText.textContent = editor.start.toFixed(1) + 's ~ ' + editor.end.toFixed(1) + 's';
    el.editorRangeLen.textContent = '片段 ' + Math.max(0, editor.end - editor.start).toFixed(1) + ' 秒';
    el.trimStart.value = editor.start.toFixed(1);
    el.trimEnd.value = editor.end.toFixed(1);
  }

  function openEditor(item) {
    if (state.recording) {
      setStatus('录制中不能剪辑，请先停止录制。');
      return;
    }
    if (editor.exporting) return;
    editor.item = item;
    editor.duration = Math.max(0.2, item.duration / 1000);
    editor.start = 0;
    editor.end = editor.duration;
    editor.cancelled = false;

    setEditorWarn('');
    setEditProgress(0, '');
    el.editorTitle.textContent = '剪辑 / 导出 · ' + formatLabel(item.mime);
    el.editorMask.hidden = false;
    el.editor.src = item.url;
    el.editor.currentTime = 0;
    el.timelineEndLabel.textContent = formatShort(editor.duration);
    el.editFormat.value = 'video';
    el.editFps.value = '30';
    el.editMaxHeight.value = '0';
    syncEditorFormatUI();
    updateEditorRange();
    el.editor.addEventListener('loadedmetadata', syncEditorDurationFromVideo, { once: true });
    el.editor.play().catch(() => {});
  }

  function syncEditorDurationFromVideo() {
    const d = el.editor.duration;
    if (!d || !isFinite(d) || d <= 0) return;
    const wasFull = editor.end >= editor.duration - 0.05;
    editor.duration = d;
    editor.end = wasFull ? d : Math.min(editor.end, d);
    editor.start = Math.min(editor.start, Math.max(0, editor.end - 0.2));
    el.timelineEndLabel.textContent = formatShort(d);
    updateEditorRange();
  }

  function teardownEditor() {
    el.editor.pause();
    el.editor.removeAttribute('src');
    try { el.editor.load(); } catch (e) { /* 忽略 */ }
    el.editorMask.hidden = true;
    editor.item = null;
    setEditorWarn('');
    setEditProgress(0, '');
  }

  function closeEditor() {
    if (editor.exporting) {
      editor.cancelled = true;
      return;
    }
    teardownEditor();
  }

  function setExporting(on) {
    editor.exporting = on;
    if (!on) editor.cancelled = false;
    el.btnEditorExport.disabled = on;
    el.btnEditorAbort.hidden = !on;
    el.btnEditorCancel.disabled = on;
    el.editorClose.disabled = on;
    [el.trimStart, el.trimEnd, el.editFormat, el.editFps, el.editMaxHeight,
      el.editQuality, el.editBitrate].forEach((input) => {
      input.disabled = on;
    });
  }

  function startEditorExport() {
    if (!editor.item || editor.exporting) return;
    if (el.editFormat.value === 'webp') {
      exportAnimatedWebp();
    } else {
      exportTrimVideo();
    }
  }

  function waitForVideoEvent(video, name, timeout) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener(name, finish);
        resolve();
      };
      video.addEventListener(name, finish, { once: true });
      setTimeout(finish, timeout || 5000);
    });
  }

  function seekVideoTo(video, time) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.005 && video.readyState >= 2) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      const onSeeked = () => {
        if (video.requestVideoFrameCallback) {
          video.requestVideoFrameCallback(() => finish());
          setTimeout(finish, 150);
        } else {
          requestAnimationFrame(() => finish());
        }
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      setTimeout(finish, 1500);
      try {
        video.currentTime = time;
      } catch (e) {
        finish();
      }
    });
  }

  function fitExportSize(vw, vh, limit) {
    let w = vw;
    let h = vh;
    if (limit && h > limit) {
      const k = limit / h;
      w = Math.round(vw * k);
      h = limit;
    }
    w = Math.max(2, w - (w % 2));
    h = Math.max(2, h - (h % 2));
    return { w: w, h: h };
  }

  /* 剪辑导出：把选中片段重新录制一遍（canvas + 原声） */
  async function exportTrimVideo() {
    const item = editor.item;
    const start = editor.start;
    const end = editor.end;
    const span = end - start;
    if (!item) return;
    if (span < 0.2) {
      setEditorWarn('片段太短了，至少保留 0.2 秒。');
      return;
    }

    const fps = Number(el.editFps.value) || 30;
    const limit = Number(el.editMaxHeight.value) || 0;
    setEditorWarn('');
    setExporting(true);
    editor.cancelled = false;
    setEditProgress(0.001, '准备中…');

    let video = null;
    let audioCtx = null;
    let outStream = null;
    let recorder = null;
    let rafId = 0;
    let timer = 0;
    let ended = false;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (timer) clearInterval(timer);
      if (audioCtx) { try { audioCtx.close(); } catch (e) { /* 忽略 */ } }
      if (outStream) {
        outStream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) { /* 忽略 */ }
        });
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        try { video.load(); } catch (e) { /* 忽略 */ }
      }
      setExporting(false);
    };

    try {
      video = document.createElement('video');
      video.src = item.url;
      video.playsInline = true;
      video.preload = 'auto';
      await waitForVideoEvent(video, 'loadedmetadata', 6000);

      const size = fitExportSize(video.videoWidth || 1280, video.videoHeight || 720, limit);
      const canvas = document.createElement('canvas');
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext('2d', { alpha: false });

      outStream = new MediaStream();
      const canvasStream = canvas.captureStream(fps);
      canvasStream.getVideoTracks().forEach((track) => outStream.addTrack(track));

      if (item.hasAudio) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          audioCtx = new Ctx();
          try {
            if (audioCtx.state === 'suspended') await audioCtx.resume();
          } catch (e) { /* 忽略 */ }
          const source = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          dest.stream.getAudioTracks().forEach((track) => outStream.addTrack(track));
        }
      }

      const picked = chooseMime();
      const recOptions = { videoBitsPerSecond: Number(el.editBitrate.value) || 5000000 };
      if (item.hasAudio) recOptions.audioBitsPerSecond = 128000;
      if (picked.mime) recOptions.mimeType = picked.mime;

      const chunks = [];
      let recorded = 0;
      recorder = new MediaRecorder(outStream, recOptions);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) {
          chunks.push(event.data);
          recorded += event.data.size;
        }
      };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

      const drawOnce = () => {
        if (ended) return;
        if (editor.cancelled) {
          ended = true;
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        if (video.readyState >= 2) {
          try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (e) { /* 忽略 */ }
        }
        const ratio = clamp((video.currentTime - start) / span, 0, 1);
        setEditProgress(ratio, Math.round(ratio * 100) + '%');
        if (video.currentTime >= end || video.ended) {
          ended = true;
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
        }
      };

      await seekVideoTo(video, start);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      recorder.start(500);
      await video.play();

      const loop = () => {
        drawOnce();
        if (!ended) rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
      timer = setInterval(() => {
        if (document.hidden) drawOnce();
      }, 120);

      await stopped;
      const wasCancelled = editor.cancelled;
      cleanup();

      if (wasCancelled) {
        setEditorWarn('');
        setEditProgress(0, '');
        setStatus('已中止剪辑导出。');
        return;
      }
      if (chunks.length && recorded > 0) {
        const blob = new Blob(chunks, { type: picked.mime ? picked.mime.split(';')[0] : 'video/webm' });
        addResult(blob, picked.ext || 'webm', span * 1000, blob.size, {
          hasAudio: item.hasAudio,
          prefix: '剪辑',
          tag: '剪辑'
        });
        setEditProgress(1, '完成');
        teardownEditor();
        revealLatestResult();
        setStatus('剪辑导出完成，已加入下方录制结果列表。');
      } else {
        setEditProgress(0, '');
        setEditorWarn('没有拿到任何数据，请重试或换个导出格式。');
      }
      return;
    } catch (err) {
      setEditProgress(0, '');
      setEditorWarn('导出失败：' + explainError(err));
    } finally {
      cleanup();
    }
  }

  /* ---------------- 动画 WebP 编码 ---------------- */
  function u24(value) {
    const v = Math.max(0, Math.min(0xffffff, Math.round(value)));
    return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff]);
  }

  function u32le(value) {
    const v = value >>> 0;
    return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  }

  function asciiBytes(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  function concatBytes(list) {
    let total = 0;
    for (let i = 0; i < list.length; i += 1) total += list[i].length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < list.length; i += 1) {
      out.set(list[i], offset);
      offset += list[i].length;
    }
    return out;
  }

  /* 按 RIFF 规范拼一个 WebP 子块（奇数长度补 0，补位不计入长度） */
  function webpChunk(fourcc, payload) {
    const header = concatBytes([asciiBytes(fourcc), u32le(payload.length)]);
    const out = new Uint8Array(header.length + payload.length + (payload.length % 2));
    out.set(header, 0);
    out.set(payload, header.length);
    return out;
  }

  function canvasToWebp(canvas, quality) {
    return new Promise((resolve) => {
      if (!canvas.toBlob) {
        resolve(null);
        return;
      }
      try {
        canvas.toBlob((blob) => resolve(blob || null), 'image/webp', quality);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /* 从单帧 WebP 文件里取出位图块（ALPH / VP8 / VP8L），用作 ANMF 的子块 */
  function decodeWebpFrame(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 12) return null;
    if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return null;
    if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return null;
    const parts = [];
    let pos = 12;
    while (pos + 8 <= bytes.length) {
      const fourcc = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      const size = (bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)) >>> 0;
      const bodyStart = pos + 8;
      const bodyEnd = Math.min(bytes.length, bodyStart + size);
      if (bodyStart >= bytes.length) break;
      if (fourcc === 'ALPH' || fourcc === 'VP8 ' || fourcc === 'VP8L') {
        parts.push(webpChunk(fourcc, bytes.slice(bodyStart, bodyEnd)));
      }
      pos = bodyStart + size + (size % 2);
    }
    if (!parts.length) return null;
    return concatBytes(parts);
  }

  /* 手工组装 animated WebP：RIFF(webp) → VP8X → ANIM → ANMF* */
  function buildAnimatedWebp(frames, width, height, delayMs, loopCount) {
    const w = Math.max(1, Math.min(16384, width));
    const h = Math.max(1, Math.min(16384, height));
    const delay = Math.max(10, Math.min(0xffffff, Math.round(delayMs)));
    const loop = clamp(Math.round(loopCount), 0, 65535);

    const vp8x = webpChunk('VP8X', concatBytes([
      new Uint8Array([0x02, 0x00, 0x00, 0x00]),
      u24(w - 1),
      u24(h - 1)
    ]));

    const anim = webpChunk('ANIM', concatBytes([
      new Uint8Array([0x00, 0x00, 0x00, 0x00]),
      new Uint8Array([loop & 0xff, (loop >>> 8) & 0xff])
    ]));

    const frameChunks = frames.map((frame) => webpChunk('ANMF', concatBytes([
      u24(0), u24(0),
      u24(w - 1), u24(h - 1),
      u24(delay),
      new Uint8Array([0x02]),
      frame
    ])));

    const body = concatBytes([asciiBytes('WEBP'), vp8x, anim].concat(frameChunks));
    const out = new Uint8Array(8 + body.length);
    out.set(asciiBytes('RIFF'), 0);
    out.set(u32le(body.length), 4);
    out.set(body, 8);
    return new Blob([out], { type: 'image/webp' });
  }

  /* 导出动画 WebP：逐帧 seek 抓图，再打包成动图 */
  async function exportAnimatedWebp() {
    const item = editor.item;
    if (!item) return;
    const start = editor.start;
    const end = editor.end;
    const span = end - start;
    if (span < 0.2) {
      setEditorWarn('片段太短了，至少保留 0.2 秒。');
      return;
    }

    const fps = clamp(Number(el.editFps.value) || 12, 1, 30);
    const limit = Number(el.editMaxHeight.value) || 0;
    const quality = clamp((Number(el.editQuality.value) || 80) / 100, 0.3, 1);
    const total = Math.max(2, Math.round(span * fps));
    const maxFrames = 900;
    if (total > maxFrames) {
      setEditorWarn('片段太长：按 ' + fps + ' fps 需要 ' + total + ' 帧，上限 ' + maxFrames + ' 帧。请缩短片段或降低帧率。');
      return;
    }

    setEditorWarn('');
    setExporting(true);
    editor.cancelled = false;
    setEditProgress(0.001, '准备抽帧…');

    let video = null;
    try {
      video = document.createElement('video');
      video.src = item.url;
      video.playsInline = true;
      video.preload = 'auto';
      video.muted = true;
      await waitForVideoEvent(video, 'loadedmetadata', 6000);

      const size = fitExportSize(video.videoWidth || 1280, video.videoHeight || 720, limit);
      const canvas = document.createElement('canvas');
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext('2d', { alpha: false });
      const delay = 1000 / fps;
      const frames = [];
      let aborted = false;

      for (let i = 0; i < total; i += 1) {
        if (editor.cancelled) {
          aborted = true;
          break;
        }
        const time = Math.max(0, Math.min(end - 0.01, start + i / fps));
        await seekVideoTo(video, time);
        if (editor.cancelled) {
          aborted = true;
          break;
        }
        try { ctx.drawImage(video, 0, 0, size.w, size.h); } catch (e) { /* 忽略 */ }
        const blob = await canvasToWebp(canvas, quality);
        if (!blob) throw new Error('浏览器没有返回图像数据');
        if (blob.type !== 'image/webp') throw new Error('当前浏览器无法编码 WebP');
        const frame = decodeWebpFrame(await blob.arrayBuffer());
        if (!frame) throw new Error('WebP 帧数据解析失败');
        frames.push(frame);
        setEditProgress((i + 1) / total, '第 ' + (i + 1) + '/' + total + ' 帧');
      }

      if (aborted) {
        setEditorWarn('');
        setEditProgress(0, '');
        setStatus('已中止 WebP 导出。');
        return;
      }

      const animBlob = buildAnimatedWebp(frames, size.w, size.h, delay, 0);
      addResult(animBlob, 'webp', span * 1000, animBlob.size, {
        kind: 'image',
        prefix: '动图',
        tag: 'WebP'
      });
      setEditProgress(1, '完成');
      teardownEditor();
      revealLatestResult();
      setStatus('动画 WebP 导出完成，已加入下方录制结果列表。');
    } catch (err) {
      setEditProgress(0, '');
      setEditorWarn('导出失败：' + explainError(err));
    } finally {
      if (video) {
        try { video.pause(); } catch (e) { /* 忽略 */ }
        video.removeAttribute('src');
        try { video.load(); } catch (e) { /* 忽略 */ }
      }
      setExporting(false);
    }
  }

  /* ---------------- 剪辑面板交互 ---------------- */
  function bindTimeline() {
    const track = el.timeline.querySelector('.timeline-track');
    if (!track) return;
    let previewSeeking = false;

    const timeAt = (event) => {
      const rect = track.getBoundingClientRect();
      if (!rect.width || !editor.duration) return 0;
      return clamp((event.clientX - rect.left) / rect.width, 0, 1) * editor.duration;
    };

    const previewSeek = (time) => {
      if (previewSeeking || editor.exporting) return;
      previewSeeking = true;
      const done = () => { previewSeeking = false; };
      el.editor.addEventListener('seeked', done, { once: true });
      setTimeout(done, 500);
      try {
        el.editor.currentTime = clamp(time, 0, Math.max(0, editor.duration - 0.05));
      } catch (e) {
        done();
      }
    };

    const applyDrag = (event) => {
      if (!editor.dragging) return;
      const t = timeAt(event);
      if (editor.dragging === 'start') {
        editor.start = clamp(t, 0, editor.end - 0.2);
        previewSeek(editor.start);
      } else {
        editor.end = clamp(t, editor.start + 0.2, editor.duration);
        previewSeek(editor.end - 0.05);
      }
      updateEditorRange();
    };

    track.addEventListener('pointerdown', (event) => {
      if (editor.exporting || el.editorMask.hidden) return;
      const handle = event.target && event.target.closest ? event.target.closest('.timeline-handle') : null;
      let which = handle && handle.dataset ? handle.dataset.handle : '';
      if (!which) {
        const t = timeAt(event);
        which = Math.abs(t - editor.start) <= Math.abs(t - editor.end) ? 'start' : 'end';
      }
      editor.dragging = which;
      try { track.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      applyDrag(event);
      event.preventDefault();
    });

    track.addEventListener('pointermove', (event) => {
      if (!editor.dragging) return;
      applyDrag(event);
      event.preventDefault();
    });

    const stopDrag = (event) => {
      if (!editor.dragging) return;
      editor.dragging = null;
      try { track.releasePointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
    };
    track.addEventListener('pointerup', stopDrag);
    track.addEventListener('pointercancel', stopDrag);
  }

  function bindEditor() {
    el.btnEditorExport.addEventListener('click', startEditorExport);
    el.btnEditorCancel.addEventListener('click', () => {
      if (editor.exporting) {
        editor.cancelled = true;
        return;
      }
      closeEditor();
    });
    el.editorClose.addEventListener('click', closeEditor);
    el.btnEditorAbort.addEventListener('click', () => {
      if (!editor.exporting) return;
      editor.cancelled = true;
      setEditorWarn('正在中止导出…');
    });

    el.editFormat.addEventListener('change', syncEditorFormatUI);
    el.editQuality.addEventListener('input', () => {
      el.editQualityOut.textContent = el.editQuality.value;
    });

    el.trimStart.addEventListener('change', () => {
      const v = Number(el.trimStart.value);
      if (isFinite(v)) editor.start = clamp(v, 0, editor.end - 0.2);
      updateEditorRange();
    });
    el.trimEnd.addEventListener('change', () => {
      const v = Number(el.trimEnd.value);
      if (isFinite(v)) editor.end = clamp(v, editor.start + 0.2, editor.duration);
      updateEditorRange();
    });

    el.editorMask.addEventListener('click', (event) => {
      if (event.target !== el.editorMask || editor.exporting) return;
      closeEditor();
    });

    el.editor.addEventListener('timeupdate', () => {
      if (editor.exporting || el.editorMask.hidden) return;
      if (el.editor.currentTime > editor.end) {
        try { el.editor.currentTime = editor.start; } catch (e) { /* 忽略 */ }
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || el.editorMask.hidden) return;
      if (editor.exporting) return;
      event.preventDefault();
      closeEditor();
    });

    bindTimeline();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindPipDrag() {
    let dragging = false;
    el.pip.addEventListener('pointerdown', (event) => {
      if (el.pip.hidden) return;
      dragging = true;
      el.pip.classList.add('dragging');
      try { el.pip.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      event.preventDefault();
    });
    el.pip.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const rect = el.stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      state.pip.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      state.pip.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      el.pipPos.value = 'custom';
      updatePipLayout();
    });
    const end = (event) => {
      if (!dragging) return;
      dragging = false;
      el.pip.classList.remove('dragging');
      try { el.pip.releasePointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      saveSettings();
    };
    el.pip.addEventListener('pointerup', end);
    el.pip.addEventListener('pointercancel', end);
  }

  function bindEvents() {
    el.btnStart.addEventListener('click', () => startRecording());
    el.btnPause.addEventListener('click', togglePause);
    el.btnStop.addEventListener('click', () => stopRecording());
    el.btnClear.addEventListener('click', clearPreview);
    el.refreshDevices.addEventListener('click', () => refreshDeviceList(true));

    el.camToggle.addEventListener('change', () => {
      syncCamUI();
      syncCompositeUI();
      saveSettings();
      if (el.camToggle.checked) ensureCamStream();
      else stopCamStream();
    });
    el.camSelect.addEventListener('change', () => {
      saveSettings();
      if (!el.camToggle.checked) return;
      stopCamStream();
      ensureCamStream();
    });
    el.clock.addEventListener('change', () => {
      syncCompositeUI();
      saveSettings();
    });
    el.pipPos.addEventListener('change', () => {
      applyPipPreset(el.pipPos.value);
      saveSettings();
    });
    el.pipSize.addEventListener('input', () => {
      updatePipSizeOut();
      updatePipLayout();
    });
    el.pipSize.addEventListener('change', saveSettings);
    el.pipCircle.addEventListener('change', () => {
      updatePipLayout();
      saveSettings();
    });
    el.pipMirror.addEventListener('change', () => {
      updatePipLayout();
      saveSettings();
    });

    [el.systemAudio, el.mic, el.micSelect, el.fps, el.bitrate,
      el.format, el.maxHeight, el.cursor, el.countdownOpt, el.autoDownload]
      .forEach((input) => input.addEventListener('change', saveSettings));

    el.btnDownloadAll.addEventListener('click', () => {
      state.results.forEach((item, index) => {
        setTimeout(() => downloadItem(item), index * 350);
      });
    });

    el.preview.addEventListener('loadedmetadata', () => {
      if (el.preview.videoWidth && el.preview.videoHeight) {
        el.stage.style.aspectRatio = el.preview.videoWidth + ' / ' + el.preview.videoHeight;
      }
      updatePipLayout();
    });
    el.cam.addEventListener('loadedmetadata', updatePipLayout);
    el.cam.addEventListener('loadeddata', syncPipPreview);
    el.cam.addEventListener('playing', syncPipPreview);

    document.addEventListener('keydown', (event) => {
      if (!el.editorMask.hidden) return;
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 's') {
        event.preventDefault();
        if (state.recording) stopRecording();
        else startRecording();
      } else if (key === 'p') {
        event.preventDefault();
        togglePause();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.recording && state.canvas) {
        setStatus('页面在后台运行，画中画会降到低帧，回到本页后恢复正常。');
      } else if (!document.hidden && state.recording) {
        setStatus('正在录制中，切换到其他应用也不会中断。画中画位置与摄像头可实时调整，其余设置已锁定。');
      }
    });

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => updatePipLayout());
      ro.observe(el.stage);
    } else {
      window.addEventListener('resize', updatePipLayout);
    }

    bindEditor();
  }

  /* ---------------- 初始化 ---------------- */
  function checkSupport() {
    const problems = [];
    if (!window.isSecureContext) problems.push('当前页面不是安全上下文，需要 https 或 localhost 打开');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) problems.push('当前浏览器不支持屏幕录制接口');
    if (!window.MediaRecorder) problems.push('当前浏览器不支持 MediaRecorder');
    if (problems.length) {
      state.supported = false;
      setWarn(problems.join('；') + '。建议使用桌面版 Chrome / Edge。');
      setStatus('当前环境无法录制');
    }
  }

  function init() {
    fillFormatOptions();
    loadSettings();
    updatePipSizeOut();
    syncCamUI();
    syncCompositeUI();
    checkSupport();
    bindEvents();
    bindPipDrag();
    if (el.pipPos.value !== 'custom') applyPipPreset(el.pipPos.value);
    updatePipLayout();
    syncControls();
    refreshDeviceList(false);
    /* 上次勾选了摄像头就直接把预览小窗亮起来 */
    if (el.camToggle.checked) ensureCamStream();
  }

  init();

})();

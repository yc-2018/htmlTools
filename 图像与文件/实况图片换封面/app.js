(function exposeLivePhotoTool(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  api.init(document, window);
})(function createLivePhotoTool() {
  'use strict';

  const constants = Object.freeze({
    DEFAULT_JPG_QUALITY: 0.95,
    VIDEO_WARNING_SECONDS: 30,
    MAX_COVER_LONG_SIDE: 4096,
    MAX_COVER_PIXELS: 16000000
  });

  function bytesToText(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function encodeUtf8(text) {
    return new TextEncoder().encode(text);
  }

  function escapeXml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function assertJpegBytes(bytes, message = '文件不是 JPEG。') {
    if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(message);
  }

  function assertMp4Bytes(bytes, message = '视频不是支持的 MP4 文件。') {
    const head = bytesToText(bytes.subarray(0, Math.min(64, bytes.length)));
    if (head.indexOf('ftyp') === -1) throw new Error(message);
  }

  function jpegSegment(marker, payload) {
    const length = payload.length + 2;
    if (length > 65535) throw new Error('XMP 元数据太大。');
    const segment = new Uint8Array(length + 2);
    segment[0] = 0xff;
    segment[1] = marker;
    segment[2] = (length >> 8) & 0xff;
    segment[3] = length & 0xff;
    segment.set(payload, 4);
    return segment;
  }

  function makeXmp(videoLength, presentationUs = 0) {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
      xmlns:Container="http://ns.google.com/photos/1.0/container/"
      xmlns:Item="http://ns.google.com/photos/1.0/container/item/"
      GCamera:MotionPhoto="1"
      GCamera:MotionPhotoVersion="1"
      GCamera:MotionPhotoPresentationTimestampUs="${escapeXml(presentationUs)}">
      <Container:Directory><rdf:Seq>
        <rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary"/></rdf:li>
        <rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${videoLength}" Item:Padding="0"/></rdf:li>
      </rdf:Seq></Container:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
    return encodeUtf8(`http://ns.adobe.com/xap/1.0/\u0000${xmp}`);
  }

  function parseJpegSize(bytes) {
    assertJpegBytes(bytes, '原图不是 JPEG。');
    let pos = 2;
    while (pos < bytes.length - 8) {
      if (bytes[pos] !== 0xff) {
        pos += 1;
        continue;
      }
      while (pos < bytes.length && bytes[pos] === 0xff) pos += 1;
      const marker = bytes[pos];
      pos += 1;
      if (marker === 0xda) break;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = (bytes[pos] << 8) + bytes[pos + 1];
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        return {
          width: (bytes[pos + 5] << 8) + bytes[pos + 6],
          height: (bytes[pos + 3] << 8) + bytes[pos + 4]
        };
      }
      pos += length;
    }
    throw new Error('没有读到原图尺寸。');
  }

  function parseMotionInfo(bytes) {
    assertJpegBytes(bytes, '原图不是 JPEG，无法作为实况照片读取。');
    const head = bytesToText(bytes.subarray(0, Math.min(bytes.length, 200000)));
    let match = head.match(/Item:Semantic="MotionPhoto"\s+Item:Length="(\d+)"/);
    if (!match) match = head.match(/Item:Length="(\d+)"\s+Item:Padding="0"/);
    if (!match) throw new Error('没有找到实况照片的视频元数据。');
    const videoLength = Number(match[1]);
    if (!videoLength || videoLength >= bytes.length) throw new Error('读取到的视频长度异常。');
    const videoStart = bytes.length - videoLength;
    assertMp4Bytes(bytes.subarray(videoStart), '文件尾部没有读到 MP4 视频。');
    const timestamp = head.match(/GCamera:MotionPhotoPresentationTimestampUs="([0-9-]+)"/);
    return {
      videoStart,
      videoLength,
      presentationUs: timestamp ? Number(timestamp[1]) : 0,
      size: parseJpegSize(bytes)
    };
  }

  function shouldPreserveJpegMetadata(marker, payload, includeXmp) {
    if (marker < 0xe0 || marker > 0xef) return false;
    if (marker !== 0xe1) return true;
    const head = bytesToText(payload.subarray(0, 256));
    if (head.indexOf('http://ns.adobe.com/xap/1.0/') === -1) return true;
    return includeXmp;
  }

  function extractJpegMetadataSegments(bytes, includeXmp = false) {
    assertJpegBytes(bytes);
    const segments = [];
    let pos = 2;
    while (pos < bytes.length - 4) {
      if (bytes[pos] !== 0xff) {
        pos += 1;
        continue;
      }
      while (pos < bytes.length && bytes[pos] === 0xff) pos += 1;
      const marker = bytes[pos];
      const segmentStart = pos - 1;
      pos += 1;
      if (marker === 0xda) break;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = (bytes[pos] << 8) + bytes[pos + 1];
      const segmentEnd = pos + length;
      if (segmentEnd > bytes.length) break;
      if (shouldPreserveJpegMetadata(marker, bytes.subarray(pos + 2, segmentEnd), includeXmp)) {
        segments.push(bytes.slice(segmentStart, segmentEnd));
      }
      pos = segmentEnd;
    }
    return segments;
  }

  function hasJpegXmpSegment(segments) {
    return segments.some((segment) => segment[1] === 0xe1
      && bytesToText(segment.subarray(4, Math.min(segment.length, 260)))
        .includes('http://ns.adobe.com/xap/1.0/'));
  }

  function extractJpegImageBody(bytes) {
    assertJpegBytes(bytes);
    let pos = 2;
    while (pos < bytes.length - 4) {
      if (bytes[pos] !== 0xff) {
        pos += 1;
        continue;
      }
      while (pos < bytes.length && bytes[pos] === 0xff) pos += 1;
      const marker = bytes[pos];
      pos += 1;
      if (marker === 0xda) return bytes.subarray(pos - 2);
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = (bytes[pos] << 8) + bytes[pos + 1];
      if (marker < 0xe0 || marker > 0xef) return bytes.subarray(pos - 2);
      pos += length;
    }
    return bytes.subarray(2);
  }

  function composeMotionPhoto(
    coverBytes,
    videoBytes,
    presentationUs = 0,
    metadataSegments = [],
    includeGeneratedXmp = true
  ) {
    assertJpegBytes(coverBytes, '封面没有成功转换成 JPEG。');
    assertMp4Bytes(videoBytes);
    const xmp = includeGeneratedXmp ? jpegSegment(0xe1, makeXmp(videoBytes.length, presentationUs)) : null;
    const coverBody = metadataSegments.length ? extractJpegImageBody(coverBytes) : coverBytes.subarray(2);
    const metadataLength = metadataSegments.reduce((sum, segment) => sum + segment.length, 0);
    const output = new Uint8Array(2 + metadataLength + (xmp ? xmp.length : 0) + coverBody.length + videoBytes.length);
    let offset = 0;
    output.set(coverBytes.subarray(0, 2), offset);
    offset += 2;
    metadataSegments.forEach((segment) => {
      output.set(segment, offset);
      offset += segment.length;
    });
    if (xmp) {
      output.set(xmp, offset);
      offset += xmp.length;
    }
    output.set(coverBody, offset);
    offset += coverBody.length;
    output.set(videoBytes, offset);
    return output;
  }

  function getSafeCoverSize(size) {
    const width = Number(size.width || 0);
    const height = Number(size.height || 0);
    if (!width || !height || width <= 0 || height <= 0) throw new Error('封面尺寸读取失败。');
    const longSideScale = constants.MAX_COVER_LONG_SIDE / Math.max(width, height);
    const pixelScale = Math.sqrt(constants.MAX_COVER_PIXELS / (width * height));
    const scale = Math.min(1, longSideScale, pixelScale);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function getCoverSizeByVideoRatio(imageInfo, videoInfo) {
    const imageWidth = Number(imageInfo.width || 0);
    const imageHeight = Number(imageInfo.height || 0);
    const videoWidth = Number(videoInfo.width || 0);
    const videoHeight = Number(videoInfo.height || 0);
    if (!imageWidth || !imageHeight || !videoWidth || !videoHeight) throw new Error('没有读取到视频比例。');
    const targetRatio = videoWidth / videoHeight;
    return imageWidth / imageHeight > targetRatio
      ? { width: Math.max(1, Math.round(imageHeight * targetRatio)), height: imageHeight }
      : { width: imageWidth, height: Math.max(1, Math.round(imageWidth / targetRatio)) };
  }

  function gcd(a, b) {
    let left = Math.abs(Number(a) || 0);
    let right = Math.abs(Number(b) || 0);
    while (right) [left, right] = [right, left % right];
    return left || 1;
  }

  function formatVideoRatioText(info) {
    const width = Number(info.width || 0);
    const height = Number(info.height || 0);
    if (!width || !height) return '';
    const divisor = gcd(width, height);
    return `${width}×${height} · ${width / divisor}:${height / divisor}`;
  }

  function shouldWarnLongVideo(duration) {
    return Number(duration || 0) > constants.VIDEO_WARNING_SECONDS;
  }

  function bytesText(bytes) {
    if (!Number.isFinite(bytes)) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }

  function durationText(seconds) {
    const value = Number(seconds || 0);
    const minutes = Math.floor(value / 60);
    const remain = Math.round((value % 60) * 10) / 10;
    return minutes ? `${minutes}:${String(remain.toFixed(1)).padStart(4, '0')}` : `${remain.toFixed(1)} 秒`;
  }

  function baseName(name) {
    return String(name || '').replace(/\.[^.]+$/, '');
  }

  function normalizeOutputName(name, fallback) {
    const value = String(name || '').trim() || fallback;
    return /\.jpe?g$/i.test(value) ? value : `${value}.jpg`;
  }

  function init(document, window) {
    const get = (id) => document.getElementById(id);
    const state = {
      mode: 'replace', resultUrl: '',
      sourceLive: null, sourceBytes: null, sourceInfo: null,
      newCover: null, newCoverImage: null,
      cover: null, coverImage: null, croppedCover: null,
      video: null, videoInfo: null,
      urls: {}
    };
    const mediaElements = {
      sourceLive: { input: get('sourceLiveInput'), preview: get('sourceLivePreview'), empty: get('sourceLiveEmpty'), meta: get('sourceLiveMeta'), badge: get('sourceLiveState') },
      newCover: { input: get('newCoverInput'), preview: get('newCoverPreview'), empty: get('newCoverEmpty'), meta: get('newCoverMeta'), badge: get('newCoverState') },
      cover: { input: get('coverInput'), preview: get('coverPreview'), empty: get('coverEmpty'), meta: get('coverMeta'), badge: get('coverState') },
      video: { input: get('videoInput'), preview: get('videoPreview'), empty: get('videoEmpty'), meta: get('videoMeta'), badge: get('videoState') }
    };

    function setStatus(title, message, type = '') {
      get('statusTitle').textContent = title;
      get('statusMessage').textContent = message;
      get('statusDot').className = `status-dot ${type}`.trim();
    }

    function setBusy(button, busy, text) {
      button.disabled = busy;
      button.textContent = busy ? '处理中…' : text;
    }

    function replaceUrl(key, blob) {
      if (state.urls[key]) URL.revokeObjectURL(state.urls[key]);
      state.urls[key] = URL.createObjectURL(blob);
      return state.urls[key];
    }

    function showMedia(kind, file, detailText) {
      const elements = mediaElements[kind];
      const isVideo = kind === 'video';
      const url = replaceUrl(kind, file);
      elements.preview.src = url;
      elements.preview.hidden = false;
      elements.empty.hidden = true;
      elements.meta.textContent = detailText;
      elements.badge.textContent = '已选择';
      elements.badge.className = 'file-state ready';
      document.querySelector(`[data-clear-kind="${kind}"]`).hidden = false;
      if (isVideo) elements.preview.load();
    }

    function resetMediaView(kind) {
      const elements = mediaElements[kind];
      if (state.urls[kind]) URL.revokeObjectURL(state.urls[kind]);
      state.urls[kind] = '';
      elements.preview.removeAttribute('src');
      elements.preview.hidden = true;
      elements.empty.hidden = false;
      elements.meta.textContent = '等待选择文件';
      elements.badge.textContent = '未选择';
      elements.badge.className = 'file-state';
      elements.input.value = '';
      document.querySelector(`[data-clear-kind="${kind}"]`).hidden = true;
    }

    function clearKind(kind) {
      if (kind === 'sourceLive') {
        state.sourceLive = null; state.sourceBytes = null; state.sourceInfo = null;
      } else if (kind === 'newCover') {
        state.newCover = null; state.newCoverImage = null;
      } else if (kind === 'cover') {
        state.cover = null; state.coverImage = null; state.croppedCover = null;
        get('cropCoverButton').hidden = true;
      } else {
        state.video = null; state.videoInfo = null;
        get('cropCoverButton').hidden = true;
      }
      resetMediaView(kind);
    }

    function loadImage(blob) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败。')); };
        image.src = url;
      });
    }

    function loadVideoInfo(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          const info = { duration: video.duration || 0, width: video.videoWidth || 0, height: video.videoHeight || 0 };
          URL.revokeObjectURL(url);
          resolve(info);
        };
        video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('视频信息读取失败。')); };
        video.src = url;
      });
    }

    function showLongVideoWarning(info) {
      const dialog = get('videoWarningDialog');
      get('videoWarningText').textContent = `当前视频时长 ${durationText(info.duration)}。部分平台可能无法识别较长的实况视频，但你仍然可以继续使用。`;
      return new Promise((resolve) => {
        const finish = (action) => { dialog.close(); resolve(action); };
        get('keepLongVideoButton').onclick = (event) => { event.preventDefault(); finish('keep'); };
        get('clearLongVideoButton').onclick = (event) => { event.preventDefault(); finish('clear'); };
        get('reselectLongVideoButton').onclick = (event) => { event.preventDefault(); finish('reselect'); };
        dialog.showModal();
      });
    }

    async function selectSourceLive(file) {
      setStatus('正在校验', '正在读取实况照片中的视频数据…', 'working');
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = parseMotionInfo(bytes);
        state.sourceLive = file; state.sourceBytes = bytes; state.sourceInfo = info;
        showMedia('sourceLive', file, `${info.size.width}×${info.size.height} · 视频 ${bytesText(info.videoLength)}`);
        setStatus('实况照片有效', `已识别文件尾部 ${bytesText(info.videoLength)} 的 MP4 视频。`, 'success');
      } catch (error) {
        clearKind('sourceLive');
        mediaElements.sourceLive.badge.textContent = '校验失败';
        mediaElements.sourceLive.badge.className = 'file-state error';
        setStatus('不是支持的实况照片', error.message, 'error');
      }
    }

    async function selectImage(kind, file) {
      try {
        const detail = await loadImage(file);
        if (kind === 'cover') {
          state.cover = file; state.coverImage = detail; state.croppedCover = null;
        } else {
          state.newCover = file; state.newCoverImage = detail;
        }
        showMedia(kind, file, `${detail.width}×${detail.height} · ${bytesText(file.size)}`);
        if (kind === 'cover') get('cropCoverButton').hidden = !state.videoInfo;
        URL.revokeObjectURL(detail.url);
        setStatus('图片已选择', kind === 'cover' ? '请选择视频，或继续调整封面。' : '可以生成换封面实况照片。', 'success');
      } catch (error) {
        clearKind(kind);
        setStatus('图片读取失败', error.message, 'error');
      }
    }

    async function selectVideo(file) {
      try {
        const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
        assertMp4Bytes(head, '没有找到 MP4 ftyp 标记，请选择 MP4 视频。');
        const info = await loadVideoInfo(file);
        if (shouldWarnLongVideo(info.duration)) {
          const action = await showLongVideoWarning(info);
          if (action !== 'keep') {
            clearKind('video');
            if (action === 'reselect') window.setTimeout(() => mediaElements.video.input.click(), 0);
            return;
          }
        }
        state.video = file; state.videoInfo = info;
        showMedia('video', file, `${durationText(info.duration)} · ${formatVideoRatioText(info) || '比例未知'} · ${bytesText(file.size)}`);
        get('cropCoverButton').hidden = !state.coverImage;
        setStatus('视频已选择', '可以生成实况照片。', 'success');
      } catch (error) {
        clearKind('video');
        setStatus('视频读取失败', error.message, 'error');
      }
    }

    async function handleFile(kind, file) {
      if (!file) return;
      if (kind === 'sourceLive') return selectSourceLive(file);
      if (kind === 'video') return selectVideo(file);
      return selectImage(kind, file);
    }

    function drawImageToJpeg(image, options) {
      const canvas = document.createElement('canvas');
      canvas.width = options.width;
      canvas.height = options.height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const sourceWidth = image.naturalWidth;
      const sourceHeight = image.naturalHeight;
      if (options.fit === 'stretch') {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } else {
        const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
        const cropWidth = canvas.width / scale;
        const cropHeight = canvas.height / scale;
        context.drawImage(image, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
      }
      return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('封面 JPG 生成失败。')),
        'image/jpeg', options.quality
      ));
    }

    function qualityValue(input) {
      return Math.max(1, Math.min(100, Number(input.value) || 95)) / 100;
    }

    function publishResult(bytes, fileName, rows) {
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      const link = get('downloadLink');
      link.href = state.resultUrl;
      link.download = fileName;
      link.textContent = `下载 ${fileName}`;
      link.hidden = false;
      get('resultMeta').innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
      setStatus('生成完成', '文件已在浏览器本地生成，点击下方按钮下载。', 'success');
    }

    async function buildReplacement() {
      const button = get('replaceButton');
      if (!state.sourceInfo) return setStatus('缺少原实况照片', '请先选择并通过校验的实况照片。', 'error');
      if (!state.newCoverImage) return setStatus('缺少新封面', '请选择新封面图。', 'error');
      setBusy(button, true, '生成换封面实况照片');
      setStatus('正在生成', '正在裁切封面并组合视频数据…', 'working');
      try {
        const size = getSafeCoverSize(state.sourceInfo.size);
        const coverBlob = await drawImageToJpeg(state.newCoverImage.image, { ...size, fit: 'crop', quality: qualityValue(get('replaceQualityInput')) });
        const coverBytes = new Uint8Array(await coverBlob.arrayBuffer());
        const videoBytes = state.sourceBytes.subarray(state.sourceInfo.videoStart);
        const keepMetadata = get('keepMetadataInput').checked;
        const metadata = keepMetadata ? extractJpegMetadataSegments(state.sourceBytes, true) : [];
        const output = composeMotionPhoto(coverBytes, videoBytes, state.sourceInfo.presentationUs, metadata, !keepMetadata || !hasJpegXmpSegment(metadata));
        const fileName = normalizeOutputName(get('replaceOutputName').value, `${baseName(state.sourceLive.name)}-换封面.jpg`);
        publishResult(output, fileName, [['输出尺寸', `${size.width}×${size.height}`], ['保留视频', bytesText(videoBytes.length)], ['文件大小', bytesText(output.length)]]);
      } catch (error) {
        setStatus('生成失败', error.message, 'error');
      } finally {
        setBusy(button, false, '生成换封面实况照片');
      }
    }

    async function buildCreated() {
      const button = get('createButton');
      if (!state.coverImage) return setStatus('缺少封面图', '请选择封面图。', 'error');
      if (!state.videoInfo) return setStatus('缺少视频', '请选择 MP4 视频。', 'error');
      setBusy(button, true, '生成实况照片');
      setStatus('正在生成', '正在处理封面并组合视频数据…', 'working');
      try {
        const sourceBlob = state.croppedCover || state.cover;
        const source = state.croppedCover ? await loadImage(sourceBlob) : state.coverImage;
        const matchRatio = get('matchVideoRatioInput').checked;
        const rawSize = matchRatio ? getCoverSizeByVideoRatio({ width: source.width, height: source.height }, state.videoInfo) : { width: source.width, height: source.height };
        const size = getSafeCoverSize(rawSize);
        const coverBlob = await drawImageToJpeg(source.image, { ...size, fit: matchRatio ? 'crop' : 'stretch', quality: qualityValue(get('createQualityInput')) });
        if (state.croppedCover) URL.revokeObjectURL(source.url);
        const coverBytes = new Uint8Array(await coverBlob.arrayBuffer());
        const videoBytes = new Uint8Array(await state.video.arrayBuffer());
        const output = composeMotionPhoto(coverBytes, videoBytes, 0);
        const fileName = normalizeOutputName(get('createOutputName').value, `${baseName(state.cover.name)}-实况图.jpg`);
        publishResult(output, fileName, [['封面尺寸', `${size.width}×${size.height}`], ['视频', bytesText(videoBytes.length)], ['文件大小', bytesText(output.length)]]);
      } catch (error) {
        setStatus('生成失败', error.message, 'error');
      } finally {
        setBusy(button, false, '生成实况照片');
      }
    }

    const crop = { image: null, baseScale: 1, zoom: 1, offsetX: 0, offsetY: 0, dragging: false, lastX: 0, lastY: 0 };

    function clampCropOffset() {
      const canvas = get('cropCanvas');
      const width = crop.image.naturalWidth * crop.baseScale * crop.zoom;
      const height = crop.image.naturalHeight * crop.baseScale * crop.zoom;
      crop.offsetX = Math.max((canvas.width - width) / 2, Math.min((width - canvas.width) / 2, crop.offsetX));
      crop.offsetY = Math.max((canvas.height - height) / 2, Math.min((height - canvas.height) / 2, crop.offsetY));
    }

    function drawCrop() {
      const canvas = get('cropCanvas');
      const context = canvas.getContext('2d');
      const scale = crop.baseScale * crop.zoom;
      const width = crop.image.naturalWidth * scale;
      const height = crop.image.naturalHeight * scale;
      clampCropOffset();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(crop.image, (canvas.width - width) / 2 + crop.offsetX, (canvas.height - height) / 2 + crop.offsetY, width, height);
    }

    function openCropDialog() {
      if (!state.coverImage || !state.videoInfo) return setStatus('暂时不能裁切', '请先选择封面图和视频。', 'error');
      const ratio = state.videoInfo.width / state.videoInfo.height;
      const canvas = get('cropCanvas');
      if (ratio >= 1) {
        canvas.width = 680; canvas.height = Math.round(680 / ratio);
      } else {
        canvas.height = 480; canvas.width = Math.round(480 * ratio);
      }
      crop.image = state.coverImage.image;
      crop.baseScale = Math.max(canvas.width / crop.image.naturalWidth, canvas.height / crop.image.naturalHeight);
      crop.zoom = 1; crop.offsetX = 0; crop.offsetY = 0;
      get('cropZoomInput').value = '1';
      drawCrop();
      get('cropDialog').showModal();
    }

    async function applyCrop() {
      const previewCanvas = get('cropCanvas');
      const scale = crop.baseScale * crop.zoom;
      const drawnWidth = crop.image.naturalWidth * scale;
      const drawnHeight = crop.image.naturalHeight * scale;
      const sourceX = ((drawnWidth - previewCanvas.width) / 2 - crop.offsetX) / scale;
      const sourceY = ((drawnHeight - previewCanvas.height) / 2 - crop.offsetY) / scale;
      const sourceWidth = previewCanvas.width / scale;
      const sourceHeight = previewCanvas.height / scale;
      const target = getSafeCoverSize(getCoverSizeByVideoRatio(state.coverImage, state.videoInfo));
      const output = document.createElement('canvas');
      output.width = target.width; output.height = target.height;
      output.getContext('2d').drawImage(crop.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, target.width, target.height);
      state.croppedCover = await new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('裁切失败。')), 'image/jpeg', constants.DEFAULT_JPG_QUALITY));
      const url = replaceUrl('cover', state.croppedCover);
      mediaElements.cover.preview.src = url;
      mediaElements.cover.meta.textContent = `已裁切 ${target.width}×${target.height}`;
      get('cropDialog').close();
      setStatus('封面已裁切', '生成时将使用当前取景。', 'success');
    }

    function switchMode(mode) {
      state.mode = mode;
      const replace = mode === 'replace';
      get('replaceTab').setAttribute('aria-selected', String(replace));
      get('createTab').setAttribute('aria-selected', String(!replace));
      get('replacePanel').hidden = !replace;
      get('createPanel').hidden = replace;
      get('downloadLink').hidden = true;
      get('resultMeta').innerHTML = '';
      setStatus('准备就绪', replace ? '请选择原实况照片和新封面图。' : '请选择封面图和 MP4 视频。');
    }

    get('replaceTab').addEventListener('click', () => switchMode('replace'));
    get('createTab').addEventListener('click', () => switchMode('create'));
    get('replaceButton').addEventListener('click', buildReplacement);
    get('createButton').addEventListener('click', buildCreated);
    get('cropCoverButton').addEventListener('click', openCropDialog);
    get('closeCropButton').addEventListener('click', () => get('cropDialog').close());
    get('cancelCropButton').addEventListener('click', () => get('cropDialog').close());
    get('applyCropButton').addEventListener('click', () => applyCrop().catch((error) => setStatus('裁切失败', error.message, 'error')));
    get('cropZoomInput').addEventListener('input', (event) => { crop.zoom = Number(event.target.value); drawCrop(); });

    const cropCanvas = get('cropCanvas');
    cropCanvas.addEventListener('pointerdown', (event) => {
      crop.dragging = true; crop.lastX = event.clientX; crop.lastY = event.clientY;
      cropCanvas.classList.add('dragging'); cropCanvas.setPointerCapture(event.pointerId);
    });
    cropCanvas.addEventListener('pointermove', (event) => {
      if (!crop.dragging) return;
      const rect = cropCanvas.getBoundingClientRect();
      crop.offsetX += (event.clientX - crop.lastX) * cropCanvas.width / rect.width;
      crop.offsetY += (event.clientY - crop.lastY) * cropCanvas.height / rect.height;
      crop.lastX = event.clientX; crop.lastY = event.clientY; drawCrop();
    });
    cropCanvas.addEventListener('pointerup', () => { crop.dragging = false; cropCanvas.classList.remove('dragging'); });

    Object.entries(mediaElements).forEach(([kind, elements]) => {
      elements.input.addEventListener('change', () => handleFile(kind, elements.input.files && elements.input.files[0]));
    });
    document.querySelectorAll('[data-open-input]').forEach((stage) => {
      stage.addEventListener('click', (event) => {
        if (event.target.closest('video')) return;
        get(stage.dataset.openInput).click();
      });
      stage.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') get(stage.dataset.openInput).click();
      });
    });
    document.querySelectorAll('[data-clear-kind]').forEach((button) => button.addEventListener('click', () => clearKind(button.dataset.clearKind)));
    document.querySelectorAll('[data-drop-kind]').forEach((card) => {
      card.addEventListener('dragover', (event) => { event.preventDefault(); card.classList.add('drag-active'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-active'));
      card.addEventListener('drop', (event) => {
        event.preventDefault(); card.classList.remove('drag-active');
        handleFile(card.dataset.dropKind, event.dataTransfer.files && event.dataTransfer.files[0]);
      });
    });

    switchMode('replace');
  }

  return Object.freeze({
    constants,
    shouldWarnLongVideo,
    getSafeCoverSize,
    getCoverSizeByVideoRatio,
    formatVideoRatioText,
    jpegSegment,
    makeXmp,
    parseJpegSize,
    parseMotionInfo,
    extractJpegMetadataSegments,
    hasJpegXmpSegment,
    composeMotionPhoto,
    init
  });
});

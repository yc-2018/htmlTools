(function exposeAiQrImageUrls(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  window.AiQrImageUrls = api;
})(function createAiQrImageUrls() {
  'use strict';

  const MAX_THUMBNAIL_SIZE = 600;
  const SIZE_BUCKET = 50;
  const MAX_DEVICE_PIXEL_RATIO = 2;

  function calculateThumbnailSize(renderedWidth, devicePixelRatio = 1) {
    const width = Math.max(1, Number(renderedWidth) || 1);
    const pixelRatio = Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, Number(devicePixelRatio) || 1));
    const requestedSize = Math.ceil(width * pixelRatio / SIZE_BUCKET) * SIZE_BUCKET;
    return Math.min(MAX_THUMBNAIL_SIZE, Math.max(SIZE_BUCKET, requestedSize));
  }

  function toThumbnailUrl(url, size) {
    const safeSize = Math.min(MAX_THUMBNAIL_SIZE, Math.max(SIZE_BUCKET, Math.round(Number(size) || SIZE_BUCKET)));
    return String(url).replace(
      '/cxxjwimg/jfs/',
      `/jdcms/s${safeSize}x${safeSize}_jfs/`
    );
  }

  function toFullImageUrl(url) {
    return String(url).replace(
      /\/jdcms\/s\d+x\d+_jfs\//,
      '/cxxjwimg/jfs/'
    );
  }

  return Object.freeze({
    MAX_THUMBNAIL_SIZE,
    calculateThumbnailSize,
    toThumbnailUrl,
    toFullImageUrl
  });
});

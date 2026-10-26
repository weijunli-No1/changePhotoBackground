const { call, writeBase64 } = require('./files');
function cropRect(width, height, ratio, x = 0.5, y = 0.5) {
  if (!ratio) return { x: 0, y: 0, width, height };
  let w = width,
    h = height;
  if (width / height > ratio) w = height * ratio;
  else h = width / ratio;
  return {
    x: (width - w) * Math.max(0, Math.min(1, x)),
    y: (height - h) * Math.max(0, Math.min(1, y)),
    width: w,
    height: h,
  };
}
function getCanvas(page) {
  // 支持导出的离屏画布无需页面节点，也不依赖 Skyline Canvas 模拟器支持。
  if (typeof wx.createOffscreenCanvas === 'function') {
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 });
      if (canvas && typeof canvas.toDataURL === 'function') return Promise.resolve(canvas);
    } catch (error) {
      /* 不支持离屏导出时使用真机 Canvas 组件 */
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('图片工具初始化超时，请重新进入')), 10000);
    page.setData({ needsCanvas: true }, () => {
      wx.createSelectorQuery()
        .in(page)
        .select('#toolCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          clearTimeout(timer);
          if (res[0] && res[0].node) resolve(res[0].node);
          else reject(new Error('图片工具初始化失败，请重新进入'));
        });
    });
  });
}
async function transform(page, source, options = {}) {
  const info = await call('getImageInfo', { src: source });
  if (options.compress) {
    const scale = Math.min(1, (options.maxEdge || 2048) / Math.max(info.width, info.height));
    const result = await call('compressImage', {
      src: source,
      quality: Math.round((options.quality || 0.85) * 100),
      compressedWidth: Math.max(1, Math.round(info.width * scale)),
      compressedHeight: Math.max(1, Math.round(info.height * scale)),
    });
    const output = await call('getImageInfo', { src: result.tempFilePath });
    return { path: result.tempFilePath, width: output.width, height: output.height };
  }
  const canvas = await getCanvas(page);
  // Skyline 需先初始化 2D 上下文，再加载 CanvasImage。
  const ctx = canvas.getContext('2d');
  const image = canvas.createImage();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('图片解码超时')), 12000);
    image.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    image.onerror = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    image.src = source;
  });
  const angle = (((options.angle || 0) % 360) + 360) % 360;
  const rotated = angle % 180 !== 0;
  const w = rotated ? info.height : info.width,
    h = rotated ? info.width : info.height;
  const crop = cropRect(w, h, options.ratio, options.x, options.y);
  const scale = Math.min(1, (options.maxEdge || 2048) / Math.max(crop.width, crop.height));
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(canvas.width / crop.width, canvas.height / crop.height);
  ctx.translate(-crop.x, -crop.y);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(image, -info.width / 2, -info.height / 2, info.width, info.height);
  if (typeof canvas.toDataURL === 'function') {
    const dataUrl = canvas.toDataURL(options.fileType === 'png' ? 'image/png' : 'image/jpeg', options.quality || 0.9);
    const path = await writeBase64(
      dataUrl,
      'local',
      dataUrl.startsWith('data:image/jpeg') ? '.jpg' : '.png',
    );
    return { path, width: canvas.width, height: canvas.height };
  }
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('图片导出超时，请重试')), 15000);
    wx.canvasToTempFilePath(
      {
        canvas,
        width: canvas.width,
        height: canvas.height,
        destWidth: canvas.width,
        destHeight: canvas.height,
        fileType: options.fileType === 'png' ? 'png' : 'jpg',
        quality: options.quality || 0.9,
        success: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      },
      page,
    );
  });
  return { path: result.tempFilePath, width: canvas.width, height: canvas.height };
}
module.exports = { cropRect, transform, getCanvas };

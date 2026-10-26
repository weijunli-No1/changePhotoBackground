const files = require("./files");
const { cropRect, getCanvas } = require("./image-transform");
// 在JPEG中写入标准JFIF密度；不会通过增加DPI来声称增加图像细节。
function jpegMetadata(input, minBytes = 0, dpi = 300) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw Error("设备未能导出JPEG图片，请重试");
  const jfif = new Uint8Array([
    255,
    224,
    0,
    16,
    74,
    70,
    73,
    70,
    0,
    1,
    1,
    1,
    dpi >> 8,
    dpi & 255,
    dpi >> 8,
    dpi & 255,
    0,
    0,
  ]);
  let start = 2;
  // 替换已有JFIF段，避免冲突的DPI标记。
  if (
    bytes[2] === 255 &&
    bytes[3] === 224 &&
    String.fromCharCode(...bytes.slice(6, 11)) === "JFIF\0"
  )
    start = 4 + ((bytes[4] << 8) | bytes[5]);
  const baseLength = 2 + jfif.length + bytes.length - start;
  let extra = Math.max(0, Math.ceil(minBytes) - baseLength);
  if (extra > 0 && extra < 4) extra = 4;
  const segments = [];
  while (extra > 0) {
    let length = Math.min(65537, extra);
    if (extra - length > 0 && extra - length < 4) length -= 4;
    const segment = new Uint8Array(length);
    segment[0] = 255;
    segment[1] = 254;
    segment[2] = (length - 2) >> 8;
    segment[3] = (length - 2) & 255;
    segments.push(segment);
    extra -= length;
  }
  const out = new Uint8Array(
    baseLength + segments.reduce((n, s) => n + s.length, 0),
  );
  out.set(bytes.slice(0, 2));
  out.set(jfif, 2);
  let offset = 2 + jfif.length;
  for (const segment of segments) {
    out.set(segment, offset);
    offset += segment.length;
  }
  out.set(bytes.slice(start), offset);
  return out;
}
async function exportJpeg(page, canvas, quality) {
  if (typeof canvas.toDataURL === "function") {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (!/^data:image\/jpeg;base64,/.test(url))
      throw Error("当前设备无法导出JPEG图片");
    return files.cleanBase64(url);
  }
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("导出超时，请重试")), 15000);
    wx.canvasToTempFilePath(
      {
        canvas,
        fileType: "jpg",
        quality,
        destWidth: canvas.width,
        destHeight: canvas.height,
        success: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        fail: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      },
      page,
    );
  });
  try {
    return await files.readBase64(result.tempFilePath);
  } finally {
    files.removeTemp(result.tempFilePath);
  }
}
async function prepare(page, source, spec, position = {}) {
  const info = await files.call("getImageInfo", { src: source });
  const rect = cropRect(
    info.width,
    info.height,
    spec.width / spec.height,
    (position.x || 0) / 100,
    (position.y || 0) / 100,
  );
  let width = spec.width,
    height = spec.height;
  if (rect.width + 0.5 < width || rect.height + 0.5 < height) {
    if (/建议输出|宽高比例/.test(spec.sizeRule)) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const divisor = gcd(width, height),
        unitWidth = width / divisor,
        unitHeight = height / divisor;
      const units = Math.floor(
        Math.min(rect.width / unitWidth, rect.height / unitHeight),
      );
      width = units * unitWidth;
      height = units * unitHeight;
      if (width < 100 || height < 100)
        throw Error("原图清晰度不足，请选择更大的证件原照");
    } else
      throw Error(
        `原图清晰度不足，请选择至少${spec.width}×${spec.height}像素且构图足够的原照`,
      );
  }
  const canvas = await getCanvas(page);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = canvas.createImage();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("图片读取超时")), 12000);
    image.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(Error("图片读取失败"));
    };
    image.src = source;
  });
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    width,
    height,
  );
  let best = "",
    lo = 0.15,
    hi = 0.98;
  const minBytes = (spec.minKB || 0) * 1024;
  const maxBytes = spec.maxKB ? spec.maxKB * 1024 : Infinity;
  for (let i = 0; i < 8; i++) {
    const quality = i === 0 ? hi : (lo + hi) / 2;
    const base64 = await exportJpeg(page, canvas, quality);
    const bytes = jpegMetadata(wx.base64ToArrayBuffer(base64), minBytes);
    if (bytes.length <= maxBytes) {
      best = wx.arrayBufferToBase64(bytes.buffer);
      if (i === 0) break;
      lo = quality;
    } else hi = quality;
  }
  if (!best)
    throw Error(
      "在保留指定像素的情况下无法满足文件大小，请换用更清晰、背景简洁的原照",
    );
  const path = await files.writeBase64(best, "local", ".jpg");
  return {
    path,
    width,
    height,
    bytes: await files.fileSize(path),
    sourceWidth: info.width,
    sourceHeight: info.height,
  };
}
module.exports = { prepare, jpegMetadata };

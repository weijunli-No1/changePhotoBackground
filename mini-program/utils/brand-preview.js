const { getCanvas } = require("./image-transform");
const files = require("./files");
const BRAND = "拾光小相";
// 水印烧录进预览位图；不能以WXML叠层代替，否则长按保存拿到的是干净底图。
async function create(page, source, options = {}) {
  const info = await files.call("getImageInfo", { src: source });
  const { cropRect } = require("./image-transform");
  const rect = cropRect(
    info.width,
    info.height,
    options.ratio,
    (options.x === undefined ? 50 : options.x) / 100,
    (options.y === undefined ? 50 : options.y) / 100,
  );
  const scale = Math.min(1, 1600 / Math.max(rect.width, rect.height));
  const canvas = await getCanvas(page);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const ctx = canvas.getContext("2d");
  const image = canvas.createImage();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("预览图片读取超时，请重试")),
      12000,
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(Error("预览图片读取失败"));
    };
    image.src = source;
  });
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const fontSize = Math.max(
    14,
    Math.round(Math.min(canvas.width, canvas.height) * 0.075),
  );
  const diagonal = Math.ceil(Math.hypot(canvas.width, canvas.height));
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 7);
  ctx.font = `500 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(45,65,95,0.28)";
  for (let y = -diagonal; y < diagonal; y += fontSize * 3.6)
    for (let x = -diagonal; x < diagonal; x += fontSize * 7)
      ctx.fillText(BRAND, x, y);
  ctx.restore();
  if (typeof canvas.toDataURL === "function")
    return files.writeBase64(
      canvas.toDataURL("image/jpeg", 0.98),
      "photo",
      ".jpg",
    );
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("水印预览生成超时")), 15000);
    wx.canvasToTempFilePath(
      {
        canvas,
        fileType: "jpg",
        quality: 0.98,
        destWidth: canvas.width,
        destHeight: canvas.height,
        success: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        fail: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      },
      page,
    );
  });
  return result.tempFilePath;
}
module.exports = { create, BRAND };

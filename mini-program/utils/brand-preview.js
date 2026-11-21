const { getCanvas, cropRect } = require("./image-transform");
const files = require("./files");
const BRAND = "拾光小相";
const VERSION = 2;
const DISPLAY_VERSION = 1;
const queues = new WeakMap();

// A device without offscreen canvas shares one canvas node for all previews on a page.
function withCanvas(page, work) {
  const previous = queues.get(page) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  queues.set(page, current);
  return current.finally(() => { if (queues.get(page) === current) queues.delete(page); });
}

function watermark(ctx, width, height) {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.075));
  const diagonal = Math.ceil(Math.hypot(width, height));
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 7);
  ctx.font = `500 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(45,65,95,0.32)";
  const rows = Math.ceil(diagonal / (fontSize * 3.6));
  const columns = Math.ceil(diagonal / (fontSize * 7));
  for (let row = -rows; row <= rows; row++)
    for (let column = -columns; column <= columns; column++)
      ctx.fillText(BRAND, column * fontSize * 7, row * fontSize * 3.6);
  ctx.restore();
}

async function render(page, source, options, display, sheet) {
  const info = await files.call("getImageInfo", { src: source });
  const rect = cropRect(info.width, info.height, options.ratio,
    (options.x === undefined ? 50 : options.x) / 100,
    (options.y === undefined ? 50 : options.y) / 100);
  const width = sheet ? 1795 : rect.width, height = sheet ? 1205 : rect.height;
  // Even an already small ID photo must lose resolution in the unmarked display image.
  const scale = display ? Math.min(0.65, 384 / Math.max(width, height)) :
    Math.min(1, 1600 / Math.max(width, height));
  const canvas = await getCanvas(page);
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext("2d");
  const image = canvas.createImage();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("预览图片读取超时，请重试")), 12000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(Error("预览图片读取失败")); };
    image.src = source;
  });
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (sheet) {
    ctx.save();
    ctx.scale(canvas.width / width, canvas.height / height);
    for (const cell of sheet) {
      ctx.save();
      ctx.translate(cell.x + cell.width / 2, cell.y + cell.height / 2);
      if (cell.rotated) ctx.rotate(-Math.PI / 2);
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height,
        -cell.width / 2, -cell.height / 2, cell.width, cell.height);
      ctx.restore();
    }
    ctx.restore();
  } else {
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  }
  if (!display) watermark(ctx, canvas.width, canvas.height);
  const quality = display ? 0.81 : 0.98;
  if (typeof canvas.toDataURL === "function")
    return files.writeBase64(canvas.toDataURL("image/jpeg", quality), "photo", ".jpg");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("预览生成超时，请重试")), 15000);
    wx.canvasToTempFilePath({
      canvas, fileType: "jpg", quality, destWidth: canvas.width, destHeight: canvas.height,
      success: (result) => { clearTimeout(timer); resolve(result.tempFilePath); },
      fail: (error) => { clearTimeout(timer); reject(error); },
    }, page);
  });
}

function create(page, source, options = {}) {
  return withCanvas(page, () => render(page, source, options, false));
}
function displayPreview(page, source, options = {}) {
  return withCanvas(page, () => render(page, source, options, true));
}
function createSheetPreview(page, source, cells) {
  return withCanvas(page, () => render(page, source, {}, false, cells));
}
async function createPair(page, source, options = {}) {
  const displayPath = options.displaySource ? await displayPreview(page, options.displaySource) :
    await displayPreview(page, source, options);
  try {
    return { displayPath, previewPath: await create(page, source, options) };
  } catch (error) {
    files.removeTemp(displayPath);
    throw error;
  }
}
module.exports = { withCanvas, create, displayPreview, createSheetPreview, createPair, BRAND, VERSION, DISPLAY_VERSION };

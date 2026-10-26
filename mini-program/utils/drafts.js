const KEY = "shiguang_drafts_v1";
const MAX_DRAFTS = 8;
let queue = Promise.resolve();
function list() {
  const items = wx.getStorageSync(KEY);
  return Array.isArray(items) ? items : [];
}
function createId() {
  return `d${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}
function root() {
  return `${wx.env.USER_DATA_PATH}/shiguang-drafts`;
}
function copy(src, target) {
  if (!src || src === target) return Promise.resolve(src || "");
  return new Promise((resolve, reject) =>
    wx
      .getFileSystemManager()
      .copyFile({
        srcPath: src,
        destPath: target,
        success: () => resolve(target),
        fail: reject,
      }),
  );
}
function deleteFiles(item, retained = new Set()) {
  const paths = new Set([
    item.sourcePath,
    item.resultPath,
    item.transparentPath,
    item.previewPath,
  ]);
  paths.forEach((filePath) => {
    if (
      filePath &&
      !retained.has(filePath) &&
      filePath.startsWith(`${root()}/${item.id}-`)
    )
      wx.getFileSystemManager().unlink({ filePath, fail() {} });
  });
}
function enqueue(work) {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}
function save(snapshot) {
  return enqueue(async () => {
    if (!snapshot.sourcePath) throw new Error("原图不可用，请重新选择");
    const id = snapshot.id || createId();
    if (!/^d[a-z0-9]+$/.test(id)) throw new Error("草稿标识无效");
    const fs = wx.getFileSystemManager();
    try {
      fs.mkdirSync(root(), true);
    } catch (error) {
      /* 目录已存在时继续 */
    }
    const item = { ...snapshot, id, updatedAt: Date.now() };
    const revision = `${id}-${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const created = [];
    const previous = list().find((old) => old.id === id);
    try {
      for (const [key, suffix] of [
        ["sourcePath", "source.png"],
        ["resultPath", "result.png"],
        ["transparentPath", "transparent.png"],
        ["previewPath", "preview.jpg"],
      ]) {
        const source = snapshot[key];
        if (!source) {
          item[key] = "";
          continue;
        }
        if (source.startsWith(`${root()}/${id}-`)) {
          item[key] = source;
          continue;
        }
        const actualSuffix =
          key === "resultPath" &&
          (snapshot.mode === "exam" || /\.jpe?g$/i.test(source))
            ? "result.jpg"
            : suffix;
        item[key] = await copy(source, `${root()}/${revision}-${actualSuffix}`);
        created.push(item[key]);
      }
      const items = [item, ...list().filter((old) => old.id !== id)];
      wx.setStorageSync(KEY, items.slice(0, MAX_DRAFTS));
      if (previous)
        deleteFiles(
          previous,
          new Set([
            item.sourcePath,
            item.resultPath,
            item.transparentPath,
            item.previewPath,
          ]),
        );
      items.slice(MAX_DRAFTS).forEach((old) => deleteFiles(old));
      return item;
    } catch (error) {
      created.forEach((filePath) => fs.unlink({ filePath, fail() {} }));
      throw error;
    }
  });
}
function remove(id) {
  return enqueue(() => {
    const items = list();
    wx.setStorageSync(
      KEY,
      items.filter((item) => item.id !== id),
    );
    items.filter((item) => item.id === id).forEach((item) => deleteFiles(item));
  });
}
function clear() {
  return enqueue(() => {
    const items = list();
    wx.removeStorageSync(KEY);
    items.forEach((item) => deleteFiles(item));
  });
}
function get(id) {
  return list().find((item) => item.id === id);
}
module.exports = { list, get, save, remove, clear, createId };

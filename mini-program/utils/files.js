function call(method, options) {
  return new Promise((resolve, reject) =>
    wx[method]({ ...options, success: resolve, fail: reject }),
  );
}
function cleanBase64(value) {
  return (value || '').replace(/^data:image\/\w+;base64,/, '').replace(/\s/g, '');
}
function writeBase64(value, label = 'result', extension = '.png') {
  const base64 = cleanBase64(value);
  if (!base64) return Promise.reject(new Error('没有收到处理结果，请重试'));
  const filePath = `${wx.env.USER_DATA_PATH}/${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${extension}`;
  return new Promise((resolve, reject) =>
    wx.getFileSystemManager().writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: reject,
    }),
  );
}
function readBase64(filePath) {
  return new Promise((resolve, reject) =>
    wx
      .getFileSystemManager()
      .readFile({
        filePath,
        encoding: 'base64',
        success: (res) => resolve(res.data),
        fail: reject,
      }),
  );
}
function fileSize(filePath) {
  return new Promise((resolve, reject) =>
    wx
      .getFileSystemManager()
      .stat({ path: filePath, success: (res) => resolve(res.stats.size), fail: reject }),
  );
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
async function saveAlbum(filePath) {
  try {
    await call('saveImageToPhotosAlbum', { filePath });
  } catch (error) {
    if (/auth|authorize/.test(error.errMsg || '')) {
      const res = await call('showModal', {
        title: '允许保存到相册',
        content: '请在设置中允许访问相册，再点击保存。',
        confirmText: '打开设置',
      });
      if (res.confirm) await call('openSetting', {});
      throw new Error('授权后请再次保存');
    }
    throw new Error('相册保存失败，作品已保留，请重试');
  }
}
function removeTemp(filePath) {
  if (!filePath || !filePath.startsWith(`${wx.env.USER_DATA_PATH}/`)) return;
  if (filePath.includes('/shiguang-drafts/')) return;
  wx.getFileSystemManager().unlink({ filePath, fail() {} });
}
function clearTransientImages() {
  const fs = wx.getFileSystemManager();
  try {
    fs.readdirSync(wx.env.USER_DATA_PATH).forEach((name) => {
      if (/^(photo|transparent|local|layout)-\d+-[a-z0-9]{5}\.(png|jpg)$/.test(name)) {
        fs.unlink({ filePath: `${wx.env.USER_DATA_PATH}/${name}`, fail() {} });
      }
    });
  } catch (error) {
    /* 清理失败不影响启动或持久化草稿 */
  }
}
module.exports = {
  call,
  cleanBase64,
  writeBase64,
  readBase64,
  fileSize,
  formatBytes,
  saveAlbum,
  removeTemp,
  clearTransientImages,
};

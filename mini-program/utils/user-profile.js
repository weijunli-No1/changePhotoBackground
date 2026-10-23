const { call } = require("./files");
const KEY = "shiguang_profiles_v1";
let queue = Promise.resolve();
function root() {
  return `${wx.env.USER_DATA_PATH}/shiguang-profiles`;
}
function records() {
  const value = wx.getStorageSync(KEY);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function get(openid) {
  if (!openid) return null;
  const item = records()[openid];
  if (!item || typeof item.nickname !== "string") return null;
  let avatarUrl = typeof item.avatarUrl === "string" ? item.avatarUrl : "";
  if (avatarUrl.startsWith(root() + "/")) {
    try {
      wx.getFileSystemManager().accessSync(avatarUrl);
    } catch (error) {
      avatarUrl = "";
    }
  }
  return { nickname: item.nickname, avatarUrl };
}
function normalizeNickname(value) {
  const nickname = typeof value === "string" ? value.trim() : "";
  if (
    !nickname ||
    Array.from(nickname).length > 20 ||
    /[\r\n\u0000-\u001f]/.test(nickname)
  )
    throw new Error("请填写1—20个字的昵称");
  return nickname;
}
function removeFile(path) {
  if (path && path.startsWith(root() + "/"))
    wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
}
function save(openid, value, isCurrent = () => true) {
  const work = queue.then(async () => {
    if (!openid) throw new Error("请先登录再保存资料");
    const nickname = normalizeNickname(value.nickname);
    const previous = get(openid);
    let avatarUrl = value.avatarUrl || "";
    let created = "";
    try {
      if (avatarUrl && avatarUrl !== (previous && previous.avatarUrl)) {
        const info = await call("getImageInfo", { src: avatarUrl });
        const type = info.type === "jpeg" ? "jpg" : info.type;
        const extension = ["jpg", "png", "webp", "gif", "bmp"].includes(type)
          ? type
          : "png";
        const fs = wx.getFileSystemManager();
        try {
          fs.mkdirSync(root(), true);
        } catch (error) {
          /* 已有目录可复用 */
        }
        const target = `${root()}/avatar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
        await new Promise((resolve, reject) =>
          fs.copyFile({
            srcPath: info.path || avatarUrl,
            destPath: target,
            success: resolve,
            fail: reject,
          }),
        );
        created = target;
        avatarUrl = target;
      }
      if (!isCurrent()) throw new Error("登录状态已变化，请返回后重试");
      const item = { nickname, avatarUrl };
      const items = { ...records(), [openid]: item };
      wx.setStorageSync(KEY, items);
      if (
        previous &&
        previous.avatarUrl !== avatarUrl &&
        !Object.values(items).some(
          (other) => other.avatarUrl === previous.avatarUrl,
        )
      )
        removeFile(previous.avatarUrl);
      return item;
    } catch (error) {
      if (created) removeFile(created);
      throw error;
    }
  });
  queue = work.catch(() => {});
  return work;
}
module.exports = { get, save, normalizeNickname };

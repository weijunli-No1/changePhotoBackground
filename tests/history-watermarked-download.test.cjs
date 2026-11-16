const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ request, saveAlbum, writeBase64, ensureLogin } = {}) {
  let definition;
  const calls = [], albums = [], writes = [], removed = [], previews = [];
  const app = {
    globalData: { openid: "OWNER", sessionToken: "TOKEN" },
    ensureLogin: ensureLogin || (async () => true),
  };
  const filename = path.resolve(__dirname, "../mini-program/pages/history/history.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: { showToast() {}, previewImage: (options) => previews.push(options) },
    require(name) {
      if (name.endsWith("/skyline-motion")) return {};
      if (name.endsWith("/drafts")) return { list: () => [] };
      if (name.endsWith("/tool-catalog")) return { presentDraft: (value) => value };
      if (name.endsWith("/api")) return {
        request: async (url, options) => {
          calls.push({ url, options });
          return request ? request(url, options) : { code: 200, data: { image_base64: "CLEAN_BASE64" } };
        },
        unwrap(response) {
          if (response.code !== 200) {
            const error = new Error(response.message || "请求失败");
            error.code = response.code;
            throw error;
          }
          return response.data;
        },
      };
      if (name.endsWith("/files")) return {
        writeBase64: async (base64, label) => {
          writes.push({ base64, label });
          return writeBase64 ? writeBase64(base64, label) : "PRIVATE_CLEAN_PATH";
        },
        saveAlbum: async (filePath) => {
          albums.push(filePath);
          if (saveAlbum) return saveAlbum(filePath);
        },
        removeTemp: (filePath) => removed.push(filePath),
      };
      throw Error(name);
    },
  }, { filename });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values, callback) {
      Object.assign(this.data, values);
      if (callback) callback();
    },
  };
  page._historyOwner = "OWNER";
  page.setData({ historyList: [{ id: 7, previewUrl: "WATERMARKED_PREVIEW" }] });
  return { page, app, calls, albums, writes, removed, previews };
}
const tap = { currentTarget: { dataset: { id: 7 } } };

test("云端列表仅向视图传水印预览，裸图字段和伪造预览URL不进入页面或系统预览", async () => {
  const f = fixture({ request: async () => ({ code: 200, data: [
    { id: 7, previewUrl: "WATERMARKED_PREVIEW", photoUrl: "CLEAN_URL", originalPhotoUrl: "ORIGINAL_URL", createTime: "2026-11-16T18:00:00" },
    { id: 8, photoUrl: "LEGACY_CLEAN_URL" },
  ] }) });
  await f.page.fetchHistoryList();
  assert.equal(f.page.data.historyList[0].timeStr, "2026-11-16 18:00");
  assert.ok(!JSON.stringify(f.page.data).includes("CLEAN_URL"));
  assert.ok(!JSON.stringify(f.page.data).includes("ORIGINAL_URL"));
  f.page.previewImage({ currentTarget: { dataset: { id: 7, url: "INJECTED_CLEAN_URL" } } });
  assert.equal(f.previews.length, 1);
  assert.equal(f.previews[0].current, "WATERMARKED_PREVIEW");
  f.page.previewImage({ currentTarget: { dataset: { id: 8 } } });
  assert.equal(f.previews.length, 1);
});

test("云端作品每次主动保存均向服务端校验，干净成品只写相册且成功后清理", async () => {
  let resolve;
  const f = fixture({ request: () => new Promise((done) => { resolve = done; }) });
  const first = f.page.saveCloudPhoto(tap);
  assert.equal(f.page.data.savingId, 7);
  await f.page.saveCloudPhoto(tap);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/history/7/download");
  assert.equal(f.calls[0].options.method, "POST");
  resolve({ code: 200, data: { image_base64: "CLEAN_BASE64" } });
  await first;
  assert.equal(f.albums.length, 1);
  assert.equal(f.page.data.savingId, null);
  assert.equal(f.page.data.historyList[0].downloadSaved, true);
  assert.deepEqual(f.removed, ["PRIVATE_CLEAN_PATH"]);
  assert.ok(!JSON.stringify(f.page.data).includes("CLEAN_BASE64"));
  assert.ok(!JSON.stringify(f.page.data).includes("PRIVATE_CLEAN_PATH"));
  assert.equal(f.previews.length, 0);
  const second = f.page.saveCloudPhoto(tap);
  assert.equal(f.calls.length, 2);
  resolve({ code: 200, data: { image_base64: "SECOND_CLEAN_BASE64" } });
  await second;
  assert.equal(f.albums.length, 2);
});

test("相册写入失败的重试复用同次授权，成功后的再次保存重新扣次", async () => {
  let fail = true;
  const f = fixture({ saveAlbum: async () => { if (fail) throw Error("授权后请再次保存"); } });
  await f.page.saveCloudPhoto(tap);
  assert.match(f.page.data.historyList[0].downloadError, /再次保存/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.removed.length, 0);
  fail = false;
  await f.page.saveCloudPhoto(tap);
  assert.equal(f.calls.length, 1);
  assert.equal(f.albums.length, 2);
  assert.equal(f.page.data.historyList[0].downloadError, "");
  await f.page.saveCloudPhoto(tap);
  assert.equal(f.calls.length, 2);
  assert.equal(f.writes.length, 2);
});

test("额度不足有明确提示且不生成干净文件，补充额度后可直接重试", async () => {
  let blocked = true;
  const f = fixture({ request: async () => blocked
    ? { code: 4031, message: "额度不足" }
    : { code: 200, data: { image_base64: "CLEAN_BASE64" } } });
  await f.page.saveCloudPhoto(tap);
  assert.equal(f.writes.length, 0);
  assert.equal(f.page.data.historyList[0].quotaBlocked, true);
  assert.match(f.page.data.historyList[0].downloadError, /观看视频/);
  assert.equal(f.page.data.savingId, null);
  blocked = false;
  await f.page.saveCloudPhoto(tap);
  assert.equal(f.calls.length, 2);
  assert.equal(f.albums.length, 1);
});

test("切换账号后丢弃迟到下载结果，卸载后迟到的干净文件仅清理而不写相册", async () => {
  let resolve;
  const switched = fixture({ request: () => new Promise((done) => { resolve = done; }) });
  const pending = switched.page.saveCloudPhoto(tap);
  switched.app.globalData.openid = "OTHER_OWNER";
  resolve({ code: 200, data: { image_base64: "CLEAN_BASE64" } });
  await pending;
  assert.equal(switched.writes.length, 0);
  assert.equal(switched.albums.length, 0);

  const unloaded = fixture({ writeBase64: () => new Promise((done) => { resolve = done; }) });
  const writing = unloaded.page.saveCloudPhoto(tap);
  await new Promise((done) => setImmediate(done));
  unloaded.page.onUnload();
  resolve("LATE_CLEAN_FILE");
  await writing;
  assert.equal(unloaded.albums.length, 0);
  assert.deepEqual(unloaded.removed, ["LATE_CLEAN_FILE"]);
});

test("缺少会话时先登录再读取列表，登录期间换账号不加载旧账号作品", async () => {
  let resolve;
  const f = fixture({ ensureLogin: () => new Promise((done) => { resolve = done; }) });
  f.app.globalData.sessionToken = "";
  const loading = f.page.fetchHistoryList();
  assert.equal(f.calls.length, 0);
  f.app.globalData.openid = "OTHER_OWNER";
  f.app.globalData.sessionToken = "OTHER_TOKEN";
  resolve(true);
  await loading;
  assert.equal(f.calls.length, 0);
});

test("登录入口缺失或登录未建立会话均失败闭合，不能读取列表或请求干净成品", async () => {
  for (const missingLogin of [true, false]) {
    const f = fixture();
    f.app.globalData.sessionToken = "";
    if (missingLogin) delete f.app.ensureLogin;
    await f.page.fetchHistoryList();
    assert.equal(f.calls.length, 0);
    assert.match(f.page.data.loadError, /重新登录/);
    await f.page.saveCloudPhoto(tap);
    assert.equal(f.calls.length, 0);
    assert.equal(f.albums.length, 0);
    assert.match(f.page.data.historyList[0].downloadError, /重新登录/);
    assert.equal(f.page.data.savingId, null);
  }
});

test("账号切换清理相册失败的授权缓存，不能继续保存上个账号作品", async () => {
  const f = fixture({ saveAlbum: async () => { throw Error("相册保存失败"); } });
  await f.page.saveCloudPhoto(tap);
  assert.equal(f.removed.length, 0);
  f.app.globalData.openid = "OTHER_OWNER";
  f.app.globalData.sessionToken = "OTHER_TOKEN";
  f.page.onShow();
  assert.equal(f.page.data.historyList.length, 0);
  assert.deepEqual(f.removed, ["PRIVATE_CLEAN_PATH"]);
  await f.page.saveCloudPhoto(tap);
  assert.equal(f.calls.length, 1);
});

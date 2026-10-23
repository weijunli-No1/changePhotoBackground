const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../mini-program");
function appFixture() {
  let app;
  const storage = new Map([
    ["openid", "current"],
    ["drafts", "keep"],
    ["shiguang_profiles_v1", "keep"],
  ]);
  const login = [],
    requests = [],
    pages = [];
  const wx = {
    login: (v) => login.push(v),
    request: (v) => requests.push(v),
    setStorageSync: (k, v) => storage.set(k, v),
    removeStorageSync: (k) => storage.delete(k),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), {
    App: (v) => (app = v),
    wx,
    getCurrentPages: () => pages,
    require: () => ({ isValidAdUnitId: () => false }),
  });
  return { app, wx, storage, login, requests, pages };
}
function pageFixture(file, app, deps = {}, wx = {}) {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), {
    Page: (v) => (page = v),
    getApp: () => app,
    wx,
    require: (name) => {
      const key = name.split("/").pop();
      if (key === "tool-catalog")
        return require("../mini-program/utils/tool-catalog");
      if (key in deps) return deps[key];
      throw Error("Unexpected dependency " + name);
    },
  });
  page.data = { ...page.data };
  page.setData = (data) => Object.assign(page.data, data);
  return page;
}
const response = (openid) => ({
  statusCode: 200,
  data: { code: 200, data: { openid } },
});

test("保存所需身份直接静默建立，并发复用同一登录，不弹确认或读取头像昵称", async () => {
  const { app, wx, login, requests, storage } = appFixture();
  wx.showModal = () => assert.fail("静默登录不应弹出确认框");
  wx.getUserProfile = () => assert.fail("登录不应索取头像昵称");
  const first = app.ensureLogin();
  const second = app.ensureLogin();
  assert.equal(login.length, 1);
  login[0].success({ code: "silent-code" });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/user\/login$/);
  assert.equal(requests[0].data.code, "silent-code");
  requests[0].success(response("silent-user"));
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(storage.get("openid"), "silent-user");
  assert.equal(await app.ensureLogin(), true);
  assert.equal(login.length, 1);
});

test("静默登录失败不写入身份，后续保存可重新登录", async () => {
  const { app, login, requests } = appFixture();
  const first = app.ensureLogin();
  const rejected = assert.rejects(first, /微信登录失败/);
  login[0].fail({ errMsg: "login:fail" });
  await rejected;
  assert.equal(app.globalData.openid, "");
  assert.equal(app._loginPromise, null);
  const retry = app.ensureLogin();
  login[1].success({ code: "retry" });
  requests[0].success(response("retry-user"));
  assert.equal(await retry, true);
});

function silentExportFixture() {
  const env = appFixture();
  let saves = 0,
    albums = 0;
  env.app.globalData.exportSession = {
    mode: "idphoto",
    resultPath: "photo",
    width: 295,
    height: 413,
    sizeName: "一寸",
    bgColor: "#FFFFFF",
  };
  const page = pageFixture("pages/export/export.js", env.app, {
    api: {
      request: async (route, options) => {
        if (route === "/api/history/save") {
          assert.equal(options.data.openid, "silent-user");
          saves++;
        }
        return { code: 200, data: { saveCount: 1, adViewCount: 0 } };
      },
      unwrap: (result) => result.data,
    },
    files: {
      call: async () => ({ width: 295, height: 413 }),
      readBase64: async () => "PHOTO",
      removeTemp() {},
    },
    "rewarded-video": { createRewardedVideoPlayer: () => ({ dispose() {} }) },
  });
  page.saveToAlbum = async () => albums++;
  page.onLoad();
  return { ...env, page, counts: () => ({ saves, albums }) };
}

test("未登录点保存会自动登录并继续一次保存，重复点击不重入，重复下载复用结果", async () => {
  const env = silentExportFixture();
  const pending = env.page.saveCurrent();
  await env.page.saveCurrent();
  assert.equal(env.login.length, 1);
  assert.equal(env.page.data.busy, true);
  assert.deepEqual(env.counts(), { saves: 0, albums: 0 });
  env.login[0].success({ code: "silent-code" });
  env.requests[0].success(response("silent-user"));
  await pending;
  assert.equal(env.page.data.saved, true);
  assert.equal(env.page.data.busy, false);
  assert.deepEqual(env.counts(), { saves: 1, albums: 1 });
  await env.page.saveCurrent();
  assert.deepEqual(env.counts(), { saves: 1, albums: 2 });
  env.page.onUnload();
});

test("保存时静默登录失败保留照片并可重试；退出页面后迟到登录不继续保存", async () => {
  const env = silentExportFixture();
  const pending = env.page.saveCurrent();
  env.login[0].fail({ errMsg: "login:fail" });
  await pending;
  assert.match(env.page.data.error, /微信登录失败/);
  assert.equal(env.page.data.busy, false);
  assert.equal(env.page._session.resultPath, "photo");
  assert.deepEqual(env.counts(), { saves: 0, albums: 0 });
  const retry = env.page.saveCurrent();
  env.page.onUnload();
  env.login[1].success({ code: "late" });
  env.requests[0].success(response("silent-user"));
  await retry;
  assert.deepEqual(env.counts(), { saves: 0, albums: 0 });
});

test("取消后迟到的登录响应不能写回身份，旧请求结束不清空新登录锁", async () => {
  const { app, login, requests, storage } = appFixture();
  const old = app.doLogin();
  const rejected = assert.rejects(old, (e) => e.cancelled === true);
  login[0].success({ code: "old" });
  app.cancelLogin();
  const current = app.doLogin();
  requests[0].success(response("stale"));
  await rejected;
  assert.equal(app.doLogin(), current);
  assert.equal(storage.get("openid"), "current");
  login[1].success({ code: "new" });
  requests[1].success(response("new-user"));
  await current;
  assert.equal(storage.get("openid"), "new-user");
  assert.equal(app.globalData.openid, "new-user");
});

test("退出清空身份、导出会话和云端列表，保留草稿和本机个人资料，迟到登录无效", async () => {
  const { app, login, requests, storage, pages } = appFixture();
  app.globalData.openid = "current";
  app.globalData.userInfo = { openid: "current" };
  app.globalData.exportSession = { image: "private" };
  for (const route of ["pages/history/history", "pages/profile/profile"]) {
    const p = {
      route,
      data: {
        hasLogin: true,
        historyList: [1],
        nickname: "name",
        avatarUrl: "avatar",
      },
    };
    p.setData = (v) => Object.assign(p.data, v);
    pages.push(p);
  }
  const pending = app.doLogin();
  const rejected = assert.rejects(pending, (e) => e.cancelled === true);
  login[0].success({ code: "code" });
  app.logout();
  requests[0].success(response("late"));
  await rejected;
  assert.equal(app.globalData.openid, "");
  assert.equal(app.globalData.userInfo, null);
  assert.equal(app.globalData.exportSession, null);
  assert.equal(storage.has("openid"), false);
  assert.equal(storage.get("drafts"), "keep");
  assert.equal(storage.get("shiguang_profiles_v1"), "keep");
  assert.equal(pages[0].data.historyList.length, 0);
  assert.equal(pages[1].data.nickname, "");
  assert.ok(pages.every((p) => p.data.hasLogin === false));
});

test("登录或退出的缓存写入失败不会产生半登录状态", async () => {
  const { app, wx, login, requests } = appFixture();
  wx.setStorageSync = () => {
    throw Error("full");
  };
  const pending = app.doLogin();
  const rejected = assert.rejects(pending, /无法保存登录状态/);
  login[0].success({ code: "code" });
  requests[0].success(response("new"));
  await rejected;
  assert.equal(app.globalData.openid, "");
  app.globalData.openid = "existing";
  wx.removeStorageSync = () => {
    throw Error("storage error");
  };
  assert.throws(() => app.logout(), /storage error/);
  assert.equal(app.globalData.openid, "existing");
});

function profileFixture(app, call) {
  return pageFixture(
    "pages/profile/profile.js",
    app,
    {
      api: {},
      drafts: { list: () => [] },
      files: { call },
      "user-profile": { get: () => null },
    },
    { showToast() {} },
  );
}
test("退出确认框可取消、阻止重复打开；确认后才执行退出", async () => {
  let done,
    dialogs = 0,
    logouts = 0;
  const app = {
    globalData: { openid: "user" },
    logout() {
      logouts++;
      this.globalData.openid = "";
    },
  };
  const p = profileFixture(app, (method, options) => {
    assert.equal(method, "showModal");
    assert.match(options.content, /草稿.*保留/);
    dialogs++;
    return new Promise((resolve) => (done = resolve));
  });
  const first = p.onLogout();
  await p.onLogout();
  assert.equal(dialogs, 1);
  done({ confirm: false });
  await first;
  assert.equal(logouts, 0);
  assert.equal(p.data.loggingOut, false);
  const second = p.onLogout();
  done({ confirm: true });
  await second;
  assert.equal(logouts, 1);
  assert.equal(p.data.loggingOut, false);
});

test("取消登录立即恢复按钮，旧登录回调不会刷新资料和额度", async () => {
  let done,
    cancellations = 0;
  const app = {
    globalData: { openid: "" },
    doLogin: () => new Promise((r) => (done = r)),
    cancelLogin() {
      cancellations++;
    },
  };
  const p = profileFixture(app, () => {});
  p.loadIdentity = p.fetchUsage = () => {
    throw Error("stale login refreshed page");
  };
  const login = p.onLogin();
  p.cancelLogin();
  assert.equal(p.data.busy, false);
  assert.equal(cancellations, 1);
  done({});
  await login;
  assert.equal(p.data.hasLogin, false);
  assert.equal(p.data.error, "");
});

test("退出后迟到的作品和额度请求不会恢复旧账号数据", async () => {
  const app = { globalData: { openid: "old" } };
  let historyDone, usageDone;
  const deps = {
    api: {
      request: () => new Promise((r) => (historyDone = r)),
      unwrap: (x) => x,
    },
    drafts: { list: () => [] },
    files: {},
  };
  const h = pageFixture("pages/history/history.js", app, deps);
  const hRequest = h.fetchHistoryList();
  const p = profileFixture(app, () => {});
  // Reload with a controlled pending usage request.
  deps.api.request = () => new Promise((r) => (usageDone = r));
  deps["user-profile"] = { get: () => null };
  const profile = pageFixture("pages/profile/profile.js", app, deps);
  const usage = profile.fetchUsage();
  app.globalData.openid = "";
  h.onShow();
  profile.onShow();
  historyDone([{ id: "private" }]);
  usageDone({ saveCount: 1 });
  await Promise.all([hRequest, usage]);
  assert.equal(h.data.historyList.length, 0);
  assert.equal(h.data.hasLogin, false);
  assert.equal(profile.data.usageKnown, false);
  assert.equal(profile.data.usageBusy, false);
});

const support = require("../mini-program/utils/support");
test("设备摘要只包含问题定位信息，不复制账号、照片和其他设备标识", () => {
  const text = support.deviceSummary({
    getDeviceInfo: () => ({
      brand: "Test",
      model: "Phone",
      system: "Test OS",
      deviceId: "private-device",
    }),
    getAppBaseInfo: () => ({
      version: "8.0",
      SDKVersion: "3.0",
      openid: "private-user",
    }),
    getAccountInfoSync: () => ({
      miniProgram: { envVersion: "trial", appId: "private-app" },
    }),
  });
  assert.match(text, /体验版/);
  assert.match(text, /Test Phone/);
  assert.match(text, /操作步骤/);
  assert.doesNotMatch(text, /private/);
  assert.doesNotThrow(() =>
    support.deviceSummary({
      getDeviceInfo() {
        throw Error("unsupported");
      },
    }),
  );
});

test("帮助页切换问答、取消客服无报错，失败可重试，复制防重且失败恢复", async () => {
  let done,
    calls = 0;
  const p = pageFixture(
    "pages/support/support.js",
    {},
    {
      support,
      files: {
        call: () => {
          calls++;
          return new Promise((resolve, reject) => (done = { resolve, reject }));
        },
      },
    },
    { canIUse: () => true, showToast() {} },
  );
  p.onLoad();
  const event = { currentTarget: { dataset: { id: "draft" } } };
  p.toggleFaq(event);
  assert.equal(p.data.expanded, "draft");
  p.toggleFaq(event);
  assert.equal(p.data.expanded, "");
  p.onContact({ detail: { errMsg: "contact:fail" } });
  assert.match(p.data.error, /暂时无法打开/);
  p.prepareContact();
  assert.equal(p.data.error, "");
  p.onContact({ detail: { errMsg: "contact:cancel" } });
  assert.equal(p.data.error, "");
  const first = p.copyDeviceInfo();
  await p.copyDeviceInfo();
  assert.equal(calls, 1);
  done.reject(Error("clipboard failed"));
  await first;
  assert.equal(p.data.copying, false);
  assert.match(p.data.error, /复制失败/);
  const second = p.copyDeviceInfo();
  done.resolve({});
  await second;
  assert.equal(p.data.copying, false);
  assert.equal(p.data.error, "");
  p.onUnload();
  await p.copyDeviceInfo();
  assert.equal(calls, 2);
});

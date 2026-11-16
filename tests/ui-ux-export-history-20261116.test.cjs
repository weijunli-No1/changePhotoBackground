const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function loadPage(name, { app, wx = {}, dependencies = {} }) {
  dependencies = {
    "brand-preview": { create: async (_page, source) => "BRANDED:" + source },
    ...dependencies,
  };
  const filename = path.resolve(__dirname, `../mini-program/pages/${name}/${name}.js`);
  const actual = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => (definition = value),
    getApp: () => app,
    wx,
    setTimeout,
    require: (name) => {
      const key = name.split("/").pop();
      return key in dependencies ? dependencies[key] : actual(name);
    },
  });
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(value, done) { Object.assign(this.data, value); done?.(); },
  };
}

test("删除云端作品替换删除前的刷新，旧响应不能将已删除作品放回列表", async () => {
  const loads = [];
  const page = loadPage("history", {
    app: { globalData: { openid: "owner", sessionToken: "fixture-token" } },
    wx: { showToast() {} },
    dependencies: {
      api: {
        unwrap: (value) => value,
        request: (route) => route.startsWith("/api/history/") && route !== "/api/history/list"
          ? Promise.resolve({})
          : new Promise((resolve, reject) => loads.push({ resolve, reject })),
      },
      files: { call: async () => ({ confirm: true }) },
    },
  });
  page.setData({ historyList: [{ id: 1 }, { id: 2 }], error: "旧的删除错误" });
  const oldRefresh = page.fetchHistoryList();
  const removing = page.onDelete({ currentTarget: { dataset: { id: 1 } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads.length, 2);
  assert.deepEqual(page.data.historyList.map((item) => item.id), [2]);
  assert.equal(page.data.error, "");
  loads[0].resolve([{ id: 1 }, { id: 2 }]);
  await oldRefresh;
  assert.deepEqual(page.data.historyList.map((item) => item.id), [2]);
  assert.equal(page.data.isLoading, true);
  loads[1].reject(Error("刷新失败"));
  await removing;
  assert.equal(page.data.isLoading, false);
  assert.deepEqual(page.data.historyList.map((item) => item.id), [2]);
  assert.equal(page.data.loadError, "刷新失败");
});

test("六寸排版保存后显示成品尺寸，迟到的单张尺寸不会覆盖它", async () => {
  let sourceInfo;
  const page = loadPage("export", {
    app: {
      globalData: { openid: "owner", exportSession: { mode: "idphoto", resultPath: "SINGLE", previewPath: "PREVIEW", width: 295, height: 413 } },
      ensureLogin: async () => true,
    },
    dependencies: {
      membership: { refresh: async () => ({ isLifetimeMember: false }) },
      api: { unwrap: (value) => value },
      "rewarded-video": { createRewardedVideoPlayer: () => ({}) },
      files: {
        call: (_method, options) => options.src === "SINGLE"
          ? new Promise((resolve) => { sourceInfo = resolve; })
          : Promise.resolve({ width: 1800, height: 1200 }),
        readBase64: async () => "BASE64",
        writeBase64: async () => "LAYOUT",
      },
    },
  });
  page.fetchUsage = async () => {};
  page.requestSave = async () => ({ image_base64: "LAYOUT_BASE64" });
  page.saveToAlbum = async () => {};
  page.onLoad();
  await page._previewReady;
  await page.savePrintLayout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.saved, true);
  assert.equal(page.data.action, "layout");
  assert.equal(page.data.actualWidth, 1800);
  assert.equal(page.data.actualHeight, 1200);
  sourceInfo({ width: 295, height: 413 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.actualWidth, 1800);
  assert.equal(page.data.actualHeight, 1200);
});

function exportDimensionsFixture() {
  let failAlbum = false;
  const page = loadPage("export", {
    app: {
      globalData: { openid: "owner", exportSession: { mode: "idphoto", resultPath: "SINGLE", previewPath: "PREVIEW", width: 295, height: 413 } },
      ensureLogin: async () => true,
    },
    dependencies: {
      membership: { refresh: async () => ({ isLifetimeMember: false }) },
      api: { unwrap: (value) => value },
      "rewarded-video": { createRewardedVideoPlayer: () => ({}) },
      files: {
        call: async (_method, options) => options.src === "SINGLE"
          ? { width: 295, height: 413 }
          : { width: 1800, height: 1200 },
        readBase64: async () => "BASE64",
        writeBase64: async () => "LAYOUT",
      },
    },
  });
  page.fetchUsage = async () => {};
  page.requestSave = async () => ({ image_base64: "LAYOUT_BASE64" });
  page.saveToAlbum = async () => { if (failAlbum) throw Error("相册写入失败"); };
  page.onLoad();
  return { page, failAlbum: () => { failAlbum = true; } };
}

test("排版保存后切回电子照片，预览和再次保存恢复单张实测尺寸", async () => {
  const { page } = exportDimensionsFixture();
  await page._previewReady;
  await page.savePrintLayout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.actualWidth, 1800);
  page.selectAction({ currentTarget: { dataset: { action: "single" } } });
  assert.equal(page.data.saved, false);
  assert.equal(page.data.actualWidth, 295);
  assert.equal(page.data.actualHeight, 413);
  await page.saveCurrent();
  assert.equal(page.data.saved, true);
  assert.equal(page.data.action, "single");
  assert.equal(page.data.actualWidth, 295);
  assert.equal(page.data.actualHeight, 413);
});

test("排版再次保存失败后展示的单张预览使用单张尺寸", async () => {
  const { page, failAlbum } = exportDimensionsFixture();
  await page._previewReady;
  await page.savePrintLayout();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.actualWidth, 1800);
  failAlbum();
  await page.saveCurrent();
  assert.equal(page.data.saved, false);
  assert.equal(page.data.actualWidth, 295);
  assert.equal(page.data.actualHeight, 413);
  assert.match(page.data.error, /相册写入失败/);
});

test("退出会员页后到达的恢复订单仍保留订单号，不再更新已卸载页面", async () => {
  let resolveOrder;
  let pending;
  const page = loadPage("member", {
    app: { globalData: { openid: "owner" } },
    dependencies: {
      membership: {
        refresh: async () => ({ isLifetimeMember: false, purchaseEnabled: true }),
        paymentSupport: () => "",
        getPending: () => pending,
        setPending: (owner, id) => { pending = { owner, id }; },
      },
      api: { unwrap: (value) => value, request: () => new Promise((resolve) => { resolveOrder = resolve; }) },
      files: { call: async () => ({ code: "login-code" }) },
    },
  });
  page.setData({ checking: false, statusKnown: true, purchaseEnabled: true, agreed: true });
  const buying = page.buy();
  await new Promise((resolve) => setImmediate(resolve));
  page.onUnload();
  page.setData = () => { throw Error("不得更新已卸载页面"); };
  resolveOrder({ outTradeNo: "PENDING", recoveryRequired: true });
  await buying;
  assert.deepEqual(pending, { owner: "owner", id: "PENDING" });
});

test("已保存排版的预览重试重新烧录水印，不将干净排版传入视图数据", async () => {
  const checked = [];
  let branded = 0;
  const page = loadPage("export", {
    app: { globalData: {} },
    dependencies: {
      files: { call: async (_method, options) => { checked.push(options.src); return {}; } },
      "brand-preview": { create: async (_page, source) => { assert.equal(source, "LAYOUT"); branded++; return "BRANDED_LAYOUT"; } },
    },
  });
  page._session = { resultPath: "SINGLE" };
  page._savedPath = "LAYOUT";
  page.setData({ saved: true, action: "layout", previewPath: "OLD_SINGLE_PREVIEW" });
  page.previewError();
  await page.primaryAction();
  assert.equal(branded, 1);
  assert.deepEqual(checked, []);
  assert.equal(page.data.previewPath, "BRANDED_LAYOUT");
  assert.equal(Object.hasOwn(page.data, "savedPath"), false);
  assert.equal(page.data.previewFailed, false);
});

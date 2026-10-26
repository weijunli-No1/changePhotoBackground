const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const specs = require("../mini-program/utils/photo-specs");
function load(file, globals = {}) {
  const filename = path.resolve(__dirname, "../mini-program", file);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => (definition = value),
    App: (value) => (definition = value),
    require: createRequire(filename),
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return {
    ...definition,
    data: structuredClone(definition.data || {}),
    setData(values, cb) {
      Object.assign(this.data, values);
      if (cb) cb();
    },
  };
}
test("编辑中从考试目录更改规格沿用当前照片，不再打开相册，并传回考试规则", async () => {
  for (const id of [
    "national-civil",
    "cpa",
    specs.presets.find((s) => s.category === "common").id,
  ]) {
    let selected, delta;
    const p = load("pages/spec-detail/spec-detail.js", {
      wx: { navigateBack: (options) => (delta = options.delta) },
    });
    p.getOpenerEventChannel = () => ({
      emit: (event, value) => (selected = value),
    });
    p.onLoad({ id, select: "1" });
    await p.start(); // 缺少相册 API，误走选图会导致这里失败。
    assert.equal(p.data.selectOnly, true);
    assert.equal(selected.size.specId, id);
    assert.equal(selected.size.width, specs.getSpec(id).width);
    assert.equal(delta, 2);
  }
});
test("相同像素切换考试仍应用文件规则，更新名称；处理中不污染当前规格", () => {
  const p = load("pages/edit/edit.js");
  let requests = 0;
  p.processTransparentImage = () => requests++;
  p.setData({
    sourcePath: "CURRENT",
    size: { name: "一寸", width: 295, height: 413 },
  });
  p.selectSpec({
    detail: { name: "国考", width: 295, height: 413, specId: "national-civil" },
  });
  assert.equal(p.data.sourcePath, "CURRENT");
  assert.equal(p.data.size.name, "国考");
  assert.equal(p._examSpec.id, "national-civil");
  assert.equal(requests, 1);
  p.selectSpec({
    detail: {
      name: "当前国考规格",
      width: 295,
      height: 413,
      specId: "national-civil",
    },
  });
  assert.equal(requests, 1);
  assert.equal(p.data.size.name, "当前国考规格");
  p._mattingBusy = true;
  p.selectSpec({
    detail: { name: "其他", width: 178, height: 220, specId: "cpa" },
  });
  assert.equal(p._examSpec.id, "national-civil");
  p._mattingBusy = false;
  p.selectSpec({ detail: { name: "一寸", width: 295, height: 413 } });
  assert.equal(p._examSpec, null);
  assert.equal(requests, 2);
});
test("分类内搜索无结果时扩大到全部分类，保留用户输入并恢复可选结果", () => {
  const p = load("pages/specs/specs.js");
  p.setData({ query: "国考", category: "education" });
  p.refresh();
  assert.equal(p.data.count, 0);
  p.broadenSearch();
  assert.equal(p.data.query, "国考");
  assert.equal(p.data.category, "all");
  assert.ok(
    p.data.groups.some((g) => g.items.some((s) => s.id === "national-civil")),
  );
});
test("水印服务未开放不上传；重新检查可恢复生成，退出后迟到检查不改界面", async () => {
  let ready,
    uploads = 0;
  const app = {
    globalData: { watermarkEnabled: false },
    appConfigReady: Promise.resolve(),
    loadRemoteAppConfig: () => new Promise((r) => (ready = r)),
  };
  const p = load("pages/watermark/watermark.js", {
    getApp: () => app,
    require: (n) => (n.endsWith("/api") ? { watermark: () => uploads++ } : {}),
  });
  p.setData({ sourcePath: "PHOTO" });
  await p.checkService();
  assert.equal(p.data.serviceReady, false);
  await p.generate();
  assert.equal(uploads, 0);
  const check = p.checkService({});
  app.globalData.watermarkEnabled = true;
  ready();
  await check;
  assert.equal(p.data.serviceReady, true);
  const late = p.checkService({});
  p._unloaded = true;
  app.globalData.watermarkEnabled = false;
  ready();
  await late;
  assert.equal(p.data.serviceReady, true);
});
test("修改水印间距会改变预览排布，处理期间不改变样式", () => {
  const p = load("pages/watermark/watermark.js");
  p._ready = true;
  p.setData({ width: 400, height: 560 });
  p.createSelectorQuery = () => ({
    select() {
      return this;
    },
    boundingClientRect() {
      return this;
    },
    exec(callback) {
      callback([{ width: 300, height: 300 }]);
    },
  });
  p.updatePreview();
  const before = p.data.spacingStyle;
  p.slider({
    currentTarget: { dataset: { key: "space" } },
    detail: { value: 60 },
  });
  assert.notEqual(p.data.spacingStyle, before);
  const after = p.data.spacingStyle;
  p.setData({ processing: true });
  p.slider({
    currentTarget: { dataset: { key: "space" } },
    detail: { value: 20 },
  });
  assert.equal(p.data.spacingStyle, after);
});
test("运行配置只有明确声明水印可用才开放，旧服务和网络失败不误启用", async () => {
  let request;
  const app = load("app.js", { wx: { request: (o) => (request = o) } });
  app.globalData = { ...app.globalData };
  let pending = app.loadRemoteAppConfig();
  request.success({ data: { code: 200, data: { watermarkEnabled: true } } });
  request.complete();
  await pending;
  assert.equal(app.globalData.watermarkEnabled, true);
  pending = app.loadRemoteAppConfig();
  request.success({ data: { code: 200, data: {} } });
  request.complete();
  await pending;
  assert.equal(app.globalData.watermarkEnabled, false);
  app.globalData.watermarkEnabled = true;
  pending = app.loadRemoteAppConfig();
  request.fail();
  request.complete();
  await pending;
  assert.equal(app.globalData.watermarkEnabled, false);
});
test("原图适配可直接复用照片转入换底色，导航失败保留原照并可重试", async () => {
  let fail = true,
    url,
    calls = 0;
  const p = load("pages/exam/exam.js", {
    require: (n) =>
      n.endsWith("/files")
        ? {
            call: async (method, options) => {
              assert.equal(method, "redirectTo");
              calls++;
              url = options.url;
              if (fail) throw Error("导航失败");
            },
          }
        : createRequire(
            path.resolve(__dirname, "../mini-program/pages/exam/exam.js"),
          )(n),
  });
  p.setData({ sourcePath: "CURRENT PHOTO.jpg", spec: specs.getSpec("cpa") });
  await p.smartPhoto();
  assert.match(p.data.error, /重试/);
  assert.equal(p.data.sourcePath, "CURRENT PHOTO.jpg");
  assert.equal(p.data.opening, false);
  fail = false;
  await p.smartPhoto();
  assert.match(url, /^\/pages\/edit\/edit\?/);
  assert.ok(url.includes("src=CURRENT%20PHOTO.jpg"));
  assert.ok(url.includes("spec=cpa"));
  p.setData({ processing: true });
  await p.smartPhoto();
  assert.equal(calls, 2);
});

test("失效保存会话提供返回编辑；没有上一页时恢复首页，不调用保存接口", () => {
  let home;
  const p = load("pages/export/export.js", {
    getApp: () => ({ globalData: {} }),
    wx: { navigateBack: (o) => o.fail(), switchTab: (o) => (home = o.url) },
  });
  p.onLoad();
  assert.equal(p.data.unavailable, true);
  p.primaryAction();
  assert.equal(home, "/pages/index/index");
});

test("原图文件失效时阻止保存，并显示明确恢复状态", async () => {
  let saves = 0;
  const app = {
    globalData: {
      exportSession: {
        mode: "idphoto",
        resultPath: "MISSING",
        previewPath: "BRANDED",
      },
    },
  };
  const real = createRequire(
    path.resolve(__dirname, "../mini-program/pages/export/export.js"),
  );
  const p = load("pages/export/export.js", {
    getApp: () => app,
    wx: {},
    require: (n) =>
      n.endsWith("/files")
        ? {
            call: async () => {
              throw Error("missing");
            },
          }
        : real(n),
  });
  p.saveToAlbum = async () => saves++;
  p.onLoad();
  await new Promise((r) => setImmediate(r));
  assert.equal(p.data.unavailable, true);
  assert.equal(p.data.previewPath, "");
  await p.saveImage("single");
  assert.equal(saves, 0);
});

test("预览失败可在当前页重建品牌水印，重试不消耗保存次数且防重复", async () => {
  let resolve,
    renders = 0,
    saves = 0;
  const real = createRequire(
    path.resolve(__dirname, "../mini-program/pages/export/export.js"),
  );
  const p = load("pages/export/export.js", {
    getApp: () => ({ globalData: {} }),
    wx: {},
    require: (n) =>
      n.endsWith("/brand-preview")
        ? {
            create: () => {
              renders++;
              return new Promise((r) => (resolve = r));
            },
          }
        : real(n),
  });
  p._session = { resultPath: "CLEAN" };
  p.setData({ previewPath: "BROKEN" });
  p.saveCurrent = () => saves++;
  p.previewError();
  const retry = p.primaryAction();
  p.primaryAction();
  assert.equal(renders, 1);
  assert.equal(saves, 0);
  assert.equal(p.data.previewPreparing, true);
  resolve("NEW_BRANDED");
  await retry;
  assert.equal(p.data.previewPath, "NEW_BRANDED");
  assert.equal(p.data.previewPreparing, false);
  assert.equal(p.data.previewFailed, false);
});

test("删除草稿从确认开始防重复，失败可重试，退出后迟到确认不删除", async () => {
  let resolve,
    dialogs = 0,
    removes = 0;
  const real = createRequire(
    path.resolve(__dirname, "../mini-program/pages/history/history.js"),
  );
  const p = load("pages/history/history.js", {
    getApp: () => ({ globalData: {} }),
    wx: {},
    require: (n) =>
      n.endsWith("/files")
        ? {
            call: () => {
              dialogs++;
              return new Promise((r) => (resolve = r));
            },
          }
        : n.endsWith("/drafts")
          ? {
              remove: async () => {
                removes++;
                throw Error("storage");
              },
            }
          : real(n),
  });
  const e = { currentTarget: { dataset: { id: "DRAFT" } } };
  const first = p.removeDraft(e);
  await p.removeDraft(e);
  assert.equal(dialogs, 1);
  resolve({ confirm: true });
  await first;
  assert.equal(removes, 1);
  assert.match(p.data.error, /重试/);
  assert.equal(p._removingDraft, false);
  const retry = p.removeDraft(e);
  p._unloaded = true;
  resolve({ confirm: true });
  await retry;
  assert.equal(removes, 1);
});

test("删除云端记录确认期间防重复，账号切换或确认失败不会误删且允许重试", async () => {
  let resolve,
    reject,
    dialogs = 0,
    requests = 0;
  const app = { globalData: { openid: "A" } };
  const real = createRequire(
    path.resolve(__dirname, "../mini-program/pages/history/history.js"),
  );
  const p = load("pages/history/history.js", {
    getApp: () => app,
    wx: {},
    require: (n) =>
      n.endsWith("/files")
        ? {
            call: () => {
              dialogs++;
              return new Promise((r, j) => {
                resolve = r;
                reject = j;
              });
            },
          }
        : n.endsWith("/api")
          ? { request: async () => requests++, unwrap: (v) => v }
          : real(n),
  });
  const e = { currentTarget: { dataset: { id: 42 } } };
  const first = p.onDelete(e);
  await p.onDelete(e);
  assert.equal(dialogs, 1);
  app.globalData.openid = "B";
  resolve({ confirm: true });
  await first;
  assert.equal(requests, 0);
  const second = p.onDelete(e);
  reject(Error("确认框未能打开"));
  await second;
  assert.equal(p._deleting, false);
  assert.match(p.data.error, /确认框/);
  const third = p.onDelete(e);
  p._unloaded = true;
  resolve({ confirm: true });
  await third;
  assert.equal(requests, 0);
});

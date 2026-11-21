const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");

function pageFor(name, { modules = {}, wx = {}, app = {} } = {}) {
  const file = resolve(__dirname, `../mini-program/pages/${name}/${name}.js`);
  const fromPage = createRequire(file);
  let page;
  vm.runInNewContext(readFileSync(file, "utf8"), {
    Page(value) { page = value; },
    require(name) { return modules[name] || fromPage(name); },
    getApp() { return app; },
    setTimeout, clearTimeout,
    wx,
  }, { filename: file });
  page.setData = function (patch, done) {
    Object.assign(this.data, patch);
    if (done) done();
  };
  return page;
}

function touch(x, y) {
  return { touches: [{ identifier: 1, clientX: x, clientY: y }] };
}

test("裁剪照片拖至边缘时实时限制位移，只在松手时重做一次；轻触不触发生成", () => {
  const page = pageFor("tools");
  page._cropGeometry = { dx: 0, dy: 100 };
  page.setData({ mode: "crop", canMoveY: true, resultPath: "previous" });
  let renders = 0;
  page.apply = () => { renders++; };
  page.startCropDrag(touch(0, 120));
  page.moveCropDrag(touch(0, 121));
  page.endCropDrag();
  assert.equal(renders, 0);
  assert.equal(page.data.resultPath, "previous");
  page.startCropDrag(touch(0, 120));
  page.moveCropDrag(touch(0, 35));
  assert.equal(page.data.adjusting, true);
  assert.equal(page.data.resultPath, "");
  assert.equal(renders, 0);
  assert.match(page.data.cropFallbackTransform, /-100px/);
  page.endCropDrag();
  page.endCropDrag();
  assert.equal(renders, 1);
  assert.equal(page.data.positionY, 100);
  assert.equal(page.data.adjusting, false);
  page.startCropDrag(touch(0, 120));
  page.moveCropDrag(touch(0, 160));
  page.cancelCropDrag();
  assert.equal(renders, 2);
  assert.equal(page.data.positionY, 100);
});

test("对照仅在有受保护预览时生效，照片拖动与原生滑杆共用分界线", () => {
  const page = pageFor("edit");
  page.setData({ sourcePath: "original", resultPath: "private" });
  page.toggleCompare();
  assert.equal(page.data.comparing, false);
  page.setData({ previewPath: "protected" });
  page.toggleCompare();
  page._compareRect = { left: 20, width: 100 };
  page.scrubComparison(touch(40, 0));
  assert.equal(page.data.comparison, 20);
  page.slideComparison({ detail: { value: 102 } });
  assert.equal(page.data.comparison, 100);
  page.toggleCompare();
  page.scrubComparison(touch(20, 0));
  assert.equal(page.data.comparison, 100);
});

test("水印滑杆重新使用当前画布尺寸，窗口调整时丢弃旧测量并使用最新参数", () => {
  const page = pageFor("watermark");
  const queries = [];
  page._ready = true;
  page.setData({ width: 200, height: 200 });
  page.createSelectorQuery = () => ({
    select() { return this; }, boundingClientRect() { return this; },
    exec(callback) { queries.push(callback); },
  });
  page.updatePreview();
  page.invalidate({ opacity: 40 });
  assert.equal(queries.length, 1);
  page.onResize();
  queries[0]([{ width: 132, height: 124 }]);
  assert.equal(page.data.previewStyle, "");
  queries[1]([{ width: 232, height: 224 }]);
  assert.equal(page.data.previewStyle, "width:200px;height:200px;");
  page.invalidate({ opacity: 55 });
  assert.match(page.data.textStyle, /opacity:0.55;/);
  assert.equal(queries.length, 2);
});


test("从相纸选择原照后编辑、恢复草稿和继续预览都保留六寸意图，普通入口默认单张", async () => {
  const app = { globalData: {} };
  const routes = [];
  const saved = { id: "d1", sourcePath: "portrait", width: 295, height: 413, exportAction: "layout" };
  const wx = { navigateTo(options) { routes.push(options.url); options.complete(); } };
  const modules = {
    "../../utils/drafts": { createId: () => "d2", get: () => saved, save: async (snapshot) => snapshot },
    "../../utils/files": { call: async () => ({ width: 295, height: 413 }) },
  };
  for (const args of [{ src: "portrait", exportAction: "layout" }, { draft: "d1" }, { src: "portrait" }]) {
    const page = pageFor("edit", { app, wx, modules });
    page.processTransparentImage = () => {};
    await page.onLoad(args);
    page.setData({ resultPath: "clean", previewPath: "protected" });
    await page.goExport();
    assert.equal(routes.pop(), "/pages/export/export");
    assert.equal(app.globalData.exportSession.exportAction, args.draft || args.exportAction ? "layout" : undefined);
  }
});

test("未选照片时可预设裁剪比例，首次选图沿用比例，替换旧图重新取景", async () => {
  const page = pageFor("tools", { modules: {
    "../../utils/drafts": { createId: () => "draft" },
    "../../utils/files": {
      call: async () => ({ width: 400, height: 560 }),
      fileSize: async () => 1024,
      formatBytes: () => "1 KB",
    },
  } });
  page.onLoad({ mode: "crop" });
  page.setRatio({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(page.data.ratio, 0.75);
  await page.loadSource("new", true);
  assert.equal(page.data.ratio, 0.75);
  await page.loadSource("replacement", true);
  assert.equal(page.data.ratio, 0);
});

test("调整水印样张在本机立即更新，样张不会成为待上传的原图", async () => {
  const page = pageFor("watermark");
  page._ready = true;
  page._stageSize = { width: 320, height: 240 };
  page.createSelectorQuery = () => assert.fail("已测量的画布无需重新查询");
  page.setData({ serviceReady: true, checkingService: false });
  page.direction({ currentTarget: { dataset: { angle: 0 } } });
  assert.match(page.data.textStyle, /rotate\(0deg\)/);
  assert.match(page.data.previewStyle, /height:216px/);
  await page.generate();
  assert.equal(page.data.sourcePath, "");
  assert.equal(page.data.resultPath, "");
});


for (const name of ["edit", "exam"]) {
  test(name + " 常规视图用独立缩图，点大图只传本次生成的水印版", async () => {
    const calls = [];
    const page = pageFor(name, { modules: {
      "../../utils/files": { call: async (method, options) => { calls.push([method, ...options.urls]); } },
    } });
    page._brandedPreviewPath = "branded";
    page.setData({ sourcePath: "source", resultPath: "original-size", displayPath: "small", previewPath: "branded" });
    await page.viewLarge();
    assert.deepEqual(calls, [["previewImage", "branded"]]);
    for (const path of ["", "small", "source", "original-size", "old-draft"]) {
      page.setData({ previewPath: path });
      await page.viewLarge();
    }
    page.setData({ previewPath: "branded", processing: true });
    await page.viewLarge();
    assert.equal(calls.length, 1);
    const wxml = readFileSync(resolve(__dirname, "../mini-program/pages", name, name + ".wxml"), "utf8");
    const photos = wxml.match(/<image\b[^>]*\/>/gs);
    assert.ok(photos.some(tag => tag.includes("{{displayPath") && tag.includes('bindtap="viewLarge"')));
    for (const photo of photos) {
      assert.match(photo, /show-menu-by-longpress="\{\{false\}\}"/);
      assert.doesNotMatch(photo, /src="[^"]*(previewPath|resultPath)/);
    }
  });
}

test("低像素考试以最终成品生成缩图，大图沿用高清原照取景，草稿注明两种预览", async () => {
  const calls = [];
  const app = { globalData: {} };
  const page = pageFor("exam", { app, modules: {
    "../../utils/exam-image": { prepare: async () => ({ path: "178x220", bytes: 10000, width: 178, height: 220 }) },
    "../../utils/brand-preview": {
      VERSION: 2,
      DISPLAY_VERSION: 1,
      createPair: async (_page, source, options) => {
        calls.push({ source, ...options });
        return { displayPath: "thumbnail", previewPath: "marked" };
      },
    },
    "../../utils/drafts": { save: async (draft) => draft },
    "../../utils/files": { formatBytes: () => "10 KB", call: async () => {} },
  } });
  page._revision = 0;
  page.setData({ spec: { width: 178, height: 220 }, sourcePath: "high-res", positionX: 32, positionY: 50 });
  await page.process();
  assert.deepEqual(calls, [{ source: "high-res", displaySource: "178x220", ratio: 178 / 220, x: 32, y: 50 }]);
  await page.goExport();
  assert.equal(app.globalData.exportSession.displayPath, "thumbnail");
  assert.equal(app.globalData.exportSession.displayPreviewVersion, 1);
  assert.equal(app.globalData.exportSession.previewPath, "marked");
  assert.equal(app.globalData.exportSession.previewWatermarkVersion, 2);
  assert.equal(app.globalData.exportSession.requiresQuota, true);
});

test("考试换底色复用同一画布队列，按已适配的成品生成无水印缩图", async () => {
  let drawing = false;
  const removed = [];
  const page = pageFor("edit", { modules: {
    "../../utils/api": { request: async () => ({ image_base64: "photo" }), unwrap: value => value },
    "../../utils/files": { writeBase64: async () => "full", removeTemp: path => removed.push(path) },
    "../../utils/exam-image": { prepare: async (_page, path) => {
      assert.equal(drawing, true);
      assert.equal(path, "full");
      return { path: "adapted" };
    } },
    "../../utils/brand-preview": {
      withCanvas: async (_page, draw) => {
        drawing = true;
        try { return await draw(); } finally { drawing = false; }
      },
      createPair: async (_page, source, { displaySource }) => {
        assert.equal(drawing, false);
        assert.equal(source, "full");
        assert.equal(displaySource, "adapted");
        return { displayPath: "small", previewPath: "branded" };
      },
    },
  } });
  page._seq = 0;
  page._colorSeq = 0;
  page._transparent = "person";
  page._examSpec = { width: 178, height: 220 };
  page.persistDraft = () => {};
  await page.changeBackgroundColor("#FFFFFF");
  assert.equal(page.data.resultPath, "adapted");
  assert.equal(page.data.displayPath, "small");
  assert.equal(page.data.previewPath, "branded");
  assert.deepEqual(removed, ["full"]);
});

test("裁剪与考试构图在相同滑杆刻度松手、默认状态还原，都保留现有成品", () => {
  const tools = pageFor("tools"), exam = pageFor("exam");
  for (const page of [tools, exam]) page.setData({ resultPath: "done", displayPath: "small", previewPath: "proof" });
  tools.apply = exam.process = () => assert.fail("没有修改参数，无需重新生成");
  const event = { currentTarget: { dataset: { axis: "Y" } }, detail: { value: 50 } };
  tools.previewPositionY(event);
  tools.positionY(event);
  tools.reset();
  exam.move(event);
  exam.moveEnd(event);
  for (const page of [tools, exam]) {
    assert.equal(page.data.resultPath, "done");
    assert.equal(page.data.adjusting, false);
  }
});

test("换色失败后可沿用上次效果，恢复保存且无需再次请求", async () => {
  const page = pageFor("edit");
  page._colorSeq = 0;
  page._appliedColor = "#638cce";
  page._failedColor = "#FF0000";
  page._transparent = "mask";
  page.setData({ sourcePath: "source", displayPath: "blue-small", resultPath: "blue", error: "换色失败" });
  await page.keepLastEffect();
  assert.equal(page.data.error, "");
  assert.equal(page.data.currentBgColor, "#638cce");
  assert.equal(page.snapshot().resultPath, "blue");
  assert.equal(page.snapshot().displayPath, "blue-small");
});

test("水印恢复期间不能导出旧图；改过文字后迟到的旧图也不会覆盖当前样式", async () => {
  let resolveResult, started;
  const checkingResult = new Promise(resolve => { started = resolve; });
  const page = pageFor("watermark", { modules: {
    "../../utils/drafts": {
      get: () => ({ mode: "watermark", sourcePath: "source", resultPath: "old", toolState: { text: "旧文字" } }),
      save: () => assert.fail("未经检查的草稿不能导出"),
    },
    "../../utils/files": {
      call: async (_method, { src }) => {
        if (src === "old") { started(); await new Promise(resolve => { resolveResult = resolve; }); }
      },
      fileSize: async () => 100,
    },
  } });
  page.checkService = () => {};
  const restoring = page.onLoad({ draft: "draft" });
  await checkingResult;
  assert.equal(page.data.restoring, true);
  assert.equal(page.data.resultPath, "");
  await page.goExport();
  page.input({ detail: { value: "    " } });
  assert.equal(page.data.previewText, "");
  page.input({ detail: { value: "  新文字 " } });
  resolveResult();
  await restoring;
  assert.equal(page.data.restoring, false);
  assert.equal(page.data.previewText, "新文字");
  assert.equal(page.data.resultPath, "");
});

test("编辑草稿尚未完成读取时退出，保留原有成品与预览", async () => {
  let resolveMask, reading;
  const pendingMask = new Promise(resolve => { reading = resolve; });
  const page = pageFor("edit", { modules: {
    "../../utils/drafts": {
      get: () => ({ mode: "idphoto", sourcePath: "original", resultPath: "saved", transparentPath: "mask", width: 295, height: 413 }),
      save: () => assert.fail("恢复尚未完成，不能写回空的成品"),
    },
    "../../utils/files": {
      call: async () => ({}),
      readBase64: () => { reading(); return new Promise(resolve => { resolveMask = resolve; }); },
    },
  } });
  const restoring = page.onLoad({ draft: "d1" });
  await pendingMask;
  page.onHide();
  page.onUnload();
  resolveMask("late mask");
  await restoring;
  assert.equal(page._transparent, undefined);
});

test("本机工具遇到其他工具的草稿时只给出重新选图入口", () => {
  const page = pageFor("tools", { modules: {
    "../../utils/drafts": { get: () => ({ mode: "idphoto", sourcePath: "portrait", resultPath: "paid" }) },
  } });
  page.onLoad({ mode: "compress", draft: "d1" });
  assert.equal(page.data.mode, "compress");
  assert.equal(page.data.displayPath, "");
  assert.equal(page.data.sourcePath, "");
  assert.match(page.data.error, /重新选图/);
});

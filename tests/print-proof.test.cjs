const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function exportPage(width = 295, height = 413, clock = {}, options = {}, session = {}) {
  const app = {
    globalData: { openid: "owner", sessionToken: "session", exportSession: {
      mode: "idphoto", width, height, resultPath: "portrait", ...session,
    } },
    ensureLogin: async () => true,
  };
  const removed = [];
  const files = {
    readBase64: async () => "portrait-bytes",
    writeBase64: async () => "layout",
    call: async () => ({ width, height }),
    removeTemp: (file) => removed.push(file),
  };
  const dependencies = {
    files,
    api: { unwrap: (result) => result },
    membership: { refresh: async () => ({ isLifetimeMember: false }) },
    "rewarded-video": { createRewardedVideoPlayer: () => ({ dispose() {} }) },
    "brand-preview": { displayPreview: async (page, source) => "display-" + source, create: async (page, source) => "branded-" + source },
  };
  let page;
  const filename = path.resolve(__dirname, "../mini-program/pages/export/export.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) => dependencies[path.basename(name)],
    Page: (definition) => { page = definition; },
    getApp: () => app,
    wx: {}, setTimeout, clearTimeout, ...clock,
  });
  page.setData = (patch, done) => { Object.assign(page.data, patch); done?.(); };
  const fetchUsage = page.fetchUsage.bind(page);
  page.fetchUsage = async () => {};
  let requests = 0;
  page.requestSave = async () => { requests++; return { image_base64: "sheet-bytes" }; };
  page.saveToAlbum = async () => {};
  page.onLoad(options);
  return { page, files, app, dependencies, fetchUsage, removed, requests: () => requests };
}

const layout = { currentTarget: { dataset: { action: "layout" } } };
const imageEvent = (path) => ({ currentTarget: { dataset: { path } } });

test("切换机身后忽略上一款的加载错误，只对当前失败的图片显示备用机身", () => {
  const { page } = exportPage(295, 413, {}, { demo: "print" });
  const peach = "/assets/printers/peach.png";
  const sky = "/assets/printers/sky-matte.png";
  const failed = printer => ({ currentTarget: { dataset: { printer } } });
  page.setData({ studioTheme: { printer: peach } });
  page.machineError(failed(peach));
  assert.equal(page.data.failedPrinter, peach);
  page.setData({ studioTheme: { printer: sky } });
  page.machineError(failed(peach));
  assert.notEqual(page.data.failedPrinter, sky);
  page.machineLoaded(failed(sky));
  assert.equal(page._machineReady, true);
});

test("选择六寸时按真实规格预排正放或旋转照片，切换不会请求保存", async () => {
  for (const [width, height, count, rotated] of [[295, 413, 10, false], [413, 579, 4, true], [100, 100, 24, false]]) {
    const env = exportPage(width, height);
    await env.page._previewReady;
    env.page.selectAction(layout);
    assert.equal(env.page.data.action, "layout");
    assert.equal(env.page.data.layoutSlots.length, count);
    assert.equal(env.page.data.layoutSlots.every((cell) => cell.includes("rotate(-90deg)") === rotated), true);
    assert.equal(env.page.data.previewPath, "display-portrait");
    assert.equal(env.requests(), 0);
  }
  const large = exportPage(3000, 3000);
  await large.page._previewReady;
  large.page.selectAction(layout);
  await large.page.savePrintLayout();
  assert.equal(large.page.data.action, "single");
  assert.equal(large.requests(), 0);
});

test("成品出纸由相册写入和当次显示缩图加载触发，迟到的载入事件不能改变当前预览", async () => {
  const { page } = exportPage();
  await page._previewReady;
  page.selectAction(layout);
  let releaseAlbum;
  let reached;
  const writing = new Promise((resolve) => { reached = resolve; });
  page.saveToAlbum = () => { reached(); return new Promise((resolve) => { releaseAlbum = resolve; }); };
  const pending = page.saveCurrent();
  await writing;
  assert.equal(page.data.printPhase, "album");
  assert.equal(page.data.saved, false);
  page.printLoaded(imageEvent("display-portrait"));
  assert.equal(page.data.printReady, false);
  releaseAlbum();
  await pending;
  assert.equal(page.data.saved, true);
  assert.equal(page.data.printPhase, "");
  page.printLoaded(imageEvent("display-portrait"));
  assert.equal(page.data.printReady, false);
  page.machineLoaded();
  page.printLoaded(imageEvent("display-layout"));
  assert.equal(page.data.printReady, true);
  page.selectAction({ currentTarget: { dataset: { action: "single" } } });
  page.previewError(imageEvent("display-layout"));
  assert.equal(page.data.printReady, false);
  assert.equal(page.data.previewFailed, false);
  assert.equal(page.data.previewPath, "display-portrait");
});

test("六寸成品落盘失败后沿用已获额度的图像，相册成功后再次保存重新申请", async () => {
  const { page, files, requests } = exportPage();
  await page._previewReady;
  page.selectAction(layout);
  files.writeBase64 = async () => { throw Error("空间不足"); };
  await page.saveCurrent();
  assert.equal(page.data.saved, false);
  assert.equal(page.data.printPhase, "");
  assert.match(page.data.error, /空间不足/);
  files.writeBase64 = async (bitmap) => { assert.equal(bitmap, "sheet-bytes"); return "layout"; };
  await page.saveCurrent();
  assert.equal(requests(), 1);
  assert.equal(page.data.saved, true);
  await page.saveCurrent();
  assert.equal(requests(), 2);
});

test("退出时尚在写入的临时排版图完成后也会清理", async () => {
  const { page, files, removed } = exportPage();
  await page._previewReady;
  let releaseWrite, started;
  const writing = new Promise((resolve) => { started = resolve; });
  files.writeBase64 = () => { started(); return new Promise((resolve) => { releaseWrite = resolve; }); };
  const pending = page.savePrintLayout();
  await writing;
  page.onUnload();
  releaseWrite("late-layout");
  await pending;
  assert.deepEqual(removed, ["display-portrait", "late-layout"]);
  assert.equal(Object.keys(page._cloudResults).length, 0);
});

test("出纸按实际用时推进、短暂停顿，离开或切换后迟到帧不再改变当前照片", async () => {
  let now = 0, frame, armed = false;
  const { page } = exportPage(295, 413, {
    Date: { now: () => now },
    setTimeout(callback, delay) { assert.equal(delay, 34); frame = callback; armed = true; return 1; },
    clearTimeout() { armed = false; },
  });
  await page._previewReady;
  await page.savePrintLayout();
  page.machineLoaded();
  page.printLoaded(imageEvent("display-layout"));
  assert.equal(page.data.paperReveal, 0);
  now = 1580; frame();
  assert.equal(page.data.paperReveal, 62);
  now = 1690; frame();
  assert.equal(page.data.paperReveal, 62);
  now = 1970; frame();
  assert.ok(page.data.paperReveal > 62 && page.data.paperReveal < 100);
  const late = frame;
  page.onHide();
  assert.equal(page.data.paperReveal, 100);
  assert.equal(armed, false);
  late();
  assert.equal(page.data.paperReveal, 100);
  page.onShow();
  await page.saveCurrent();
  page.machineLoaded();
  page.printLoaded(imageEvent("display-layout"));
  const stale = frame;
  page.selectAction({ currentTarget: { dataset: { action: "single" } } });
  assert.equal(armed, false);
  stale();
  assert.equal(armed, false);
  await page.savePrintLayout();
  page.machineLoaded();
  page.printLoaded(imageEvent("display-layout"));
  now += 2800; armed = false; frame();
  assert.equal(page.data.paperReveal, 100);
  assert.equal(armed, false);
  page.onUnload();
});

function loadTiles(page, count = page.data.layoutSlots.length, version = page.data.proofVersion) {
  for (let index = 0; index < count; index++)
    page.proofLoaded({ currentTarget: { dataset: { path: page.data.previewPath, version, index } } });
}

test("正常六寸入口等机身和全部显示缩图就位才送纸，免费重播和切换都不会写相册", async () => {
  let now = 0, frame;
  const env = exportPage(295, 413, {
    Date: { now: () => now },
    setTimeout(callback) { frame = callback; return 1; }, clearTimeout() {},
  }, {}, { exportAction: "layout" });
  await env.page._previewReady;
  const page = env.page;
  let albums = 0;
  page.saveToAlbum = async () => { albums++; };
  assert.equal(page.data.action, "layout");
  assert.equal(page.data.paperReveal, 0);
  loadTiles(page, 10, page.data.proofVersion - 1);
  assert.equal(page._loadedCells.size, 0);
  loadTiles(page, 9);
  assert.equal(page.data.printReady, false);
  loadTiles(page);
  assert.equal(page.data.paperMoving, false);
  page.machineLoaded();
  assert.equal(page.data.paperMoving, true);
  now = 600; frame();
  assert.ok(page.data.paperReveal > 0 && page.data.paperReveal < 46);
  now = 2800; frame();
  assert.equal(page.data.paperReveal, 100);
  assert.equal(page.data.paperMoving, false);
  page.replayPaper();
  assert.equal(page.data.paperReveal, 0);
  assert.equal(page.data.paperMoving, true);
  page.selectAction({ currentTarget: { dataset: { action: "single" } } });
  frame();
  assert.equal(page.data.printReady, false);
  page.selectAction(layout);
  loadTiles(page);
  page.machineLoaded();
  assert.equal(page.data.paperMoving, true);
  page.onHide();
  assert.equal(env.requests(), 0);
  assert.equal(albums, 0);
});

test("首页打样独立于用户会话和权限，取消选图可留在样片重试，确认后进入六寸编辑", async () => {
  const env = exportPage(295, 413, {}, { demo: "print" });
  const { page } = env;
  const existingSession = env.app.globalData.exportSession;
  assert.equal(page._session, undefined);
  assert.equal(page._videoPlayer, undefined);
  assert.equal(page.data.demo, true);
  assert.equal(page.data.action, "layout");
  assert.match(page.data.previewPath, /^\/assets\/images\/sample-/);
  assert.equal(page.data.layoutSlots.length, 10);
  let membership = 0, usage = 0, albums = 0;
  page.refreshMembership = () => { membership++; };
  page.fetchUsage = () => { usage++; };
  page.saveToAlbum = () => { albums++; };
  page.onShow();
  await page.saveCurrent();
  loadTiles(page);
  page.machineLoaded();
  assert.equal(page.data.paperMoving, true);
  page.onHide();
  page.onShow();
  page.replayPaper();
  page.onHide();
  assert.equal(page.data.saved, false);
  assert.deepEqual([membership, usage, albums, env.requests()], [0, 0, 0, 0]);
  env.files.call = async () => { throw { errMsg: "chooseMedia:fail cancel" }; };
  await page.primaryAction();
  assert.equal(page.data.choosing, false);
  assert.equal(page.data.error, "");
  const calls = [];
  env.files.call = async (method, options) => {
    calls.push([method, options]);
    return { tempFiles: [{ tempFilePath: "wxfile://tmp/a & b.jpg" }] };
  };
  await page.primaryAction();
  assert.deepEqual(calls.map(([method]) => method), ["chooseMedia", "navigateTo"]);
  assert.match(calls[1][1].url, /src=wxfile%3A%2F%2Ftmp%2Fa%20%26%20b.jpg&width=295&height=413&name=.+&tool=idphoto&exportAction=layout$/);
  assert.equal(env.app.globalData.exportSession, existingSession);
  page.onUnload();
});

test("旧版额度响应保留本账号的已确认会员状态，切换账号后显示为未知", async () => {
  const { page, app, dependencies, fetchUsage } = exportPage();
  await page._previewReady;
  dependencies.api.request = async () => ({ saveCount: 1, adViewCount: 0 });
  dependencies.membership.refresh = async () => ({ available: true, isLifetimeMember: true });
  await page.refreshMembership();
  await fetchUsage();
  assert.equal(page.data.memberKnown, true);
  assert.equal(page.data.isLifetimeMember, true);
  assert.equal(page.data.unlimited, true);
  app.globalData.openid = "another-owner";
  await fetchUsage();
  assert.equal(page.data.memberKnown, false);
  assert.equal(page.data.isLifetimeMember, false);
  assert.equal(page.data.unlimited, false);
  assert.equal(page.data.remaining, 4);
});

test("滚轮声等待原生音频可播，跟随当前出纸进度，静音/隐藏/退出立即停止", async () => {
  let now = 100, ready, frame, played = 0, stops = 0, disposed = 0;
  const seeks = [], storage = {};
  const audio = { onCanplay(fn) { ready = fn; }, onError() {}, play() { played++; },
    seek(v) { seeks.push(v); }, stop() { stops++; }, destroy() { disposed++; } };
  const clock = { Date: { now: () => now }, setTimeout(fn) { frame = fn; return 1; }, clearTimeout() {},
    wx: { createInnerAudioContext: () => audio, getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => { storage[key] = value; } } };
  const { page } = exportPage(295,413,clock,{demo:"print"});
  page.onShow();
  loadTiles(page); page.machineLoaded();
  assert.equal(played,0);
  now += 200; ready();
  assert.equal(played,1); assert.equal(seeks[0],0.2); assert.equal(audio.obeyMuteSwitch,true);
  page.togglePrintSound(); assert.equal(stops,1); assert.equal(storage["studio-print-sound"],false);
  now += 160; page.togglePrintSound(); assert.equal(played,2); assert.equal(seeks[1],0.36);
  page.onHide(); assert.equal(stops,2); ready(); assert.equal(played,2);
  page.onShow(); page.replayPaper(); assert.equal(seeks.at(-1),0);
  now+=2800; frame(); assert.equal(stops,2); // Allow the recording to release naturally.
  page.togglePrintSound();
  const next = exportPage(295,413,clock,{demo:"print"}).page;
  assert.equal(next.data.printSound,false);
  next.onUnload(); page.onUnload(); assert.equal(disposed,1);
});

test("保存后的额度优先于迟到的进入页面查询", async () => {
  const { page, dependencies, fetchUsage } = exportPage();
  await page._previewReady;
  const replies = [];
  dependencies.api.request = () => new Promise(resolve => replies.push(resolve));
  const entering = fetchUsage();
  const afterSave = fetchUsage();
  replies[1]({ saveCount: 2, adViewCount: 0 });
  await afterSave;
  replies[0]({ saveCount: 1, adViewCount: 0 });
  await entering;
  assert.equal(page.data.remaining, 3);
});

test("保存接口已确认额度耗尽时，旧查询不能让可用次数恢复", async () => {
  const { page, dependencies, fetchUsage } = exportPage();
  await page._previewReady;
  let reply;
  dependencies.api.request = () => new Promise(resolve => { reply = resolve; });
  const entering = fetchUsage();
  page.requestSave = async () => ({ code: 4031 });
  page.watchAdForSave = async () => false;
  await page.saveCurrent();
  reply({ saveCount: 4, adViewCount: 0 });
  await entering;
  assert.equal(page.data.quotaKnown, true);
  assert.equal(page.data.remaining, 0);
});

test("打印声音解码失败后重播会重新载入，旧音轨回调不影响当前播放", () => {
  const tracks = [];
  const wx = { createInnerAudioContext() {
    const track = { plays: 0, destroyed: false, seek() {}, stop() {}, play() { this.plays++; },
      onCanplay(fn) { this.ready = fn; }, onError(fn) { this.fail = fn; },
      destroy() { this.destroyed = true; } };
    tracks.push(track);
    return track;
  } };
  let now = 100, frame;
  const { page } = exportPage(295, 413, { wx, Date: { now: () => now },
    setTimeout(fn) { frame = fn; return 1; }, clearTimeout() {} }, { demo: "print" });
  page.onShow();
  loadTiles(page);
  page.machineLoaded();
  tracks[0].fail();
  now += 2800;
  frame();
  page.replayPaper();
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].destroyed, true);
  tracks[0].ready();
  assert.equal(tracks[1].plays, 0);
  tracks[1].ready();
  assert.equal(tracks[1].plays, 1);
  page.onUnload();
});

test("样片和自己的排版点开均为带水印的整张相纸，重播与点开不生成云端作品", async () => {
  for (const demo of [true,false]) {
    const opened = [], sheetInputs = [];
    const e = exportPage(295,413,{wx:{previewImage:(o)=>opened.push(o.current)}},
      demo ? {demo:"print"} : {}, {exportAction:"layout"});
    await e.page._previewReady;
    e.dependencies["brand-preview"].createSheetPreview = async (_page,src,cells) => {
      assert.equal(cells.length,10); sheetInputs.push(src); return "burned-sheet.jpg";
    };
    await e.page.previewImage(); await e.page.previewImage();
    assert.deepEqual(opened,["burned-sheet.jpg","burned-sheet.jpg"]);
    assert.deepEqual(sheetInputs,[demo?"/assets/images/sample-female-smile.jpg":"portrait"]);
    assert.equal(e.requests(),0);
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(session = {}) {
  const displays = [], renders = [], previews = [], albums = [], writes = [], requests = [], adRecords = [];
  let definition, failAlbum = false, failPreview = false, limit = false;
  const app = {
    globalData: { openid: "owner", sessionToken: "token-A", exportSession: {
      mode: "idphoto", resultPath: "CLEAN_SINGLE", previewPath: "UNTRUSTED_IMPORTED_PREVIEW",
      width: 295, height: 413, ...session,
    } },
    ensureLogin: async () => true,
    getRewardedVideoAdUnitId: async () => "adunit-test123",
  };
  const dependencies = {
    membership: { refresh: async () => ({ isLifetimeMember: false }), canShowAds: () => true },
    api: {
      request: async (route) => { adRecords.push(route); return { code: 200 }; },
      unwrap: (value) => { if (value.code !== 200) throw Error("保存次数不足"); return value.data; },
    },
    "rewarded-video": { createRewardedVideoPlayer: () => ({ dispose() {} }) },
    "brand-preview": { displayPreview: async (_page, source) => {
      displays.push(source);
      if (failPreview) throw Error("缩图失败");
      return `SMALL_${displays.length}.jpg`;
    }, create: async (_page, source) => {
      renders.push(source);
      if (failPreview) throw Error("水印生成失败");
      return `WATERMARK_${renders.length}.jpg`;
    } },
    files: {
      call: async (_method, options) => options.src === "CLEAN_LAYOUT"
        ? { width: 1800, height: 1200 } : { width: 295, height: 413 },
      readBase64: async () => "PHOTO_BASE64",
      writeBase64: async () => "CLEAN_LAYOUT",
      removeTemp() {},
    },
  };
  const filename = path.resolve(__dirname, "../mini-program/pages/export/export.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: { previewImage: (value) => previews.push(value) },
    require: (name) => dependencies[name.split("/").pop()],
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values) { writes.push(structuredClone(values)); Object.assign(this.data, values); },
  };
  page.fetchUsage = async () => {};
  page.requestSave = async (action) => {
    requests.push(action);
    return limit ? { code: 4031 } : { code: 200, data: { image_base64: "LAYOUT_BASE64" } };
  };
  page.watchAdForSave = async () => false;
  page.saveToAlbum = async (file) => {
    albums.push(file);
    if (failAlbum) throw Error("相册权限未授权");
  };
  page.onLoad();
  return {
    page, app, renders, displays, previews, albums, writes, requests, dependencies, adRecords,
    watchAd: definition.watchAdForSave.bind(page),
    albumFails: (value) => { failAlbum = value; },
    previewFails: (value) => { failPreview = value; },
    exhausted: () => { limit = true; },
  };
}

function assertProtectedData(env) {
  const serialized = JSON.stringify(env.writes);
  assert.doesNotMatch(serialized, /CLEAN_SINGLE|CLEAN_LAYOUT|UNTRUSTED_IMPORTED_PREVIEW/);
  assert.equal(Object.hasOwn(env.page.data, "savedPath"), false);
  for (const preview of env.previews) {
    assert.match(preview.current, /^WATERMARK_\d+\.jpg$/);
    assert.equal(preview.urls[0], preview.current);
  }
}

for (const session of [{ mode: "idphoto" }, { mode: "exam" }, { mode: "other", requiresQuota: true }]) {
  test(`${session.mode} 页内仅展示新生成的小图，点开大图才烧录水印，保存使用清晰原件`, async () => {
    const env = fixture(session);
    await env.page.previewImage();
    assert.equal(env.previews.length, 0);
    await env.page._previewReady;
    assert.deepEqual(env.displays, ["CLEAN_SINGLE"]);
    assert.deepEqual(env.renders, []);
    assert.equal(env.page.data.previewPath, "SMALL_1.jpg");
    await env.page.previewImage();
    await env.page.saveCurrent();
    await env.page.previewImage();
    assert.equal(env.page._savedPath, "CLEAN_SINGLE");
    assert.deepEqual(env.albums, ["CLEAN_SINGLE"]);
    assert.deepEqual(env.renders, ["CLEAN_SINGLE"]);
    assertProtectedData(env);
  });
}

test("已保存相纸缩图或大图失败时可独立重试，禁止退回无水印成品", async () => {
  const env = fixture();
  await env.page._previewReady;
  await env.page.savePrintLayout();
  assert.deepEqual(env.displays, ["CLEAN_SINGLE", "CLEAN_LAYOUT"]);
  env.previewFails(true);
  await env.page.previewImage();
  assert.equal(env.previews.length, 0);
  assert.equal(env.page.data.previewPath, "SMALL_2.jpg");
  assert.match(env.page.data.zoomError,/大图/);
  env.page.previewError();
  await env.page.primaryAction();
  assert.equal(env.page.data.previewFailed, true);
  assert.equal(env.page.data.previewPath, "");
  env.previewFails(false);
  await env.page.primaryAction();
  await env.page.previewImage();
  assert.equal(env.page.data.previewFailed, false);
  assert.deepEqual(env.renders, ["CLEAN_LAYOUT","CLEAN_LAYOUT"]);
  assertProtectedData(env);
});

for (const action of ["single", "layout"]) {
  test(`${action} 相册失败只重试原次授权，成功后每次新保存重新经过额度校验`, async () => {
    const env = fixture();
    await env.page._previewReady;
    env.albumFails(true);
    await env.page.saveImage(action);
    assert.equal(env.requests.length, 1);
    env.albumFails(false);
    await env.page.saveImage(action);
    assert.equal(env.page.data.saved, true);
    assert.equal(env.requests.length, 1);
    assert.equal(Object.keys(env.page._cloudResults).length, 0);
    await env.page.saveImage(action);
    assert.equal(env.requests.length, 2);
    assert.equal(env.albums.length, 3);
    env.exhausted();
    await env.page.saveImage(action);
    assert.equal(env.requests.length, 3);
    assert.equal(env.albums.length, 3);
    assertProtectedData(env);
  });
}

test("本地压缩与裁剪在页内展示缩图，点开大图带水印，免费保存自己的清晰原件", async () => {
  for (const mode of ["compress", "crop"]) {
    const env = fixture({ mode, previewPath: "" });
    await env.page._previewReady;
    await env.page.saveCurrent();
    await env.page.saveCurrent();
    await env.page.previewImage();
    assert.equal(env.renders.length, 1);
    assert.equal(env.requests.length, 0);
    assert.deepEqual(env.albums, ["CLEAN_SINGLE", "CLEAN_SINGLE"]);
    assert.equal(env.previews[0].current, "WATERMARK_1.jpg");
  }
});

test("导出模板所有照片与缩略图只绑定受保护的预览数据，不绑定逻辑保存路径", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../mini-program/pages/export/export.wxml"), "utf8");
  assert.doesNotMatch(template, /savedPath|resultPath|_savedPath|show-menu-by-longpress="{{true}}"/);
  assert.deepEqual([...template.matchAll(/src="([^"]+)"/g)].map((match) => match[1]), [
    "{{studioTheme.printer || '/assets/printers/sky-matte.png'}}", "{{previewPath}}", "{{previewPath}}", "{{previewPath}}",
  ]);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

for (const changed of ["openid", "sessionToken"]) {
  for (const stage of ["read", "save-request", "ad", "retry-request", "layout-write"]) {
    test(`${changed} 在 ${stage} 期间变化后，导出停止且不写入相册或缓存旧结果`, async () => {
      const env = fixture();
      await env.page._previewReady;
      const pending = deferred();
      let started;
      const reached = new Promise((resolve) => { started = resolve; });
      const pause = () => { started(); return pending.promise; };
      let result;
      if (stage === "read") {
        env.dependencies.files.readBase64 = pause;
        result = "PHOTO_BASE64";
      } else if (stage === "layout-write") {
        env.dependencies.files.writeBase64 = pause;
        result = "CLEAN_LAYOUT";
      } else if (stage === "ad") {
        env.page.requestSave = async () => ({ code: 4031 });
        env.page.watchAdForSave = pause;
        result = true;
      } else {
        let calls = 0;
        env.page.requestSave = () => {
          if (stage === "retry-request" && ++calls === 1) return Promise.resolve({ code: 4031 });
          return pause();
        };
        env.page.watchAdForSave = async () => true;
        result = { code: 200, data: { image_base64: "LAYOUT_BASE64" } };
      }
      const saving = env.page.saveImage(stage === "layout-write" ? "layout" : "single");
      await reached;
      env.app.globalData[changed] = "changed";
      pending.resolve(result);
      await saving;
      assert.deepEqual(env.albums, []);
      assert.equal(env.page.data.saved, false);
      assert.equal(Object.keys(env.page._cloudResults).length, 0);
      assert.match(env.page.data.error, /登录状态已变化/);
      assertProtectedData(env);
    });
  }
}

for (const stage of ["membership", "ad-id", "dialog", "latest-membership", "video", "record"]) {
  test(`广告保存链路在 ${stage} 等待期间更换会话，迟到响应不能继续发奖或保存`, async () => {
    const env = fixture();
    await env.page._previewReady;
    const pending = deferred();
    let started;
    const reached = new Promise((resolve) => { started = resolve; });
    const pause = () => { started(); return pending.promise; };
    let memberships = 0;
    env.dependencies.membership.refresh = async () => {
      memberships++;
      if (stage === "membership" || (stage === "latest-membership" && memberships === 2)) return pause();
      return { isLifetimeMember: false };
    };
    env.app.getRewardedVideoAdUnitId = stage === "ad-id" ? pause : async () => "adunit-test123";
    env.page.showAdDialog = stage === "dialog" ? pause : async () => true;
    env.page._videoPlayer = { play: stage === "video" ? pause : async () => true };
    if (stage === "record") env.dependencies.api.request = pause;
    const reward = env.watchAd("owner", "token-A");
    await reached;
    env.app.globalData.sessionToken = "token-B";
    pending.resolve(stage.includes("membership") ? { isLifetimeMember: false }
      : stage === "ad-id" ? "adunit-test123" : stage === "record" ? { code: 200 } : true);
    await assert.rejects(reward, /登录状态已变化/);
    assert.deepEqual(env.adRecords, []);
    assert.deepEqual(env.albums, []);
  });
}

test("同账号新登录会话不能复用相册失败前的旧额度授权", async () => {
  const env = fixture();
  await env.page._previewReady;
  env.albumFails(true);
  await env.page.saveCurrent();
  assert.equal(env.requests.length, 1);
  env.app.globalData.sessionToken = "token-B";
  env.albumFails(false);
  await env.page.saveCurrent();
  assert.equal(env.requests.length, 2);
  assert.equal(env.page.data.saved, true);
});

test("无水印展示图总是独立降采样，大图保留文字水印，半成品生成失败即清理", async () => {
  const sourceRect = { width: 144, height: 192 };
  const renders = [], removed = [];
  let marks = 0, failed = false;
  const ctx = {
    fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {},
    fillText() { marks++; if (failed) throw Error("水印绘制失败"); },
  };
  const canvas = {
    width: 0, height: 0,
    createImage() { return { set src(_s) { queueMicrotask(() => this.onload()); } }; },
    getContext() { marks=0; return ctx; },
    toDataURL() {
      renders.push({ width:this.width, height:this.height, marks });
      return "data:image/jpeg;base64,eA==";
    },
  };
  const module = { exports: {} };
  const filename=path.resolve(__dirname,"../mini-program/utils/brand-preview.js");
  vm.runInNewContext(fs.readFileSync(filename,"utf8"), {
    module, setTimeout, clearTimeout,
    require(name) {
      if (name === "./image-transform") return {
        getCanvas: async () => canvas,
        cropRect: require("../mini-program/utils/image-transform").cropRect,
      };
      return { call: async () => sourceRect, writeBase64: async () => "preview-"+renders.length,
        removeTemp: (p) => removed.push(p) };
    },
  });
  const page = {}, utils = module.exports;
  const pair=await utils.createPair(page,"source");
  assert.notEqual(pair.displayPath,pair.previewPath);
  assert.deepEqual(renders[0],{width:93,height:124,marks:0});
  assert.deepEqual([renders[1].width,renders[1].height],[144,192]);
  assert.ok(renders[1].marks>0);
  sourceRect.width=1795; sourceRect.height=1205;
  await utils.displayPreview(page,"sheet");
  assert.equal(renders[2].width,384);
  assert.equal(renders[2].marks,0);
  failed=true;
  await assert.rejects(utils.createPair(page,"source"),/水印/);
  assert.deepEqual(removed,["preview-4"]);
});

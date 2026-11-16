const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(session = {}) {
  const renders = [], previews = [], albums = [], writes = [], requests = [], adRecords = [];
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
    "brand-preview": { create: async (_page, source) => {
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
    page, app, renders, previews, albums, writes, requests, dependencies, adRecords,
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
  test(`${session.mode} 导出入口不信任旧预览，成功保存与大图始终只显示烧录水印`, async () => {
    const env = fixture(session);
    env.page.previewImage();
    assert.equal(env.previews.length, 0);
    await env.page._previewReady;
    assert.deepEqual(env.renders, ["CLEAN_SINGLE"]);
    env.page.previewImage();
    await env.page.saveCurrent();
    env.page.previewImage();
    assert.equal(env.page._savedPath, "CLEAN_SINGLE");
    assert.deepEqual(env.albums, ["CLEAN_SINGLE"]);
    assertProtectedData(env);
  });
}

test("排版成功与预览重试都重新烧录水印，水印生成失败时不会退回干净图", async () => {
  const env = fixture();
  await env.page._previewReady;
  await env.page.savePrintLayout();
  env.page.previewImage();
  assert.deepEqual(env.renders, ["CLEAN_SINGLE", "CLEAN_LAYOUT"]);
  assert.equal(env.page.data.saved, true);
  assert.equal(env.page.data.actualWidth, 1800);
  env.page.previewError();
  env.previewFails(true);
  await env.page.primaryAction();
  env.page.previewImage();
  assert.equal(env.page.data.previewPath, "");
  assert.equal(env.page.data.previewFailed, true);
  assert.equal(env.previews.length, 1);
  env.previewFails(false);
  await env.page.primaryAction();
  env.page.previewImage();
  assert.equal(env.page.data.previewFailed, false);
  assert.deepEqual(env.renders, ["CLEAN_SINGLE", "CLEAN_LAYOUT", "CLEAN_LAYOUT", "CLEAN_LAYOUT"]);
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

test("本地压缩与裁剪仍可直接查看和重复保存，不进入额度或品牌水印流程", async () => {
  for (const mode of ["compress", "crop"]) {
    const env = fixture({ mode, previewPath: "" });
    await env.page.saveCurrent();
    await env.page.saveCurrent();
    env.page.previewImage();
    assert.equal(env.renders.length, 0);
    assert.equal(env.requests.length, 0);
    assert.deepEqual(env.albums, ["CLEAN_SINGLE", "CLEAN_SINGLE"]);
    assert.equal(env.previews[0].current, "CLEAN_SINGLE");
  }
});

test("导出模板所有照片与缩略图只绑定受保护的预览数据，不绑定逻辑保存路径", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../mini-program/pages/export/export.wxml"), "utf8");
  assert.doesNotMatch(template, /savedPath|resultPath|_savedPath/);
  assert.deepEqual([...template.matchAll(/src="([^"]+)"/g)].map((match) => match[1]), [
    "../../templates/campus.wxml", "{{previewPath}}", "{{previewPath}}", "{{previewPath}}",
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

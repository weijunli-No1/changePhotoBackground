const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../mini-program");
function load(file, globals = {}) {
  let definition;
  const filename = path.join(root, file),
    module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      require: createRequire(filename),
      Page: (v) => (definition = v),
      Component: (v) => (definition = v),
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename },
  );
  if (!definition) return module.exports;
  const p = {
    ...definition,
    ...definition.methods,
    data: structuredClone(definition.data),
  };
  p.setData = (v) => Object.assign(p.data, v);
  return p;
}
function editor(api, files = {}) {
  return load("pages/edit/edit.js", {
    require: (name) => {
      if (name.endsWith("/api")) return api;
      if (name.endsWith("/files")) return files;
      if (name.endsWith("/drafts"))
        return {
          get: () => null,
          createId: () => "test",
          save: async (s) => s,
        };
      if (name.endsWith("/photo-specs"))
        return require("../mini-program/utils/photo-specs");
      throw Error(name);
    },
  });
}
test("制作可以取消，终止上传且丢弃迟到结果，原图仍可重试", async () => {
  let resolve,
    aborts = 0;
  const p = editor({
    upload: (_src, _size, onTask) => {
      onTask({
        abort() {
          aborts++;
        },
      });
      return new Promise((r) => (resolve = r));
    },
  });
  p._seq = 0;
  p._colorSeq = 0;
  p.data.sourcePath = "source";
  const pending = p.processTransparentImage();
  assert.equal(p.data.processing, true);
  p.cancelProcessing();
  assert.equal(aborts, 1);
  assert.equal(p.data.processing, false);
  resolve({ image_base64_hd: "late" });
  await pending;
  assert.equal(p.data.sourcePath, "source");
  assert.equal(p.data.resultPath, "");
  assert.match(p.data.error, /已取消/);
});
test("取消发生在图片写入期间时，迟到文件被清理且不覆盖新状态", async () => {
  let write,
    removed = [];
  const p = editor(
    { upload: async () => ({ image_base64_hd: "alpha" }) },
    {
      cleanBase64: (v) => v,
      writeBase64: () => new Promise((r) => (write = r)),
      removeTemp: (p) => removed.push(p),
    },
  );
  p._seq = 0;
  p._colorSeq = 0;
  p.data.sourcePath = "source";
  const pending = p.processTransparentImage();
  await new Promise((r) => setImmediate(r));
  p.cancelProcessing();
  write("late-file");
  await pending;
  assert.deepEqual(removed, ["late-file"]);
  assert.equal(p._transparentPath, "");
  assert.equal(p.data.processing, false);
});
test("换底色失败重试只调用换色接口，保留原成功照片直到重试完成", async () => {
  const colors = [];
  let succeed = false;
  const p = editor(
    {
      upload: () => {
        throw Error("should not repeat matting");
      },
      unwrap: (v) => v,
      request: async (_path, opt) => {
        colors.push(opt.data.color);
        if (!succeed) throw Error("offline");
        return { image_base64: "red" };
      },
    },
    { writeBase64: async () => "red-result" },
  );
  p.persistDraft = () => {};
  p._seq = 1;
  p._colorSeq = 0;
  p._transparent = "alpha";
  p._appliedColor = "#638cce";
  p.setData({
    sourcePath: "source",
    resultPath: "blue-result",
    currentBgColor: "#638cce",
  });
  await p.changeBackgroundColor("#FF0000");
  assert.equal(p.data.resultPath, "blue-result");
  assert.equal(p.data.currentBgColor, "#638cce");
  succeed = true;
  await p.retry();
  assert.deepEqual(colors, ["#FF0000", "#FF0000"]);
  assert.equal(p.data.resultPath, "red-result");
  assert.equal(p.data.currentBgColor, "#FF0000");
});
test("失效草稿的恢复操作是重新选图，而不是对不存在的原图空重试", async () => {
  const p = editor({
    upload: () => {
      throw Error("invalid source uploaded");
    },
  });
  await p.onLoad({ draft: "missing" });
  let chosen = 0;
  p.reselect = () => chosen++;
  await p.retry();
  assert.equal(chosen, 1);
  assert.equal(p.data.errorRecovery, "reselect");
});
test("新照片读取失败后无法导出旧结果，读取期间不能再改参数", async () => {
  let fail,
    transformCalls = 0;
  const p = load("pages/tools/tools.js", {
    require: (name) => {
      if (name.endsWith("/files"))
        return { call: () => new Promise((_, r) => (fail = r)) };
      if (name.endsWith("/drafts")) return {};
      if (name.endsWith("/image-transform"))
        return { transform: () => transformCalls++ };
      throw Error(name);
    },
  });
  p.setData({ sourcePath: "old-source", resultPath: "old-result" });
  const loading = p.loadSource("new-source");
  p.setQuality({ currentTarget: { dataset: { quality: 40 } } });
  assert.equal(p.data.quality, 85);
  assert.equal(p.data.resultPath, "");
  assert.equal(transformCalls, 0);
  fail(Error("missing"));
  await loading;
  assert.equal(p.data.processing, false);
  assert.equal(p.data.sourcePath, "");
  assert.equal(p.data.errorRecovery, "reselect");
  let chosen = 0;
  p.choosePhoto = () => chosen++;
  await p.retry();
  assert.equal(chosen, 1);
});
test("尺寸错误常驻并标记错误字段，改正后使用正确数值继续", () => {
  const events = [];
  const p = load("components/spec-picker/index.js", {
    wx: { hideKeyboard() {} },
  });
  p.triggerEvent = (name, value) => events.push({ name, value });
  p.setData({ width: "50", height: "413" });
  p.custom();
  assert.ok(p.data.error);
  assert.equal(p.data.invalidWidth, true);
  assert.equal(p.data.invalidHeight, false);
  assert.equal(events.length, 0);
  p.inputWidth({ detail: { value: "295" } });
  assert.equal(p.data.error, "");
  p.custom();
  assert.equal(events[0].value.width, 295);
  assert.equal(events[0].value.height, 413);
});
test("请求适配器暴露原生取消任务，保持原 HTTP 参数和路径", async () => {
  const calls = [],
    task = { abort() {} };
  const api = load("utils/api.js", {
    getApp: () => ({ globalData: { baseUrl: "https://example.test" } }),
    wx: {
      request: (o) => {
        calls.push(o);
        o.success({ statusCode: 200, data: { code: 200, data: {} } });
        return task;
      },
      uploadFile: (o) => {
        calls.push(o);
        o.success({
          statusCode: 200,
          data: JSON.stringify({ code: 200, data: { image_base64_hd: "abc" } }),
        });
        return task;
      },
    },
  });
  let forwarded;
  await api.upload(
    "source",
    { width: 295, height: 413 },
    (v) => (forwarded = v),
  );
  assert.equal(forwarded, task);
  assert.equal(calls[0].name, "file");
  assert.equal(calls[0].formData.width, 295);
  await api.request(
    "/api/photo/add-background",
    { method: "POST", data: { color: "#FFFFFF" } },
    (v) => (forwarded = v),
  );
  assert.equal(forwarded, task);
  assert.equal(calls[1].url, "https://example.test/api/photo/add-background");
});
test("云端列表登录有等待反馈且防止重复确认，取消后恢复可用", async () => {
  let resolve,
    calls = 0;
  const app = {
    globalData: { openid: "" },
    ensureLogin: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
  };
  const p = load("pages/history/history.js", {
    getApp: () => app,
    require: () => ({}),
  });
  const pending = p.login();
  assert.equal(p.data.loggingIn, true);
  await p.login();
  assert.equal(calls, 1);
  resolve(false);
  await pending;
  assert.equal(p.data.loggingIn, false);
  assert.equal(p.data.error, "");
});

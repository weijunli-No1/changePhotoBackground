const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
function page(file, globals = {}) {
  let definition;
  const filename = path.resolve(__dirname, "../mini-program", file);
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      Page: (v) => (definition = v),
      Component: (v) => (definition = v),
      require: createRequire(filename),
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename },
  );
  const instance = {
    ...definition,
    ...definition.methods,
    data: structuredClone(definition.data),
  };
  instance.setData = (data) => Object.assign(instance.data, data);
  return instance;
}
test("小屏规格输入为键盘留出空间，切换宽高不反复展开，收起后恢复可用高度", async () => {
  let hidden = 0,
    closed = 0;
  const p = page("components/spec-picker/index.js", {
    wx: {
      getWindowInfo: () => ({
        windowWidth: 320,
        windowHeight: 568,
        statusBarHeight: 20,
      }),
      hideKeyboard: () => hidden++,
    },
  });
  p.triggerEvent = (event) => {
    if (event === "close") closed++;
  };
  p.lifetimes.attached.call(p);
  p.openSheet();
  const normal = p.data.availableHeight;
  p.focusCustom({ detail: { height: 250 } });
  assert.equal(p.data.keyboardHeight, 250);
  assert.equal(p.data.selectedIndex, -1);
  assert.ok(p.data.availableHeight + 250 <= 568 - 20 - 48);
  p.inputBlur();
  assert.equal(p.data.keyboardHeight, 250);
  p.keyboardChange({ detail: { height: 0 } });
  assert.equal(p.data.availableHeight, normal);
  p.close();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(p.data.keyboardHeight, 0);
  assert.equal(p.data.rendered, false);
  assert.equal(hidden, 1);
  assert.equal(closed, 1);
});
test("恢复蓝底草稿后换色失败，显示照片与保存底色保持一致", async () => {
  const draft = {
    id: "blue",
    sourcePath: "SOURCE",
    resultPath: "BLUE",
    transparentPath: "ALPHA",
    width: 295,
    height: 413,
    bgColor: "#638cce",
  };
  const p = page("pages/edit/edit.js", {
    require: (name) => {
      if (name.endsWith("/files"))
        return { call: async () => ({}), readBase64: async () => "ALPHA" };
      if (name.endsWith("/drafts")) return { get: () => draft };
      if (name.endsWith("/api"))
        return {
          request: async () => {
            throw Error("网络中断");
          },
        };
      if (name.endsWith("/photo-specs"))
        return require("../mini-program/utils/photo-specs");
      throw Error(name);
    },
  });
  await p.onLoad({ draft: "blue" });
  await p.changeBackgroundColor("#FF0000");
  assert.equal(p.data.resultPath, "BLUE");
  assert.equal(p.data.currentBgColor, "#638cce");
  assert.equal(p.snapshot().bgColor, "#638cce");
});
test("配额查询失败显示可重试状态，重试后展示真实剩余次数", async () => {
  let requests = 0;
  const app = { globalData: { openid: "test" } };
  const p = page("pages/profile/profile.js", {
    getApp: () => app,
    require: (name) => {
      if (name.endsWith("/api"))
        return {
          unwrap: (r) => r,
          request: async () => {
            if (++requests === 1) throw Error("offline");
            return { adViewCount: 0, saveCount: 3 };
          },
        };
      if (name.endsWith("/drafts")) return { list: () => [] };
      if (name.endsWith("/user-profile")) return { get: () => null };
      if (name.endsWith("/files")) return {};
      throw Error(name);
    },
  });
  await p.fetchUsage();
  assert.equal(p.data.usageKnown, false);
  assert.ok(p.data.usageError);
  assert.equal(p.data.usageBusy, false);
  await p.fetchUsage();
  assert.equal(p.data.usageError, "");
  assert.equal(p.data.usageKnown, true);
  assert.equal(p.data.remaining, 2);
});

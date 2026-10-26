const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const motion = require("../mini-program/utils/skyline-motion");
function load(
  file,
  { wx = {}, app = { globalData: {} }, deps = {}, timers } = {},
) {
  const filename = path.resolve(__dirname, "../mini-program", file);
  const realRequire = createRequire(filename);
  deps = { 'brand-preview': { create: async (_page, source) => 'BRANDED:' + source }, ...deps };
  let def;
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      Page: (d) => (def = d),
      Component: (d) => (def = d),
      wx,
      getApp: () => app,
      require: (name) =>
        Object.hasOwn(deps, name.split("/").pop())
          ? deps[name.split("/").pop()]
          : realRequire(name),
      setTimeout: timers
        ? (fn) => {
            timers.push(fn);
            return fn;
          }
        : setTimeout,
      clearTimeout: timers
        ? (fn) => {
            const i = timers.indexOf(fn);
            if (i >= 0) timers.splice(i, 1);
          }
        : clearTimeout,
    },
    { filename },
  );
  const p = { ...def, ...def.methods, data: structuredClone(def.data) };
  p.setData = (v, done) => {
    Object.assign(p.data, v);
    if (done) done();
  };
  return p;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fakeWorklet() {
  return {
    shared: (value) => ({ value }),
    timing: (value) => value,
    Easing: { ease: "ease" },
  };
}
test("同账号返回个人页保留已知次数，刷新失败提示旧值，换账号立即清空并忽略迟到响应", async () => {
  const app = { globalData: { openid: "a" } };
  const pending = [];
  const p = load("pages/profile/profile.js", {
    app,
    deps: {
      api: {
        unwrap: (v) => v,
        request: () =>
          new Promise((resolve, reject) => pending.push({ resolve, reject })),
      },
      drafts: { list: () => [] },
      "user-profile": { get: () => null },
    },
  });
  p.onShow();
  pending.shift().resolve({ saveCount: 2, adViewCount: 0 });
  await tick();
  assert.equal(p.data.remaining, 3);
  p.onShow();
  assert.equal(p.data.usageKnown, true);
  assert.equal(p.data.remaining, 3);
  p.onShow();
  assert.equal(pending.length, 1, "重复onShow复用在途查询");
  pending.shift().reject(Error("offline"));
  await tick();
  assert.equal(p.data.usageKnown, true);
  assert.match(p.data.usageError, /上次/);
  p.onShow();
  const old = pending.shift();
  app.globalData.openid = "b";
  p.onShow();
  assert.equal(p.data.remaining, 0);
  assert.equal(p.data.usageKnown, false);
  old.resolve({ saveCount: 0, adViewCount: 8 });
  await tick();
  assert.equal(p.data.unlimited, false);
  pending.shift().resolve({ saveCount: 4 });
  await tick();
  assert.equal(p.data.remaining, 1);
  app.globalData.openid = "";
  p.onShow();
  assert.equal(p.data.remaining, 0);
  assert.equal(p.data.usageKnown, false);
});
test("换色复用成功同色，连续点选只合成最后一项，旧请求取消且迟到结果不覆盖", async () => {
  const timers = [],
    calls = [],
    removals = [];
  const p = load("pages/edit/edit.js", {
    timers,
    deps: {
      api: {
        unwrap: (v) => v,
        request: (_url, opt, onTask) =>
          new Promise((resolve) => {
            const call = { color: opt.data.color, resolve, aborted: false };
            calls.push(call);
            onTask({
              abort() {
                call.aborted = true;
              },
            });
          }),
      },
      files: {
        writeBase64: async (v) => "file-" + v,
        removeTemp: (v) => removals.push(v),
      },
    },
  });
  p._seq = 1;
  p._colorSeq = 0;
  p._transparent = "alpha";
  p._appliedColor = "#638cce";
  p.persistDraft = async () => null;
  p.setData({
    sourcePath: "src",
    resultPath: "blue",
    currentBgColor: "#638cce",
  });
  p.selectColor({ currentTarget: { dataset: { color: "#638cce" } } });
  assert.equal(calls.length, 0);
  assert.equal(p.data.processing, false);
  p.selectColor({ currentTarget: { dataset: { color: "#FF0000" } } });
  p.selectColor({ currentTarget: { dataset: { color: "#FFFFFF" } } });
  assert.equal(timers.length, 1);
  assert.equal(p.data.currentBgColor, "#FFFFFF");
  assert.equal(p.data.processing, true);
  timers.shift()();
  assert.equal(calls[0].color, "#FFFFFF");
  p.selectColor({ currentTarget: { dataset: { color: "#FF0000" } } });
  assert.equal(calls[0].aborted, true);
  timers.shift()();
  calls[1].resolve({ image_base64: "red" });
  await tick();
  calls[0].resolve({ image_base64: "white" });
  await tick();
  assert.equal(p.data.resultPath, "file-red");
  assert.equal(p.snapshot().bgColor, "#FF0000");
  assert.equal(p.data.processing, false);
  assert.equal(calls.length, 2);
});
test("换色处理中选回已应用底色立即复用，失败颜色仍可重新请求", async () => {
  let reject,
    count = 0,
    aborts = 0;
  const p = load("pages/edit/edit.js", {
    deps: {
      api: {
        request: (_u, _o, onTask) => {
          count++;
          onTask({
            abort() {
              aborts++;
            },
          });
          return new Promise((_, r) => (reject = r));
        },
      },
    },
  });
  p._seq = 1;
  p._colorSeq = 0;
  p._transparent = "alpha";
  p._appliedColor = "#638cce";
  p.setData({ sourcePath: "src", resultPath: "blue" });
  const old = p.changeBackgroundColor("#FF0000");
  await p.changeBackgroundColor("#638cce");
  reject(Error("aborted"));
  await old;
  assert.equal(aborts, 1);
  assert.equal(p.data.resultPath, "blue");
  assert.equal(p.data.error, "");
  const failed = p.changeBackgroundColor("#FF0000");
  reject(Error("offline"));
  await failed;
  const retry = p.retry();
  reject(Error("offline"));
  await retry;
  assert.equal(count, 3);
  assert.equal(p.data.currentBgColor, "#638cce");
});
for (const page of ["edit", "tools"])
  test(`${page}进入保存前立即反馈，等待期间防重与禁止改参，导航失败恢复后可重试`, async () => {
    let finish,
      options,
      draftCalls = 0;
    const p = load(`pages/${page}/${page}.js`, {
      wx: { navigateTo: (o) => (options = o) },
    });
    p.setData({ sourcePath: "src", resultPath: "result" });
    p.persistDraft = () => {
      draftCalls++;
      return new Promise((r) => (finish = r));
    };
    const pending = p.goExport();
    assert.equal(p.data.opening, true);
    await p.goExport();
    assert.equal(draftCalls, 1);
    if (page === "tools") {
      p.setRatio({ currentTarget: { dataset: { index: 1 } } });
      assert.equal(p.data.ratio, 0);
    } else {
      p.selectColor({ currentTarget: { dataset: { color: "#FF0000" } } });
      assert.equal(p.data.currentBgColor, "#FFFFFF");
    }
    finish(null);
    await pending;
    assert.equal(p.data.opening, true);
    options.fail();
    options.complete();
    assert.equal(p.data.opening, false);
    assert.ok(p.data.openingError);
    const retry = p.goExport();
    assert.equal(draftCalls, 2);
    p._unloaded = true;
    finish(null);
    await retry;
    assert.equal(p._opening, false);
  });
test("裁剪拖动只更新原生共享位置，松手一次生成文件，失败时不能导出旧图", async () => {
  let updater,
    reject,
    transforms = 0;
  const p = load("pages/tools/tools.js", {
    wx: { worklet: fakeWorklet() },
    deps: {
      "image-transform": {
        cropRect: require("../mini-program/utils/image-transform").cropRect,
        transform: () => {
          transforms++;
          return new Promise((_, r) => (reject = r));
        },
      },
    },
  });
  p.setData({
    mode: "crop",
    sourcePath: "src",
    sourceWidth: 400,
    sourceHeight: 560,
    resultPath: "old",
    displayPath: "old",
    ratio: 1,
  });
  p.createSelectorQuery = () => ({
    select() {
      return this;
    },
    boundingClientRect() {
      return this;
    },
    exec(fn) {
      fn([{ width: 335, height: 245 }]);
    },
  });
  p.applyAnimatedStyle = (_s, fn, _o, cb) => {
    updater = fn;
    cb(0);
  };
  let cleared = 0;
  p.clearAnimatedStyle = () => cleared++;
  p.updateCropPreview();
  assert.equal(p.data.canMoveY, true);
  assert.equal(p.data.canMoveX, false);
  let updates = 0;
  const set = p.setData;
  p.setData = (...args) => {
    updates++;
    set(...args);
  };
  p.previewPositionY({ detail: { value: 0 } });
  const start = updater().transform;
  p.previewPositionY({ detail: { value: 100 } });
  const end = updater().transform;
  assert.notEqual(start, end);
  assert.equal(updates, 1, "首帧作废旧结果，后续拖动不逐帧setData");
  assert.equal(p.data.resultPath, "");
  assert.equal(p.data.displayPath, "old");
  assert.equal(transforms, 0);
  p.positionY({ detail: { value: 100 } });
  assert.equal(transforms, 1);
  assert.equal(p.data.positionY, 100);
  reject(Error("failed"));
  await tick();
  assert.equal(p.data.resultPath, "");
  assert.equal(p.data.displayPath, "old");
  assert.ok(p.data.error);
  assert.ok(cleared >= 1);
});
test("裁剪旋转后的预览使用旋转坐标，左右构图范围与实际裁剪一致", () => {
  const p = load("pages/tools/tools.js");
  p.setData({
    mode: "crop",
    sourceWidth: 400,
    sourceHeight: 560,
    angle: 90,
    ratio: 1,
  });
  p.createSelectorQuery = () => ({
    select() {
      return this;
    },
    boundingClientRect() {
      return this;
    },
    exec(fn) {
      fn([{ width: 335, height: 245 }]);
    },
  });
  p.updateCropPreview();
  assert.equal(p.data.canMoveX, true);
  assert.equal(p.data.canMoveY, false);
  assert.equal(p._cropGeometry.dx, 88.4);
  assert.match(
    p.cropTransform("X", 100),
    /translate\(-88.4px,0px\) rotate\(90deg\)/,
  );
});
test("动效绑定兼容数字0，页面退出后清理且忽略迟到回调", () => {
  const callbacks = [],
    clears = [];
  const host = {
    applyAnimatedStyle: (_s, _u, _o, cb) => callbacks.push(cb),
    clearAnimatedStyle: (s, ids) => clears.push({ s, ids }),
  };
  const m = motion.createMotion(host, { worklet: fakeWorklet() });
  m.bind(".a", () => ({}));
  callbacks[0](0);
  m.bind(".b", () => ({}));
  m.dispose();
  callbacks[1]({ styleId: 1 });
  assert.deepEqual(clears, [
    { s: ".a", ids: [0] },
    { s: ".b", ids: [1] },
  ]);
});
test("额度弹层在退出后只派发一次确认，隐藏或卸载撤销待执行动作", () => {
  const timers = [],
    events = [];
  const p = load("components/motion-sheet/index.js", { timers });
  p.triggerEvent = (e) => events.push(e);
  p.lifetimes.attached.call(p);
  p.lifetimes.ready.call(p);
  p.open();
  p.confirm();
  p.confirm();
  assert.equal(events.length, 0);
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.deepEqual(events, ["confirm"]);
  p.open();
  p.confirm();
  p.observers.visible.call(p, false);
  timers.shift()();
  assert.deepEqual(events, ["confirm"]);
  p.open();
  p.confirm();
  p.lifetimes.detached.call(p);
  assert.equal(timers.length, 0);
});

test("FAQ展开收起同步内容高度、透明度和箭头，卸载后清理绑定", () => {
  const updaters = {},
    cleared = [];
  const p = load("components/faq-item/index.js", {
    wx: { worklet: fakeWorklet() },
  });
  p.createSelectorQuery = () => ({
    select() {
      return this;
    },
    boundingClientRect() {
      return this;
    },
    exec(fn) {
      fn([{ height: 120 }]);
    },
  });
  p.applyAnimatedStyle = (selector, updater, options, done) => {
    updaters[selector] = updater;
    done(Object.keys(updaters).length - 1);
  };
  p.clearAnimatedStyle = (selector, ids) => cleared.push({ selector, ids });
  p.lifetimes.ready.call(p);
  assert.equal(updaters[".faq-reveal"]().height, "0px");
  p.data.expanded = true;
  p.observers.expanded.call(p);
  assert.equal(updaters[".faq-reveal"]().height, "120px");
  assert.equal(updaters[".faq-reveal"]().opacity, 1);
  assert.equal(updaters[".faq-arrow"]().transform, "rotate(180deg)");
  p.data.expanded = false;
  p.observers.expanded.call(p);
  assert.equal(updaters[".faq-reveal"]().height, "0px");
  assert.equal(updaters[".faq-arrow"]().transform, "rotate(0deg)");
  p.lifetimes.detached.call(p);
  assert.equal(cleared.length, 2);
});

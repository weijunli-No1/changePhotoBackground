const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
function picker({ motion = false, numericStyleIds = false } = {}) {
  const filename = path.resolve(
    __dirname,
    "../mini-program/components/spec-picker/index.js",
  );
  let definition,
    clock = 0,
    serial = 0;
  const timers = new Map(),
    events = [],
    bindings = [],
    clears = [],
    timings = [];
  const wx = {
    getWindowInfo: () => ({
      windowWidth: 375,
      windowHeight: 730,
      statusBarHeight: 47,
    }),
    hideKeyboard() {},
  };
  if (motion)
    wx.worklet = {
      shared: (value) => ({ value }),
      timing: (value, options) => {
        timings.push({ value, ...options });
        return value;
      },
      Easing: { ease: "ease" },
    };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      Component: (value) => (definition = value),
      require: createRequire(filename),
      wx,
      setTimeout: (fn, delay) => {
        const id = ++serial;
        timers.set(id, { fn, at: clock + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    { filename },
  );
  const p = { ...definition.methods, data: structuredClone(definition.data) };
  p.setData = (data, done) => {
    Object.assign(p.data, data);
    if (done) done();
  };
  p.triggerEvent = (event, detail) => events.push({ event, detail });
  if (motion) {
    p.applyAnimatedStyle = (selector, updater, options, callback) => {
      const id = bindings.length;
      bindings.push({ selector, updater });
      callback(numericStyleIds ? id : { styleId: id });
    };
    p.clearAnimatedStyle = (selector, ids) => clears.push({ selector, ids });
  }
  p.data.currentWidth = 295;
  p.data.currentHeight = 413;
  definition.lifetimes.attached.call(p);
  definition.lifetimes.ready.call(p);
  return {
    p,
    events,
    bindings,
    clears,
    timings,
    visible(value) {
      p.data.visible = value;
      definition.observers.visible.call(p, value);
    },
    detach() {
      definition.lifetimes.detached.call(p);
    },
    tick(ms) {
      clock += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= clock) {
          timers.delete(id);
          timer.fn();
        }
    },
  };
}
test("规格先选中再确认，确认退出期间防重，保留原规格事件字段", () => {
  const e = picker();
  e.visible(true);
  e.p.select({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(e.events.length, 0);
  assert.equal(e.p.data.selectedName, "二寸");
  e.p.confirm();
  e.p.confirm();
  e.p.close();
  e.tick(179);
  assert.equal(e.events.length, 0);
  e.tick(1);
  assert.equal(e.events.length, 1);
  assert.equal(e.events[0].event, "select");
  assert.equal(e.events[0].detail.width, 413);
  assert.equal(e.events[0].detail.height, 579);
  assert.equal(e.events[0].detail.name, "二寸");
  assert.equal(e.p.data.rendered, false);
});
test("取消不提交选择，重新打开按已应用规格恢复；未应用的自定义值不污染当前规格", () => {
  const e = picker();
  e.visible(true);
  e.p.inputWidth({ detail: { value: "800" } });
  e.p.inputHeight({ detail: { value: "600" } });
  assert.equal(e.p.data.selectedIndex, -1);
  e.p.close();
  e.tick(180);
  assert.equal(e.events[0].event, "close");
  e.visible(false);
  e.visible(true);
  assert.equal(e.p.data.width, "295");
  assert.equal(e.p.data.height, "413");
  assert.equal(e.p.data.selectedIndex, 0);
});
test("切换底栏或父页面隐藏会撤销尚未完成的确认；快速重新打开不被旧回调关闭", () => {
  const e = picker();
  e.visible(true);
  e.p.confirm();
  e.visible(false);
  e.tick(180);
  assert.equal(e.events.length, 0);
  e.visible(true);
  e.p.close();
  e.tick(90);
  e.visible(false);
  e.visible(true);
  e.tick(90);
  assert.equal(e.p.data.rendered, true);
  assert.equal(e.p.data.closing, false);
  assert.equal(e.events.length, 0);
  e.detach();
  e.tick(500);
  assert.equal(e.events.length, 0);
});
test("Worklet 绑定面板位移与遮罩透明度，退出后清理绑定，再打开从隐藏位置开始", () => {
  const e = picker({ motion: true });
  e.visible(true);
  assert.equal(e.p.data.motionFallback, false);
  assert.equal(e.timings[0].value, 1);
  assert.equal(e.timings[0].duration, 260);
  assert.equal(e.bindings[0].updater().opacity, 1);
  assert.equal(e.bindings[1].updater().transform, "translateY(0%)");
  e.p.close();
  assert.equal(e.timings[1].value, 0);
  assert.equal(e.timings[1].duration, 180);
  e.tick(180);
  assert.equal(e.clears.length, 2);
  e.visible(false);
  e.visible(true);
  assert.equal(e.bindings.length, 4);
  e.detach();
  assert.equal(e.clears.length, 4);
});
test("无 Worklet 的运行环境仍可选择，自定义无效值留在原处提示，修正后才能提交", () => {
  const e = picker();
  e.visible(true);
  assert.equal(e.p.data.motionFallback, true);
  e.p.inputWidth({ detail: { value: "99" } });
  e.p.inputHeight({ detail: { value: "560" } });
  e.p.confirm();
  assert.equal(e.p.data.invalidWidth, true);
  assert.equal(e.events.length, 0);
  assert.equal(e.p.data.closing, false);
  e.p.inputWidth({ detail: { value: "400" } });
  e.p.confirm();
  e.tick(180);
  assert.equal(e.events[0].detail.name, "自定义");
  assert.equal(e.events[0].detail.width, 400);
});

test("基础库返回数字动画绑定ID（包括0）时也能清理，避免重复打开积累绑定", () => {
  const e = picker({ motion: true, numericStyleIds: true });
  e.visible(true);
  e.p.close();
  e.tick(180);
  assert.equal(e.clears.length, 2);
  assert.equal(e.clears[0].ids[0], 0);
  assert.equal(e.clears[1].ids[0], 1);
});

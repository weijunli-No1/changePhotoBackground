const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function picker(windowInfo = { windowHeight: 730, statusBarHeight: 47 }) {
  const filename = path.resolve(__dirname, "../mini-program/components/spec-picker/index.js");
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Component: (value) => { definition = value; },
    require: createRequire(filename),
    wx: { getWindowInfo: () => windowInfo },
    setTimeout,
    clearTimeout,
  }, { filename });
  const page = {
    ...definition.methods,
    data: structuredClone(definition.data),
    setData(values, callback) {
      Object.assign(this.data, values);
      if (callback) callback();
    },
  };
  definition.lifetimes.attached.call(page);
  page.setData({ rendered: true });
  return page;
}

function measure(page, { head = 44, footer = 106, content = 400, deferred = false } = {}) {
  let resolve;
  page.createSelectorQuery = () => {
    const query = {
      select: () => query,
      boundingClientRect: () => query,
      exec: (callback) => {
        resolve = () => callback([{ height: head }, { height: footer }, { height: content }]);
        if (!deferred) resolve();
      },
    };
    return query;
  };
  page.updateBodyHeight();
  return () => resolve();
}

test("规格弹层仅有260px空间时内容可滚动，标题和安全区确认栏完整留在视口内", () => {
  const page = picker();
  page.setData({ availableHeight: 260, compactLayout: true });
  measure(page, { content: 420 });
  assert.equal(page.data.bodyHeight, 102);
  assert.equal(8 + 44 + page.data.bodyHeight + 106, 260);
});

test("窄屏大键盘弹起时弹层不会向上越过状态栏，内容区仍能滚动", () => {
  const page = picker({ windowWidth: 320, windowHeight: 568, statusBarHeight: 20 });
  page.keyboardChange({ detail: { height: 376 } });
  measure(page, { head: 44, footer: 66, content: 200 });
  assert.equal(page.data.availableHeight, 172);
  assert.equal(page.data.bodyHeight, 54);
});

test("空间充裕时规格弹层按内容自然收高，键盘出现时重新计算滚动区", () => {
  const page = picker();
  measure(page);
  assert.equal(page.data.bodyHeight, 400);
  assert.ok(8 + 44 + page.data.bodyHeight + 106 < page.data.availableHeight);
  page.keyboardChange({ detail: { height: 340 } });
  assert.equal(page.data.compactLayout, true);
  measure(page, { footer: 72, content: 240 });
  assert.equal(page.data.bodyHeight, page.data.availableHeight - 8 - 44 - 72);
  page.keyboardChange({ detail: { height: 0 } });
  assert.equal(page.data.compactLayout, false);
});

test("键盘布局的迟到测量不能覆盖新布局，关闭后的测量不更新弹层", () => {
  const page = picker();
  const stale = measure(page, { content: 400, deferred: true });
  page.setData({ availableHeight: 260, compactLayout: true });
  measure(page, { content: 420 });
  stale();
  assert.equal(page.data.bodyHeight, 102);
  const closed = measure(page, { content: 50, deferred: true });
  page.setData({ closing: true });
  closed();
  assert.equal(page.data.bodyHeight, 102);
});

test("自定义聚焦显示输入框，反复提交无效尺寸仍滚到错误提示，重开后复位", () => {
  const page = picker();
  const targets = [];
  const setData = page.setData;
  page.setData = function (values, callback) {
    if (Object.hasOwn(values, "customScrollTarget")) targets.push(values.customScrollTarget);
    setData.call(this, values, callback);
  };
  page.focusCustom({ detail: {} });
  assert.equal(page.data.customScrollTarget, "custom-fields");
  page.inputWidth({ detail: { value: "99" } });
  page.confirm();
  assert.equal(page.data.customScrollTarget, "custom-error");
  assert.equal(page.data.invalidWidth, true);
  page.confirm();
  assert.deepEqual(targets.slice(-2), ["", "custom-error"]);
  page.resetSelection();
  assert.equal(page.data.customScrollTarget, "");
});

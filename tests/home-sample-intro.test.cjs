const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function fixture() {
  let now = 1000, sequence = 0, defer = false;
  const preference = { width: 1, height: 1 };
  const timers = new Map(), listeners = {}, pending = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../mini-program/pages/index/sample-intro.js"), "utf8"), {
    module, Date: { now: () => now },
    setTimeout(fn, delay) {
      const id = ++sequence;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const page = {
    data: { size: { width: 295 }, frontSample: "female", sampleStyles: null },
    frames: [],
    setData(values) { Object.assign(this.data, values); this.frames.push({ ...values }); },
    createSelectorQuery() {
      const query = {
        select() { return query; },
        boundingClientRect() { return query; },
        exec(fn) {
          const rects = [ { ...photo }, { top: 88, bottom: 660, left: 0, right: 360 }, { ...preference } ];
          if (defer) pending.push(() => fn(rects));
          else fn(rects);
        },
      };
      return query;
    },
  };
  const api = {
    onAppHide(fn) { listeners.hide = fn; }, offAppHide(fn) { assert.equal(fn, listeners.hide); delete listeners.hide; },
    onAppShow(fn) { listeners.show = fn; }, offAppShow(fn) { assert.equal(fn, listeners.show); delete listeners.show; },
  };
  const photo = { top: 150, bottom: 270, left: 195, right: 310, width: 115, height: 120 };
  const intro = module.exports.createSampleIntro(page, api);
  function tick(ms) {
    const end = now + ms;
    for (;;) {
      const task = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!task || task[1].at > end) break;
      timers.delete(task[0]); now = task[1].at; task[1].fn();
    }
    now = end;
  }
  function visible() { intro.show(); intro.ready(); intro.image("male"); intro.image("female"); }
  return { page, intro, photo, preference, tick, visible, listeners, pending, setDefer(value) { defer = value; } };
}

test("两张样片实际载入并在首页连续可见后只换一次，广告位无关的加载不重新计时", () => {
  const f = fixture();
  f.intro.image("female"); f.intro.ready(); f.intro.show(); f.tick(6000);
  assert.equal(f.page.frames.length, 0);
  f.intro.image("male"); f.tick(900); f.intro.layout(); f.tick(500);
  assert.equal(f.page.frames.length, 0);
  f.tick(200); assert.ok(f.page.data.sampleStyles);
  f.tick(1000); assert.equal(f.page.data.frontSample, "male"); assert.equal(f.page.data.sampleStyles, null);
  const count = f.page.frames.length;
  for (let i = 0; i < 3; i++) { f.intro.hide(); f.intro.show(); f.intro.layout(); f.tick(3200); }
  assert.equal(f.page.frames.length, count);
});

test("应用或底栏切走时中断未完成的换位，恢复后从完整的可见停留重新播放", () => {
  const f = fixture(); f.visible(); f.tick(1740);
  assert.ok(f.page.data.sampleStyles);
  f.intro.hide(); f.listeners.hide();
  f.tick(8000); f.intro.show(); f.tick(8000);
  assert.equal(f.page.data.frontSample, "female"); assert.equal(f.page.data.sampleStyles, null);
  f.listeners.show(); f.tick(800); f.intro.hide(); f.intro.show(); f.tick(1200);
  assert.equal(f.page.data.sampleStyles, null);
  f.tick(400); assert.ok(f.page.data.sampleStyles); f.tick(950);
  assert.equal(f.page.data.frontSample, "male");
});

test("裁切、快速滚动与销毁后的迟到布局都不会在后台启动首播", () => {
  const f = fixture();
  f.photo.top = 20; f.photo.bottom = 140;
  f.visible(); f.tick(4000); assert.equal(f.page.frames.length, 0);
  f.photo.top = 150; f.photo.bottom = 270; f.intro.scroll(); f.tick(1000); f.intro.scroll(); f.tick(1200);
  assert.equal(f.page.frames.length, 0);
  f.setDefer(true); f.tick(500); assert.ok(f.pending.length);
  f.intro.hide(); f.intro.dispose(); f.pending.forEach(callback => callback()); f.tick(9000);
  assert.equal(f.page.frames.length, 0); assert.deepEqual(f.listeners, {});
});

test("手动操作在等待或换位中接管，不覆盖手选结果，也不会在切换底栏后补播", () => {
  for (const delay of [500, 1800, 2020]) {
    const f = fixture(); f.visible(); f.tick(delay); f.intro.takeOver();
    f.page.setData({ frontSample: "female" });
    const count = f.page.frames.length;
    f.intro.hide(); f.listeners.hide(); f.listeners.show(); f.intro.show(); f.intro.layout(); f.tick(9000);
    assert.equal(f.page.frames.length, count); assert.equal(f.page.data.frontSample, "female");
    assert.equal(f.page.data.sampleStyles, null);
  }
});

test("图片报错后丢弃在途测量，真实重载成功才有新一轮首播", () => {
  const f = fixture();
  f.setDefer(true); f.visible();
  f.intro.imageFailed("male"); f.pending.forEach(cb => cb()); f.tick(5000);
  assert.equal(f.page.frames.length, 0);
  f.setDefer(false); f.intro.image("male"); f.tick(2500);
  assert.equal(f.page.data.frontSample, "male");
});

test("单独收到前后台事件、页面仍显示时，同样重新计时；重复 show 保留已经可见的时间", () => {
  const f = fixture(); f.visible(); f.tick(1100); f.listeners.hide(); f.tick(5000);
  assert.equal(f.page.frames.length, 0);
  f.listeners.show(); f.tick(800); f.listeners.show(); f.intro.show(); f.tick(600);
  assert.equal(f.page.frames.length, 0);
  f.tick(120); assert.ok(f.page.data.sampleStyles);
});

test("系统明确要求减弱动效时只切换一次，无法区分媒体条件的渲染器保持正常首播", () => {
  const reduced = fixture();
  reduced.preference.width = 2;
  reduced.visible(); reduced.tick(2400);
  assert.equal(reduced.page.data.sampleReduced, true);
  assert.equal(reduced.page.data.frontSample, "male");
  assert.ok(reduced.page.frames.every(step => !step.sampleStyles));
  const unsupported = fixture();
  unsupported.preference.width = unsupported.preference.height = 2;
  unsupported.visible(); unsupported.tick(1620);
  assert.ok(unsupported.page.data.sampleStyles);
});

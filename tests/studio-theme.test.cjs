const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../mini-program");
const source = fs.readFileSync(path.join(root, "utils/themes.js"), "utf8");
function runtime(storage) {
  const page = { data: {}, setData(values) { Object.assign(this.data, values); } };
  const context = {
    module: { exports: {} },
    getCurrentPages: () => [page],
    wx: {
      getStorageSync: key => storage[key],
      setStorageSync: (key, value) => { storage[key] = value; },
      getAppBaseInfo: () => ({ theme: "light" }),
    },
  };
  vm.runInNewContext(source, context);
  return { themes: context.module.exports, page };
}
test("选主题立即更新页面，重开仍沿用同一台打印机，系统深色切换保持机型", () => {
  const storage = {};
  const { themes, page } = runtime(storage);
  const changes = [];
  const off = themes.subscribe(theme => changes.push(theme.id));
  assert.equal(themes.set("missing"), false);
  assert.equal(themes.set("peach"), true);
  assert.equal(themes.set("peach"), false);
  assert.equal(page.data.studioTheme.printer, "/assets/printers/peach.png");
  themes.applyPage(page, "dark");
  assert.equal(page.data.studioAccent, themes.current().darkAccent);
  assert.equal(runtime(storage).themes.current().id, "peach");
  off();
  themes.set("mint");
  assert.deepEqual(changes, ["sky", "peach"]);
  const machines = themes.choices.map(theme => theme.printer);
  assert.equal(new Set(machines).size, 3);
  assert.ok(machines.every(file => fs.existsSync(path.join(root, file))));
});
test("没有有效配置的首次使用展示晴空蓝，页面保留自身业务状态", () => {
  const { themes, page } = runtime({ "studio-theme": "retired" });
  page.data.draftId = "local";
  themes.applyCurrentPage();
  assert.equal(page.data.studioTheme.id, "sky");
  assert.equal(page.data.draftId, "local");
});

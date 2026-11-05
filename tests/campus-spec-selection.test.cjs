const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function fixture(call = async () => ({})) {
  const filename = path.resolve(__dirname, "../mini-program/pages/specs/specs.js");
  let definition;
  const events = [], back = [];
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => { definition = value; },
    require: (name) => name.endsWith("/files") ? { call } : localRequire(name),
    wx: { hideKeyboard() {}, navigateBack: (value) => back.push(value) },
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); },
    getOpenerEventChannel: () => ({ emit: (event, value) => events.push({ event, value }) }),
  };
  page.onLoad();
  return { page, events, back };
}

test("常用规格先选择再继续：切换到二寸不打开相册，确认携带新尺寸，连点只选择一次", async () => {
  let resolveMedia, choices = 0;
  const navigations = [];
  const { page } = fixture((method, options) => {
    if (method === "chooseMedia") {
      choices++;
      return new Promise((resolve) => { resolveMedia = resolve; });
    }
    navigations.push(options.url);
    return Promise.resolve();
  });
  page.selectCommon({ currentTarget: { dataset: { id: "common-1" } } });
  assert.equal(choices, 0);
  assert.equal(page.data.selectedSize.width, 413);
  const first = page.confirmSelection();
  await page.confirmSelection();
  page.selectCommon({ currentTarget: { dataset: { id: "common-0" } } });
  assert.equal(choices, 1);
  resolveMedia({ tempFiles: [{ tempFilePath: "photo with spaces.jpg" }] });
  await first;
  assert.equal(navigations.length, 1);
  assert.match(navigations[0], /width=413&height=579/);
  assert.match(navigations[0], /photo%20with%20spaces.jpg/);
  assert.equal(page.data.choosing, false);
});

test("从编辑页选择常用规格只回传尺寸，不重新选照片，也不误走考试原照流程", async () => {
  const { page, events, back } = fixture(() => { throw Error("不应打开相册"); });
  page.onLoad({ select: "1" });
  page.selectCommon({ currentTarget: { dataset: { id: "common-1" } } });
  await page.confirmSelection();
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "selected");
  assert.equal(events[0].value.size.width, 413);
  assert.equal(events[0].value.size.height, 579);
  assert.equal(back.length, 1);
});

test("常用与考试分类互不混入，考试搜索仍能找到原有完整规则", () => {
  const { page } = fixture();
  page.selectCategory({ currentTarget: { dataset: { id: "common" } } });
  assert.equal(page.data.count, 4);
  assert.ok(page.data.groups.every((group) => group.items.every((item) => item.category === "common")));
  page.selectCategory({ currentTarget: { dataset: { id: "exam" } } });
  assert.ok(page.data.groups.every((group) => group.items.every((item) => item.category !== "common")));
  page.search({ detail: { value: "四六级" } });
  assert.equal(page.data.count, 2);
  assert.ok(page.data.groups[0].items[0].sourceUrl);
});

test("选图期间离开规格页，迟到的结果不导航、不恢复页面状态", async () => {
  let resolveMedia, navigations = 0;
  const { page } = fixture((method) => {
    if (method === "chooseMedia") return new Promise((resolve) => { resolveMedia = resolve; });
    navigations++;
    return Promise.resolve();
  });
  const pending = page.confirmSelection();
  page.onUnload();
  resolveMedia({ tempFiles: [{ tempFilePath: "late.jpg" }] });
  await pending;
  assert.equal(navigations, 0);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const catalog = require("../mini-program/utils/tool-catalog");
const root = path.resolve(__dirname, "../mini-program");
function load(file, globals = {}) {
  let def;
  const filename = path.join(root, file);
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      Page: (v) => (def = v),
      require: createRequire(filename),
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename },
  );
  const p = { ...def, data: structuredClone(def.data) };
  p.setData = (v) => Object.assign(p.data, v);
  return p;
}
function launchFixture(call) {
  let module = { exports: {} };
  const navigations = [];
  const filename = path.join(root, "utils/tool-launcher.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module,
    wx: {
      navigateTo: (o) => {
        navigations.push(o);
        if (o.complete) o.complete();
      },
    },
    require: (name) =>
      name === "./files" ? { call } : require(path.join(root, "utils", name)),
  });
  const page = {
    ...module.exports,
    data: {},
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  return { page, navigations };
}

test("按用途搜索支持大小写及多关键词，并保持分类约束和空结果", () => {
  assert.equal(catalog.findTools("缩小")[0].id, "compress");
  assert.equal(catalog.findTools("JPG 体积")[0].id, "compress");
  assert.equal(catalog.findTools("蓝底")[0].id, "background");
  assert.equal(catalog.findTools("正方形")[0].id, "crop");
  assert.equal(catalog.findTools("压缩", "portrait").length, 0);
  assert.equal(catalog.grouped("不存在的功能").length, 0);
  assert.equal(catalog.findTools("  ").length, 4);
});
test("新文档类别可通过注册接入目录，未启用工具不会出现在搜索或入口", async () => {
  catalog.categories.push({ id: "document", name: "文档工具" });
  catalog.tools.push({
    id: "test-document",
    name: "测试文档工具",
    category: "document",
    description: "仅测试注册能力",
    keywords: ["PDF"],
    entry: { type: "page", url: "/pages/test-document/test-document" },
  });
  catalog.tools.push({
    id: "test-disabled",
    name: "隐藏工具",
    category: "document",
    enabled: false,
    entry: { type: "page", url: "/hidden" },
  });
  try {
    assert.ok(catalog.getCategories().some((c) => c.id === "document"));
    assert.equal(catalog.grouped("PDF")[0].tools[0].id, "test-document");
    assert.equal(catalog.getTool("test-disabled"), undefined);
    const { page, navigations } = launchFixture(() => {
      throw Error("Document should not invoke photo chooser");
    });
    page.openToolEntry("test-document");
    assert.equal(navigations[0].url, "/pages/test-document/test-document");
    page.openToolEntry("test-disabled");
    assert.equal(navigations.length, 1);
  } finally {
    catalog.tools.splice(-2);
    catalog.categories.pop();
  }
});
test("当前已启用的工具入口和草稿路由均指向实际注册页面", () => {
  const routes = JSON.parse(
    fs.readFileSync(path.join(root, "app.json"), "utf8"),
  ).pages;
  for (const tool of catalog.available()) {
    const route =
      tool.entry.type === "portrait"
        ? "pages/edit/edit"
        : tool.entry.url.slice(1).split("?")[0];
    assert.ok(routes.includes(route), tool.id + " has no route");
    for (const ext of ["js", "json", "wxml", "wxss"])
      assert.ok(fs.existsSync(path.join(root, route + "." + ext)));
  }
  assert.equal(catalog.draftUrl({ id: "d1", mode: "unknown" }), "");
  assert.match(
    catalog.draftUrl({ id: "d&1", mode: "idphoto", toolId: "background" }),
    /draft=d%261$/,
  );
  const draft = catalog.presentDraft(
    { id: "d1", mode: "idphoto", toolId: "background", updatedAt: 10000 },
    20000,
  );
  assert.equal(draft.title, "更换底色草稿");
  assert.equal(draft.updatedLabel, "刚刚编辑");
});
test("选择规格后选照片防重复，后台入口参数保持原规格并传递明确用途", async () => {
  let resolve,
    choices = 0;
  const { page, navigations } = launchFixture(() => {
    choices++;
    return new Promise((r) => (resolve = r));
  });
  page.openToolEntry("background");
  assert.equal(page.data.specVisible, true);
  const first = page.selectSpec({
    detail: { name: "一寸", width: 295, height: 413 },
  });
  page.openToolEntry("compress");
  await page.selectSpec({ detail: { width: 413, height: 579 } });
  assert.equal(choices, 1);
  assert.equal(navigations.length, 0);
  resolve({ tempFiles: [{ tempFilePath: "wxfile://photo?a=1&b=2" }] });
  await first;
  const url = new URL("https://example.test" + navigations[0].url);
  assert.equal(url.searchParams.get("src"), "wxfile://photo?a=1&b=2");
  assert.equal(url.searchParams.get("width"), "295");
  assert.equal(url.searchParams.get("tool"), "background");
});
test("无效规格不打开相册，用户取消和页面退出不触发导航或错误", async () => {
  let calls = 0,
    resolve;
  const { page, navigations } = launchFixture(() => {
    calls++;
    return new Promise((r) => (resolve = r));
  });
  await page.selectSpec({ detail: { width: 0, height: 413 } });
  assert.equal(calls, 0);
  assert.ok(page.data.entryError);
  const pending = page.selectSpec({ detail: { width: 295, height: 413 } });
  page._unloaded = true;
  resolve({ tempFiles: [{ tempFilePath: "fixture" }] });
  await pending;
  assert.equal(navigations.length, 0);
  const cancelled = launchFixture(async () => {
    throw { errMsg: "chooseMedia:fail cancel" };
  });
  await cancelled.page.selectSpec({ detail: { width: 295, height: 413 } });
  assert.equal(cancelled.page.data.entryError, "");
  assert.equal(cancelled.page._choosing, false);
});
test("目录组合筛选后可清空或恢复全部，不留下死胡同", () => {
  const p = load("pages/library/library.js");
  p.selectCategory({ currentTarget: { dataset: { id: "portrait" } } });
  p.search({ detail: { value: "压缩" } });
  assert.equal(p.data.groups.length, 0);
  p.clearSearch();
  assert.equal(p.data.category, "portrait");
  assert.equal(p.data.groups[0].tools.length, 2);
  p.resetSearch();
  assert.equal(p.data.category, "all");
  assert.equal(p.data.groups.length, 2);
});
test("保存后的主要操作完成返回，次要重复保存仍走原缓存链路，保存中不能跳转", () => {
  const p = load("pages/export/export.js", {
    getApp: () => ({ globalData: {} }),
  });
  let finishes = 0,
    saves = 0;
  p.backToTools = () => finishes++;
  p.saveCurrent = () => saves++;
  p.primaryAction();
  assert.equal(saves, 1);
  p.setData({ saved: true });
  p.primaryAction();
  assert.equal(finishes, 1);
  p.setData({ busy: true });
  p.primaryAction();
  assert.equal(finishes, 1);
  assert.equal(saves, 1);
});
test("从个人中心进入草稿会消费一次导航意图，不落到先前的云端页签", () => {
  const app = { globalData: { openid: "", requestedWorksTab: "drafts" } };
  const p = load("pages/history/history.js", {
    getApp: () => app,
    require: (name) => {
      if (name.endsWith("/skyline-motion"))
        return require("../mini-program/utils/skyline-motion");
      if (name.endsWith("/tool-catalog")) return catalog;
      if (name.endsWith("/drafts")) return { list: () => [] };
      return {};
    },
  });
  p.setData({ tab: "cloud" });
  p.onShow();
  assert.equal(p.data.tab, "drafts");
  assert.equal(app.globalData.requestedWorksTab, undefined);
  p.setData({ tab: "cloud" });
  p.onShow();
  assert.equal(p.data.tab, "cloud");
});
test("在作品管理清理草稿需确认且防重，取消不清理，成功不操作云端数据", async () => {
  let done,
    cleared = 0,
    dialogs = 0;
  const app = { globalData: { openid: "test" } };
  const p = load("pages/history/history.js", {
    getApp: () => app,
    wx: { showToast() {} },
    require: (name) => {
      if (name.endsWith("/skyline-motion"))
        return require("../mini-program/utils/skyline-motion");
      if (name.endsWith("/tool-catalog")) return catalog;
      if (name.endsWith("/drafts")) return { clear: async () => cleared++ };
      if (name.endsWith("/files"))
        return {
          call: () => {
            dialogs++;
            return new Promise((r) => (done = r));
          },
        };
      if (name.endsWith("/api"))
        return {
          request: () => {
            throw Error("Cloud must remain unchanged");
          },
        };
      throw Error(name);
    },
  });
  p.setData({ drafts: [{ id: "d1" }], historyList: [{ id: "cloud" }] });
  let work = p.clearDrafts();
  await p.clearDrafts();
  assert.equal(dialogs, 1);
  done({ confirm: false });
  await work;
  assert.equal(cleared, 0);
  work = p.clearDrafts();
  done({ confirm: true });
  await work;
  assert.equal(cleared, 1);
  assert.equal(p.data.drafts.length, 0);
  assert.equal(p.data.historyList[0].id, "cloud");
});

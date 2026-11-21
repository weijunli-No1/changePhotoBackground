const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function page(name, wx = {}, deps = {}) {
  const filename = path.resolve(__dirname, "../mini-program/pages", name, name + ".js");
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: value => { definition = value; },
    require: (name) => deps[path.basename(name)] || localRequire(name),
    wx,
  }, { filename });
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, done) {
      for (const [key, value] of Object.entries(patch)) {
        const group = key.match(/^groups\[(\d+)\]\.expanded$/);
        if (group) this.data.groups[group[1]].expanded = value;
        else this.data[key] = value;
      }
      if (done) done();
    },
  };
}

const tap = (dataset) => ({ currentTarget: { dataset } });

test("首页选尺寸更新样张，选照片直接沿用尺寸，切回证件照不会继承换底色入口", () => {
  const home = page("index");
  home._activeTool = "background";
  let selection;
  home.selectSpec = ({ detail }) => { selection = detail; };
  home.selectHomeSize(tap({ index: 1 }));
  assert.equal(home.data.size.height, 579);
  assert.equal(selection, undefined);
  home.startHomePhoto();
  assert.equal(selection.width, 413);
  assert.equal(home._activeTool, "idphoto");
});

test("跨分类搜索保留原词、定位具体考试，同一结果连续点击只导航一次", () => {
  const navigation = [];
  const library = page("library", { navigateTo: options => navigation.push(options) });
  library.selectCategory(tap({ id: "image" }));
  library.search({ detail: { value: "四六级" } });
  assert.equal(library.data.outsideCategory, true);
  assert.equal(library.data.specMatchCount, 0);
  library.searchAllCategories();
  assert.equal(library.data.query, "四六级");
  assert.equal(library.data.specMatchCount, 2);
  library.openMatchingSpec(tap({ id: "cet4" }));
  library.openMatchingSpec(tap({ id: "cet6" }));
  assert.equal(navigation.length, 1);
  assert.equal(navigation[0].url, "/pages/spec-detail/spec-detail?id=cet4");
  navigation[0].complete();
  library.openMatchingSpec(tap({}));
  const all = page("specs");
  all.onLoad({ query: navigation[1].url.split("?query=")[1] });
  assert.equal(all.data.count, 2);
  assert.equal(all.data.query, "四六级");
});

test("规格目录按需展开分类，搜索揭示折叠项并在清空后恢复先前展开状态", () => {
  const specs = page("specs");
  specs.onLoad();
  const id = "qualification";
  const group = () => specs.data.groups.find(item => item.id === id);
  assert.equal(group().expanded, false);
  specs.toggleGroup(tap({ id }));
  assert.equal(group().expanded, true);
  specs.search({ detail: { value: "一建" } });
  assert.ok(specs.data.count > 0);
  assert.ok(specs.data.groups.every(item => !item.collapsible));
  specs.clearSearch();
  assert.equal(group().expanded, true);
  specs.toggleGroup(tap({ id }));
  assert.equal(group().expanded, false);
});

test("首页更多规格和换底色直接打开独立规格页，沿用二寸并带入相应编辑工具", async () => {
  const calls = [];
  const wx = { navigateTo: options => calls.push(options) };
  const file = path.resolve(__dirname, "../mini-program/utils/tool-launcher.js");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    module, wx, require: createRequire(file),
  });
  const home = page("index", wx, { "tool-launcher": module.exports });
  home.selectHomeSize(tap({ index: 1 }));
  for (const id of ["idphoto", "background"]) {
    const index = calls.length;
    home.openToolEntry(tap({ id }));
    home.openToolEntry(tap({ id }));
    assert.equal(calls.length, index + 1);
    const [route, query] = calls[index].url.split("?");
    assert.equal(route, "/pages/specs/specs");
    calls[index].complete();

    const navigation = [];
    const specs = page("specs", {}, {
      files: { call: async (method, options) => {
        if (method === "chooseMedia") return { tempFiles: [{ tempFilePath: "album.jpg" }] };
        navigation.push(options.url);
      } },
    });
    const rawQuery = Object.fromEntries(query.split("&").map(pair => pair.split("=")));
    specs.onLoad(rawQuery);
    assert.equal(specs.data.selectedSize.name, "二寸");
    await specs.confirmSelection();
    assert.equal(navigation.length, 1);
    const editor = new URL(navigation[0], "https://example.test");
    assert.equal(editor.pathname, "/pages/edit/edit");
    assert.equal(editor.searchParams.get("width"), "413");
    assert.equal(editor.searchParams.get("height"), "579");
    assert.equal(editor.searchParams.get("tool"), id);
  }
});

test("首页相纸样张不选用户照片，连点只开一次，导航失败可以重试", () => {
  const navigations = [];
  const home = page("index", { navigateTo: options => navigations.push(options) });
  home.openPrintDemo();
  home.openPrintDemo();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, "/pages/export/export?demo=print");
  navigations[0].fail();
  navigations[0].complete();
  assert.match(home.data.entryError, /重试/);
  home.openPrintDemo();
  assert.equal(navigations.length, 2);
});

test("工具库快捷搜索直达相关规格，考试结果不出现无关的一寸制作按钮", () => {
  const library = page("library");
  library.quickSearch(tap({ query: "四六级" }));
  assert.equal(library.data.query, "四六级");
  assert.deepEqual(Array.from(library.data.matchingSpecs, item => item.id), ["cet4", "cet6"]);
  const specs = page("specs");
  specs.onLoad({ query: "四六级" });
  assert.equal(specs.data.showSelection, false);
  specs.clearSearch();
  assert.equal(specs.data.showSelection, true);
  specs.selectCategory(tap({ id: "exam" }));
  assert.equal(specs.data.showSelection, false);
});

test("从考试报名打开目录预选考试栏目，搜索其他常用尺寸需明确选中结果", () => {
  const catalog = require("../mini-program/utils/tool-catalog");
  const entry = new URL(catalog.getTool("exam").entry.url, "https://example.test");
  const specs = page("specs");
  specs.onLoad({ category: entry.searchParams.get("category") });
  assert.equal(specs.data.category, "exam");
  assert.equal(specs.data.showSelection, false);
  specs.selectCategory(tap({ id: "all" }));
  specs.search({ detail: { value: "小二寸" } });
  assert.equal(specs.data.showSelection, false);
  specs.selectCommon(tap({ id: "common-3" }));
  assert.equal(specs.data.showSelection, true);
  assert.equal(specs.data.selectedSize.name, "小二寸");
});

test("首页男女样片可交替到前景，尺寸和用户选择的原照独立", async () => {
  const home = page("index");
  home.selectSample(tap({ id: "male" }));
  home.selectHomeSize(tap({ index: 1 }));
  assert.equal(home.data.frontSample, "male");
  home.selectSample(tap({ id: "female" }));
  assert.equal(home.data.frontSample, "female");
  home.selectSample(tap({ id: "female" }));
  assert.equal(home.data.frontSample, "male");
  let selected;
  home.selectSpec = ({ detail }) => { selected = detail; };
  await home.startHomePhoto();
  assert.equal(selected.name, "二寸");
  assert.equal(selected.src, undefined);
  assert.equal(home.data.frontSample, "male");
});

test("键入像素尺寸时，工具库优先返回对应证件规格，目录也支持常用乘号和单位", () => {
  const library = page("library");
  for (const query of ["295x413", "295 × 413 px", "295*413像素"]) {
    library.search({ detail: { value: query } });
    assert.equal(library.data.matchingSpecs[0].id, "common-0");
    const specs = page("specs");
    specs.onLoad({ query: encodeURIComponent(query) });
    specs.selectCategory(tap({ id: "common" }));
    assert.equal(specs.data.count, 1);
  }
});

test("考试目录自定义尺寸后取消相册，可以直接沿用同一尺寸重选照片", async () => {
  let attempts = 0;
  const specs = page("specs", {}, { files: { call: async () => {
    attempts++;
    throw { errMsg: "chooseMedia:fail cancel" };
  } } });
  specs.onLoad({ category: "exam" });
  await specs.selectCustom({ detail: { width: 600, height: 800, name: "自定义" } });
  assert.equal(specs.data.showSelection, true);
  assert.equal(specs.data.selectedSize.width, 600);
  assert.equal(specs.data.choosing, false);
  await specs.confirmSelection();
  assert.equal(attempts, 2);
});

test("首页跨入口连点只打开一次，导航完成后可正常重试", () => {
  const calls = [];
  const home = page("index", { navigateTo: options => calls.push(options) });
  home.openLibrary();
  home.openPrintDemo();
  home.showWorks();
  assert.equal(calls.length, 1);
  calls[0].complete();
  home.openPrintDemo();
  assert.equal(calls[1].url, "/pages/export/export?demo=print");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function loadPage(name, overrides = {}) {
  let definition;
  const filename = path.resolve(__dirname, `../mini-program/pages/${name}/${name}.js`);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => { definition = value; },
    require: createRequire(filename),
    setTimeout,
    clearTimeout,
    ...overrides,
  }, { filename });
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(values, callback) {
      Object.assign(this.data, values);
      if (callback) callback();
    },
  };
}

test("空编辑页与抠图失败后的预设底色不会锁进处理中，仍可重新选图", async () => {
  for (const sourcePath of ["", "FAILED_SOURCE"]) {
    const page = loadPage("edit");
    page.setData({ sourcePath, error: "请选择或重新选择照片", errorRecovery: "reselect" });
    page.selectColor({ currentTarget: { dataset: { color: "#FF0000" } } });
    page.queueColor("#638cce");
    assert.equal(page.data.processing, false);
    assert.equal(page.data.currentBgColor, "#FFFFFF");
    assert.equal(page._colorTimer, undefined);
    let selected = 0;
    page.reselect = () => selected++;
    await page.retry();
    assert.equal(selected, 1);
  }
});

test("规格目录打开失败只提示导航错误，保留已生成结果与保存入口", () => {
  let navigation;
  const page = loadPage("edit", { wx: { navigateTo: (options) => { navigation = options; } } });
  page.setData({ sourcePath: "SOURCE", resultPath: "RESULT", previewPath: "PREVIEW" });
  page.browseSpecs();
  navigation.fail();
  assert.equal(page.data.resultPath, "RESULT");
  assert.equal(page.data.error, "");
  assert.match(page.data.openingError, /规格目录/);
  page.browseSpecs();
  assert.equal(page.data.openingError, "");
});

test("水印重复点当前方向、颜色或模板保留成品，实际修改后才需要重新生成", () => {
  const page = loadPage("watermark");
  let previews = 0;
  page.updatePreview = () => previews++;
  page.setData({ sourcePath: "SOURCE", resultPath: "RESULT", resultSize: "40 KB" });
  page.direction({ currentTarget: { dataset: { angle: "30" } } });
  page.setColor({ currentTarget: { dataset: { color: "#000000" } } });
  page.template({ currentTarget: { dataset: { index: "0" } } });
  assert.equal(page.data.resultPath, "RESULT");
  assert.equal(page.data.resultSize, "40 KB");
  assert.equal(previews, 0);
  page.direction({ currentTarget: { dataset: { angle: "0" } } });
  assert.equal(page.data.angle, 0);
  assert.equal(page.data.resultPath, "");
  assert.equal(page.data.resultSize, "");
  assert.equal(previews, 1);
});

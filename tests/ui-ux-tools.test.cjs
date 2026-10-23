const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("裁剪设置变更后处理失败，旧图不能导出或写入当前草稿；重试成功后才恢复导出", async () => {
  let definition;
  let rejectTransform;
  let succeeding = false;
  const navigations = [];
  const app = { globalData: {} };
  const filename = path.join(__dirname, "../mini-program/pages/tools/tools.js");
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      Page: (value) => {
        definition = value;
      },
      getApp: () => app,
      wx: { navigateTo: (value) => navigations.push(value), showToast() {} },
      require: (name) => {
        if (name === "../../utils/files")
          return {
            fileSize: async () => 2048,
            formatBytes: () => "2 KB",
          };
        if (name === "../../utils/drafts")
          return { save: async (snapshot) => snapshot };
        if (name === "../../utils/image-transform")
          return {
            cropRect: require("../mini-program/utils/image-transform").cropRect,
            transform: () =>
              succeeding
                ? Promise.resolve({
                    path: "SQUARE_RESULT",
                    width: 400,
                    height: 400,
                  })
                : new Promise((resolve, reject) => {
                    rejectTransform = reject;
                  }),
          };
        throw new Error(`Unexpected module: ${name}`);
      },
    },
    { filename },
  );
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = (value) => Object.assign(page.data, value);
  page._draftId = "dtest";
  page.setData({
    mode: "crop",
    sourcePath: "SOURCE",
    resultPath: "OLD_PORTRAIT",
    width: 400,
    height: 560,
    sourceWidth: 400,
    sourceHeight: 560,
  });

  page.setRatio({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.ratio, 1);
  assert.equal(page.data.processing, true);
  assert.equal(page.snapshot().resultPath, "");
  await page.goExport();
  assert.equal(navigations.length, 0);

  rejectTransform(new Error("canvas export failed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.processing, false);
  assert.ok(page.data.error);
  assert.equal(page.data.resultPath, "");
  await page.goExport();
  assert.equal(navigations.length, 0);
  assert.equal(app.globalData.exportSession, undefined);

  succeeding = true;
  await page.apply();
  await page.goExport();
  assert.equal(app.globalData.exportSession.resultPath, "SQUARE_RESULT");
  assert.equal(app.globalData.exportSession.width, 400);
  assert.equal(app.globalData.exportSession.height, 400);
  assert.equal(navigations.length, 1);
});

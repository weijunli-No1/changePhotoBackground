const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../mini-program/utils/tool-catalog");
const { VERSION, DISPLAY_VERSION } = require("../mini-program/utils/brand-preview");

test("作品只用独立低清封面，旧草稿不把原图、成品或烧水印大图放进列表", () => {
  for (const mode of ["idphoto", "exam"]) {
    const draft = {
      id: "d1", mode, sourcePath: "SOURCE", resultPath: "CLEAN", transparentPath: "MASK",
      previewPath: "MARKED", previewWatermarkVersion: VERSION,
    };
    for (const displayPath of ["", "SOURCE", "CLEAN", "MASK", "MARKED"]) {
      const item = catalog.presentDraft({ ...draft, displayPath, displayPreviewVersion: DISPLAY_VERSION });
      assert.equal(item.displayPath, "");
      assert.equal(item.thumbnailMissing, true);
      assert.ok(!("sourcePath" in item) && !("resultPath" in item) && !("previewPath" in item));
    }
    assert.equal(catalog.presentDraft({ ...draft, displayPath: "LOW" }).displayPath, "");
    const item = catalog.presentDraft({ ...draft, displayPath: "LOW", displayPreviewVersion: DISPLAY_VERSION });
    assert.equal(item.displayPath, "LOW");
    assert.equal(item.thumbnailMissing, false);
  }
  assert.equal(catalog.presentDraft({ mode: "compress", resultPath: "LOCAL" }).displayPath, "LOCAL");
});

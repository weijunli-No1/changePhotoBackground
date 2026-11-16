const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../mini-program/utils/tool-catalog');
const { VERSION } = require('../mini-program/utils/brand-preview');

test('证件照与考试草稿缺失水印预览时使用占位，不回退无水印结果或原图', () => {
  for (const mode of ['idphoto', 'exam']) {
    const missing = catalog.presentDraft({ id: 'draft', mode, sourcePath: 'SOURCE', resultPath: 'CLEAN' });
    assert.equal(missing.displayPath, '');
    assert.equal(missing.thumbnailMissing, true);
    const marked = catalog.presentDraft({ id: 'draft', mode, sourcePath: 'SOURCE', resultPath: 'CLEAN', previewPath: 'MARKED', previewWatermarkVersion: VERSION });
    assert.equal(marked.displayPath, 'MARKED');
    assert.equal(marked.thumbnailMissing, false);
  }
  assert.equal(catalog.presentDraft({ mode: 'compress', sourcePath: 'SOURCE', resultPath: 'LOCAL' }).displayPath, 'LOCAL');
});

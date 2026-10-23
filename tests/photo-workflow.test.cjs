const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../mini-program');
function load(file, globals = {}) {
  const filename = path.join(root, file),
    module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      module,
      exports: module.exports,
      require: createRequire(filename),
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename },
  );
  return module.exports;
}
const { cropRect } = require('../mini-program/utils/image-transform');
const { validateSize } = require('../mini-program/utils/photo-specs');
test('居中与边缘裁剪都保留比例且不越过原图', () => {
  assert.deepEqual(cropRect(1200, 800, 1), { x: 200, y: 0, width: 800, height: 800 });
  assert.deepEqual(cropRect(1200, 800, 1, 1, 0), { x: 400, y: 0, width: 800, height: 800 });
  assert.deepEqual(cropRect(800, 1200, 1, 0, -10), { x: 0, y: 0, width: 800, height: 800 });
  assert.deepEqual(cropRect(800, 1200, 0), { x: 0, y: 0, width: 800, height: 1200 });
  for (const [w, h, r] of [
    [1200, 800, 0.75],
    [800, 1200, 16 / 9],
    [400, 400, 9 / 16],
  ]) {
    const rect = cropRect(w, h, r, 0.7, 0.3);
    assert.ok(Math.abs(rect.width / rect.height - r) < 1e-9);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= w && rect.y + rect.height <= h);
  }
});
test('自定义规格拒绝无效值，避免向后端提交异常宽高', () => {
  assert.deepEqual(validateSize('295', '413'), { name: '自定义', width: 295, height: 413 });
  for (const pair of [
    ['', 413],
    [1, 413],
    [295, 3001],
    [295.2, 413],
    ['abc', 413],
    [Infinity, 413],
  ])
    assert.throws(() => validateSize(...pair));
});
function draftStore() {
  let storage = [],
    disk = new Map([
      ['tmp-source', 'SOURCE'],
      ['tmp-result', 'RESULT'],
    ]),
    failStore = false;
  const deletes = [];
  const manager = {
    mkdirSync() {},
    copyFile({ srcPath, destPath, success, fail }) {
      if (!disk.has(srcPath)) return fail(new Error('missing'));
      disk.set(destPath, disk.get(srcPath));
      success();
    },
    unlink({ filePath }) {
      disk.delete(filePath);
      deletes.push(filePath);
    },
  };
  const wx = {
    env: { USER_DATA_PATH: 'usr' },
    getStorageSync: () => storage,
    setStorageSync(key, v) {
      if (failStore) throw new Error('storage full');
      storage = v;
    },
    removeStorageSync() {
      storage = [];
    },
    getFileSystemManager: () => manager,
  };
  return {
    drafts: load('utils/drafts.js', { wx }),
    disk,
    deletes,
    failStore: () => {
      failStore = true;
    },
    storage: () => storage,
  };
}
test('草稿复制到持久目录，元数据不保存 Base64，替换结果会清理旧文件', async () => {
  const env = draftStore();
  const a = await env.drafts.save({
    id: 'done',
    mode: 'idphoto',
    sourcePath: 'tmp-source',
    resultPath: 'tmp-result',
  });
  assert.ok(a.sourcePath.startsWith('usr/shiguang-drafts/done-'));
  assert.equal(env.disk.get(a.resultPath), 'RESULT');
  env.disk.set('tmp-new', 'NEW');
  const b = await env.drafts.save({ ...a, resultPath: 'tmp-new' });
  assert.equal(b.sourcePath, a.sourcePath);
  assert.equal(env.disk.has(a.resultPath), false);
  assert.equal(env.disk.get(b.resultPath), 'NEW');
  assert.equal(JSON.stringify(env.storage()).includes('base64'), false);
});
test('磁盘或 Storage 写入失败时保留旧草稿，并清理本次副本', async () => {
  const env = draftStore();
  const a = await env.drafts.save({
    id: 'done',
    sourcePath: 'tmp-source',
    resultPath: 'tmp-result',
  });
  const before = env.disk.size;
  await assert.rejects(env.drafts.save({ ...a, sourcePath: 'missing-file' }));
  assert.equal(env.drafts.get('done').resultPath, a.resultPath);
  env.failStore();
  await assert.rejects(env.drafts.save({ ...a, resultPath: 'tmp-result' }));
  assert.equal(env.disk.size, before);
  assert.equal(env.disk.get(a.resultPath), 'RESULT');
});
test('仅保留最近8份草稿，清理不触碰源文件或登录缓存', async () => {
  const env = draftStore();
  for (let i = 0; i < 10; i++)
    await env.drafts.save({ id: 'd' + i, sourcePath: 'tmp-source', resultPath: 'tmp-result' });
  assert.equal(env.drafts.list().length, 8);
  assert.equal(env.drafts.get('d0'), undefined);
  assert.equal(env.disk.has('tmp-source'), true);
  await env.drafts.clear();
  assert.equal(env.drafts.list().length, 0);
  assert.equal(env.disk.size, 2);
});
test('同一草稿的并发保存按调用顺序落盘', async () => {
  const env = draftStore();
  env.disk.set('tmp-new', 'NEW');
  await Promise.all([
    env.drafts.save({ id: 'done', sourcePath: 'tmp-source', resultPath: 'tmp-result' }),
    env.drafts.save({ id: 'done', sourcePath: 'tmp-source', resultPath: 'tmp-new' }),
  ]);
  assert.equal(env.disk.get(env.drafts.get('done').resultPath), 'NEW');
  assert.equal(env.drafts.list().length, 1);
});
test('抠图接口仍使用原路径与 multipart 参数，并识别 Python 的业务失败', async () => {
  let options;
  const api = load('utils/api.js', {
    getApp: () => ({ globalData: { baseUrl: 'https://example.test/new-api' } }),
    wx: {
      uploadFile: (o) => {
        options = o;
        o.success({
          statusCode: 200,
          data: JSON.stringify({ code: 200, data: { status: false } }),
        });
      },
    },
  });
  await assert.rejects(api.upload('tmp-source', { width: 295, height: 413 }), /正面照片/);
  assert.equal(options.url, 'https://example.test/new-api/api/photo/generate-idphoto');
  assert.equal(options.name, 'file');
  assert.equal(options.formData.width, 295);
  assert.equal(options.formData.height, 413);
});
test('每个注册页面都采用 Skyline 和 glass-easel，所有路由文件完整', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.equal(app.renderer, 'skyline');
  assert.equal(app.componentFramework, 'glass-easel');
  for (const page of app.pages) {
    for (const ext of ['js', 'wxml', 'wxss', 'json'])
      assert.ok(fs.existsSync(path.join(root, page + '.' + ext)), page + '.' + ext);
    const config = JSON.parse(fs.readFileSync(path.join(root, page + '.json'), 'utf8'));
    assert.equal(config.renderer, 'skyline', page);
    assert.equal(config.componentFramework, 'glass-easel', page);
    assert.equal(
      fs.readFileSync(path.join(root, page + '.wxml'), 'utf8').includes('<web-view'),
      false,
    );
  }
});

test('没有有效抠图时调色不会进入永久处理中，待合成颜色会阻止提前导出', () => {
  let page;
  const filename=path.join(root,'pages/edit/edit.js');
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), {Page:p=>{page=p;},require:createRequire(filename),setTimeout,clearTimeout},{filename});
  page.data={...page.data};page.setData=data=>Object.assign(page.data,data);
  page.customColor({detail:{value:'#123456'}});
  assert.equal(page.data.processing,false);
  page._transparent='valid-image';
  page.customColor({detail:{value:'#123456'}});
  assert.equal(page.data.processing,true);
  clearTimeout(page._colorTimer);
});

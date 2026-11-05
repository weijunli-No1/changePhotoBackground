const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(name, { files = {}, drafts = {}, wx = {}, api = {} } = {}) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../mini-program/pages/${name}/${name}.js`), 'utf8'), {
    Page: value => { definition = value; }, wx,
    getApp: () => ({ globalData: {}, appConfigReady: Promise.resolve() }),
    require: name => {
      if (name.endsWith('/files')) return files;
      if (name.endsWith('/drafts')) return drafts;
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/image-transform')) return {};
      throw Error(name);
    },
  });
  return { ...definition, data: structuredClone(definition.data), setData(values, callback) {
    Object.assign(this.data, values);
    if (callback) callback();
  } };
}

test('工具更换图片失败保留现有照片、结果和草稿；成功读取新图后才重置裁剪', async () => {
  let fail = true;
  const p = load('tools', {
    files: {
      call: async () => { if (fail) throw Error('bad image'); return { width: 900, height: 1200 }; },
      fileSize: async () => 3000, formatBytes: () => '3 KB',
    },
    drafts: { createId: () => 'dnew' },
  });
  p._draftId = 'dold';
  p.setData({ sourcePath: 'OLD', resultPath: 'RESULT', displayPath: 'RESULT', ratio: 1, angle: 90, positionX: 20 });
  await p.loadSource('BROKEN', true);
  assert.equal(p.data.sourcePath, 'OLD');
  assert.equal(p.data.resultPath, 'RESULT');
  assert.equal(p.data.displayPath, 'RESULT');
  assert.equal(p.data.ratio, 1);
  assert.equal(p.data.angle, 90);
  assert.equal(p._draftId, 'dold');
  assert.match(p.data.error, /已保留/);
  assert.equal(p.data.processing, false);
  fail = false;
  await p.loadSource('NEW', true);
  assert.equal(p.data.sourcePath, 'NEW');
  assert.equal(p.data.resultPath, '');
  assert.equal(p.data.ratio, 0);
  assert.equal(p.data.angle, 0);
  assert.equal(p.data.positionX, 50);
  assert.equal(p._draftId, 'dnew');
});

test('工具选图取消不清空结果，退出后迟到的读取不更新页面', async () => {
  let resolve;
  const p = load('tools', {
    files: {
      call: method => method === 'chooseMedia'
        ? Promise.reject({ errMsg: 'chooseMedia:fail cancel' })
        : new Promise(r => { resolve = r; }),
      fileSize: async () => 100,
    },
  });
  p.setData({ sourcePath: 'OLD', resultPath: 'RESULT', angle: 90 });
  await p.choosePhoto();
  assert.equal(p.data.resultPath, 'RESULT');
  assert.equal(p.data.error, '');
  assert.equal(p._choosing, false);
  const pending = p.loadSource('NEW', true);
  p._unloaded = true;
  resolve({ width: 10, height: 10 });
  await pending;
  assert.equal(p.data.sourcePath, 'OLD');
  assert.equal(p.data.angle, 90);
});

test('用于制作证件照与保存入口互斥，失败解锁可重试，退出后不导航', async () => {
  const navigation = [];
  const p = load('tools', { wx: { navigateTo: args => navigation.push(args) } });
  p.setData({ sourcePath: 'SOURCE', resultPath: 'RESULT' });
  p.makeIdPhoto();
  p.makeIdPhoto();
  await p.goExport();
  assert.equal(navigation.length, 1);
  assert.equal(p.data.opening, true);
  navigation[0].fail();
  navigation[0].complete();
  assert.match(p.data.openingError, /重试/);
  assert.equal(p.data.opening, false);
  p.makeIdPhoto();
  assert.equal(navigation.length, 2);
  assert.equal(p.data.openingError, '');
  p._unloaded = true;
  navigation[1].complete();
  p.makeIdPhoto();
  assert.equal(navigation.length, 2);
});

test('水印草稿区分原图失效与结果失效，保留可用原图并刷新预览', async () => {
  for (const broken of ['SOURCE', 'RESULT']) {
    const p = load('watermark', {
      files: { call: async (_method, args) => { if (args.src === broken) throw Error('missing'); } },
      drafts: { get: () => ({ mode: 'watermark', sourcePath: 'SOURCE', resultPath: 'RESULT', width: 400, height: 600, toolState: { text: '仅供报名' } }) },
    });
    let previews = 0;
    p.updatePreview = () => previews++;
    await p.onLoad({ draft: 'dexisting' });
    assert.equal(p.data.resultPath, '');
    assert.equal(p.data.sourcePath, broken === 'SOURCE' ? '' : 'SOURCE');
    assert.match(p.data.error, broken === 'SOURCE' ? /重新选图/ : /重新生成/);
    if (broken === 'RESULT') {
      assert.equal(p.data.text, '仅供报名');
      assert.equal(previews, 1);
    }
  }
});

test('两个工具空态主按钮可选图；水印选图期间不能生成或导出旧照片', async () => {
  for (const name of ['tools', 'watermark']) {
    const p = load(name);
    let choices = 0;
    p.choosePhoto = () => choices++;
    p.primary();
    assert.equal(choices, 1);
  }
  const p = load('watermark');
  p._choosing = true;
  p.setData({ sourcePath: 'OLD', resultPath: 'RESULT', serviceReady: true, checkingService: false });
  // 若错误地进入接口或草稿保存，此处无 stub 会直接失败。
  await p.generate();
  await p.goExport();
  assert.equal(p.data.processing, false);
  assert.equal(p.data.opening, false);
  assert.equal(p.data.resultPath, 'RESULT');
});

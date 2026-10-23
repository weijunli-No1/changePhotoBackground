const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createRewardedVideoPlayer } = require('../mini-program/utils/rewarded-video');

const AD_ID = 'adunit-8643a04d0caed362';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function mockSdk(options = {}) {
  const instances = [];
  const wx = {
    createRewardedVideoAd({ adUnitId }) {
      const close = new Set();
      const error = new Set();
      const instance = {
        adUnitId,
        shows: 0,
        loads: 0,
        destroyed: false,
        show() {
          this.shows += 1;
          return options.show ? options.show(this.shows) : Promise.resolve();
        },
        load() {
          this.loads += 1;
          return options.load ? options.load() : Promise.resolve();
        },
        onClose: (fn) => close.add(fn),
        offClose: (fn) => close.delete(fn),
        onError: (fn) => error.add(fn),
        offError: (fn) => error.delete(fn),
        close: (result) => [...close].forEach((fn) => fn(result)),
        error: (result) => [...error].forEach((fn) => fn(result)),
        destroy() {
          this.destroyed = true;
        },
        listenerCount: () => close.size + error.size,
      };
      instances.push(instance);
      return instance;
    },
  };
  return { wx, instances };
}

test('缺失或占位广告位不会调用广告 SDK', async () => {
  const sdk = mockSdk();
  const player = createRewardedVideoPlayer(sdk.wx);
  for (const id of ['', 'your_ad_unit_id', undefined]) {
    await assert.rejects(player.play(id), /广告暂未开放/);
  }
  assert.equal(sdk.instances.length, 0);
  player.dispose();
});

test('仅完整观看返回奖励资格，提前关闭不奖励，实例可以再次播放', async () => {
  const sdk = mockSdk();
  const player = createRewardedVideoPlayer(sdk.wx);
  for (const [result, expected] of [
    [{ isEnded: false }, false],
    [undefined, false],
    [{ isEnded: true }, true],
  ]) {
    const playback = player.play(AD_ID);
    await flush();
    sdk.instances[0].close(result);
    assert.equal(await playback, expected);
  }
  assert.equal(sdk.instances.length, 1);
  assert.equal(sdk.instances[0].listenerCount(), 2);
  player.dispose();
  assert.equal(sdk.instances[0].listenerCount(), 0);
});

test('首次展示失败后加载重试，不重复奖励', async () => {
  const sdk = mockSdk({
    show: (count) => (count === 1 ? Promise.reject({ errCode: 1004 }) : Promise.resolve()),
  });
  const player = createRewardedVideoPlayer(sdk.wx);
  const playback = player.play(AD_ID);
  await flush();
  assert.equal(sdk.instances[0].shows, 2);
  assert.equal(sdk.instances[0].loads, 1);
  sdk.instances[0].close({ isEnded: true });
  sdk.instances[0].close({ isEnded: true });
  assert.equal(await playback, true);
  player.dispose();
});

test('无广告库存时结束流程，允许后续重试', async () => {
  const sdk = mockSdk({
    show: () => Promise.reject({ errCode: 1004 }),
    load: () => Promise.reject({ errCode: 1004 }),
  });
  const player = createRewardedVideoPlayer(sdk.wx);
  await assert.rejects(player.play(AD_ID), /暂无可用广告/);
  await assert.rejects(player.play(AD_ID), /暂无可用广告/);
  player.dispose();
});

test('展示期间错误不会奖励，并发播放被拒绝', async () => {
  const sdk = mockSdk();
  const player = createRewardedVideoPlayer(sdk.wx);
  const playback = player.play(AD_ID);
  await assert.rejects(player.play(AD_ID), /广告正在播放/);
  await flush();
  sdk.instances[0].error({ errCode: 1004 });
  await assert.rejects(playback, /暂无可用广告/);
  player.dispose();
});

test('页面立即退出时不再展示广告，并移除全部监听', async () => {
  const sdk = mockSdk();
  const player = createRewardedVideoPlayer(sdk.wx);
  const playback = player.play(AD_ID);
  player.dispose();
  assert.equal(await playback, false);
  await flush();
  assert.equal(sdk.instances[0].shows, 0);
  assert.equal(sdk.instances[0].listenerCount(), 0);
  assert.equal(sdk.instances[0].destroyed, true);
});

test('加载重试期间退出不会再次展示广告', async () => {
  let finishLoad;
  const sdk = mockSdk({
    show: () => Promise.reject(new Error('not loaded')),
    load: () =>
      new Promise((resolve) => {
        finishLoad = resolve;
      }),
  });
  const player = createRewardedVideoPlayer(sdk.wx);
  const playback = player.play(AD_ID);
  await flush();
  player.dispose();
  finishLoad();
  assert.equal(await playback, false);
  await flush();
  assert.equal(sdk.instances[0].shows, 1);
});

function editPage({
  action = 'single',
  confirm = true,
  adId = AD_ID,
  rewardCode = 200,
  limited = true,
  mode = 'idphoto',
  login = true,
} = {}) {
  const sdk = mockSdk();
  const calls = [];
  const saved = [];
  const toasts = [];
  let saveRequests = 0;
  const wx = Object.assign(sdk.wx, {
    showLoading() {},
    hideLoading() {},
    navigateBack() {},
    showToast: (value) => toasts.push(value.title),
    showModal: (options) => options.success({ confirm }),
    request(options) {
      const route = new URL(options.url).pathname;
      calls.push({ route, data: options.data });
      let data;
      if (route === '/api/user/recordAd') data = { code: rewardCode, message: '奖励记录失败' };
      else {
        saveRequests += 1;
        data =
          limited && saveRequests === 1
            ? { code: 4031 }
            : { code: 200, data: { image_base64: 'LAYOUT' } };
      }
      options.success({ statusCode: 200, data });
    },
  });
  const app = {
    globalData: {
      openid: 'test-user',
      baseUrl: 'https://example.test',
      exportSession: {
        mode,
        resultPath: 'ORIGINAL_PATH',
        width: 295,
        height: 413,
        bgColor: '#FFFFFF',
      },
    },
    ensureLogin: async () => login,
    getRewardedVideoAdUnitId: async () => adId,
  };
  let definition;
  const filename = path.resolve(__dirname, '../mini-program/pages/export/export.js');
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      wx,
      getApp: () => app,
      Page: (value) => {
        definition = value;
      },
      require: (name) => {
        if (name === '../../utils/api')
          return {
            request: (route, options = {}) =>
              new Promise((resolve) =>
                wx.request({
                  url: 'https://example.test' + route,
                  ...options,
                  success: (res) => resolve(res.data),
                }),
              ),
            unwrap: (result) => {
              if (result.code !== 200) throw new Error(result.message || '保存失败');
              return result.data;
            },
          };
        if (name === '../../utils/files')
          return {
            call: async () => ({ width: 295, height: 413 }),
            readBase64: async () => 'ORIGINAL',
            writeBase64: async () => 'LAYOUT_PATH',
            removeTemp() {},
          };
        return createRequire(filename)(name);
      },
      setTimeout,
      clearTimeout,
      console,
    },
    { filename },
  );
  const page = Object.assign({}, definition, { data: structuredClone(definition.data) });
  page.setData = (value) => Object.assign(page.data, value);
  page.fetchUsage = async () => {};
  page.showAdDialog = async () => confirm;
  page.onLoad({});
  page.saveToAlbum = async (value) => {
    saved.push(value);
  };
  const start = () => (action === 'layout' ? page.savePrintLayout() : page.savePhoto());
  return { page, app, sdk, calls, saved, toasts, start };
}

for (const action of ['single', 'layout']) {
  test(`${action} 完整观看只记一次奖励，重试原操作与原图片`, async () => {
    const env = editPage({ action });
    const saving = env.start();
    await flush();
    await env.start(); // 重复点击不产生第二条保存或广告流程。
    env.page._session = { ...env.page._session, resultPath: 'CHANGED' };
    env.sdk.instances[0].close({ isEnded: true });
    env.sdk.instances[0].close({ isEnded: true });
    await saving;
    const route = action === 'layout' ? '/api/photo/generate-layout' : '/api/history/save';
    assert.deepEqual(
      env.calls.map((call) => call.route),
      [route, '/api/user/recordAd', route],
    );
    assert.equal(env.calls[2].data.base64Image, 'ORIGINAL');
    assert.deepEqual(env.saved, [action === 'layout' ? 'LAYOUT_PATH' : 'ORIGINAL_PATH']);
    env.page.onUnload();
  });
}

test('未超限的保存不会拉广告或记录奖励', async () => {
  const env = editPage({ limited: false });
  await env.start();
  assert.equal(env.sdk.instances.length, 0);
  assert.equal(env.calls.length, 1);
  assert.deepEqual(env.saved, ['ORIGINAL_PATH']);
  env.page.onUnload();
});

for (const reason of ['cancel', 'incomplete', 'missing-id', 'reward-failed', 'unload']) {
  test(`${reason} 不重试保存、不错误发奖`, async () => {
    const env = editPage({
      confirm: reason !== 'cancel',
      adId: reason === 'missing-id' ? '' : AD_ID,
      rewardCode: reason === 'reward-failed' ? 500 : 200,
    });
    const saving = env.start();
    await flush();
    if (reason === 'unload') env.page.onUnload();
    else if (env.sdk.instances.length)
      env.sdk.instances[0].close({ isEnded: reason === 'reward-failed' });
    await saving;
    assert.equal(env.calls.length, reason === 'reward-failed' ? 2 : 1);
    assert.deepEqual(env.saved, []);
    assert.equal(env.page._saveInProgress, false);
    env.page.onUnload();
  });
}

test('远程广告位加载完成后才读取，失败或占位值使用本地备用 ID', async () => {
  const filename = path.resolve(__dirname, '../mini-program/app.js');
  let app;
  let configRequest;
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      App: (value) => {
        app = value;
      },
      require: (name) =>
        name === './utils/files' ? { clearTransientImages() {} } : createRequire(filename)(name),
      wx: {
        getStorageSync: () => '',
        request: (options) => {
          configRequest = options;
        },
      },
    },
    { filename },
  );
  app.globalData.rewardedVideoAdUnitIdOverride = '';
  app.globalData.defaultRewardedVideoAdUnitId = AD_ID;
  app.onLaunch();
  let resolved = false;
  const ready = app.getRewardedVideoAdUnitId().then((value) => {
    resolved = true;
    return value;
  });
  await flush();
  assert.equal(resolved, false);
  configRequest.success({
    data: { code: 200, data: { rewardedVideoAdUnitId: 'adunit-remote123' } },
  });
  configRequest.complete();
  assert.equal(await ready, 'adunit-remote123');
  app.globalData.rewardedVideoAdUnitId = 'your_ad_unit_id';
  assert.equal(await app.getRewardedVideoAdUnitId(), AD_ID);
  app.globalData.rewardedVideoAdUnitId = '';
  assert.equal(await app.getRewardedVideoAdUnitId(), AD_ID);
});

test('本版本广告位优先于服务器旧配置', async () => {
  const filename = path.resolve(__dirname, '../mini-program/app.js');
  let app;
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      App: (value) => {
        app = value;
      },
      require: createRequire(filename),
    },
    { filename },
  );
  app.globalData.rewardedVideoAdUnitId = 'adunit-old-server';
  assert.equal(await app.getRewardedVideoAdUnitId(), AD_ID);
});

test('本地工具保存不要求登录、不请求云端和广告', async () => {
  const env = editPage({ mode: 'compress', login: false });
  await env.start();
  assert.equal(env.calls.length, 0);
  assert.equal(env.sdk.instances.length, 0);
  assert.deepEqual(env.saved, ['ORIGINAL_PATH']);
  env.page.onUnload();
});
test('取消登录保留作品，不发起云端保存', async () => {
  const env = editPage({ login: false });
  await env.start();
  assert.equal(env.calls.length, 0);
  assert.deepEqual(env.saved, []);
  assert.equal(env.page._session.resultPath, 'ORIGINAL_PATH');
  env.page.onUnload();
});
test('相册失败后重试不重复扣除云端保存额度', async () => {
  const env = editPage({ limited: false });
  let attempts = 0;
  env.page.saveToAlbum = async () => {
    if (++attempts === 1) throw new Error('权限被拒绝');
  };
  await env.start();
  assert.equal(env.calls.length, 1);
  assert.equal(env.page.data.saved, false);
  await env.start();
  assert.equal(env.calls.length, 1);
  assert.equal(env.page.data.saved, true);
  assert.equal(attempts, 2);
  env.page.onUnload();
});

for (const action of ['single', 'layout']) {
  test(`${action} 同一导出页反复下载成功结果，不重复扣保存次数或新增历史`, async () => {
    const env = editPage({ action, limited: false });
    await env.start();
    await env.start();
    assert.equal(env.calls.length, 1);
    assert.equal(env.saved.length, 2);
    assert.equal(env.saved[0], env.saved[1]);
    env.page.selectAction({ currentTarget: { dataset: { action: action === 'single' ? 'layout' : 'single' } } });
    await env.page.saveCurrent();
    assert.equal(env.calls.length, 2);
    env.page.selectAction({ currentTarget: { dataset: { action } } });
    await env.page.saveCurrent();
    assert.equal(env.calls.length, 2);
    env.page.onUnload();
  });
}


test('已缓存的云端下载结果不跨登录账号复用', async () => {
  const env = editPage({ limited: false });
  await env.start();
  env.app.globalData.openid = 'second-user';
  await env.start();
  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[0].data.openid, 'test-user');
  assert.equal(env.calls[1].data.openid, 'second-user');
  env.page.onUnload();
});

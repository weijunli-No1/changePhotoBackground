const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, "../mini-program", file);
  const requireLocal = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => { definition = value; },
    Component: (value) => { definition = value; },
    getApp: () => ({ globalData: {} }),
    require: requireLocal,
    setTimeout, clearTimeout,
    ...overrides,
  });
  const page = {
    ...definition, ...(definition.methods || {}),
    data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); callback?.(); },
  };
  return { page, definition };
}

test("完整规格目录沿用当前二寸/自定义规格，未改动确认仍回传原规格和考试规则", async () => {
  const { page } = load("pages/specs/specs.js", { wx: { navigateBack() {} } });
  let selected;
  page.getOpenerEventChannel = () => ({ emit: (_name, value) => { selected = value.size; } });
  page.onLoad({ select: "1", width: "413", height: "579", name: "二寸" });
  assert.equal(page.data.selectedSize.name, "二寸");
  await page.confirmSelection();
  assert.equal(selected.width, 413);
  assert.equal(selected.height, 579);
  const other = load("pages/specs/specs.js", { wx: { navigateBack() {} } }).page;
  other.getOpenerEventChannel = () => ({ emit: (_name, value) => { selected = value.size; } });
  other.onLoad({ select: "1", width: "600", height: "800", name: "考研报名照片", spec: "postgraduate" });
  await other.confirmSelection();
  assert.equal(selected.specId, "postgraduate");
});

test("编辑打开规格目录携带当前规格和底色工具上下文，不重选照片", () => {
  let url;
  const { page } = load("pages/edit/edit.js", { wx: { navigateTo: (options) => { url = options.url; } } });
  page.setData({ toolId: "background", sourcePath: "existing-photo", size: { name: "二寸", width: 413, height: 579 } });
  page.browseSpecs();
  const query = new URLSearchParams(url.split("?")[1]);
  assert.equal(query.get("select"), "1");
  assert.equal(query.get("width"), "413");
  assert.equal(query.get("tool"), "background");
  assert.equal(query.get("name"), "二寸");
});

test("换底色经完整目录选图后仍进入底色工具，丢失的相册文件路径不会进入编辑页", async () => {
  let media = { tempFiles: [{ tempFilePath: "demo.jpg" }] };
  const urls = [];
  const { page } = load("pages/specs/specs.js", {
    require: (name) => name.endsWith("/files") ? { call: async (method, options) => {
      if (method === "chooseMedia") return media;
      urls.push(options.url);
    } } : require("../mini-program/utils/photo-specs"),
  });
  page.onLoad({ tool: "background" });
  await page.confirmSelection();
  assert.match(urls[0], /tool=background/);
  media = { tempFiles: [{}] };
  await page.confirmSelection();
  assert.equal(urls.length, 1);
  assert.match(page.data.error, /读取照片/);
  assert.equal(page.data.choosing, false);
});

test("规格应用连点只派发一次，导航失败可重试，无效尺寸不派发事件", async () => {
  let navigation, count = 0;
  const { page } = load("pages/specs/specs.js", { wx: { navigateBack: (options) => { navigation = options; } } });
  page.getOpenerEventChannel = () => ({ emit: () => { count++; } });
  page.onLoad({ select: "1" });
  await page.confirmSelection();
  await page.confirmSelection();
  assert.equal(count, 1);
  navigation.fail();
  await page.confirmSelection();
  assert.equal(count, 2);
  navigation.fail();
  await page.selectCustom({ detail: { width: 0, height: 413 } });
  assert.equal(count, 2);
  assert.match(page.data.error, /100/);
});

test("考试规格详情连点不会连续返回两次", async () => {
  let events = 0, navigations = 0;
  const { page } = load("pages/spec-detail/spec-detail.js", { wx: { navigateBack() { navigations++; } } });
  page.getOpenerEventChannel = () => ({ emit() { events++; } });
  page.onLoad({ id: "postgraduate", select: "1" });
  await page.start();
  await page.start();
  assert.equal(events, 1);
  assert.equal(navigations, 1);
});

test("返回编辑连点只退一页；保存中和无排版能力时禁止更换格式", () => {
  let navigations = 0, complete;
  const { page } = load("pages/export/export.js", {
    wx: { navigateBack(options) { navigations++; complete = options.complete; } },
  });
  page.returnToEdit(); page.returnToEdit();
  assert.equal(navigations, 1);
  complete(); page.returnToEdit();
  assert.equal(navigations, 2);
  page.setData({ busy: true });
  page.selectAction({ currentTarget: { dataset: { action: "layout" } } });
  assert.equal(page.data.action, "single");
  page.setData({ busy: false, allowLayout: false });
  page.selectAction({ currentTarget: { dataset: { action: "layout" } } });
  assert.equal(page.data.action, "single");
});

test("缓存的隐藏导航栏不覆盖当前页状态栏，主题切换使用事件的最新主题", () => {
  const listeners = [], colors = [];
  const wx = {
    onThemeChange: (handler) => listeners.push(handler), offThemeChange() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getAppBaseInfo: () => ({ theme: "light" }),
    setNavigationBarColor: (value) => colors.push(value),
  };
  const normal = load("components/navigation-bar/index.js", { wx });
  normal.page.properties = { inverse: false };
  normal.definition.lifetimes.attached.call(normal.page);
  const hidden = load("components/navigation-bar/index.js", { wx });
  hidden.page.properties = { inverse: true };
  hidden.definition.lifetimes.attached.call(hidden.page);
  normal.definition.pageLifetimes.show.call(normal.page);
  hidden.definition.pageLifetimes.hide.call(hidden.page);
  colors.length = 0;
  listeners.forEach((callback) => callback({ theme: "dark" }));
  assert.equal(colors.length, 1);
  assert.equal(colors[0].frontColor, "#ffffff");
  assert.equal(colors[0].backgroundColor, "#121212");
});

test("本地图标保留TDesign字形和单位，颜色变化不丢失选中标记", () => {
  const { page, definition } = load("components/local-icon/index.js");
  page.setData({ name: "check-circle-filled", size: "38rpx", color: "var(--sg-brand)" });
  definition.observers["name, size, color"].call(page);
  const glyph = page.data.glyph;
  assert.equal(glyph, require("../mini-program/components/local-icon/glyphs")["check-circle-filled"]);
  assert.match(page.data.iconStyle, /font-size:38rpx/);
  page.setData({ color: "#ffffff", size: 24 });
  definition.observers["name, size, color"].call(page);
  assert.equal(page.data.glyph, glyph);
  assert.match(page.data.iconStyle, /font-size:24px/);
});

test("编辑页选图互斥、退出后迟到失败不提示，裁剪导航失败可重试", async () => {
  let rejectChoice, choices = 0, toasts = 0;
  const actual = createRequire(path.resolve(__dirname, '../mini-program/pages/edit/edit.js'));
  const { page } = load('pages/edit/edit.js', {
    wx: { showToast() { toasts++; } },
    require: n => n.endsWith('/files') ? { call: () => { choices++; return new Promise((_, reject) => { rejectChoice = reject; }); } } : actual(n),
  });
  const pending = page.reselect();
  await page.reselect();
  assert.equal(choices, 1);
  page._unloaded = true;
  rejectChoice(Error('failed'));
  await pending;
  assert.equal(toasts, 0);
  assert.equal(page._choosing, false);
  let requests = [];
  const p = load('pages/edit/edit.js', { wx: { navigateTo: o => requests.push(o) } }).page;
  p.data.sourcePath = 'current';
  p.adjustPhoto(); p.adjustPhoto();
  assert.equal(requests.length, 1);
  requests[0].fail(); requests[0].complete();
  assert.match(p.data.openingError, /裁剪页/);
  p.adjustPhoto();
  assert.equal(requests.length, 2);
  assert.equal(p.data.openingError, '');
});

test("顶部返回连点只退一页，失败完成后允许再操作", () => {
  let pending, calls = 0, homes = 0;
  const { page } = load('components/navigation-bar/index.js', { wx: {
    navigateBack: o => { calls++; pending = o; }, switchTab: () => homes++,
  }});
  page.goBack(); page.goBack();
  assert.equal(calls, 1);
  pending.fail(); pending.complete();
  assert.equal(homes, 1);
  page.goBack();
  assert.equal(calls, 2);
});

test("保存预览准备期间即使保留旧预览也不触发云保存或相册写入", async () => {
  const { page } = load('pages/export/export.js');
  page.setData({ previewPath: 'old-preview', previewPreparing: true });
  page._session = { resultPath: 'photo' };
  let saves = 0;
  page.saveCurrent = () => saves++;
  page.saveToAlbum = async () => saves++;
  page.primaryAction();
  await page.saveImage('single');
  assert.equal(saves, 0);
  assert.equal(page.data.busy, false);
});

test("权益同步失败退出加载态，点击重试可恢复且并发请求只发送一次", async () => {
  let attempts = 0, rejectFirst;
  const actual = createRequire(path.resolve(__dirname, '../mini-program/pages/export/export.js'));
  const { page } = load('pages/export/export.js', { require: n => n.endsWith('/membership') ? {
    refresh: () => { attempts++; return attempts === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve({ isLifetimeMember: false, unlimitedSaves: false }); },
  } : actual(n) });
  const pending = page.refreshMembership();
  await page.refreshMembership();
  assert.equal(attempts, 1);
  assert.equal(page.data.memberLoading, true);
  rejectFirst(Error('offline')); await pending;
  assert.equal(page.data.memberKnown, false);
  assert.equal(page.data.memberLoading, false);
  await page.retryMembership();
  assert.equal(attempts, 2);
  assert.equal(page.data.memberKnown, true);
  assert.equal(page.data.memberLoading, false);
});

test('个人中心会员查询失败退出加载，重新进入可恢复，离开后不回写', async () => {
  let attempts = 0, settle;
  const actual = createRequire(path.resolve(__dirname, '../mini-program/pages/profile/profile.js'));
  const { page } = load('pages/profile/profile.js', { require: n => n.endsWith('/membership') ? {
    refresh: () => { attempts++; return new Promise((resolve, reject) => { settle = { resolve, reject }; }); },
  } : actual(n) });
  page.loadIdentity = page.fetchUsage = () => {};
  const first = page.refreshMembership();
  await page.refreshMembership();
  assert.equal(attempts, 1);
  assert.equal(page.data.memberLoading, true);
  settle.reject(Error('offline')); await first;
  assert.equal(page.data.memberLoading, false);
  assert.equal(page.data.memberKnown, false);
  const second = page.refreshMembership();
  settle.resolve({ isLifetimeMember: true }); await second;
  assert.equal(page.data.memberKnown, true);
  assert.equal(page.data.isLifetimeMember, true);
  const third = page.refreshMembership();
  page._unloaded = true;
  settle.resolve({ isLifetimeMember: false }); await third;
  assert.equal(page.data.isLifetimeMember, true);
});

test('继续编辑草稿防重复导航，导航失败可重试，已删除草稿给出恢复提示', () => {
  let item = { id: 'draft' }, routes = [];
  const actual = createRequire(path.resolve(__dirname, '../mini-program/pages/history/history.js'));
  const { page } = load('pages/history/history.js', {
    wx: { navigateTo: o => routes.push(o) },
    require: n => n.endsWith('/drafts') ? { get: () => item, list: () => [] } : n.endsWith('/tool-catalog') ? { draftUrl: () => '/pages/edit/edit?draft=draft', presentDraft: d => d } : actual(n),
  });
  const event = { currentTarget: { dataset: { id: 'draft' } } };
  page.resume(event); page.resume(event);
  assert.equal(routes.length, 1);
  routes[0].fail(); routes[0].complete();
  assert.match(page.data.error, /重试/);
  page.resume(event);
  assert.equal(routes.length, 2);
  routes[1].complete(); item = null;
  page.resume(event);
  assert.match(page.data.error, /不存在/);
  assert.equal(page.data.drafts.length, 0);
});

test('会员状态已同步但保存额度失败时，点击重试仍会重新请求真实额度', async () => {
  const app = { globalData: { openid: 'owner', sessionToken: 'token' } };
  let requests = 0;
  const actual = createRequire(path.resolve(__dirname, '../mini-program/pages/export/export.js'));
  const { page } = load('pages/export/export.js', {
    getApp: () => app,
    require: n => n.endsWith('/api') ? {
      request: async route => {
        assert.equal(route, '/api/user/usage');
        if (++requests === 1) throw Error('offline');
        return { saveCount: 3, adViewCount: 0, isLifetimeMember: false };
      },
      unwrap: value => value,
    } : actual(n),
  });
  page.setData({ memberKnown: true });
  await page.fetchUsage();
  assert.equal(page.data.quotaKnown, false);
  await page.retryMembership();
  assert.equal(requests, 2);
  assert.equal(page.data.quotaKnown, true);
  assert.equal(page.data.remaining, 2);
});

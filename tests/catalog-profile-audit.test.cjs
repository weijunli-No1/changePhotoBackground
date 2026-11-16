const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function pageFixture(file, deps = {}, wx = {}, app = { globalData: {} }) {
  const filename = path.resolve(__dirname, "../mini-program/pages", file);
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (value) => { definition = value; },
    require: (name) => deps[name.split("/").pop()] || localRequire(name),
    getApp: () => app,
    wx,
  });
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(values) { Object.assign(this.data, values); },
  };
}

test("打开分享的考试页可直接选择原照，取消后仍可重试，选择成功后继续适配", async () => {
  let choices = 0, processes = 0;
  const page = pageFixture("exam/exam.js", {
    drafts: { createId: () => "draft" },
    files: {
      call: async (method) => {
        assert.equal(method, "chooseMedia");
        if (++choices === 1) throw { errMsg: "chooseMedia:fail cancel" };
        return { tempFiles: [{ tempFilePath: "selected.jpg" }] };
      },
    },
  });
  await page.onLoad({ spec: "cpa" });
  page.process = async () => { processes++; };
  assert.equal(page.data.sourcePath, "");
  await page.choosePhoto();
  assert.equal(page.data.error, "");
  await page.choosePhoto();
  assert.equal(page.data.sourcePath, "selected.jpg");
  assert.equal(processes, 1);
  const template = fs.readFileSync(path.resolve(__dirname, "../mini-program/pages/exam/exam.wxml"), "utf8");
  assert.match(template, /wx:else class="exam-empty"/);
  assert.match(template, /wx:if="\{\{spec && sourcePath\}\}" class="footer-actions"/);
});

test("考试规格失效不打开相册，可重新选择规格，导航失败可重试且不重复进入", async () => {
  const calls = [];
  let complete;
  const page = pageFixture("exam/exam.js", {
    drafts: { createId: () => "draft" },
    files: {
      call: (method, options) => {
        calls.push({ method, options });
        return new Promise((resolve, reject) => { complete = { resolve, reject }; });
      },
    },
  });
  await page.onLoad({ spec: "missing" });
  await page.choosePhoto();
  assert.equal(calls.length, 0);
  const first = page.openSpecs();
  await page.openSpecs();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "redirectTo");
  assert.equal(calls[0].options.url, "/pages/specs/specs");
  complete.reject(Error("navigation failed"));
  await first;
  assert.match(page.data.error, /规格页未能打开/);
  const retry = page.openSpecs();
  assert.equal(calls.length, 2);
  complete.resolve();
  await retry;
  page.onUnload();
  await page.openSpecs();
  assert.equal(calls.length, 2);
});

test("复制官方来源失败显示可重试提示，复制期间防止重复调用，退出后不弹迟到提示", async () => {
  let complete, copies = 0, toasts = 0;
  const page = pageFixture("spec-detail/spec-detail.js", {
    files: { call: () => {
      copies++;
      return new Promise((resolve, reject) => { complete = { resolve, reject }; });
    } },
  }, { showToast: () => { toasts++; } });
  page.onLoad({ id: "cpa" });
  const first = page.source();
  await page.source();
  assert.equal(copies, 1);
  complete.reject(Error("clipboard failed"));
  await first;
  assert.match(page.data.error, /未能复制/);
  assert.equal(page.data.copyingSource, false);
  const retry = page.source();
  complete.resolve();
  await retry;
  assert.equal(page.data.error, "");
  assert.equal(toasts, 1);
  const last = page.source();
  page.onUnload();
  complete.resolve();
  await last;
  assert.equal(toasts, 1);
});

test("资料保存完成前切换账号，不覆盖新账号资料或返回页面", async () => {
  let finish, returned = 0, toasted = 0;
  const app = { globalData: { openid: "old", userInfo: { openid: "old" } } };
  const page = pageFixture("account/account.js", {
    "user-profile": {
      get: () => null,
      normalizeNickname: (value) => value,
      save: () => new Promise((resolve) => { finish = resolve; }),
    },
  }, { showToast: () => { toasted++; }, navigateBack: () => { returned++; } }, app);
  page.onLoad();
  const pending = page.submit({ detail: { value: { nickname: "旧账号昵称" } } });
  app.globalData.openid = "new";
  app.globalData.userInfo = { openid: "new", nickname: "新账号昵称" };
  finish({ nickname: "旧账号昵称", avatarUrl: "old-avatar" });
  await pending;
  assert.equal(app.globalData.userInfo.nickname, "新账号昵称");
  assert.equal(returned, 0);
  assert.equal(toasted, 0);
  assert.equal(page.data.ownerValid, false);
  assert.equal(page.data.saving, false);
  assert.match(page.data.error, /登录状态已变化/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function store() {
  let storage = {},
    failStore = false,
    failCopy = false;
  const disk = new Map([
    ["wx-temp-avatar", "AVATAR"],
    ["wx-new-avatar", "NEW"],
  ]);
  const manager = {
    mkdirSync() {},
    accessSync(p) {
      if (!disk.has(p)) throw Error("missing");
    },
    copyFile(o) {
      if (failCopy || !disk.has(o.srcPath)) return o.fail(Error("copy failed"));
      disk.set(o.destPath, disk.get(o.srcPath));
      o.success();
    },
    unlink(o) {
      disk.delete(o.filePath);
    },
  };
  const wx = {
    env: { USER_DATA_PATH: "usr" },
    getStorageSync: () => storage,
    setStorageSync(k, v) {
      if (failStore) throw Error("storage full");
      storage = v;
    },
    getFileSystemManager: () => manager,
  };
  const filename = path.resolve(
    __dirname,
    "../mini-program/utils/user-profile.js",
  );
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      wx,
      require: () => ({
        call: async (method, o) => ({ type: "jpg", path: o.src }),
      }),
    },
    { filename },
  );
  return {
    profiles: module.exports,
    disk,
    wx,
    failStore(v) {
      failStore = v;
    },
    failCopy(v) {
      failCopy = v;
    },
  };
}
test("头像复制到持久目录，按账号恢复昵称头像，替换时仅清理旧头像", async () => {
  const e = store();
  const one = await e.profiles.save("alice", {
    nickname: "小相",
    avatarUrl: "wx-temp-avatar",
  });
  assert.match(one.avatarUrl, /usr\/shiguang-profiles\/avatar-/);
  assert.equal(e.disk.get(one.avatarUrl), "AVATAR");
  assert.equal(e.profiles.get("alice").nickname, "小相");
  assert.equal(e.profiles.get("bob"), null);
  const two = await e.profiles.save("alice", {
    nickname: "新昵称",
    avatarUrl: "wx-new-avatar",
  });
  assert.equal(e.disk.has(one.avatarUrl), false);
  assert.equal(e.disk.get(two.avatarUrl), "NEW");
  assert.equal(e.disk.has("wx-temp-avatar"), true);
  await e.profiles.save("bob", { nickname: "另一用户", avatarUrl: "" });
  assert.equal(e.profiles.get("alice").nickname, "新昵称");
  assert.equal(e.profiles.get("bob").nickname, "另一用户");
});
test("头像复制或元数据保存失败时，保留旧资料并清理新副本", async () => {
  const e = store(),
    one = await e.profiles.save("alice", {
      nickname: "原昵称",
      avatarUrl: "wx-temp-avatar",
    });
  const count = e.disk.size;
  e.failCopy(true);
  await assert.rejects(
    e.profiles.save("alice", {
      nickname: "新昵称",
      avatarUrl: "wx-new-avatar",
    }),
  );
  e.failCopy(false);
  e.failStore(true);
  await assert.rejects(
    e.profiles.save("alice", {
      nickname: "新昵称",
      avatarUrl: "wx-new-avatar",
    }),
  );
  assert.equal(e.profiles.get("alice").nickname, "原昵称");
  assert.equal(e.disk.get(one.avatarUrl), "AVATAR");
  assert.equal(e.disk.size, count);
});
test("保存期间退出或切换账号不提交资料，失败不会阻塞后续保存", async () => {
  const e = store();
  await assert.rejects(
    e.profiles.save(
      "alice",
      { nickname: "新昵称", avatarUrl: "wx-temp-avatar" },
      () => false,
    ),
    /登录状态/,
  );
  assert.equal(e.profiles.get("alice"), null);
  assert.equal(e.disk.size, 2);
  await e.profiles.save("bob", { nickname: "用户B", avatarUrl: "" });
  assert.equal(e.profiles.get("bob").nickname, "用户B");
});
test("头像文件丢失可回退默认图，昵称仍保留；无效昵称不能保存", async () => {
  const e = store(),
    one = await e.profiles.save("alice", {
      nickname: "原昵称",
      avatarUrl: "wx-temp-avatar",
    });
  e.disk.delete(one.avatarUrl);
  assert.equal(e.profiles.get("alice").avatarUrl, "");
  assert.equal(e.profiles.get("alice").nickname, "原昵称");
  for (const name of ["", "  ", "x".repeat(21), "a\nb"])
    assert.throws(() => e.profiles.normalizeNickname(name));
  assert.equal(e.profiles.normalizeNickname("  📷小相  "), "📷小相");
});
function editor() {
  let definition,
    saves = 0,
    back = 0;
  const saved = [];
  const app = { globalData: { openid: "alice", userInfo: null } };
  const real = store().profiles;
  const filename = path.resolve(
    __dirname,
    "../mini-program/pages/account/account.js",
  );
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      Page: (v) => (definition = v),
      getApp: () => app,
      wx: {
        showToast() {},
        navigateBack() {
          back++;
        },
      },
      require: () => ({
        get: () => null,
        normalizeNickname: real.normalizeNickname,
        save: async (id, value, valid) => {
          saves++;
          if (!valid()) throw Error("账号变化");
          saved.push({ id, ...value });
          return value;
        },
      }),
    },
    { filename },
  );
  const p = { ...definition, data: structuredClone(definition.data) };
  p.setData = (v) => Object.assign(p.data, v);
  p.onLoad();
  return { p, app, saved, count: () => saves, back: () => back };
}
test("使用表单最新昵称直接保存；重复点击不重复写入，取消头像不覆盖原图", async () => {
  const e = editor();
  e.p.setData({ avatarUrl: "ORIGINAL", nickname: "旧值" });
  e.p.onChooseAvatar({ detail: {} });
  assert.equal(e.p.data.avatarUrl, "ORIGINAL");
  const saving = e.p.submit({
    detail: { value: { nickname: "微信快捷填写的新昵称" } },
  });
  await e.p.submit({ detail: { value: { nickname: "不应重复提交" } } });
  await saving;
  assert.equal(e.count(), 1);
  assert.equal(e.saved[0].nickname, "微信快捷填写的新昵称");
  assert.equal(e.back(), 1);
  e.p.onUnload();
});
test("页面退出或账号变化后不能提交资料", async () => {
  const e = editor();
  e.p.onUnload();
  await e.p.submit({ detail: { value: { nickname: "微信昵称" } } });
  assert.equal(e.count(), 0);
  const other = editor();
  other.app.globalData.openid = "bob";
  other.p.onShow();
  await other.p.submit({ detail: { value: { nickname: "微信昵称" } } });
  assert.equal(other.count(), 0);
  assert.equal(other.back(), 0);
});
test("表单昵称为空时保留原资料，不回退旧输入提交", async () => {
  const e = editor();
  e.p.setData({ nickname: "原昵称" });
  await e.p.submit({ detail: { value: { nickname: "" } } });
  assert.equal(e.count(), 0);
  assert.match(e.p.data.error, /1—20/);
  assert.equal(e.p.data.saving, false);
});

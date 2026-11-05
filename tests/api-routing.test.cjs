const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../mini-program");

test("启动配置、登录及所有业务请求使用当前服务器入口，上传与认证参数完整保留", async () => {
  let app;
  const requests = [], uploads = [];
  const wx = {
    getStorageSync: () => "",
    setStorageSync() {},
    login: ({ success }) => success({ code: "test-code" }),
    request(options) {
      requests.push(options);
      const data = options.url.endsWith("/api/user/login")
        ? { openid: "test-user", sessionToken: "test-session" }
        : options.url.endsWith("/api/app/config") ? { watermarkEnabled: true } : {};
      options.success({ statusCode: 200, data: { code: 200, data } });
      if (options.complete) options.complete();
      return { abort() {} };
    },
    uploadFile(options) {
      uploads.push(options);
      options.success({ statusCode: 200, data: JSON.stringify({ code: 200, data: { status: true, image_base64: "image" } }) });
      return { abort() {} };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), {
    App: value => { app = value; }, wx,
    require: name => name.endsWith("files") ? { clearTransientImages() {} } : require("../mini-program/utils/rewarded-video"),
  });
  app.onLaunch();
  await app.appConfigReady;
  await app.doLogin();
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "utils/api.js"), "utf8"), { module, wx, getApp: () => app });
  const api = module.exports;
  const routes = [
    ["/api/photo/add-background", "POST"],
    ["/api/photo/generate-layout", "POST"],
    ["/api/history/save", "POST"],
    ["/api/history/list", "GET"],
    ["/api/history/42", "DELETE"],
    ["/api/user/usage", "GET"],
    ["/api/user/recordAd", "POST"],
    ["/api/member/status", "GET"],
    ["/api/member/orders", "POST"],
    ["/api/member/orders/M123", "GET"],
  ];
  const base = "https://www.myhaibin.top/new-api";
  for (const [route, method] of routes) {
    await api.request(route, { method, data: { openid: "test-user" }, header: { "content-type": "application/json" } });
    const request = requests.at(-1);
    assert.equal(request.url, base + route);
    assert.equal(request.method, method);
    assert.equal(request.header.Authorization, "Bearer test-session");
    assert.equal(request.header["content-type"], "application/json");
    assert.equal(request.data.openid, "test-user");
  }
  assert.equal(requests[0].url, base + "/api/app/config");
  assert.equal(requests[1].url, base + "/api/user/login");
  assert.equal(requests[1].data.code, "test-code");
  await api.upload("portrait.jpg", { width: 295, height: 413 });
  await api.watermark("portrait.jpg", { text: "test" });
  assert.equal(uploads[0].url, base + "/api/photo/generate-idphoto");
  assert.equal(uploads[1].url, base + "/api/photo/watermark");
  assert.equal(uploads[0].filePath, "portrait.jpg");
  assert.equal(uploads[0].formData.width, 295);
  assert.equal(uploads[1].formData.text, "test");
  assert.ok(requests.every(item => !item.url.includes("/shiguang-api")));
});

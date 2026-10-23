const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function historyPage(request) {
  let page;
  const filename = path.resolve(
    __dirname,
    "../mini-program/pages/history/history.js",
  );
  const app = { globalData: { openid: "test-user" } };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      Page(value) {
        page = value;
      },
      getApp: () => app,
      require(name) {
        if (name.endsWith("/api"))
          return { request, unwrap: (value) => value.data };
        if (name.endsWith("/drafts")) return { list: () => [] };
        if (name.endsWith("/tool-catalog"))
          return require("../mini-program/utils/tool-catalog");
        if (name.endsWith("/files")) return {};
        throw new Error(`Unexpected dependency: ${name}`);
      },
    },
    { filename },
  );
  page.data = { ...page.data, tab: "cloud", hasLogin: true };
  page.setData = (data) => Object.assign(page.data, data);
  return page;
}

test("云端首次加载失败保留错误状态，重试成功后恢复作品列表", async () => {
  let requests = 0;
  const page = historyPage(async () => {
    if (++requests === 1) throw new Error("连接失败，请检查网络后重试");
    return {
      data: [
        {
          id: 1,
          photoUrl: "https://example.test/photo.png",
          createTime: "2026-10-22T18:00:00",
        },
      ],
    };
  });
  await page.fetchHistoryList();
  assert.equal(page.data.isLoading, false);
  assert.match(page.data.loadError, /连接失败/);
  assert.equal(page.data.historyList.length, 0);
  assert.equal(page.data.error, "");

  await page.retryHistory();
  assert.equal(requests, 2);
  assert.equal(page.data.loadError, "");
  assert.equal(page.data.historyList[0].id, 1);
  assert.equal(page.data.historyList[0].timeStr, "2026-10-22 18:00");
});

test("刷新失败仍保留已经加载的云端作品，错误不会污染本地草稿页", async () => {
  let reject;
  const page = historyPage(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  page.data.historyList = [
    { id: 9, photoUrl: "https://example.test/saved.png" },
  ];
  const loading = page.fetchHistoryList();
  page.selectTab({ currentTarget: { dataset: { tab: "drafts" } } });
  reject(new Error("连接失败"));
  await loading;
  assert.equal(page.data.tab, "drafts");
  assert.equal(page.data.error, "");
  assert.equal(page.data.historyList[0].id, 9);
  assert.equal(page.data.loadError, "连接失败");
});

test("加载中重复点击重试不会同时请求多次，成功空结果清除旧错误", async () => {
  let resolve,
    requests = 0;
  const page = historyPage(() => {
    requests++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  page.data.loadError = "上次加载失败";
  const loading = page.retryHistory();
  assert.equal(page.data.isLoading, true);
  assert.equal(page.data.loadError, "");
  await page.retryHistory();
  assert.equal(requests, 1);
  resolve({ data: [] });
  await loading;
  assert.equal(page.data.isLoading, false);
  assert.equal(page.data.loadError, "");
  assert.equal(page.data.historyList.length, 0);
});

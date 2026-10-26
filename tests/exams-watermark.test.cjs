const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const specs = require("../mini-program/utils/photo-specs");
const { jpegMetadata } = require("../mini-program/utils/exam-image");
function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, "../mini-program", file);
  let definition;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module,
    Page: (v) => (definition = v),
    require: createRequire(filename),
    setTimeout,
    clearTimeout,
    ...overrides,
    require: (name) =>
      name.endsWith("/brand-preview")
        ? { create: async (_page, source) => "BRANDED:" + source }
        : (overrides.require || createRequire(filename))(name),
  });
  if (!definition) return module.exports;
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values, cb) {
      Object.assign(this.data, values);
      if (cb) cb();
    },
  };
  return page;
}
test("考试目录支持别名、英文与类别筛选，所有考试都有可追溯出处", () => {
  assert.equal(specs.presets.length, 36);
  assert.equal(new Set(specs.presets.map((s) => s.id)).size, 36);
  for (const query of [
    "国考",
    "四六级",
    "考研",
    "教资",
    "NCRE",
    "cpa",
    "一建",
    "注安",
    "普通话",
    "CATTI",
  ])
    assert.ok(specs.findSpecs(query).length, query);
  assert.equal(specs.findSpecs("四六级").length, 2);
  assert.equal(specs.findSpecs("国考", "education").length, 0);
  for (const spec of specs.presets.filter((s) => s.category !== "common")) {
    assert.match(spec.sourceUrl, /^https:\/\//);
    assert.ok(spec.sourceLabel && spec.notice && spec.reviewedAt);
    assert.ok(spec.width >= 100 && spec.height >= 100);
  }
  assert.equal(specs.getSpec("national-civil").maxKB, undefined);
  assert.match(specs.getSpec("national-civil").sizeRule, /下限/);
  assert.match(specs.getSpec("postgraduate").sizeRule, /3:4/);
  assert.match(specs.getSpec("teacher-exam").sizeRule, /建议/);
});
test("JPEG密度标记与合法注释填充不改变像素数据，可处理跨段大小", () => {
  const jpeg = Uint8Array.from([255, 216, 255, 219, 0, 2, 255, 217]);
  const result = jpegMetadata(jpeg, 20 * 1024);
  assert.equal(result.length, 20 * 1024);
  assert.equal(Buffer.from(result.slice(6, 11)).toString(), "JFIF\0");
  assert.equal(result[13], 1); // DPI单位
  assert.equal(result[14] * 256 + result[15], 300);
  assert.deepEqual([...result.slice(-6)], [255, 219, 0, 2, 255, 217]);
  const second = jpegMetadata(result, 100000);
  assert.equal(second.length, 100000);
  let offset = 20;
  while (second[offset] === 255 && second[offset + 1] === 254)
    offset += 2 + (second[offset + 2] * 256 + second[offset + 3]);
  // 原注释保留，新填充亦为合法JPEG段；可一路解析到图像量化段。
  assert.equal(second[offset + 1], 219);
  assert.throws(() => jpegMetadata(Uint8Array.from([1, 2, 3])), /JPEG/);
});
test("选择照片取消或页面退出不误导航；重复开始只调用一次相册", async () => {
  let resolve,
    choices = 0,
    nav = 0;
  const p = load("pages/spec-detail/spec-detail.js", {
    require: (n) =>
      n.endsWith("/files")
        ? {
            call: (method) => {
              if (method === "chooseMedia") {
                choices++;
                return new Promise((r) => (resolve = r));
              }
              nav++;
              return Promise.resolve();
            },
          }
        : require("../mini-program/utils/photo-specs"),
  });
  p.onLoad({ id: "national-civil" });
  const first = p.start();
  await p.start();
  assert.equal(choices, 1);
  p.onUnload();
  resolve({ tempFiles: [{ tempFilePath: "fixture.jpg" }] });
  await first;
  assert.equal(nav, 0);
});
test("考试适配失败清空旧图，禁止导出；成功后才恢复", async () => {
  let fail = true,
    saves = 0;
  const p = load("pages/exam/exam.js", {
    require: (n) => {
      if (n.endsWith("/photo-specs")) return specs;
      if (n.endsWith("/image-transform"))
        return require("../mini-program/utils/image-transform");
      if (n.endsWith("/exam-image"))
        return {
          prepare: async () => {
            if (fail) throw Error("压缩失败");
            return { path: "NEW.jpg", bytes: 5000 };
          },
        };
      if (n.endsWith("/drafts"))
        return {
          createId: () => "d1",
          save: async (s) => {
            saves++;
            return s;
          },
        };
      if (n.endsWith("/files"))
        return { formatBytes: (n) => String(n), call: async () => ({}) };
      throw Error(n);
    },
    getApp: () => ({ globalData: {} }),
  });
  p._unloaded = false;
  p._revision = 0;
  p.setData({
    spec: specs.getSpec("cpa"),
    sourcePath: "SOURCE",
    resultPath: "OLD",
    previewPath: "OLD_PREVIEW",
  });
  await p.process();
  assert.equal(p.data.resultPath, "");
  assert.equal(p.data.previewPath, "");
  await p.goExport();
  assert.equal(saves, 0);
  fail = false;
  await p.process();
  assert.equal(p.data.resultPath, "NEW.jpg");
  p.move({ currentTarget: { dataset: { axis: "Y" } }, detail: { value: 60 } });
  assert.equal(p.data.resultPath, "");
  assert.equal(p.data.previewPath, "");
  await p.goExport();
  assert.equal(saves, 0);
});
function watermarkFixture() {
  let resolve,
    reject,
    uploads = 0,
    saved = 0,
    aborted = 0;
  const p = load("pages/watermark/watermark.js", {
    require: (n) => {
      if (n.endsWith("/api"))
        return {
          watermark: (_src, _settings, onTask) => {
            uploads++;
            onTask({ abort: () => aborted++ });
            return new Promise((r, j) => {
              resolve = r;
              reject = j;
            });
          },
        };
      if (n.endsWith("/files"))
        return {
          writeBase64: async () => "NEW",
          call: async () => ({ width: 400, height: 600 }),
          fileSize: async () => 40000,
          formatBytes: () => "40KB",
          removeTemp() {},
        };
      if (n.endsWith("/drafts"))
        return {
          createId: () => "d1",
          save: async (s) => {
            saved++;
            return s;
          },
        };
      throw Error(n);
    },
    getApp: () => ({ globalData: {} }),
  });
  p._unloaded = false;
  p._revision = 0;
  p.setData({
    sourcePath: "SOURCE",
    resultPath: "OLD",
    serviceReady: true,
    checkingService: false,
    width: 400,
    height: 600,
  });
  return {
    p,
    resolve: (v) => resolve(v),
    reject: (e) => reject(e),
    get counts() {
      return { uploads, saved, aborted };
    },
  };
}
test("水印修改文字即使旧图失效，空白文字不能请求，失败不能保存旧图", async () => {
  const f = watermarkFixture(),
    p = f.p;
  p.input({ detail: { value: "新的用途" } });
  assert.equal(p.data.resultPath, "");
  p.input({ detail: { value: "   " } });
  await p.generate();
  assert.equal(f.counts.uploads, 0);
  p.input({ detail: { value: "仅供报名" } });
  const pending = p.generate();
  await p.generate();
  assert.equal(f.counts.uploads, 1);
  f.reject(Error("离线"));
  await pending;
  await p.goExport();
  assert.equal(f.counts.saved, 0);
  assert.equal(p.data.resultPath, "");
});
test("水印取消阻止迟到响应覆盖，重试成功后可保存，处理时不能改参数", async () => {
  const f = watermarkFixture(),
    p = f.p;
  const first = p.generate();
  p.input({ detail: { value: "不能生效" } });
  assert.equal(p.data.text, "仅供报名使用");
  p.cancel();
  assert.equal(f.counts.aborted, 1);
  f.resolve({ image_base64: "A" });
  await first;
  assert.equal(p.data.resultPath, "");
  const retry = p.generate();
  f.resolve({ image_base64: "A" });
  await retry;
  assert.equal(p.data.resultPath, "NEW");
  await p.goExport();
  assert.equal(f.counts.saved, 1);
});
test("水印上传保留原生取消任务，区分未部署、业务失败及成功响应", async () => {
  let options, task, callback;
  const api = load("utils/api.js", {
    getApp: () => ({ globalData: { baseUrl: "https://example.test/" } }),
    wx: {
      uploadFile: (o) => {
        options = o;
        task = { abort() {} };
        return task;
      },
    },
  });
  let result = api.watermark(
    "SOURCE",
    { text: "仅供报名", opacity: 0.25 },
    (t) => (callback = t),
  );
  assert.equal(callback, task);
  assert.equal(options.url, "https://example.test/api/photo/watermark");
  assert.equal(options.name, "file");
  options.success({ statusCode: 404 });
  await assert.rejects(result, /尚未部署/);
  result = api.watermark("SOURCE", {});
  options.success({
    statusCode: 200,
    data: JSON.stringify({ code: 200, data: { status: false } }),
  });
  await assert.rejects(result, /生成失败/);
  result = api.watermark("SOURCE", {});
  options.success({
    statusCode: 200,
    data: JSON.stringify({
      code: 200,
      data: { status: true, image_base64: "A" },
    }),
  });
  assert.equal((await result).image_base64, "A");
});

test("主制作与换底色仍进入原有智能制作，考试目录不替换核心入口", () => {
  const filename = path.resolve(
    __dirname,
    "../mini-program/utils/tool-launcher.js",
  );
  const module = { exports: {} };
  const urls = [];
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module,
    require: createRequire(filename),
    wx: { hideKeyboard() {}, navigateTo: (o) => urls.push(o.url) },
  });
  const page = {
    ...module.exports,
    data: {},
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  page.openToolEntry("idphoto");
  assert.equal(page.data.specVisible, true);
  assert.equal(urls.length, 0);
  page.openToolEntry("background");
  assert.equal(page.data.specVisible, true);
  assert.match(page.data.specTitle, /更换底色/);
});

test("考试照片使用真实品牌预览并走保存配额；额度不足不写相册，成功后重复保存复用", async () => {
  const session = {
    mode: "exam",
    sourcePath: "SOURCE",
    resultPath: "CLEAN.jpg",
    previewPath: "BRAND.jpg",
    requiresQuota: true,
    width: 144,
    height: 192,
    sizeName: "考试照",
  };
  const app = {
    globalData: { openid: "qa", exportSession: session },
    ensureLogin: async () => true,
  };
  const previews = [],
    albums = [];
  let denied = true,
    requests = 0,
    ads = 0;
  const p = load("pages/export/export.js", {
    getApp: () => app,
    wx: { previewImage: (o) => previews.push(o) },
    require: (n) => {
      if (n.endsWith("/rewarded-video"))
        return { createRewardedVideoPlayer: () => ({ dispose() {} }) };
      if (n.endsWith("/files"))
        return {
          call: async () => ({ width: 144, height: 192 }),
          readBase64: async (path) => {
            assert.equal(path, "CLEAN.jpg");
            return "CLEAN";
          },
          saveAlbum: async (p) => albums.push(p),
          removeTemp() {},
        };
      if (n.endsWith("/api"))
        return {
          request: async () => ({
            code: 200,
            data: { adViewCount: 0, saveCount: 0 },
          }),
          unwrap: (r) => {
            if (r.code !== 200) throw Error("denied");
            return r.data;
          },
        };
      throw Error(n);
    },
  });
  p.onLoad();
  assert.equal(p.data.local, false);
  assert.equal(p.data.allowLayout, false);
  p.previewImage();
  assert.equal(previews[0].current, "BRAND.jpg");
  p.requestSave = async () => {
    requests++;
    return denied ? { code: 4031 } : { code: 200, data: {} };
  };
  p.watchAdForSave = async () => {
    ads++;
    return false;
  };
  p.saveToAlbum = async (path) => albums.push(path);
  await p.saveImage("single");
  assert.equal(albums.length, 0);
  assert.equal(ads, 1);
  assert.equal(p.data.previewPath, "BRAND.jpg");
  denied = false;
  await p.saveImage("single");
  assert.deepEqual(albums, ["CLEAN.jpg"]);
  await p.saveImage("single");
  assert.equal(requests, 2);
  assert.equal(albums.length, 2);
  assert.equal(p.data.previewPath, "BRAND.jpg");
});

test("品牌水印绘制到导出的位图中，不依赖页面覆盖文字", async () => {
  const filename = path.resolve(
    __dirname,
    "../mini-program/utils/brand-preview.js",
  );
  const calls = [];
  let encoded = false;
  const ctx = {
    fillRect() {},
    drawImage() {
      calls.push("image");
    },
    save() {},
    translate() {},
    rotate() {},
    fillText(text) {
      calls.push(text);
    },
    restore() {},
  };
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ctx,
    createImage() {
      const image = {};
      Object.defineProperty(image, "src", {
        set() {
          queueMicrotask(() => image.onload());
        },
      });
      return image;
    },
    toDataURL(type) {
      assert.equal(type, "image/jpeg");
      assert.ok(calls.includes("拾光小相"));
      encoded = true;
      return "data:image/jpeg;base64,QlJBTkQ=";
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module,
    setTimeout,
    clearTimeout,
    require: (n) =>
      n === "./image-transform"
        ? {
            getCanvas: async () => canvas,
            cropRect: require("../mini-program/utils/image-transform").cropRect,
          }
        : {
            call: async () => ({ width: 400, height: 560 }),
            writeBase64: async (data) => {
              assert.equal(encoded, true);
              assert.match(data, /QlJBTkQ=/);
              return "BURNED.jpg";
            },
          },
  });
  assert.equal(await module.exports.create({}, "CLEAN.jpg"), "BURNED.jpg");
  assert.equal(calls[0], "image");
  assert.ok(calls.filter((c) => c === "拾光小相").length > 5);
  await module.exports.create({}, "SOURCE.jpg", {
    ratio: 178 / 220,
    x: 50,
    y: 50,
  });
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 494);
  assert.ok(canvas.width > 178, "高清预览不使用低像素的考试标准成品");
  const editor = fs.readFileSync(
    path.resolve(__dirname, "../mini-program/pages/edit/edit.wxml"),
    "utf8",
  );
  assert.ok(!/src="[^"]*resultPath/.test(editor));
});

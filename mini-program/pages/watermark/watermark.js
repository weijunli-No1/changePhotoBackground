const files = require("../../utils/files");
const api = require("../../utils/api");
const drafts = require("../../utils/drafts");
Page({
  data: {
    sourcePath: "",
    resultPath: "",
    text: "仅供报名使用",
    size: 48,
    opacity: 25,
    angle: 30,
    color: "#000000",
    space: 25,
    advanced: false,
    processing: false,
    opening: false,
    serviceReady: false,
    checkingService: true,
    error: "",
    resultSize: "",
    width: 0,
    height: 0,
    previewStyle: "",
    textStyle: "",
    spacingStyle: "",
    rowStyle: "",
    accentColor: "#2563eb",
    templates: ["仅供报名使用", "仅供办理业务", "仅供复印使用"],
    rows: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    columns: [0, 1, 2],
    colors: [
      { name: "黑色", value: "#000000" },
      { name: "白色", value: "#FFFFFF" },
      { name: "灰色", value: "#666666" },
    ],
  },
  async onLoad(options = {}) {
    this._unloaded = false;
    this._revision = 0;
    this.checkService();
    this._themeChange = ({ theme }) => {
      if (!this._unloaded)
        this.setData({ accentColor: theme === "dark" ? "#78cbb4" : "#2563eb" });
    };
    if (wx.getAppBaseInfo) this._themeChange(wx.getAppBaseInfo());
    if (wx.onThemeChange) wx.onThemeChange(this._themeChange);
    this._draftId = options.draft || drafts.createId();
    const draft = options.draft ? drafts.get(options.draft) : null;
    if (options.draft && (!draft || draft.mode !== "watermark")) {
      this.setData({ error: "草稿已失效，请重新选择照片" });
      return;
    }
    if (draft) {
      this.setData({
        ...draft.toolState,
        sourcePath: draft.sourcePath,
        resultPath: draft.resultPath || "",
        width: draft.width,
        height: draft.height,
      });
      try {
        await files.call("getImageInfo", { src: draft.sourcePath });
        if (draft.resultPath) {
          await files.call("getImageInfo", { src: draft.resultPath });
          if (!this._unloaded)
            this.setData({
              resultSize: files.formatBytes(
                await files.fileSize(draft.resultPath),
              ),
            });
        }
      } catch (error) {
        if (!this._unloaded)
          this.setData({ resultPath: "", error: "草稿图片不可用，请重新选图" });
      }
    }
  },
  onReady() {
    this._ready = true;
    this.updatePreview();
  },
  async checkService(e) {
    if (this._checkingService || this._unloaded) return;
    this._checkingService = true;
    this.setData({ checkingService: true });
    try {
      const app = getApp();
      if (e) await app.loadRemoteAppConfig();
      else await app.appConfigReady;
      if (!this._unloaded)
        this.setData({
          serviceReady: app.globalData.watermarkEnabled === true,
        });
    } catch (error) {
      if (!this._unloaded) this.setData({ serviceReady: false });
    } finally {
      this._checkingService = false;
      if (!this._unloaded) this.setData({ checkingService: false });
    }
  },
  onResize() {
    this.updatePreview();
  },
  onUnload() {
    this._unloaded = true;
    this._revision++;
    if (this._task && this._task.abort) this._task.abort();
    if (wx.offThemeChange && this._themeChange)
      wx.offThemeChange(this._themeChange);
  },
  invalidate(values) {
    if (this.data.processing || this.data.opening || this._unloaded) return;
    this.setData({ ...values, resultPath: "", resultSize: "", error: "" }, () =>
      this.updatePreview(),
    );
  },
  async choosePhoto() {
    if (this.data.processing || this.data.opening || this._choosing) return;
    this._choosing = true;
    try {
      const media = await files.call("chooseMedia", {
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["original"],
      });
      if (this._unloaded) return;
      const photo = media.tempFiles && media.tempFiles[0];
      if (!photo || !photo.tempFilePath) throw Error("未能读取照片");
      const info = await files.call("getImageInfo", {
        src: photo.tempFilePath,
      });
      if (this._unloaded) return;
      if (
        info.width * info.height > 16000000 ||
        info.width > 6000 ||
        info.height > 6000
      )
        throw Error(
          "请选择1600万像素以内且单边不超过6000像素的照片，可先使用图片压缩工具",
        );
      if ((await files.fileSize(photo.tempFilePath)) > 10 * 1024 * 1024)
        throw Error("照片超过10 MB，请先压缩后再添加水印");
      if (this._unloaded) return;
      this._draftId = drafts.createId();
      this.invalidate({
        sourcePath: photo.tempFilePath,
        width: info.width,
        height: info.height,
      });
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || ""))
        this.setData({ error: error.message || "选择照片失败，请重试" });
    } finally {
      this._choosing = false;
    }
  },
  input(e) {
    this.invalidate({ text: e.detail.value });
  },
  template(e) {
    const text = this.data.templates[Number(e.currentTarget.dataset.index)];
    if (text) this.invalidate({ text });
  },
  slider(e) {
    const key = e.currentTarget.dataset.key;
    const limits = { size: [16, 100], opacity: [10, 70], space: [10, 100] };
    if (!limits[key]) return;
    this.invalidate({
      [key]: Math.max(
        limits[key][0],
        Math.min(limits[key][1], Number(e.detail.value) || limits[key][0]),
      ),
    });
  },
  direction(e) {
    const angle = Number(e.currentTarget.dataset.angle);
    if ([0, 30].includes(angle)) this.invalidate({ angle });
  },
  setColor(e) {
    const color = e.currentTarget.dataset.color;
    if (this.data.colors.some((c) => c.value === color))
      this.invalidate({ color });
  },
  toggleAdvanced() {
    if (!this.data.processing && !this.data.opening)
      this.setData({ advanced: !this.data.advanced });
  },
  updatePreview() {
    if (
      !this._ready ||
      !this.createSelectorQuery ||
      !this.data.width ||
      this._unloaded
    )
      return;
    this.createSelectorQuery()
      .select(".watermark-stage")
      .boundingClientRect()
      .exec((rects) => {
        if (this._unloaded || !rects[0]) return;
        const scale = Math.min(
          (rects[0].width - 32) / this.data.width,
          (rects[0].height - 24) / this.data.height,
        );
        this.setData({
          previewStyle: `width:${this.data.width * scale}px;height:${this.data.height * scale}px;`,
          textStyle: `font-size:${Math.max(5, this.data.size * scale)}px;color:${this.data.color};opacity:${this.data.opacity / 100};transform:rotate(${-this.data.angle}deg);`,
          spacingStyle: `margin:0 ${this.data.space * scale}px;`,
          rowStyle: `margin-bottom:${this.data.space * scale}px;`,
        });
      });
  },
  cancel() {
    if (!this.data.processing) return;
    this._revision++;
    if (this._task && this._task.abort) this._task.abort();
    this._task = null;
    this.setData({
      processing: false,
      resultPath: "",
      error: "已取消处理，照片和设置已保留",
    });
  },
  async generate() {
    if (
      this._unloaded ||
      this.data.processing ||
      this.data.opening ||
      !this.data.sourcePath
    )
      return;
    if (!this.data.serviceReady || this.data.checkingService) return;
    const text = this.data.text.trim();
    if (!text || text.length > 60 || /[\x00-\x1f\x7f]/.test(text)) {
      this.setData({ error: "请输入1至60个字的单行水印文字" });
      return;
    }
    const revision = ++this._revision;
    this.setData({
      processing: true,
      resultPath: "",
      resultSize: "",
      error: "",
    });
    try {
      const response = await api.watermark(
        this.data.sourcePath,
        {
          text,
          size: this.data.size,
          opacity: this.data.opacity / 100,
          angle: this.data.angle,
          color: this.data.color,
          space: this.data.space,
          dpi: 300,
        },
        (task) => {
          if (!this._unloaded && revision === this._revision) this._task = task;
          else if (task && task.abort) task.abort();
        },
      );
      if (this._unloaded || revision !== this._revision) return;
      const path = await files.writeBase64(response.image_base64, "photo");
      if (this._unloaded || revision !== this._revision) {
        files.removeTemp(path);
        return;
      }
      const info = await files.call("getImageInfo", { src: path });
      const bytes = await files.fileSize(path);
      if (this._unloaded || revision !== this._revision) {
        files.removeTemp(path);
        return;
      }
      this.setData({
        resultPath: path,
        width: info.width,
        height: info.height,
        resultSize: files.formatBytes(bytes),
      });
    } catch (error) {
      if (!this._unloaded && revision === this._revision)
        this.setData({ error: error.message || "水印处理失败，请重试" });
    } finally {
      if (!this._unloaded && revision === this._revision) {
        this._task = null;
        this.setData({ processing: false });
      }
    }
  },
  primary() {
    return this.data.resultPath ? this.goExport() : this.generate();
  },
  async goExport() {
    if (
      this._unloaded ||
      this.data.processing ||
      this.data.opening ||
      !this.data.resultPath
    )
      return;
    this.setData({ opening: true, error: "" });
    try {
      const { text, size, opacity, angle, color, space } = this.data;
      const saved = await drafts.save({
        id: this._draftId,
        mode: "watermark",
        toolId: "watermark",
        sourcePath: this.data.sourcePath,
        resultPath: this.data.resultPath,
        width: this.data.width,
        height: this.data.height,
        sizeName: "水印照片",
        outputNote: "水印已合成到图片；修改文字和样式请返回编辑。",
        toolState: { text, size, opacity, angle, color, space },
      });
      if (this._unloaded) return;
      this.setData({
        sourcePath: saved.sourcePath,
        resultPath: saved.resultPath,
      });
      getApp().globalData.exportSession = saved;
      await files.call("navigateTo", { url: "/pages/export/export" });
    } catch (error) {
      if (!this._unloaded)
        this.setData({ error: error.message || "保存页未能打开，请重试" });
    } finally {
      if (!this._unloaded) this.setData({ opening: false });
    }
  },
});

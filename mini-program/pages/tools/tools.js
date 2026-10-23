const files = require("../../utils/files");
const drafts = require("../../utils/drafts");
const { transform, cropRect } = require("../../utils/image-transform");
Page({
  data: {
    mode: "compress",
    sourcePath: "",
    resultPath: "",
    processing: false,
    error: "",
    errorRecovery: "reselect",
    quality: 85,
    maxEdge: 2048,
    angle: 0,
    ratio: 0,
    ratioName: "原比例",
    positionX: 50,
    positionY: 50,
    sourceSize: "",
    resultSize: "",
    sourceWidth: 0,
    sourceHeight: 0,
    canMoveX: false,
    canMoveY: false,
    width: 0,
    height: 0,
    returnToEditor: false,
    ratios: [
      { name: "原比例", value: 0 },
      { name: "1:1", value: 1 },
      { name: "3:4", value: 0.75 },
      { name: "4:3", value: 1.3333333333 },
      { name: "9:16", value: 0.5625 },
    ],
    edges: [1280, 2048, 2560],
    qualityOptions: [
      { value: 85, label: "清晰优先" },
      { value: 65, label: "均衡压缩" },
      { value: 40, label: "体积优先" },
    ],
  },
  onLoad(options) {
    this._unloaded = false;
    this._draftId = options.draft || drafts.createId();
    const draft = options.draft ? drafts.get(options.draft) : null;
    const mode = draft
      ? draft.mode
      : options.mode === "crop"
        ? "crop"
        : "compress";
    this.setData({ mode, returnToEditor: options.returnToEditor === "1" });
    if (draft)
      this.setData({
        ...draft.toolState,
        sourcePath: draft.sourcePath,
        resultPath: draft.resultPath || "",
        width: draft.width,
        height: draft.height,
      });
    else if (options.src)
      this.setData({ sourcePath: decodeURIComponent(options.src) });
    else if (options.draft)
      this.setData({ error: "草稿已清理，请重新选择照片" });
  },
  onReady() {
    this._ready = true;
    if (this.data.sourcePath) this.loadSource(this.data.sourcePath);
  },
  onHide() {
    this.persistDraft();
  },
  onUnload() {
    this.persistDraft();
    this._unloaded = true;
  },
  async choosePhoto() {
    if (this.data.processing || this._choosing) return;
    this._choosing = true;
    try {
      const res = await files.call("chooseMedia", {
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["original"],
      });
      if (this._unloaded) return;
      this._draftId = drafts.createId();
      this.setData({
        angle: 0,
        ratio: 0,
        ratioName: "原比例",
        positionX: 50,
        positionY: 50,
      });
      await this.loadSource(res.tempFiles[0].tempFilePath);
    } catch (error) {
      if (!/cancel/.test(error.errMsg || "") && !this._unloaded)
        this.setData({ error: "无法选择照片，请重试" });
    } finally {
      this._choosing = false;
    }
  },
  async loadSource(path) {
    this.setData({
      processing: true,
      resultPath: "",
      resultSize: "",
      error: "",
    });
    try {
      const info = await files.call("getImageInfo", { src: path });
      const size = await files.fileSize(path);
      if (this._unloaded) return;
      this.setData({
        processing: false,
        sourcePath: path,
        sourceSize: files.formatBytes(size),
        sourceWidth: info.width,
        sourceHeight: info.height,
        resultPath: "",
        error: "",
      });
      if (this._ready) await this.apply();
    } catch (error) {
      if (!this._unloaded)
        this.setData({
          processing: false,
          sourcePath: "",
          sourceSize: "",
          error: "原图不可用，请重新选择",
          errorRecovery: "reselect",
        });
    }
  },
  async apply() {
    if (this.data.processing || !this.data.sourcePath || this._unloaded) return;
    // 参数已经更新，旧结果不再代表当前设置，也不能作为当前草稿导出。
    this.setData({
      processing: true,
      error: "",
      resultPath: "",
      resultSize: "",
      errorRecovery: "retry",
    });
    try {
      const result = await transform(this, this.data.sourcePath, {
        compress: this.data.mode === "compress",
        angle: this.data.mode === "crop" ? this.data.angle : 0,
        ratio: this.data.mode === "crop" ? this.data.ratio : 0,
        x: this.data.positionX / 100,
        y: this.data.positionY / 100,
        quality: this.data.mode === "compress" ? this.data.quality / 100 : 0.95,
        maxEdge: this.data.mode === "compress" ? this.data.maxEdge : 2560,
      });
      const size = await files.fileSize(result.path);
      if (this._unloaded) return;
      const turned = this.data.angle % 180 !== 0;
      const orientedWidth = turned
        ? this.data.sourceHeight
        : this.data.sourceWidth;
      const orientedHeight = turned
        ? this.data.sourceWidth
        : this.data.sourceHeight;
      const rect = cropRect(orientedWidth, orientedHeight, this.data.ratio);
      this.setData({
        canMoveX: rect.width < orientedWidth - 0.5,
        canMoveY: rect.height < orientedHeight - 0.5,
        resultPath: result.path,
        width: result.width,
        height: result.height,
        resultSize: files.formatBytes(size),
      });
      this.persistDraft();
    } catch (error) {
      if (!this._unloaded)
        this.setData({
          error: "照片处理失败，可重试或重新选择照片",
          errorRecovery: "retry",
        });
    } finally {
      if (!this._unloaded)
        this.setData({ processing: false, needsCanvas: false });
    }
  },
  retry() {
    if (this.data.processing) return;
    return this.data.sourcePath && this.data.errorRecovery === "retry"
      ? this.apply()
      : this.choosePhoto();
  },
  setQuality(e) {
    if (this.data.processing) return;
    this.setData({ quality: Number(e.currentTarget.dataset.quality) });
    this.apply();
  },
  setEdge(e) {
    if (this.data.processing) return;
    this.setData({ maxEdge: Number(e.currentTarget.dataset.edge) });
    this.apply();
  },
  setRatio(e) {
    if (this.data.processing) return;
    const item = this.data.ratios[Number(e.currentTarget.dataset.index)];
    this.setData({ ratio: item.value, ratioName: item.name });
    this.apply();
  },
  rotate() {
    if (this.data.processing) return;
    this.setData({ angle: (this.data.angle + 90) % 360 });
    this.apply();
  },
  reset() {
    if (this.data.processing) return;
    this.setData({
      angle: 0,
      ratio: 0,
      ratioName: "原比例",
      positionX: 50,
      positionY: 50,
    });
    this.apply();
  },
  positionX(e) {
    if (this.data.processing) return;
    this.setData({ positionX: e.detail.value });
    this.apply();
  },
  positionY(e) {
    if (this.data.processing) return;
    this.setData({ positionY: e.detail.value });
    this.apply();
  },
  snapshot() {
    return {
      id: this._draftId,
      mode: this.data.mode,
      sourcePath: this.data.sourcePath,
      resultPath: this.data.resultPath,
      width: this.data.width,
      height: this.data.height,
      sizeName: `${this.data.width} × ${this.data.height} px`,
      toolState: {
        quality: this.data.quality,
        maxEdge: this.data.maxEdge,
        angle: this.data.angle,
        ratio: this.data.ratio,
        ratioName: this.data.ratioName,
        positionX: this.data.positionX,
        positionY: this.data.positionY,
      },
    };
  },
  async persistDraft() {
    if (!this.data.sourcePath) return null;
    const snapshot = this.snapshot();
    try {
      const saved = await drafts.save(snapshot);
      if (
        !this._unloaded &&
        this.data.sourcePath === snapshot.sourcePath &&
        this.data.resultPath === snapshot.resultPath
      )
        this.setData({
          sourcePath: saved.sourcePath,
          resultPath: saved.resultPath,
        });
      return saved;
    } catch (error) {
      if (!this._warned && !this._unloaded) {
        this._warned = true;
        wx.showToast({ title: "草稿保存失败，请检查可用空间", icon: "none" });
      }
      return null;
    }
  },
  async goExport() {
    if (this.data.processing || !this.data.resultPath || this._opening) return;
    this._opening = true;
    try {
      const draft = await this.persistDraft();
      if (this._unloaded) return;
      if (this.data.returnToEditor) {
        this.getOpenerEventChannel().emit("adjusted", {
          path: (draft || this.snapshot()).resultPath,
        });
        wx.navigateBack();
        return;
      }
      getApp().globalData.exportSession = draft || this.snapshot();
      wx.navigateTo({ url: "/pages/export/export" });
    } finally {
      this._opening = false;
    }
  },
  makeIdPhoto() {
    if (!this.data.processing && this.data.resultPath)
      wx.navigateTo({
        url: `/pages/edit/edit?src=${encodeURIComponent(this.data.resultPath)}`,
      });
  },
});

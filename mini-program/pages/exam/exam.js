const specs = require("../../utils/photo-specs");
const files = require("../../utils/files");
const drafts = require("../../utils/drafts");
const { prepare } = require("../../utils/exam-image");
const { cropRect } = require("../../utils/image-transform");
const brandPreview = require("../../utils/brand-preview");
Page({
  data: {
    spec: null,
    sourcePath: "",
    resultPath: "",
    previewPath: "",
    resultSize: "",
    processing: false,
    opening: false,
    error: "",
    positionX: 50,
    positionY: 50,
    adjusting: false,
    accentColor: "#2563eb",
    resultWidth: 0,
    resultHeight: 0,
    cropReady: false,
    frameStyle: "",
    imageStyle: "",
    positionStyle: "",
    canMoveX: false,
    canMoveY: false,
  },
  async onLoad(options = {}) {
    this._unloaded = false;
    this._revision = 0;
    this._themeChange = ({ theme }) => {
      if (!this._unloaded)
        this.setData({ accentColor: theme === "dark" ? "#78cbb4" : "#2563eb" });
    };
    if (wx.getAppBaseInfo) this._themeChange(wx.getAppBaseInfo());
    if (wx.onThemeChange) wx.onThemeChange(this._themeChange);
    const draft = options.draft ? drafts.get(options.draft) : null;
    this._draftId = draft ? draft.id : drafts.createId();
    const spec = specs.getSpec(draft ? draft.specId : options.spec);
    if (!spec || (options.draft && !draft)) {
      this.setData({ error: "规格或草稿已失效，请返回重新选择" });
      return;
    }
    this.setData({
      spec,
      sourcePath: draft
        ? draft.sourcePath
        : options.src
          ? decodeURIComponent(options.src)
          : "",
      positionX: draft && draft.toolState ? draft.toolState.positionX : 50,
      positionY: draft && draft.toolState ? draft.toolState.positionY : 50,
    });
    if (this.data.sourcePath) await this.process();
  },
  onReady() {
    this._ready = true;
    this.updatePreview();
  },
  onResize() {
    this.updatePreview();
  },
  updatePreview() {
    if (
      !this._ready ||
      !this._sourceInfo ||
      !this.createSelectorQuery ||
      this._unloaded
    )
      return;
    this.createSelectorQuery()
      .select(".exam-preview")
      .boundingClientRect()
      .exec((rects) => {
        if (!rects[0] || this._unloaded) return;
        const { width, height } = this._sourceInfo;
        const rect = cropRect(
          width,
          height,
          this.data.spec.width / this.data.spec.height,
        );
        const scale = Math.min(
          (rects[0].width - 24) / rect.width,
          (rects[0].height - 24) / rect.height,
        );
        this._geometry = {
          dx: (width - rect.width) * scale,
          dy: (height - rect.height) * scale,
        };
        this.setData({
          cropReady: true,
          frameStyle: `width:${rect.width * scale}px;height:${rect.height * scale}px;`,
          imageStyle: `width:${width * scale}px;height:${height * scale}px;`,
          positionStyle: this.positionStyle(),
          canMoveX: this._geometry.dx > 0.5,
          canMoveY: this._geometry.dy > 0.5,
        });
      });
  },
  positionStyle() {
    const g = this._geometry || { dx: 0, dy: 0 };
    return `transform:translate(${(-g.dx * this.data.positionX) / 100}px,${(-g.dy * this.data.positionY) / 100}px);`;
  },
  onUnload() {
    this._unloaded = true;
    this._revision++;
    if (wx.offThemeChange && this._themeChange)
      wx.offThemeChange(this._themeChange);
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
      this._draftId = drafts.createId();
      this._sourceInfo = null;
      this.setData({
        sourcePath: photo.tempFilePath,
        resultPath: "",
        previewPath: "",
        positionX: 50,
        positionY: 50,
        cropReady: false,
        canMoveX: false,
        canMoveY: false,
      });
      await this.process();
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || ""))
        this.setData({ error: error.message || "选择失败，请重试" });
    } finally {
      this._choosing = false;
    }
  },
  async smartPhoto() {
    if (
      this._unloaded ||
      this.data.processing ||
      this.data.opening ||
      this._choosing ||
      !this.data.sourcePath ||
      !this.data.spec
    )
      return;
    this.setData({ opening: true, error: "" });
    const spec = this.data.spec;
    try {
      await files.call("redirectTo", {
        url: `/pages/edit/edit?src=${encodeURIComponent(this.data.sourcePath)}&width=${spec.width}&height=${spec.height}&name=${encodeURIComponent(spec.name)}&spec=${spec.id}`,
      });
    } catch (error) {
      if (!this._unloaded)
        this.setData({ error: "换底色页面未能打开，请重试" });
    } finally {
      if (!this._unloaded) this.setData({ opening: false });
    }
  },
  move(e) {
    if (this.data.processing || this.data.opening) return;
    const axis = e.currentTarget.dataset.axis;
    if (!["X", "Y"].includes(axis)) return;
    this.setData({
      ["position" + axis]: Math.max(
        0,
        Math.min(100, Number(e.detail.value) || 0),
      ),
      adjusting: true,
      resultPath: "",
      previewPath: "",
      error: "",
    });
    this.setData({ positionStyle: this.positionStyle() });
  },
  moveEnd(e) {
    if (this.data.processing || this.data.opening) return;
    this.move(e);
    this.setData({ adjusting: false });
    return this.process();
  },
  cancelMove() {
    if (this.data.adjusting) {
      this.setData({ adjusting: false });
      return this.process();
    }
  },
  async process() {
    if (
      this._unloaded ||
      !this.data.spec ||
      !this.data.sourcePath ||
      this.data.processing ||
      this.data.opening
    )
      return;
    const revision = ++this._revision;
    this.setData({
      processing: true,
      resultPath: "",
      previewPath: "",
      resultSize: "",
      error: "",
    });
    try {
      const result = await prepare(this, this.data.sourcePath, this.data.spec, {
        x: this.data.positionX,
        y: this.data.positionY,
      });
      if (this._unloaded || revision !== this._revision) {
        files.removeTemp(result.path);
        return;
      }
      const previewPath = await brandPreview.create(
        this,
        this.data.sourcePath,
        {
          ratio: this.data.spec.width / this.data.spec.height,
          x: this.data.positionX,
          y: this.data.positionY,
        },
      );
      if (this._unloaded || revision !== this._revision) {
        files.removeTemp(result.path);
        files.removeTemp(previewPath);
        return;
      }
      if (result.sourceWidth && result.sourceHeight)
        this._sourceInfo = {
          width: result.sourceWidth,
          height: result.sourceHeight,
        };
      this.setData({
        resultPath: result.path,
        previewPath,
        resultSize: files.formatBytes(result.bytes),
        resultWidth: result.width,
        resultHeight: result.height,
      });
      this.updatePreview();
    } catch (error) {
      if (!this._unloaded && revision === this._revision)
        this.setData({ error: error.message || "照片适配失败，请重试" });
    } finally {
      if (!this._unloaded && revision === this._revision)
        this.setData({ processing: false });
    }
  },
  async goExport() {
    if (
      this._unloaded ||
      this.data.opening ||
      this.data.processing ||
      this.data.adjusting ||
      !this.data.resultPath
    )
      return;
    this.setData({ opening: true, error: "" });
    try {
      const session = {
        id: this._draftId,
        mode: "exam",
        toolId: "exam",
        specId: this.data.spec.id,
        sourcePath: this.data.sourcePath,
        resultPath: this.data.resultPath,
        previewPath: this.data.previewPath,
        requiresQuota: true,
        width: this.data.resultWidth,
        height: this.data.resultHeight,
        sizeName: this.data.spec.name,
        outputNote: `请核对底色、人像和官方审核要求。${this.data.spec.fileRule}`,
        toolState: {
          positionX: this.data.positionX,
          positionY: this.data.positionY,
        },
      };
      const saved = await drafts.save(session);
      if (this._unloaded) return;
      this.setData({
        sourcePath: saved.sourcePath,
        resultPath: saved.resultPath,
        previewPath: saved.previewPath,
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

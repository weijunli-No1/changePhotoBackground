const specs = require("../../utils/photo-specs");
const files = require("../../utils/files");
const drafts = require("../../utils/drafts");
const { prepare } = require("../../utils/exam-image");
const { cropRect } = require("../../utils/image-transform");
const brandPreview = require("../../utils/brand-preview");
Page({
  onShareAppMessage() {
    return { title: "拾光小相｜考试报名照片制作", path: this.data.spec ? "/pages/exam/exam?spec=" + encodeURIComponent(this.data.spec.id) : "/pages/specs/specs" };
  },
  onShareTimeline() {
    return { title: "拾光小相｜考试报名照片制作", query: this.data.spec ? "spec=" + encodeURIComponent(this.data.spec.id) : "" };
  },

  data: {
    spec: null,
    sourcePath: "",
    resultPath: "",
    previewPath: "",
    displayPath: "",
    resultSize: "",
    processing: false,
    proofing: false,
    opening: false,
    error: "",
    positionX: 50,
    positionY: 50,
    adjusting: false,
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
    this._brandedPreviewPath = "";
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
    const source = this._sourceInfo;
    const request = {};
    this._frameRequest = request;
    this.createSelectorQuery()
      .select(".exam-preview")
      .boundingClientRect()
      .exec((rects) => {
        if (this._unloaded || this._frameRequest !== request || this._sourceInfo !== source ||
            !rects[0] || rects[0].width <= 24 || rects[0].height <= 24) return;
        const { width, height } = source;
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
  },
  async choosePhoto() {
    if (
      this._unloaded ||
      !this.data.spec ||
      this.data.processing ||
      this.data.opening ||
      this._choosing
    ) return;
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
      if (this.data.sourcePath)
        await files.call("getImageInfo", { src: photo.tempFilePath });
      if (this._unloaded) return;
      this._draftId = drafts.createId();
      this._sourceInfo = null;
      this.setData({
        sourcePath: photo.tempFilePath,
        resultPath: "",
        previewPath: "",
        displayPath: "",
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
  async openSpecs() {
    if (this._unloaded || this._openingSpecs) return;
    this._openingSpecs = true;
    try {
      await files.call("redirectTo", { url: "/pages/specs/specs" });
    } catch (_) {
      if (!this._unloaded)
        this.setData({ error: "规格页未能打开，请重试" });
    } finally {
      this._openingSpecs = false;
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
    const value = Math.max(0, Math.min(100, Number(e.detail.value) || 0));
    if (value === this.data["position" + axis]) return;
    this.setData({
      ["position" + axis]: value,
      adjusting: true,
      resultPath: "",
      previewPath: "",
      displayPath: "",
      error: "",
    });
    this.setData({ positionStyle: this.positionStyle() });
  },
  moveEnd(e) {
    if (this.data.processing || this.data.opening) return;
    this.move(e);
    if (!this.data.adjusting) return;
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
    this._brandedPreviewPath = "";
    this.setData({
      processing: true,
      proofing: false,
      resultPath: "",
      previewPath: "",
      displayPath: "",
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
      this.setData({ proofing: true });
      let previews;
      try {
        previews = await brandPreview.createPair(this, this.data.sourcePath, {
          displaySource: result.path,
          ratio: this.data.spec.width / this.data.spec.height,
          x: this.data.positionX,
          y: this.data.positionY,
        });
      } catch (error) {
        files.removeTemp(result.path);
        throw error;
      }
      const { displayPath, previewPath } = previews;
      if (this._unloaded || revision !== this._revision) {
        files.removeTemp(result.path);
        files.removeTemp(displayPath);
        files.removeTemp(previewPath);
        return;
      }
      if (result.sourceWidth && result.sourceHeight)
        this._sourceInfo = {
          width: result.sourceWidth,
          height: result.sourceHeight,
        };
      this._brandedPreviewPath = previewPath;
      this.setData({
        resultPath: result.path,
        displayPath,
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
        this.setData({ processing: false, proofing: false });
    }
  },
  async viewLarge() {
    const { previewPath, displayPath, resultPath } = this.data;
    if (!previewPath || !displayPath || previewPath !== this._brandedPreviewPath ||
        previewPath === displayPath || previewPath === resultPath || this.data.processing ||
        this.data.opening || this.data.adjusting || this._viewingPhoto || this._unloaded) return;
    this._viewingPhoto = true;
    try {
      await files.call("previewImage", { current: previewPath, urls: [previewPath] });
    } catch (_) {
      if (!this._unloaded) wx.showToast({ title: "大图打开失败，请重试", icon: "none" });
    } finally {
      this._viewingPhoto = false;
    }
  },
  async goExport() {
    if (
      this._unloaded ||
      this._choosing ||
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
        displayPath: this.data.displayPath,
        displayPreviewVersion: this.data.displayPath ? brandPreview.DISPLAY_VERSION : 0,
        previewPath: this.data.previewPath,
        previewWatermarkVersion: this.data.previewPath &&
          this.data.previewPath === this._brandedPreviewPath &&
          this.data.previewPath !== this.data.resultPath ? brandPreview.VERSION : 0,
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
      if (session.previewWatermarkVersion === brandPreview.VERSION &&
        this._brandedPreviewPath === session.previewPath)
        this._brandedPreviewPath = saved.previewPath;
      this.setData({
        sourcePath: saved.sourcePath,
        resultPath: saved.resultPath,
        displayPath: saved.displayPath || "",
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

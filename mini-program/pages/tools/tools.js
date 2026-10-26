const files = require("../../utils/files");
const drafts = require("../../utils/drafts");
const { transform, cropRect } = require("../../utils/image-transform");
Page({
  data: {
    mode: "compress",
    sourcePath: "",
    resultPath: "",
    displayPath: "",
    processing: false,
    opening: false,
    openingError: "",
    adjusting: false,
    cropFrameStyle: "",
    cropImageStyle: "",
    cropFallbackTransform: "",
    cropPreviewReady: false,
    accentColor: "#2563eb",
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
    this._themeChange = ({ theme }) => {
      if (!this._unloaded)
        this.setData({ accentColor: theme === "dark" ? "#78cbb4" : "#2563eb" });
    };
    if (wx.getAppBaseInfo) this._themeChange(wx.getAppBaseInfo());
    if (wx.onThemeChange) wx.onThemeChange(this._themeChange);
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
        displayPath: draft.resultPath || draft.sourcePath,
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
  onResize() {
    this.updateCropPreview();
  },
  onHide() {
    if (!this.data.opening) this.persistDraft();
  },
  onUnload() {
    this.persistDraft();
    this._unloaded = true;
    if (this._themeChange && wx.offThemeChange)
      wx.offThemeChange(this._themeChange);
    this.releaseCropMotion();
  },
  async choosePhoto() {
    if (
      this.data.processing ||
      this.data.opening ||
      this.data.adjusting ||
      this._choosing
    )
      return;
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
      displayPath: "",
      cropPreviewReady: false,
      error: "",
    });
    try {
      const info = await files.call("getImageInfo", { src: path });
      const size = await files.fileSize(path);
      if (this._unloaded) return;
      this.setData({
        processing: false,
        sourcePath: path,
        displayPath: path,
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
    if (
      this.data.processing ||
      this.data.opening ||
      !this.data.sourcePath ||
      this._unloaded
    )
      return;
    this.updateCropPreview();
    // 参数已经更新，旧结果不再代表当前设置，也不能作为当前草稿导出。
    this.setData({
      processing: true,
      error: "",
      resultPath: "",
      resultSize: "",
      openingError: "",
      errorRecovery: "retry",
    });
    try {
      const result = await transform(this, this.data.sourcePath, {
        compress: this.data.mode === "compress",
        angle: this.data.mode === "crop" ? this.data.angle : 0,
        ratio: this.data.mode === "crop" ? this.data.ratio : 0,
        x: this.data.positionX / 100,
        y: this.data.positionY / 100,
        quality: this.data.mode === "compress" ? this.data.quality / 100 : 1,
        fileType: this.data.mode === "crop" ? "png" : "jpg",
        maxEdge: this.data.mode === "compress" ? this.data.maxEdge : 4096,
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
        displayPath: result.path,
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
    if (this.data.processing || this.data.opening || this.data.adjusting)
      return;
    return this.data.sourcePath && this.data.errorRecovery === "retry"
      ? this.apply()
      : this.choosePhoto();
  },
  setQuality(e) {
    if (this.data.processing || this.data.opening || this.data.adjusting)
      return;
    if (this.data.quality === Number(e.currentTarget.dataset.quality)) return;
    this.setData({ quality: Number(e.currentTarget.dataset.quality) });
    this.apply();
  },
  setEdge(e) {
    if (this.data.processing || this.data.opening || this.data.adjusting)
      return;
    if (this.data.maxEdge === Number(e.currentTarget.dataset.edge)) return;
    this.setData({ maxEdge: Number(e.currentTarget.dataset.edge) });
    this.apply();
  },
  setRatio(e) {
    if (this.data.processing || this.data.opening || this.data.adjusting)
      return;
    const item = this.data.ratios[Number(e.currentTarget.dataset.index)];
    if (!item || this.data.ratio === item.value) return;
    this.setData({ ratio: item.value, ratioName: item.name });
    this.apply();
  },
  rotate() {
    if (this.data.processing || this.data.opening || this.data.adjusting)
      return;
    this.setData({ angle: (this.data.angle + 90) % 360 });
    this.apply();
  },
  reset() {
    if (this.data.processing || this.data.opening || this.data.adjusting)
      return;
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
    this.finishPosition("X", e);
  },
  positionY(e) {
    this.finishPosition("Y", e);
  },
  previewPositionX(e) {
    this.previewPosition("X", e);
  },
  previewPositionY(e) {
    this.previewPosition("Y", e);
  },
  previewPosition(axis, e) {
    if (this.data.processing || this.data.opening || this._unloaded) return;
    const value = Math.max(0, Math.min(100, Number(e.detail.value) || 0));
    if (!this.data.adjusting)
      this.setData({
        adjusting: true,
        resultPath: "",
        resultSize: "",
        error: "",
      });
    this._dragPosition = { axis, value };
    if (this._cropPosition) this._cropPosition[axis].value = value / 100;
    else
      this.setData({ cropFallbackTransform: this.cropTransform(axis, value) });
  },
  finishPosition(axis, e) {
    if (this.data.processing || this.data.opening || this._unloaded) return;
    this._dragPosition = null;
    this.setData({
      ["position" + axis]: Math.max(
        0,
        Math.min(100, Number(e.detail.value) || 0),
      ),
      adjusting: false,
    });
    this.apply();
  },
  cancelPosition() {
    if (!this.data.adjusting) return;
    this._dragPosition = null;
    this.setData({ adjusting: false });
    this.apply();
  },
  cropTransform(axis, value) {
    const g = this._cropGeometry || { dx: 0, dy: 0 };
    const x = axis === "X" ? value : this.data.positionX;
    const y = axis === "Y" ? value : this.data.positionY;
    return `transform:translate(${(-g.dx * x) / 100}px,${(-g.dy * y) / 100}px) rotate(${this.data.angle}deg);`;
  },
  updateCropPreview() {
    if (
      this.data.mode !== "crop" ||
      !this.data.sourceWidth ||
      !this.createSelectorQuery ||
      this._unloaded
    )
      return;
    const version = (this._previewVersion = (this._previewVersion || 0) + 1);
    this.createSelectorQuery()
      .select(".local-preview")
      .boundingClientRect()
      .exec((rects) => {
        if (this._unloaded || version !== this._previewVersion || !rects[0])
          return;
        const { sourceWidth: sw, sourceHeight: sh, angle, ratio } = this.data;
        const turned = angle % 180 !== 0;
        const ow = turned ? sh : sw,
          oh = turned ? sw : sh;
        const crop = cropRect(ow, oh, ratio);
        const scale = Math.min(
          (rects[0].width - 24) / crop.width,
          (rects[0].height - 24) / crop.height,
        );
        const dx = (ow - crop.width) * scale,
          dy = (oh - crop.height) * scale;
        this._cropGeometry = { dx, dy };
        this.releaseCropMotion();
        this.setData(
          {
            cropFrameStyle: `width:${crop.width * scale}px;height:${crop.height * scale}px;`,
            cropImageStyle: `width:${sw * scale}px;height:${sh * scale}px;left:${((ow - sw) * scale) / 2}px;top:${((oh - sh) * scale) / 2}px;`,
            cropFallbackTransform: this.cropTransform(),
            cropPreviewReady: true,
            canMoveX: dx > 0.5,
            canMoveY: dy > 0.5,
          },
          () => {
            if (this._unloaded || version !== this._previewVersion) return;
            if (!wx.worklet || !wx.worklet.shared || !this.applyAnimatedStyle)
              return;
            const x = wx.worklet.shared(this.data.positionX / 100);
            const y = wx.worklet.shared(this.data.positionY / 100);
            this._cropPosition = { X: x, Y: y };
            this.applyAnimatedStyle(
              ".crop-source",
              () => {
                "worklet";
                return {
                  transform: `translate(${-dx * x.value}px,${-dy * y.value}px) rotate(${angle}deg)`,
                };
              },
              {},
              (result) => {
                const id =
                  typeof result === "number"
                    ? result
                    : result && result.styleId;
                if (id === undefined || id === null) return;
                if (this._unloaded || version !== this._previewVersion) {
                  if (this.clearAnimatedStyle)
                    this.clearAnimatedStyle(".crop-source", [id]);
                } else this._cropStyleId = id;
              },
            );
          },
        );
      });
  },
  releaseCropMotion() {
    if (this._cropStyleId !== undefined && this.clearAnimatedStyle)
      this.clearAnimatedStyle(".crop-source", [this._cropStyleId]);
    this._cropStyleId = undefined;
    this._cropPosition = null;
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
      ) {
        this.setData({
          sourcePath: saved.sourcePath,
          resultPath: saved.resultPath,
          displayPath:
            this.data.displayPath === snapshot.resultPath
              ? saved.resultPath
              : this.data.displayPath,
        });
      }
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
    if (
      this._unloaded ||
      this.data.processing ||
      this.data.adjusting ||
      !this.data.resultPath ||
      this._opening
    )
      return;
    this._opening = true;
    this.setData({ opening: true, openingError: "" });
    let navigating = false;
    const finish = () => {
      this._opening = false;
      if (!this._unloaded) this.setData({ opening: false });
    };
    const fail = () => {
      if (!this._unloaded)
        this.setData({ openingError: "未能打开下一步，请再次点击重试" });
    };
    try {
      const draft = await this.persistDraft();
      if (this._unloaded) return;
      if (this.data.returnToEditor) {
        this.getOpenerEventChannel().emit("adjusted", {
          path: (draft || this.snapshot()).resultPath,
        });
        navigating = true;
        wx.navigateBack({ fail, complete: finish });
        return;
      }
      getApp().globalData.exportSession = draft || this.snapshot();
      navigating = true;
      wx.navigateTo({ url: "/pages/export/export", fail, complete: finish });
    } catch (error) {
      navigating = false;
      fail();
    } finally {
      if (!navigating) finish();
    }
  },
  makeIdPhoto() {
    if (
      !this.data.processing &&
      !this.data.opening &&
      !this.data.adjusting &&
      this.data.resultPath
    )
      wx.navigateTo({
        url: `/pages/edit/edit?src=${encodeURIComponent(this.data.resultPath)}`,
      });
  },
});

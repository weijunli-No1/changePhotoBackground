const { createMotion } = require("../../utils/skyline-motion");
const api = require("../../utils/api");
const files = require("../../utils/files");
const drafts = require("../../utils/drafts");
const { sizes, validateSize, getSpec } = require("../../utils/photo-specs");
const brandPreview = require("../../utils/brand-preview");
const { prepare: prepareExam } = require("../../utils/exam-image");
Page({
  onShareAppMessage() {
    return { title: "拾光小相｜制作证件照，轻松换底色", path: "/pages/index/index" };
  },
  onShareTimeline() {
    return { title: "拾光小相｜制作证件照，轻松换底色", query: "" };
  },

  data: {
    toolId: "idphoto",
    exportAction: "",
    sourcePath: "",
    resultPath: "",
    previewPath: "",
    displayPath: "",
    comparing: false,
    comparison: 50,
    phase: "",
    processing: false,
    opening: false,
    openingError: "",
    status: "",
    error: "",
    errorRecovery: "retry",
    panel: "color",
    specVisible: false,
    colorPickerVisible: false,
    colorReady: false,
    currentBgColor: "#FFFFFF",
    size: sizes[0],
    presetColors: [
      { name: "白色", value: "#FFFFFF" },
      { name: "蓝色", value: "#638cce" },
      { name: "红色", value: "#FF0000" },
    ],
    custom: false,
  },
  async onLoad(options) {
    this._unloaded = false;
    this._seq = 0;
    this._colorSeq = 0;
    this._brandedPreviewPath = "";
    this._draftId = options.draft || drafts.createId();
    const draft = options.draft ? drafts.get(options.draft) : null;
    const restoreSeq = this._seq;
    this._restoringDraft = draft ? this._draftId : "";
    this._examSpec = getSpec(draft ? draft.specId : options.spec);
    if (this._examSpec && this._examSpec.category === "common") this._examSpec = null;
    this.setData({
      exportAction: (draft ? draft.exportAction : options.exportAction) === "layout" ? "layout" : "",
      toolId:
        (draft && draft.toolId === "background") || options.tool === "background"
          ? "background"
          : "idphoto",
    });
    if (options.draft && !draft) {
      this.setData({
        error: "草稿已被清理，请重新选择照片",
        errorRecovery: "reselect",
      });
      return;
    }
    try {
      if (draft) {
        await files.call("getImageInfo", { src: draft.sourcePath });
        if (this._unloaded || this._seq !== restoreSeq) return;
        this._transparentPath = draft.transparentPath || "";
        this.setData({
          sourcePath: draft.sourcePath,
          resultPath: "",
          previewPath: "",
          displayPath: "",
          size: {
            name: draft.sizeName || "自定义",
            width: draft.width,
            height: draft.height,
          },
          currentBgColor: draft.bgColor || "#FFFFFF",
          custom: !["#FFFFFF", "#638cce", "#FF0000"].includes(draft.bgColor),
        });
        if (this._transparentPath) {
          try {
            const transparent = await files.readBase64(this._transparentPath);
            if (this._unloaded || this._seq !== restoreSeq) return;
            this._transparent = transparent;
          } catch (error) {
            if (this._unloaded || this._seq !== restoreSeq) return;
            this._transparentPath = "";
            this._transparent = "";
          }
        }
        if (draft.resultPath && this._transparent) {
          const seq = ++this._seq;
          this._mattingBusy = true;
          this.setData({ processing: true, phase: "proof", status: "正在恢复照片", colorReady: false });
          try {
            await files.call("getImageInfo", { src: draft.resultPath });
            const { displayPath, previewPath } = await brandPreview.createPair(this, draft.resultPath);
            if (this._unloaded || seq !== this._seq) {
              files.removeTemp(displayPath);
              files.removeTemp(previewPath);
              return;
            }
            this._restoringDraft = "";
            this._brandedPreviewPath = previewPath;
            this._mattingBusy = false;
            this.setData({ resultPath: draft.resultPath, displayPath, previewPath, processing: false, status: "", colorReady: true });
            this._appliedColor = draft.bgColor || "#FFFFFF";
            await this.persistDraft();
            return;
          } catch (error) {
            if (this._unloaded || seq !== this._seq) return;
            this._mattingBusy = false;
            this._failedColor = this.data.currentBgColor;
            this.setData({
              resultPath: "", displayPath: "", previewPath: "", processing: false, status: "",
              colorReady: true, error: "未能恢复预览，请重试", errorRecovery: "retry",
            });
            return;
          }
        }
      } else if (options.src) {
        let size = sizes[0];
        if (options.width && options.height)
          size = {
            ...validateSize(options.width, options.height),
            name: options.name ? decodeURIComponent(options.name) : "自定义",
          };
        this.setData({ sourcePath: decodeURIComponent(options.src), size });
      } else {
        this.setData({ error: "请先选择一张照片", errorRecovery: "reselect" });
        return;
      }
      this.processTransparentImage();
    } catch (error) {
      if (!this._unloaded && (!draft || this._seq === restoreSeq))
        this.setData({
          error: "草稿文件不可用，请重新选择照片",
          errorRecovery: "reselect",
          processing: false,
        });
    }
  },
  onReady() {
    this._motion = createMotion(this, wx);
    this.updatePanelMotion();
  },
  updatePanelMotion() {
    if (this._motion)
      this._motion.indicator(".editor-tabs", ".editor-tab.active", ".editor-indicator", {
        maxWidth: 32,
      });
  },
  onHide() {
    if (this.data.comparing) this.setData({ comparing: false });
    if (!this.data.opening) this.persistDraft();
  },
  onUnload() {
    this.persistDraft();
    this._unloaded = true;
    if (this._motion) this._motion.dispose();
    this._seq++;
    this._colorSeq++;
    clearTimeout(this._colorTimer);
    if (this._activeTask && this._activeTask.abort) this._activeTask.abort();
    this._activeTask = null;
  },
  setPanel(e) {
    const panel = e.currentTarget.dataset.panel;
    if (panel === "size" && (this._mattingBusy || this.data.opening)) return;
    if (panel === this.data.panel) return;
    this.setData({ panel }, () => {
      this.updatePanelMotion();
      if (this._motion) this._motion.fade(".panel-content");
    });
    if (panel === "size") this.setData({ specVisible: true });
  },
  showSpecs() {
    if (!this._mattingBusy && !this.data.opening) this.setData({ specVisible: true });
  },
  closeSpecs() {
    this.setData({ specVisible: false });
  },
  browseSpecs() {
    if (this.data.processing || this.data.opening) return;
    this.setData({ specVisible: false, openingError: "" });
    wx.navigateTo({
      url: `/pages/specs/specs?select=1&width=${this.data.size.width}&height=${this.data.size.height}&name=${encodeURIComponent(this.data.size.name)}&tool=${this.data.toolId}&spec=${this._examSpec ? this._examSpec.id : ""}`,
      success: (res) =>
        res.eventChannel.on("selected", (value) => {
          if (!this._unloaded && value.size) this.selectSpec({ detail: value.size });
        }),
      fail: () => {
        if (!this._unloaded) this.setData({ openingError: "规格目录未能打开，请重试" });
      },
    });
  },
  selectSpec(e) {
    if (this.data.opening || this._mattingBusy || this._unloaded) return;
    const size = e.detail;
    const selected = getSpec(size.specId);
    const examSpec = selected && selected.category !== "common" ? selected : null;
    const sameRules =
      ((this._examSpec && this._examSpec.id) || "") === ((examSpec && examSpec.id) || "");
    const sameDimensions =
      size.width === this.data.size.width && size.height === this.data.size.height;
    this._examSpec = examSpec;
    this.setData({ specVisible: false, panel: "color", size }, () => this.updatePanelMotion());
    if (sameRules && sameDimensions) return;
    this.processTransparentImage();
  },
  async processTransparentImage() {
    if (!this.data.sourcePath || this._unloaded) return;
    clearTimeout(this._colorTimer);
    this._queuedColor = "";
    const seq = ++this._seq;
    this._colorSeq++;
    this._mattingBusy = true;
    this._transparent = "";
    this._transparentPath = "";
    this._failedColor = "";
    this._brandedPreviewPath = "";
    this.setData({
      processing: true,
      comparing: false,
      phase: "detect",
      status: "正在识别人像轮廓",
      error: "",
      errorRecovery: "retry",
      resultPath: "",
      // A new source must never keep displaying the previous photo on failure.
      previewPath: "",
      displayPath: "",
      colorReady: false,
    });
    try {
      const data = await api.upload(this.data.sourcePath, this.data.size, (task) => {
        this._activeTask = task;
      });
      if (this._unloaded || seq !== this._seq) return;
      const transparent = files.cleanBase64(
        data.image_base64_hd || data.image_base64_standard,
      );
      if (!transparent) throw new Error("没有生成有效照片，请换一张正面照片");
      const transparentPath = await files.writeBase64(transparent, "transparent");
      if (this._unloaded || seq !== this._seq) {
        files.removeTemp(transparentPath);
        return;
      }
      this._transparent = transparent;
      this._transparentPath = transparentPath;
      this._mattingBusy = false;
      this.setData({ colorReady: true });
      await this.changeBackgroundColor(this.data.currentBgColor);
    } catch (error) {
      if (!this._unloaded && seq === this._seq)
        this.setData({
          processing: false,
          error: error.message || "照片处理失败，请重试",
          status: "",
        });
    } finally {
      if (seq === this._seq) {
        if (this._mattingBusy) this._activeTask = null;
        this._mattingBusy = false;
      }
    }
  },
  async changeBackgroundColor(color) {
    if (!this._transparent || this._unloaded) return;
    // 同色成功结果可复用；失败后的同色操作仍允许重试。
    if (color === this._requestedColor && this.data.processing) return;
    if (color === this._appliedColor && this.data.resultPath) {
      this._colorSeq++;
      if (this._activeTask && this._activeTask.abort) this._activeTask.abort();
      this._activeTask = null;
      this._requestedColor = "";
      this._failedColor = "";
      this.setData({
        processing: false,
        currentBgColor: color,
        status: "",
        error: "",
      });
      return;
    }
    const seq = ++this._colorSeq,
      sourceSeq = this._seq;
    if (this._activeTask && this._activeTask.abort) this._activeTask.abort();
    this._activeTask = null;
    this._requestedColor = color;
    this._failedColor = "";
    this.setData({
      processing: true,
      comparing: false,
      phase: "compose",
      currentBgColor: color,
      error: "",
      errorRecovery: "retry",
      status: "正在合成背景",
    });
    try {
      const data = api.unwrap(
        await api.request(
          "/api/photo/add-background",
          {
            method: "POST",
            header: { "content-type": "application/x-www-form-urlencoded" },
            data: { base64Image: this._transparent, color },
          },
          (task) => {
            if (seq === this._colorSeq && sourceSeq === this._seq)
              this._activeTask = task;
            else if (task && task.abort) task.abort();
          },
        ),
      );
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq) return;
      if (!data || data.status === false) throw new Error("换底色失败，请重试");
      let path = await files.writeBase64(data.image_base64, "photo");
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq) {
        files.removeTemp(path);
        return;
      }
      const previewSource = path;
      if (this._examSpec) {
        this.setData({ phase: "proof", status: "正在适配考试规格" });
        const examSpec = this._examSpec;
        let adapted;
        try {
          adapted = await brandPreview.withCanvas(this, () =>
            prepareExam(this, previewSource, examSpec, { x: 50, y: 50 }),
          );
        } catch (error) {
          files.removeTemp(previewSource);
          throw error;
        }
        path = adapted.path;
        if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq) {
          files.removeTemp(path);
          files.removeTemp(previewSource);
          return;
        }
      }
      this.setData({ phase: "proof", status: "正在生成预览" });
      let previews;
      try {
        previews = await brandPreview.createPair(this, previewSource, { displaySource: path });
      } catch (error) {
        files.removeTemp(path);
        throw error;
      } finally {
        if (path !== previewSource) files.removeTemp(previewSource);
      }
      const { displayPath, previewPath } = previews;
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq) {
        files.removeTemp(path);
        files.removeTemp(displayPath);
        files.removeTemp(previewPath);
        return;
      }
      this._activeTask = null;
      this._requestedColor = "";
      this._appliedColor = color;
      this._restoringDraft = "";
      this._brandedPreviewPath = previewPath;
      this.setData({
        resultPath: path,
        displayPath,
        previewPath,
        currentBgColor: color,
        processing: false,
        status: "",
      });
      this.persistDraft();
    } catch (error) {
      if (!this._unloaded && seq === this._colorSeq && sourceSeq === this._seq) {
        this._activeTask = null;
        this._requestedColor = "";
        this._failedColor = color;
        this.setData({
          processing: false,
          error: error.message || "换底色失败，请重试",
          status: "",
          currentBgColor: this._appliedColor || "#FFFFFF",
          custom: !["#FFFFFF", "#638cce", "#FF0000"].includes(
            this._appliedColor || "#FFFFFF",
          ),
        });
      }
    }
  },
  selectColor(e) {
    if (!this._transparent || this._mattingBusy || this.data.opening) return;
    clearTimeout(this._colorTimer);
    this.setData({ custom: false });
    this.queueColor(e.currentTarget.dataset.color);
  },
  queueColor(color) {
    if (!this._transparent || this._mattingBusy || this.data.opening || this._unloaded) return;
    if (
      this.data.processing &&
      (this._queuedColor === color || this._requestedColor === color)
    )
      return;
    clearTimeout(this._colorTimer);
    this._queuedColor = "";
    // 立即更新选中态，但合并短时间内连续点选产生的请求。
    if (color === this._appliedColor && this.data.resultPath)
      return this.changeBackgroundColor(color);
    this._colorSeq++;
    if (this._activeTask && this._activeTask.abort) this._activeTask.abort();
    this._activeTask = null;
    this._requestedColor = "";
    this._queuedColor = color;
    this._failedColor = color;
    this.setData({
      currentBgColor: color,
      processing: true,
      comparing: false,
      phase: "compose",
      status: "正在合成背景",
      error: "",
    });
    this._colorTimer = setTimeout(() => {
      this._queuedColor = "";
      this.changeBackgroundColor(color);
    }, 140);
  },
  showCustomColor() {
    if (this._transparent && !this._mattingBusy && !this.data.opening)
      this.setData({ colorPickerVisible: true });
  },
  closeCustomColor() {
    this.setData({ colorPickerVisible: false });
  },
  customColor(e) {
    if (!this._transparent || this._mattingBusy || this.data.opening) return;
    const color = e.detail.value;
    if (!/^#[a-fA-F0-9]{6}$/.test(color)) return;
    this.setData({ custom: true });
    this.queueColor(color);
  },
  toggleCompare() {
    if (!this.data.sourcePath || !this.data.previewPath || this.data.processing || this.data.opening) return;
    this.setData({ comparing: !this.data.comparing }, () => this.measureComparison());
  },
  onResize() {
    this.updatePanelMotion();
    this.measureComparison();
  },
  measureComparison() {
    this._compareRect = null;
    if (!this.data.comparing || !this.createSelectorQuery) return;
    this.createSelectorQuery().select(".studio-artboard").boundingClientRect().exec((rects) => {
      if (!this._unloaded && this.data.comparing && rects[0] && rects[0].width > 0)
        this._compareRect = rects[0];
    });
  },
  scrubComparison(e) {
    if (!this._compareRect || e.touches.length !== 1) return;
    const { left, width } = this._compareRect;
    this.setComparison(100 * (e.touches[0].clientX - left) / width);
  },
  slideComparison(e) {
    this.setComparison(Number(e.detail.value));
  },
  setComparison(value) {
    if (!this.data.comparing || !Number.isFinite(value)) return;
    const comparison = Math.max(0, Math.min(100, Math.round(value)));
    if (comparison !== this.data.comparison) this.setData({ comparison });
  },
  cancelProcessing() {
    if (!this.data.processing) return;
    this._seq++;
    this._colorSeq++;
    this._mattingBusy = false;
    this._failedColor = this._transparent ? this.data.currentBgColor : "";
    clearTimeout(this._colorTimer);
    this._queuedColor = "";
    this._requestedColor = "";
    if (this._activeTask && this._activeTask.abort) this._activeTask.abort();
    this._activeTask = null;
    const color = this._appliedColor || this.data.currentBgColor;
    this.setData({
      processing: false,
      status: "",
      error: "处理已取消，可重试或重新选择照片",
      errorRecovery: "retry",
      colorReady: !!this._transparent,
      currentBgColor: color,
      custom: !["#FFFFFF", "#638cce", "#FF0000"].includes(color),
    });
  },
  keepLastEffect() {
    if (!this.data.processing && !this.data.opening && this.data.resultPath && this._appliedColor)
      return this.changeBackgroundColor(this._appliedColor);
  },
  retry() {
    if (this.data.processing) return;
    if (this.data.errorRecovery === "reselect" || !this.data.sourcePath)
      return this.reselect();
    if (this._transparent && this._failedColor)
      return this.changeBackgroundColor(this._failedColor);
    return this.processTransparentImage();
  },
  async reselect() {
    if (this.data.processing || this.data.opening || this._choosing || this._adjusting || this._unloaded) return;
    this._choosing = true;
    try {
      const res = await files.call("chooseMedia", {
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["original"],
      });
      if (this._unloaded) return;
      const photo = res.tempFiles && res.tempFiles[0];
      if (!photo || !photo.tempFilePath) throw Error("未能读取照片，请重新选择");
      this._draftId = drafts.createId();
      this.setData({ sourcePath: photo.tempFilePath });
      this.processTransparentImage();
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || ""))
        wx.showToast({ title: "选择照片失败", icon: "none" });
    } finally {
      this._choosing = false;
    }
  },
  adjustPhoto() {
    if (this.data.processing || this.data.opening || this._choosing || this._adjusting || this._unloaded || !this.data.sourcePath) return;
    this._adjusting = true;
    this.setData({ openingError: "" });
    wx.navigateTo({
      url: `/pages/tools/tools?mode=crop&src=${encodeURIComponent(this.data.sourcePath)}&returnToEditor=1`,
      success: (res) => {
        res.eventChannel.on("adjusted", (result) => {
          if (this._unloaded) return;
          this.setData({ sourcePath: result.path });
          this.processTransparentImage();
        });
      },
      fail: () => {
        if (!this._unloaded) this.setData({ openingError: "裁剪页未能打开，请重试" });
      },
      complete: () => { this._adjusting = false; },
    });
  },
  snapshot() {
    return {
      id: this._draftId,
      mode: "idphoto",
      toolId: this.data.toolId,
      ...(this.data.exportAction === "layout" ? { exportAction: "layout" } : {}),
      sourcePath: this.data.sourcePath,
      resultPath: this.data.resultPath,
      displayPath: this.data.displayPath,
      displayPreviewVersion: this.data.displayPath ? brandPreview.DISPLAY_VERSION : 0,
      previewPath: this.data.previewPath,
      previewWatermarkVersion: this.data.previewPath &&
        this.data.previewPath === this._brandedPreviewPath &&
        this.data.previewPath !== this.data.resultPath ? brandPreview.VERSION : 0,
      requiresQuota: true,
      specId: this._examSpec ? this._examSpec.id : "",
      transparentPath: this._transparentPath || "",
      width: this.data.size.width,
      height: this.data.size.height,
      sizeName: this.data.size.name,
      bgColor: this.data.processing
        ? this._appliedColor || this.data.currentBgColor
        : this.data.currentBgColor,
    };
  },
  async persistDraft() {
    if (!this.data.sourcePath || (this._restoringDraft && this._restoringDraft === this._draftId)) return null;
    const snapshot = this.snapshot();
    try {
      const saved = await drafts.save(snapshot);
      if (
        !this._unloaded &&
        this.data.sourcePath === snapshot.sourcePath &&
        this.data.resultPath === snapshot.resultPath
      ) {
        if (snapshot.previewWatermarkVersion === brandPreview.VERSION &&
          this._brandedPreviewPath === snapshot.previewPath)
          this._brandedPreviewPath = saved.previewPath;
        this.setData({
          sourcePath: saved.sourcePath,
          resultPath: saved.resultPath,
          displayPath: saved.displayPath || "",
          previewPath: saved.previewPath,
        });
        if (this._transparentPath === snapshot.transparentPath)
          this._transparentPath = saved.transparentPath;
      }
      return saved;
    } catch (error) {
      if (!this._draftWarning && !this._unloaded) {
        this._draftWarning = true;
        wx.showToast({ title: "草稿保存失败，请检查可用空间", icon: "none" });
      }
      return null;
    }
  },
  async viewLarge() {
    const { previewPath, displayPath, resultPath } = this.data;
    if (!previewPath || !displayPath || previewPath !== this._brandedPreviewPath ||
        previewPath === displayPath || previewPath === resultPath || this.data.processing ||
        this.data.opening || this.data.comparing || this._viewingPhoto || this._unloaded) return;
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
    if (this._unloaded || this._opening || this.data.processing || !this.data.resultPath)
      return;
    this._opening = true;
    this.setData({ opening: true, openingError: "" });
    let navigating = false;
    try {
      const draft = await this.persistDraft();
      if (this._unloaded) return;
      getApp().globalData.exportSession = draft || this.snapshot();
      navigating = true;
      wx.navigateTo({
        url: "/pages/export/export",
        fail: () => {
          if (!this._unloaded)
            this.setData({ openingError: "保存页未能打开，请再次点击重试" });
        },
        complete: () => {
          this._opening = false;
          if (!this._unloaded) this.setData({ opening: false });
        },
      });
    } catch (error) {
      navigating = false;
      if (!this._unloaded)
        this.setData({ openingError: "保存页未能打开，请再次点击重试" });
    } finally {
      if (!navigating) {
        this._opening = false;
        if (!this._unloaded) this.setData({ opening: false });
      }
    }
  },
});

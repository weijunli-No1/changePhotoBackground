const { createMotion } = require("../../utils/skyline-motion");
const api = require("../../utils/api");
const files = require("../../utils/files");
const drafts = require("../../utils/drafts");
const { sizes, validateSize, getSpec } = require("../../utils/photo-specs");
const brandPreview = require("../../utils/brand-preview");
const { prepare: prepareExam } = require("../../utils/exam-image");
Page({
  data: {
    toolId: "idphoto",
    sourcePath: "",
    resultPath: "",
    previewPath: "",
    comparing: false,
    processing: false,
    opening: false,
    openingError: "",
    status: "",
    error: "",
    errorRecovery: "retry",
    panel: "color",
    specVisible: false,
    colorPickerVisible: false,
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
    this._draftId = options.draft || drafts.createId();
    const draft = options.draft ? drafts.get(options.draft) : null;
    this._examSpec = getSpec(draft ? draft.specId : options.spec);
    if (this._examSpec && this._examSpec.category === "common")
      this._examSpec = null;
    this.setData({
      toolId:
        (draft && draft.toolId === "background") ||
        options.tool === "background"
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
        this._transparentPath = draft.transparentPath || "";
        this.setData({
          sourcePath: draft.sourcePath,
          resultPath: draft.resultPath || "",
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
            this._transparent = await files.readBase64(this._transparentPath);
          } catch (error) {
            this._transparentPath = "";
            this._transparent = "";
          }
        }
        if (draft.resultPath && this._transparent) {
          try {
            await files.call("getImageInfo", { src: draft.resultPath });
            let previewPath = draft.previewPath || "";
            try {
              if (!previewPath) throw Error("missing");
              await files.call("getImageInfo", { src: previewPath });
            } catch (error) {
              previewPath = await brandPreview.create(this, draft.resultPath);
            }
            if (this._unloaded) return;
            this.setData({ previewPath });
            this._appliedColor = draft.bgColor || "#FFFFFF";
            return;
          } catch (error) {
            this.setData({ resultPath: "" });
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
      if (!this._unloaded)
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
      this._motion.indicator(
        ".editor-tabs",
        ".editor-tab.active",
        ".editor-indicator",
      );
  },
  onHide() {
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
    if (!this._mattingBusy && !this.data.opening)
      this.setData({ specVisible: true });
  },
  closeSpecs() {
    this.setData({ specVisible: false });
  },
  browseSpecs() {
    if (this.data.processing || this.data.opening) return;
    this.setData({ specVisible: false });
    wx.navigateTo({
      url: "/pages/specs/specs?select=1",
      success: (res) =>
        res.eventChannel.on("selected", (value) => {
          if (!this._unloaded && value.size)
            this.selectSpec({ detail: value.size });
        }),
      fail: () => {
        if (!this._unloaded)
          this.setData({ error: "规格目录未能打开，请重试" });
      },
    });
  },
  selectSpec(e) {
    if (this.data.opening || this._mattingBusy || this._unloaded) return;
    const size = e.detail;
    const selected = getSpec(size.specId);
    const examSpec =
      selected && selected.category !== "common" ? selected : null;
    const sameRules =
      ((this._examSpec && this._examSpec.id) || "") ===
      ((examSpec && examSpec.id) || "");
    const sameDimensions =
      size.width === this.data.size.width &&
      size.height === this.data.size.height;
    this._examSpec = examSpec;
    this.setData({ specVisible: false, panel: "color" });
    this.setData({ size });
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
    this.setData({
      processing: true,
      status: "正在识别人像与制作证件照",
      error: "",
      errorRecovery: "retry",
      resultPath: "",
    });
    try {
      const data = await api.upload(
        this.data.sourcePath,
        this.data.size,
        (task) => {
          this._activeTask = task;
        },
      );
      if (this._unloaded || seq !== this._seq) return;
      const transparent = files.cleanBase64(
        data.image_base64_hd || data.image_base64_standard,
      );
      if (!transparent) throw new Error("没有生成有效照片，请换一张正面照片");
      const transparentPath = await files.writeBase64(
        transparent,
        "transparent",
      );
      if (this._unloaded || seq !== this._seq) {
        files.removeTemp(transparentPath);
        return;
      }
      this._transparent = transparent;
      this._transparentPath = transparentPath;
      this._mattingBusy = false;
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
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq)
        return;
      if (!data || data.status === false) throw new Error("换底色失败，请重试");
      let path = await files.writeBase64(data.image_base64, "photo");
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq) {
        files.removeTemp(path);
        return;
      }
      const previewSource = path;
      if (this._examSpec) {
        const adapted = await prepareExam(this, path, this._examSpec, {
          x: 50,
          y: 50,
        });
        path = adapted.path;
      }
      const previewPath = await brandPreview.create(this, previewSource);
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq) {
        files.removeTemp(path);
        files.removeTemp(previewPath);
        return;
      }
      this._activeTask = null;
      this._requestedColor = "";
      this._appliedColor = color;
      this.setData({
        resultPath: path,
        previewPath,
        currentBgColor: color,
        processing: false,
        status: "",
      });
      this.persistDraft();
    } catch (error) {
      if (
        !this._unloaded &&
        seq === this._colorSeq &&
        sourceSeq === this._seq
      ) {
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
    if (this._mattingBusy || this.data.opening) return;
    clearTimeout(this._colorTimer);
    this.setData({ custom: false });
    this.queueColor(e.currentTarget.dataset.color);
  },
  queueColor(color) {
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
  compareStart() {
    this.setData({ comparing: true });
  },
  compareEnd() {
    this.setData({ comparing: false });
  },
  toggleCompare() {
    if (this.data.sourcePath) this.setData({ comparing: !this.data.comparing });
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
      currentBgColor: color,
      custom: !["#FFFFFF", "#638cce", "#FF0000"].includes(color),
    });
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
    if (this.data.processing || this.data.opening) return;
    try {
      const res = await files.call("chooseMedia", {
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["original"],
      });
      if (this._unloaded) return;
      this._draftId = drafts.createId();
      this.setData({ sourcePath: res.tempFiles[0].tempFilePath });
      this.processTransparentImage();
    } catch (error) {
      if (!/cancel/.test(error.errMsg || ""))
        wx.showToast({ title: "选择照片失败", icon: "none" });
    }
  },
  adjustPhoto() {
    if (this.data.processing || this.data.opening || !this.data.sourcePath)
      return;
    wx.navigateTo({
      url: `/pages/tools/tools?mode=crop&src=${encodeURIComponent(this.data.sourcePath)}&returnToEditor=1`,
      success: (res) => {
        res.eventChannel.on("adjusted", (result) => {
          if (this._unloaded) return;
          this.setData({ sourcePath: result.path });
          this.processTransparentImage();
        });
      },
    });
  },
  snapshot() {
    return {
      id: this._draftId,
      mode: "idphoto",
      toolId: this.data.toolId,
      sourcePath: this.data.sourcePath,
      resultPath: this.data.resultPath,
      previewPath: this.data.previewPath,
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
  async goExport() {
    if (
      this._unloaded ||
      this._opening ||
      this.data.processing ||
      !this.data.resultPath
    )
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

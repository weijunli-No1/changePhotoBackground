const api = require("../../utils/api");
const files = require("../../utils/files");
const drafts = require("../../utils/drafts");
const { sizes, validateSize } = require("../../utils/photo-specs");
Page({
  data: {
    toolId: "idphoto",
    sourcePath: "",
    resultPath: "",
    comparing: false,
    processing: false,
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
  onHide() {
    this.persistDraft();
  },
  onUnload() {
    this.persistDraft();
    this._unloaded = true;
    this._seq++;
    this._colorSeq++;
    clearTimeout(this._colorTimer);
    if (this._activeTask && this._activeTask.abort) this._activeTask.abort();
    this._activeTask = null;
  },
  setPanel(e) {
    const panel = e.currentTarget.dataset.panel;
    if (panel === "size" && this._mattingBusy) return;
    this.setData({ panel });
    if (panel === "size") this.setData({ specVisible: true });
  },
  showSpecs() {
    if (!this._mattingBusy) this.setData({ specVisible: true });
  },
  closeSpecs() {
    this.setData({ specVisible: false });
  },
  selectSpec(e) {
    const size = e.detail;
    this.setData({ specVisible: false, panel: "color" });
    if (
      size.width === this.data.size.width &&
      size.height === this.data.size.height
    )
      return;
    if (this._mattingBusy) return;
    this.setData({ size });
    this.processTransparentImage();
  },
  async processTransparentImage() {
    if (!this.data.sourcePath || this._unloaded) return;
    clearTimeout(this._colorTimer);
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
        this._mattingBusy = false;
        this._activeTask = null;
      }
    }
  },
  async changeBackgroundColor(color) {
    if (!this._transparent || this._unloaded) return;
    const seq = ++this._colorSeq,
      sourceSeq = this._seq;
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
            this._activeTask = task;
          },
        ),
      );
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq)
        return;
      if (!data || data.status === false) throw new Error("换底色失败，请重试");
      const path = await files.writeBase64(data.image_base64, "photo");
      if (this._unloaded || seq !== this._colorSeq || sourceSeq !== this._seq) {
        files.removeTemp(path);
        return;
      }
      this._activeTask = null;
      this._appliedColor = color;
      this.setData({
        resultPath: path,
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
    if (this._mattingBusy) return;
    clearTimeout(this._colorTimer);
    this.setData({ custom: false });
    this.changeBackgroundColor(e.currentTarget.dataset.color);
  },
  showCustomColor() {
    if (this._transparent && !this._mattingBusy)
      this.setData({ colorPickerVisible: true });
  },
  closeCustomColor() {
    this.setData({ colorPickerVisible: false });
  },
  customColor(e) {
    if (!this._transparent || this._mattingBusy) return;
    const color = e.detail.value;
    if (!/^#[a-fA-F0-9]{6}$/.test(color)) return;
    this.setData({
      custom: true,
      processing: true,
      status: "正在合成背景",
      error: "",
    });
    clearTimeout(this._colorTimer);
    this._colorTimer = setTimeout(() => this.changeBackgroundColor(color), 240);
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
    if (this.data.processing) return;
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
    if (this.data.processing || !this.data.sourcePath) return;
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
    if (this._opening || this.data.processing || !this.data.resultPath) return;
    this._opening = true;
    try {
      const draft = await this.persistDraft();
      if (this._unloaded) return;
      getApp().globalData.exportSession = draft || this.snapshot();
      wx.navigateTo({ url: "/pages/export/export" });
    } finally {
      this._opening = false;
    }
  },
});

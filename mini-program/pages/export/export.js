const app = getApp();
const api = require("../../utils/api");
const files = require("../../utils/files");
const brandPreview = require("../../utils/brand-preview");
const { createRewardedVideoPlayer } = require("../../utils/rewarded-video");
Page({
  data: {
    previewPath: "",
    action: "single",
    sizeName: "",
    colorName: "",
    width: 0,
    height: 0,
    local: false,
    outputNote: "",
    allowLayout: true,
    previewPreparing: false,
    previewFailed: false,
    unavailable: false,
    previewCaption: "",
    busy: false,
    savingStage: "",
    saved: false,
    error: "",
    quotaVisible: false,
    quotaKnown: false,
    remaining: 0,
    unlimited: false,
    login: false,
    layoutSlots: [0, 1, 2, 3, 4, 5],
    actualWidth: 0,
    actualHeight: 0,
  },
  onLoad() {
    this._unloaded = false;
    this._saveInProgress = false;
    this._cloudResults = Object.create(null);
    this._layoutPaths = [];
    this._videoPlayer = createRewardedVideoPlayer(wx);
    const session = app.globalData.exportSession;
    if (!session || !session.resultPath) {
      this.markUnavailable();
      return;
    }
    this._session = { ...session };
    const requiresQuota =
      ["idphoto", "exam"].includes(session.mode) ||
      session.requiresQuota === true;
    this.setData({
      previewPath:
        session.previewPath || (requiresQuota ? "" : session.resultPath),
      previewPreparing: requiresQuota && !session.previewPath,
      previewCaption:
        session.mode === "exam" || session.specId
          ? "预览保留高清，保存按所选规格输出；小像素标准照放大查看会影响清晰感。"
          : "",
      local: !requiresQuota,
      allowLayout: session.mode === "idphoto",
      outputNote: session.outputNote || "",
      sizeName: session.sizeName || "本地照片",
      width: session.width,
      height: session.height,
      colorName:
        { "#FFFFFF": "白底", "#638cce": "蓝底", "#FF0000": "红底" }[
          session.bgColor
        ] || "自定义底色",
      login: Boolean(app.globalData.openid),
    });
    this.fetchUsage();
    if (requiresQuota && !session.previewPath) {
      this.retryPreview();
    }
    files
      .call("getImageInfo", { src: session.resultPath })
      .then((info) => {
        if (!this._unloaded)
          this.setData({ actualWidth: info.width, actualHeight: info.height });
      })
      .catch(() => {
        if (!this._unloaded) this.markUnavailable();
      });
  },
  markUnavailable() {
    this.setData({
      unavailable: true,
      previewPreparing: false,
      previewPath: "",
      allowLayout: false,
      local: true,
      sizeName: "作品暂不可用",
      outputNote: "请返回编辑，重新生成照片后再保存。",
      error: "照片文件已失效，编辑中的草稿可在作品页继续打开。",
    });
  },
  previewError() {
    if (this._unloaded || this.data.unavailable) return;
    this.setData({
      previewPath: "",
      previewFailed: true,
      error: "预览未能加载，请重新加载或返回编辑。",
    });
  },
  async retryPreview() {
    if (
      this._unloaded ||
      this._previewLoading ||
      this.data.unavailable ||
      !this._session
    )
      return;
    this._previewLoading = true;
    this.setData({ previewPreparing: true, previewFailed: false, error: "" });
    try {
      const path = this.data.local
        ? this._session.resultPath
        : await brandPreview.create(this, this._session.resultPath);
      if (this.data.local) await files.call("getImageInfo", { src: path });
      if (this._unloaded || this.data.unavailable) {
        if (!this.data.local) files.removeTemp(path);
        return;
      }
      this.setData({ previewPath: path });
    } catch (error) {
      if (!this._unloaded && !this.data.unavailable)
        this.setData({
          previewFailed: true,
          error: "预览未能加载，请重试或返回编辑。",
        });
    } finally {
      this._previewLoading = false;
      if (!this._unloaded) this.setData({ previewPreparing: false });
    }
  },
  returnToEdit() {
    if (this.data.busy || this._saveInProgress || this._unloaded) return;
    wx.navigateBack({ fail: () => this.backToTools() });
  },
  onUnload() {
    this._unloaded = true;
    if (this._confirmAd) this._confirmAd(false);
    if (this._videoPlayer) this._videoPlayer.dispose();
    for (const path of this._layoutPaths || []) files.removeTemp(path);
  },
  selectAction(e) {
    if (this._saveInProgress) return;
    this.setData({
      action: e.currentTarget.dataset.action,
      saved: false,
      error: "",
    });
  },
  previewImage() {
    if (this.data.previewPath)
      wx.previewImage({
        urls: [this.data.previewPath],
        current: this.data.previewPath,
      });
  },
  async fetchUsage() {
    if (!app.globalData.openid || this.data.local) return;
    try {
      const usage = api.unwrap(
        await api.request("/api/user/usage", {
          data: { openid: app.globalData.openid },
        }),
      );
      if (!this._unloaded)
        this.setData({
          quotaKnown: true,
          remaining: Math.max(
            0,
            5 + (usage.adViewCount || 0) - (usage.saveCount || 0),
          ),
          unlimited: usage.adViewCount >= 5,
        });
    } catch (error) {
      /* 配额仍由保存接口做最终校验 */
    }
  },
  requestApi(options) {
    const path = options.url.split("/api/")[1];
    const rest = { ...options };
    delete rest.url;
    return api.request("/api/" + path, rest);
  },
  async requestSave(action, snapshot) {
    const isLayout = action === "layout";
    return this.requestApi({
      url: `${app.globalData.baseUrl}/api/${isLayout ? "photo/generate-layout" : "history/save"}`,
      method: "POST",
      header: {
        "content-type": isLayout
          ? "application/x-www-form-urlencoded"
          : "application/json",
      },
      data: isLayout
        ? {
            openid: snapshot.openid,
            base64Image: snapshot.base64Image,
            height: snapshot.size.height,
            width: snapshot.size.width,
          }
        : {
            openid: snapshot.openid,
            base64Image: snapshot.base64Image,
            bgColor: snapshot.bgColor,
          },
    });
  },
  savePhoto() {
    return this.saveImage("single");
  },
  savePrintLayout() {
    return this.saveImage("layout");
  },
  primaryAction() {
    if (this.data.busy || this._saveInProgress || this._unloaded) return;
    if (this.data.unavailable) return this.returnToEdit();
    if (this.data.previewFailed) return this.retryPreview();
    if (!this.data.saved && !this.data.previewPath) return;
    return this.data.saved ? this.backToTools() : this.saveCurrent();
  },
  saveCurrent() {
    return this.saveImage(this.data.action);
  },
  async saveImage(action) {
    if (
      this._unloaded ||
      this._saveInProgress ||
      !this._session ||
      this.data.unavailable ||
      this.data.previewFailed
    )
      return;
    this._saveInProgress = true;
    this.setData({
      busy: true,
      savingStage: "准备保存…",
      error: "",
      saved: false,
    });
    try {
      let path = this._session.resultPath;
      if (!this.data.local) {
        this.setData({
          savingStage: "正在准备保存…",
        });
        if (!(await app.ensureLogin()) || this._unloaded) return;
        this.setData({ login: true });
        const snapshot = {
          openid: app.globalData.openid,
          base64Image: await files.readBase64(this._session.resultPath),
          bgColor: this._session.bgColor,
          size: { width: this._session.width, height: this._session.height },
        };
        if (this._unloaded) return;
        const cacheKey = snapshot.openid + ":" + action;
        if (this._cloudResults[cacheKey]) path = this._cloudResults[cacheKey];
        else {
          this.setData({
            savingStage:
              action === "layout" ? "正在生成六寸排版…" : "正在保存云端作品…",
          });
          let result = await this.requestSave(action, snapshot);
          if (this._unloaded) return;
          if (result.code === 4031) {
            this.setData({
              busy: false,
              quotaKnown: true,
              remaining: 0,
              unlimited: false,
            });
            if (!(await this.watchAdForSave(snapshot.openid)) || this._unloaded)
              return;
            this.setData({
              busy: true,
              savingStage:
                action === "layout" ? "正在生成六寸排版…" : "正在保存云端作品…",
            });
            result = await this.requestSave(action, snapshot);
          }
          if (this._unloaded) return;
          const data = api.unwrap(result);
          if (action === "layout") {
            if (!data || data.status === false)
              throw new Error("排版生成失败，请重试");
            path = await files.writeBase64(data.image_base64, "layout");
            this._layoutPaths.push(path);
          }
          this._cloudResults[cacheKey] = path;
        }
      }
      if (this._unloaded) return;
      this.setData({ savingStage: "正在写入手机相册…" });
      await this.saveToAlbum(path);
      if (!this._unloaded) {
        this.setData({ saved: true });
        this.fetchUsage();
      }
    } catch (error) {
      if (!this._unloaded)
        this.setData({ error: error.message || "保存失败，请稍后重试" });
    } finally {
      this._saveInProgress = false;
      if (!this._unloaded) this.setData({ busy: false, savingStage: "" });
    }
  },
  async saveToAlbum(path) {
    await files.saveAlbum(path);
    if (!this._unloaded)
      wx.showToast({ title: "已保存到相册", icon: "success" });
  },
  showAdDialog() {
    return new Promise((resolve) => {
      this._confirmAd = (value) => {
        this._confirmAd = null;
        if (!this._unloaded) this.setData({ quotaVisible: false });
        resolve(value);
      };
      this.setData({ quotaVisible: true });
    });
  },
  confirmAd() {
    if (this._confirmAd) this._confirmAd(true);
  },
  cancelAd() {
    if (this._confirmAd) this._confirmAd(false);
  },
  stop() {},
  async watchAdForSave(openid) {
    const adUnitId = await app.getRewardedVideoAdUnitId();
    if (this._unloaded) return false;
    if (!adUnitId) throw new Error("广告暂未开放，作品已保留");
    if (!(await this.showAdDialog()) || this._unloaded) return false;
    this.setData({ busy: true, savingStage: "正在加载视频…" });
    const completed = await this._videoPlayer.play(adUnitId);
    if (!completed || this._unloaded) {
      if (!this._unloaded)
        this.setData({ error: "完整观看视频后可增加保存次数，当前作品已保留" });
      return false;
    }
    const result = await api.request("/api/user/recordAd", {
      method: "POST",
      header: { "content-type": "application/x-www-form-urlencoded" },
      data: { openid },
    });
    api.unwrap(result);
    return !this._unloaded;
  },
  backToTools() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});

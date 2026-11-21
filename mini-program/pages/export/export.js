const app = getApp();
const membership = require("../../utils/membership");
const api = require("../../utils/api");
const files = require("../../utils/files");
const brandPreview = require("../../utils/brand-preview");
const { createRewardedVideoPlayer } = require("../../utils/rewarded-video");

// Match the six-inch paper, spacing and rotation used by HivisionIDPhotos' layout_calculator.
// The same placement drives the bounded display tiles and the watermarked zoom sheet.
function paperLayout(width = 295, height = 413) {
  const w = Number(width), h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return [];
  const paperWidth = 1795, paperHeight = 1205, gap = 30;
  function fit(tileWidth, tileHeight) {
    const columns = Math.min(8, Math.floor((paperWidth - 140 + gap - 1) / (tileWidth + gap)));
    const rows = Math.min(3, Math.floor((paperHeight - 100 + gap - 1) / (tileHeight + gap)));
    return { columns, rows, tileWidth, tileHeight, count: rows * columns };
  }
  const upright = fit(w, h), sideways = fit(h, w);
  const rotated = sideways.count > upright.count;
  const { columns, rows, tileWidth, tileHeight, count } = rotated ? sideways : upright;
  const left = Math.floor((paperWidth - columns * tileWidth - (columns - 1) * gap) / 2);
  const top = Math.floor((paperHeight - rows * tileHeight - (rows - 1) * gap) / 2);
  return Array.from({ length: count }, (_, index) => {
    const x = left + (index % columns) * (tileWidth + gap) + (tileWidth - w) / 2;
    const y = top + Math.floor(index / columns) * (tileHeight + gap) + (tileHeight - h) / 2;
    return { x, y, width: w, height: h, rotated, style:
      `left:${100 * x / paperWidth}%;top:${100 * y / paperHeight}%;width:${100 * w / paperWidth}%;height:${100 * h / paperHeight}%;${rotated ? "transform:rotate(-90deg);" : ""}` };
  });
}

const SAMPLE_PORTRAIT = "/assets/images/sample-female-smile.jpg";
const SAMPLE_DISPLAY = "/assets/images/sample-print-display.jpg";
const SOUND_KEY = "studio-print-sound";
// Match the two sounding passages of the packaged print-bgm.mp3 and let its tail finish.
const FIRST_PASS_END = 1560;
const SECOND_PASS_START = 1718;
const PAPER_SEATED = 2402;
const FEED_DURATION = 2743;

Page({
  onShareAppMessage() {
    if (this.data.demo) return { title: "拾光小相｜试印一张六寸相纸", path: "/pages/export/export?demo=print" };
    return { title: "拾光小相｜制作并保存证件照", path: "/pages/index/index" };
  },
  onShareTimeline() {
    if (this.data.demo) return { title: "拾光小相｜试印一张六寸相纸", query: "demo=print" };
    return { title: "拾光小相｜制作并保存证件照", query: "" };
  },

  data: {
    memberKnown: false,
    memberLoading: false,
    memberAvailable: null,
    isLifetimeMember: false,
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
    layoutSlots: [],
    printPhase: "",
    printReady: false,
    paperReveal: 0,
    proofVersion: 0,
    paperMoving: false,
    failedPrinter: "",
    printSound: true,
    zoomPreparing: false,
    zoomError: "",
    demo: false,
    choosing: false,
    scrollTarget: "",
    actualWidth: 0,
    actualHeight: 0,
  },
  onLoad(options = {}) {
    this._unloaded = false;
    this._saveInProgress = false;
    this._cloudResults = Object.create(null);
    this._layoutPaths = [];
    this._previewPaths = [];
    this._loadedCells = new Set();
    this._soundVisible = false;
    this._appHidden = () => this.onHide();
    this._interrupted = () => { this._audioInterrupted = true; this.stopRollers(); };
    this._interruptionEnded = () => { this._audioInterrupted = false; };
    if (wx.onAppHide) wx.onAppHide(this._appHidden);
    if (wx.onAudioInterruptionBegin) wx.onAudioInterruptionBegin(this._interrupted);
    if (wx.onAudioInterruptionEnd) wx.onAudioInterruptionEnd(this._interruptionEnded);
    this._zoomImages = new Map();
    try { this.setData({ printSound: wx.getStorageSync(SOUND_KEY) !== false }); } catch (_) {}
    if (options.demo === "print") {
      this._layoutCells = paperLayout(295, 413);
      this.setData({
        demo: true, local: true, action: "layout", allowLayout: true,
        previewPath: SAMPLE_DISPLAY, layoutSlots: this._layoutCells.map((cell) => cell.style),
        sizeName: "一寸", width: 295, height: 413,
      });
      return;
    }
    this._videoPlayer = createRewardedVideoPlayer(wx);
    const session = app.globalData.exportSession;
    if (!session || !session.resultPath) {
      this.markUnavailable();
      return;
    }
    this._session = { ...session };
    const requiresQuota =
      ["idphoto", "exam"].includes(session.mode) || session.requiresQuota === true;
    this._layoutCells = session.mode === "idphoto" ? paperLayout(session.width, session.height) : [];
    const layoutSlots = this._layoutCells.map((cell) => cell.style);
    this.setData({
      // Rebuild the display from the source. Imported draft paths can contain full-size photos.
      previewPath: "",
      previewPreparing: true,
      previewCaption:
        session.mode === "exam" || session.specId
          ? "保存时按所选规格输出，小尺寸照片放大后可能看见像素。"
          : "",
      local: !requiresQuota,
      allowLayout: session.mode === "idphoto",
      layoutSlots,
      action: layoutSlots.length && session.exportAction === "layout" ? "layout" : "single",
      outputNote: session.outputNote || "",
      sizeName: session.sizeName || "本地照片",
      width: session.width,
      height: session.height,
      colorName:
        { "#FFFFFF": "白底", "#638cce": "蓝底", "#FF0000": "红底" }[session.bgColor] ||
        "自定义底色",
      login: Boolean(app.globalData.openid),
    });
    this.refreshMembership();
    this.fetchUsage();
    this._previewReady = this.retryPreview();
    files
      .call("getImageInfo", { src: session.resultPath })
      .then((info) => {
        this._sourceDimensions = { actualWidth: info.width, actualHeight: info.height };
        if (!this._unloaded && !(this.data.saved && this.data.action === "layout"))
          this.setData(this.sourceDimensions());
      })
      .catch(() => {
        if (!this._unloaded) this.markUnavailable();
      });
  },
  onShow() {
    this._hidden = false;
    this._soundVisible = true;
    if (this._printMotion) this.playRollers(this._printMotion);
    if (this.data.action === "layout" && this._machineReady && this._paperLoaded && !this.data.printReady)
      this.startFeed();
    if (!this.data.demo) {
      this.syncUsageOwner();
      this.refreshMembership();
    }
  },
  async refreshMembership() {
    if (this._unloaded || this._memberRefreshing) return;
    this._memberRefreshing = true;
    this.setData({ memberLoading: true });
    try {
      const status = await membership.refresh(app);
      if (!this._unloaded) {
        this.syncUsageOwner();
        this.setData({
          memberAvailable: status.available !== false,
          ...(status.available !== false && typeof status.isLifetimeMember === "boolean" ? {
            memberKnown: true,
            isLifetimeMember: status.isLifetimeMember,
            unlimited: status.isLifetimeMember || status.unlimitedSaves === true || this._adUnlimited === true,
          } : {}),
        });
      }
    } catch (_) {
      // Keep unknown rights distinct from an in-progress request.
    } finally {
      this._memberRefreshing = false;
      if (!this._unloaded) this.setData({ memberLoading: false });
    }
  },
  async retryMembership() {
    await Promise.all([
      !this.data.memberKnown ? this.refreshMembership() : Promise.resolve(),
      !this.data.quotaKnown ? this.fetchUsage() : Promise.resolve(),
    ]);
  },
  openMembership() {
    this.cancelAd();
    membership.open();
  },
  markUnavailable() {
    this.setData({
      ...this.resetPaper(),
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
  previewError(event) {
    if (this._unloaded || this.data.unavailable) return;
    if (event && event.currentTarget.dataset.path !== this.data.previewPath) return;
    if (event && this.data.action === "layout" && !this.currentPaper(event)) return;
    this._machineReady = false;
    this.setData({
      ...this.resetPaper(),
      previewPath: "",
      previewFailed: true,
      error: this.data.demo ? "样片未能加载，请重试。" : "预览未能加载，请重新加载或返回编辑。",
    });
  },
  currentPaper(event) {
    const { path, version } = event.currentTarget.dataset;
    return !this._unloaded && this.data.action === "layout" && path === this.data.previewPath &&
      (version === undefined || Number(version) === this.data.proofVersion);
  },
  proofLoaded(event) {
    if (this.data.saved || this._paperLoaded || !this.currentPaper(event)) return;
    this._loadedCells.add(Number(event.currentTarget.dataset.index));
    if (this._loadedCells.size === this.data.layoutSlots.length) this.paperLoaded();
  },
  printLoaded(event) {
    if (this.data.saved && !this._paperLoaded && this.currentPaper(event)) this.paperLoaded();
  },
  paperLoaded() {
    this._paperLoaded = true;
    if (this._machineReady && !this._hidden) this.startFeed();
  },
  machineLoaded(event) {
    if (event && event.currentTarget.dataset.printer !== ((this.data.studioTheme || {}).printer || "/assets/printers/sky-matte.png")) return;
    if (this._unloaded || this.data.action !== "layout") return;
    this._machineReady = true;
    if (this._paperLoaded && !this._hidden && !this.data.printReady) this.startFeed();
  },
  machineError(event) {
    if (event && event.currentTarget.dataset.printer !== ((this.data.studioTheme || {}).printer || "/assets/printers/sky-matte.png")) return;
    if (this._unloaded || this.data.action !== "layout") return;
    const failedPrinter = this.data.studioTheme?.printer || "/assets/printers/sky-matte.png";
    this.setData({ failedPrinter }, () => this.machineLoaded(event));
  },
  replayPaper() {
    if (!this._machineReady || !this._paperLoaded || this.data.paperMoving || this.data.busy || this._hidden ||
        this._unloaded || this.data.action !== "layout" || this.data.previewFailed) return;
    this.startFeed();
  },
  startFeed() {
    this.stopPrintMotion();
    const run = this._printMotion = { path: this.data.previewPath, start: 0 };
    this.setData({ printReady: true, paperMoving: true, paperReveal: 0 }, () => {
      if (this._printMotion !== run) return;
      run.start = Date.now();
      this.playRollers(run);
      this.advancePaper(run);
    });
  },
  advancePaper(run) {
    if (this._printMotion !== run || this._unloaded || run.path !== this.data.previewPath) return;
    const elapsed = Math.max(0, Date.now() - run.start);
    let revealed;
    if (elapsed < FIRST_PASS_END) {
      const t = elapsed / FIRST_PASS_END;
      revealed = 0.62 * t * t * (3 - 2 * t);
    } else if (elapsed < SECOND_PASS_START) {
      revealed = 0.62;
    } else {
      const t = Math.min(1, (elapsed - SECOND_PASS_START) / (PAPER_SEATED - SECOND_PASS_START));
      revealed = 0.62 + 0.38 * t * t * (3 - 2 * t);
    }
    const percent = Math.round(revealed * 1000) / 10;
    if (elapsed < FEED_DURATION) {
      if (percent !== this.data.paperReveal) this.setData({ paperReveal: percent });
      this._printTimer = setTimeout(() => this.advancePaper(run), 34);
    } else {
      this._printTimer = null;
      this._printMotion = null;
      this.setData({ paperReveal: 100, paperMoving: false });
    }
  },
  stopPrintMotion() {
    if (this._printTimer) clearTimeout(this._printTimer);
    this._printTimer = null;
    this._printMotion = null;
    this.stopRollers();
  },
  togglePrintSound() {
    const enabled = !this.data.printSound;
    this.setData({ printSound: enabled });
    try { wx.setStorageSync(SOUND_KEY, enabled); } catch (_) {}
    if (!enabled) this.stopRollers();
    else if (this._printMotion) this.playRollers(this._printMotion);
  },
  playRollers(run) {
    if (!this.data.printSound || !this._soundVisible || this._audioInterrupted || this._adPlayback ||
        this.data.quotaVisible || !wx.createInnerAudioContext || this._hidden || this._unloaded) return;
    if (!this._rollerAudio) {
      try {
        const audio = wx.createInnerAudioContext();
        this._rollerAudio = audio;
        audio.obeyMuteSwitch = true;
        audio.volume = 0.72;
        audio.onError(() => {
          if (this._rollerAudio !== audio) return;
          this._rollerAudio = null;
          this._audioRun = null;
          this._audioReady = false;
          audio.destroy();
        });
        audio.onCanplay(() => {
          if (this._rollerAudio !== audio || this._unloaded) return;
          this._audioReady = true;
          if (this._printMotion) this.playRollers(this._printMotion);
        });
        if (audio.onEnded) audio.onEnded(() => {
          if (this._rollerAudio === audio) this._audioRun = null;
        });
        audio.src = "/assets/audio/print-bgm.mp3";
      } catch (_) { return; }
    }
    if (!this._audioReady || this._audioRun === run || this._printMotion !== run) return;
    const elapsed = Math.max(0, Date.now() - run.start);
    if (elapsed >= FEED_DURATION) return;
    this._audioRun = run;
    try {
      this._rollerAudio.seek(elapsed / 1000);
      this._rollerAudio.play();
    } catch (_) { this._audioRun = null; }
  },
  stopRollers() {
    try { if (this._audioRun && this._rollerAudio) this._rollerAudio.stop(); } catch (_) {}
    this._audioRun = null;
  },
  printerChanged() {
    if (this._unloaded || this.data.action !== "layout") return;
    this.stopPrintMotion();
    this._machineReady = false;
    this.setData({ failedPrinter: "", paperReveal: 0, printReady: false, paperMoving: false });
  },
  resetPaper() {
    this.stopPrintMotion();
    this._paperLoaded = false;
    this._loadedCells = new Set();
    return {
      proofVersion: this.data.proofVersion + 1, paperReveal: 0, paperMoving: false, printReady: false,
    };
  },
  onHide() {
    this._hidden = true;
    this._soundVisible = false;
    this.stopRollers();
    if (this._printMotion) {
      this.stopPrintMotion();
      this.setData({ paperReveal: 100, paperMoving: false });
    }
  },
  async retryPreview() {
    if (this.data.demo && !this._unloaded) {
      this.setData({ previewPath: SAMPLE_DISPLAY, previewFailed: false, failedPrinter: "", error: "", ...this.resetPaper() });
      return;
    }
    if (this._unloaded || this._previewLoading || this.data.unavailable || !this._session)
      return;
    this._previewLoading = true;
    this.setData({ previewPreparing: true, previewFailed: false, failedPrinter: "", error: "" });
    const source = this.data.saved && this._savedPath
      ? this._savedPath : this._session.resultPath;
    try {
      const path = await brandPreview.displayPreview(this, source);
      if (this._unloaded || this.data.unavailable) {
        files.removeTemp(path);
        return;
      }
      (this._previewPaths || (this._previewPaths = [])).push(path);
      if (source === this._session.resultPath) this._singlePreviewPath = path;
      this.setData({ previewPath: path, ...(this.data.action === "layout" ? this.resetPaper() : {}) });
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
    if (this.data.busy || this._saveInProgress || this._unloaded || this._returning)
      return;
    this._returning = true;
    wx.navigateBack({
      fail: () => this.backToTools(),
      complete: () => {
        this._returning = false;
      },
    });
  },
  onUnload() {
    this._unloaded = true;
    this.stopPrintMotion();
    if (wx.offAppHide && this._appHidden) wx.offAppHide(this._appHidden);
    if (wx.offAudioInterruptionBegin && this._interrupted) wx.offAudioInterruptionBegin(this._interrupted);
    if (wx.offAudioInterruptionEnd && this._interruptionEnded) wx.offAudioInterruptionEnd(this._interruptionEnded);
    if (this._rollerAudio) this._rollerAudio.destroy();
    this._rollerAudio = null;
    if (this._confirmAd) this._confirmAd(false);
    if (this._videoPlayer) this._videoPlayer.dispose();
    for (const path of this._layoutPaths || []) files.removeTemp(path);
    for (const path of this._previewPaths || []) files.removeTemp(path);
  },
  sourceDimensions() {
    return this._sourceDimensions || { actualWidth: 0, actualHeight: 0 };
  },
  focusPreview() {
    this.setData({ scrollTarget: "exportPreviewTop" }, () => {
      if (!this._unloaded) this.setData({ scrollTarget: "" });
    });
  },
  selectAction(e) {
    const action = e.currentTarget.dataset.action;
    if (
      this._saveInProgress || this.data.busy || this._unloaded || this.data.demo ||
      (this.data.previewPreparing && this.data.saved) || action === this.data.action ||
      !["single", "layout"].includes(action) ||
      (action === "layout" && (!this.data.allowLayout || !this.data.layoutSlots.length))
    ) return;
    const needsRetry = this.data.previewFailed && !this._singlePreviewPath;
    this._machineReady = false;
    this.setData({
      ...this.resetPaper(),
      failedPrinter: "",
      action,
      saved: false,
      previewFailed: false,
      error: "",
      zoomError: "",
      previewPath: this._singlePreviewPath || "",
      ...this.sourceDimensions(),
    });
    if (needsRetry) this.retryPreview();
    this.focusPreview();
  },
  async previewImage() {
    if (this._unloaded || this._hidden || this.data.busy || this.data.previewFailed ||
        !this.data.previewPath || this.data.zoomPreparing) return;
    const { action, saved, demo, previewPath } = this.data;
    const source = demo ? SAMPLE_PORTRAIT : saved ? this._savedPath : this._session.resultPath;
    const sheet = action === "layout" && !saved;
    const key = JSON.stringify([source, sheet]);
    const current = () => !this._unloaded && !this._hidden && !this.data.busy &&
      this.data.action === action && this.data.saved === saved && this.data.previewPath === previewPath;
    this.setData({ zoomPreparing: true, zoomError: "" });
    try {
      let path = this._zoomImages.get(key);
      if (!path) {
        path = sheet ? await brandPreview.createSheetPreview(this, source, this._layoutCells) :
          await brandPreview.create(this, source);
        if (this._unloaded) { files.removeTemp(path); return; }
        this._zoomImages.set(key, path);
        this._previewPaths.push(path);
      }
      if (current()) wx.previewImage({ current: path, urls: [path], fail: (error) => {
        if (/cancel/i.test(error && error.errMsg || "")) return;
        if (this._zoomImages.get(key) === path) this._zoomImages.delete(key);
        if (current()) this.setData({ zoomError: "大图未能打开，轻点照片重试" });
      } });
    } catch (_) {
      if (current()) this.setData({ zoomError: "大图未能生成，轻点照片重试" });
    } finally {
      if (!this._unloaded) this.setData({ zoomPreparing: false });
    }
  },
  syncUsageOwner() {
    const owner = app.globalData.openid || "";
    if (this._usageOwner !== undefined && this._usageOwner !== owner) {
      this._adUnlimited = false;
      this.setData({ memberKnown: false, isLifetimeMember: false, memberAvailable: null,
        quotaKnown: false, remaining: 0, unlimited: false });
    }
    this._usageOwner = owner;
  },
  async fetchUsage() {
    if (!app.globalData.openid || this.data.local) return;
    const request = this._latestUsageRequest = {};
    try {
      if (!app.globalData.sessionToken) await app.ensureLogin();
      const { openid, sessionToken } = app.globalData;
      const usage = api.unwrap(await api.request("/api/user/usage", { data: { openid } }));
      if (request !== this._latestUsageRequest || !this.saveSessionIsCurrent({ openid, sessionToken })) return;
      this.syncUsageOwner();
      const hasMembership = typeof usage.isLifetimeMember === "boolean";
      this._adUnlimited = usage.adViewCount >= 5;
      this.setData({
        quotaKnown: true,
        remaining: Math.max(0, 5 + (usage.adViewCount || 0) - (usage.saveCount || 0)),
        unlimited: this._adUnlimited || (hasMembership ? usage.isLifetimeMember : this.data.isLifetimeMember),
        ...(hasMembership ? { memberKnown: true, isLifetimeMember: usage.isLifetimeMember } : {}),
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
    if (this.data.busy || this.data.previewPreparing || this._saveInProgress || this._unloaded) return;
    if (this.data.demo) return this.chooseOwnPhoto();
    if (this.data.unavailable) return this.returnToEdit();
    if (this.data.previewFailed) return this.retryPreview();
    if (!this.data.saved && !this.data.previewPath) return;
    return this.data.saved ? this.backToTools() : this.saveCurrent();
  },
  async chooseOwnPhoto() {
    if (!this.data.demo || this._choosing || this._unloaded) return;
    this._choosing = true;
    this.setData({ choosing: true, error: "" });
    try {
      const result = await files.call("chooseMedia", {
        count: 1, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["original"],
      });
      if (this._unloaded) return;
      const photo = result.tempFiles && result.tempFiles[0];
      if (!photo || !photo.tempFilePath) throw Error("照片未能读取，请重新选择");
      await files.call("navigateTo", {
        url: `/pages/edit/edit?src=${encodeURIComponent(photo.tempFilePath)}&width=295&height=413&name=${encodeURIComponent("一寸")}&tool=idphoto&exportAction=layout`,
      });
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || error.message || ""))
        this.setData({ error: "照片未能打开，请重新选择" });
    } finally {
      this._choosing = false;
      if (!this._unloaded) this.setData({ choosing: false });
    }
  },
  saveCurrent() {
    return this.saveImage(this.data.action);
  },
  saveSessionIsCurrent(identity) {
    return !this._unloaded && identity.openid === app.globalData.openid &&
      identity.sessionToken === app.globalData.sessionToken;
  },
  assertSaveSession(identity) {
    if (!this.saveSessionIsCurrent(identity)) {
      const error = new Error("登录状态已变化，请重新保存");
      error.saveSessionChanged = true;
      throw error;
    }
  },
  async saveImage(action) {
    if (
      this._unloaded ||
      this._saveInProgress ||
      this.data.demo ||
      !this._session ||
      this.data.unavailable ||
      this.data.previewPreparing ||
      this.data.previewFailed ||
      (action === "layout" && (!this.data.allowLayout || !this.data.layoutSlots.length))
    )
      return;
    this._saveInProgress = true;
    const newProof = this.data.saved || action !== this.data.action;
    if (action === "layout") this.focusPreview();
    let cacheKey = "";
    let identity = null;
    this.setData({
      busy: true,
      action,
      ...(newProof ? this.resetPaper() : {}),
      savingStage: "准备保存…",
      error: "",
      saved: false,
      previewPath: this._singlePreviewPath || "",
      ...this.sourceDimensions(),
    });
    try {
      let path = this._session.resultPath;
      if (!this.data.local) {
        this.setData({
          savingStage: "正在准备保存…",
        });
        if (!(await app.ensureLogin()) || this._unloaded) return;
        identity = {
          openid: app.globalData.openid,
          sessionToken: app.globalData.sessionToken,
        };
        this.assertSaveSession(identity);
        this.setData({ login: true });
        cacheKey = JSON.stringify([identity.openid, identity.sessionToken, action]);
        let authorized = this._cloudResults[cacheKey];
        if (!authorized) {
          const snapshot = {
            openid: identity.openid,
            base64Image: await files.readBase64(this._session.resultPath),
            bgColor: this._session.bgColor,
            size: { width: this._session.width, height: this._session.height },
          };
          this.assertSaveSession(identity);
          this.setData({
            savingStage: action === "layout" ? "正在生成六寸排版…" : "正在保存云端作品…",
            printPhase: action === "layout" ? "rendering" : "",
          });
          let result = await this.requestSave(action, snapshot);
          this.assertSaveSession(identity);
          if (result.code === 4031) {
            this._latestUsageRequest = null;
            this.setData({
              busy: false,
              printPhase: "",
              quotaKnown: true,
              remaining: 0,
              unlimited: false,
            });
            const rewarded = await this.watchAdForSave(identity.openid, identity.sessionToken);
            this.assertSaveSession(identity);
            if (!rewarded) return;
            this.setData({
              busy: true,
              printPhase: action === "layout" ? "rendering" : "",
              savingStage:
                action === "layout" ? "正在生成六寸排版…" : "正在保存云端作品…",
            });
            result = await this.requestSave(action, snapshot);
          }
          this.assertSaveSession(identity);
          const data = api.unwrap(result);
          if (action === "single" && data && data.id && this._session.id) {
            const { id, resultPath } = this._session;
            Promise.resolve().then(() => require("../../utils/drafts")
              .linkCloudCover(id, resultPath, identity.openid, data.id)).catch(() => {});
          }
          if (action === "layout" && (!data || data.status === false || !data.image_base64))
            throw new Error("排版生成失败，请重试");
          authorized = action === "layout" ? { bitmap: data.image_base64 } : { path };
          this._cloudResults[cacheKey] = authorized;
        }
        if (authorized.bitmap) {
          path = await files.writeBase64(authorized.bitmap, "layout");
          if (this._unloaded) files.removeTemp(path);
          else this._layoutPaths.push(path);
          this.assertSaveSession(identity);
          authorized.path = path;
          delete authorized.bitmap;
        }
        path = authorized.path;
      }
      if (this._unloaded) return;
      if (identity) this.assertSaveSession(identity);
      this.setData({ savingStage: "正在写入手机相册…", printPhase: action === "layout" ? "album" : "" });
      await this.saveToAlbum(path, identity);
      // Keep a successful authorization across local file or album errors only.
      // A new save after success always goes through the server quota again.
      if (cacheKey) delete this._cloudResults[cacheKey];
      if (identity) this.assertSaveSession(identity);
      this._savedPath = path;
      if (!this._unloaded) {
        this.setData({
          saved: true,
          action,
          printPhase: "",
          ...(action === "layout" ? { previewPath: "", ...this.resetPaper() } : {}),
          ...(action === "layout" ? { actualWidth: 0, actualHeight: 0 } : this.sourceDimensions()),
        });
        if (action === "layout") {
          files.call("getImageInfo", { src: path }).then((info) => {
            if (!this._unloaded && (!identity || this.saveSessionIsCurrent(identity)) && this.data.saved && this._savedPath === path)
              this.setData({ actualWidth: info.width, actualHeight: info.height });
          }).catch(() => { /* Saving succeeded; an unavailable dimension must not report failure. */ });
          await this.retryPreview();
          if (identity) this.assertSaveSession(identity);
        }
        this.fetchUsage();
      }
    } catch (error) {
      if (error.saveSessionChanged && cacheKey) delete this._cloudResults[cacheKey];
      if (!this._unloaded)
        this.setData({ error: error.message || "保存失败，请稍后重试" });
    } finally {
      this._saveInProgress = false;
      if (!this._unloaded) this.setData({ busy: false, savingStage: "", printPhase: "" });
    }
  },
  async saveToAlbum(path, identity) {
    if (identity) this.assertSaveSession(identity);
    await files.saveAlbum(path);
    if (identity) this.assertSaveSession(identity);
    if (!this._unloaded) wx.showToast({ title: "已保存到相册", icon: "success" });
  },
  showAdDialog() {
    return new Promise((resolve) => {
      this._confirmAd = (value) => {
        this._confirmAd = null;
        if (!this._unloaded) this.setData({ quotaVisible: false });
        resolve(value);
      };
      this.stopRollers();
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
  async watchAdForSave(openid, sessionToken = app.globalData.sessionToken) {
    const identity = { openid, sessionToken };
    this.assertSaveSession(identity);
    const status = await membership.refresh(app, true);
    this.assertSaveSession(identity);
    if (status.isLifetimeMember) return true;
    const legacyRewards = (state) => state.available === false &&
      app.globalData.membershipEnabled === false && !membership.getPending(openid);
    if (!legacyRewards(status) && !membership.canShowAds()) throw new Error("付款状态待确认，请在会员页恢复购买");
    const adUnitId = await app.getRewardedVideoAdUnitId();
    this.assertSaveSession(identity);
    if (!adUnitId) throw new Error("广告暂未开放，作品已保留");
    const confirmed = await this.showAdDialog();
    this.assertSaveSession(identity);
    if (!confirmed) return false;
    // 用户确认期间可能已在其他页面开通会员，播放前再次确认。
    const latest = await membership.refresh(app, true);
    this.assertSaveSession(identity);
    if (latest.isLifetimeMember) return true;
    if (!legacyRewards(latest) && !membership.canShowAds()) return false;
    this.setData({ busy: true, savingStage: "正在加载视频…" });
    this._adPlayback = true;
    this.stopRollers();
    let completed;
    try { completed = await this._videoPlayer.play(adUnitId); }
    finally { this._adPlayback = false; }
    this.assertSaveSession(identity);
    if (!completed) {
      if (!this._unloaded)
        this.setData({ error: "完整观看视频后可增加保存次数，当前作品已保留" });
      return false;
    }
    const result = await api.request("/api/user/recordAd", {
      method: "POST",
      header: { "content-type": "application/x-www-form-urlencoded" },
      data: { openid },
    });
    this.assertSaveSession(identity);
    api.unwrap(result);
    return true;
  },
  backToTools() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});

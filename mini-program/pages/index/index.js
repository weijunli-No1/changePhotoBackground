const { createSampleIntro } = require("./sample-intro");
const drafts = require("../../utils/drafts");
const catalog = require("../../utils/tool-catalog");
const launcher = require("../../utils/tool-launcher");
const { sizes } = require("../../utils/photo-specs");
Page({
  onShareAppMessage() {
    return { title: "拾光小相｜证件照与图片工具", path: "/pages/index/index" };
  },
  onShareTimeline() {
    return { title: "拾光小相｜证件照与图片工具", query: "" };
  },

  data: {
    draft: null,
    quickTools: catalog.quickTools(),
    homeSizes: sizes.slice(0, 2),
    frontSample: "female",
    sampleStyles: null,
    featuredTool: catalog.featuredTool() || null,
    examTool: catalog.getTool("exam") || null,
    size: sizes[0],
    entryError: "",
    pickingHome: false,
  },
  ...launcher,
  onLoad() {
    this._sampleIntro = createSampleIntro(this, wx);
  },
  onReady() { if (this._sampleIntro) this._sampleIntro.ready(); },
  onHide() { if (this._sampleIntro) this._sampleIntro.hide(); },
  onResize() { this.sampleLayout(); },
  sampleLoaded(event) { if (this._sampleIntro) this._sampleIntro.image(event.currentTarget.dataset.id); },
  sampleFailed(event) { if (this._sampleIntro) this._sampleIntro.imageFailed(event.currentTarget.dataset.id); },
  sampleLayout() { if (this._sampleIntro) this._sampleIntro.layout(); },
  sampleScrolled() { if (this._sampleIntro) this._sampleIntro.scroll(); },
  onShow() {
    if (this._sampleIntro) this._sampleIntro.show();
    this._unloaded = false;
    const draft = drafts.list()[0];
    this.setData({ draft: draft ? catalog.presentDraft(draft) : null });
  },
  onUnload() {
    if (this._sampleIntro) this._sampleIntro.dispose();
    this._unloaded = true;
  },
  openToolEntry(e) {
    if (this._choosing || this._openingTool || this._unloaded) return;
    const id = typeof e === "string" ? e : e.currentTarget.dataset.id;
    const tool = catalog.getTool(id);
    if (!tool) return;
    if (this._sampleIntro) this._sampleIntro.takeOver();
    if (tool.entry.type === "portrait") {
      this._activeTool = id;
      this.setData({ entryError: "" });
      return launcher.browseSpecs.call(this);
    }
    return launcher.openToolEntry.call(this, id);
  },
  draftImageError(e) {
    if (
      !this._unloaded &&
      this.data.draft &&
      this.data.draft.id === e.currentTarget.dataset.id
    )
      this.setData({ draft: { ...this.data.draft, thumbnailMissing: true } });
  },
  selectSample(e) {
    if (this._unloaded) return;
    const samples = this.data.featuredTool.featured.photos;
    const tapped = samples.find(sample => sample.id === e.currentTarget.dataset.id);
    if (!tapped) return;
    if (this._sampleIntro) this._sampleIntro.takeOver();
    const next = tapped.id === this.data.frontSample
      ? samples.find(sample => sample.id !== tapped.id)
      : tapped;
    if (next) this.setData({ frontSample: next.id });
  },
  selectHomeSize(e) {
    if (this._choosing || this._openingTool) return;
    const size = this.data.homeSizes[e.currentTarget.dataset.index];
    if (!size) return;
    if (this._sampleIntro) this._sampleIntro.takeOver();
    this.setData({ size, entryError: "" });
  },
  async startHomePhoto() {
    if (this._choosing || this._openingTool || this.data.pickingHome || this._unloaded) return;
    if (this._sampleIntro) this._sampleIntro.takeOver();
    this._activeTool = "idphoto";
    this.setData({ pickingHome: true });
    try {
      await this.selectSpec({ detail: this.data.size });
    } finally {
      if (!this._unloaded) this.setData({ pickingHome: false });
    }
  },
  openPrintDemo() {
    if (this._openingTool || this._choosing || this._unloaded) return;
    if (this._sampleIntro) this._sampleIntro.takeOver();
    this._openingTool = true;
    this.setData({ entryError: "" });
    wx.navigateTo({
      url: "/pages/export/export?demo=print",
      fail: () => {
        if (!this._unloaded) this.setData({ entryError: "相纸样片未能打开，请重试" });
      },
      complete: () => { this._openingTool = false; },
    });
  },
  openLibrary(e) {
    if (this._openingTool || this._choosing || this._unloaded) return;
    if (this._sampleIntro) this._sampleIntro.takeOver();
    this._openingTool = true;
    wx.navigateTo({
      url: `/pages/library/library${e && e.currentTarget.dataset.search ? "?focus=1" : ""}`,
      complete: () => {
        this._openingTool = false;
      },
      fail: () => {
        if (!this._unloaded) this.setData({ entryError: "工具目录暂时无法打开，请重试" });
      },
    });
  },
  openTool(e) {
    this.openToolEntry(e.currentTarget.dataset.id || e.currentTarget.dataset.mode);
  },
  chooseImage() {
    this.startIdPhoto();
  },
  resumeDraft() {
    if (this._openingTool || this._choosing || this._unloaded || !this.data.draft) return;
    const url = catalog.draftUrl(this.data.draft);
    if (!url) {
      this.setData({ entryError: "暂时无法打开这份草稿，可在作品页查看" });
      return;
    }
    if (this._sampleIntro) this._sampleIntro.takeOver();
    this._openingTool = true;
    wx.navigateTo({
      url,
      complete: () => {
        this._openingTool = false;
      },
      fail: () => {
        if (!this._unloaded) this.setData({ entryError: "草稿未能打开，请在作品页重试" });
      },
    });
  },
  showWorks() {
    if (this._openingTool || this._choosing || this._unloaded) return;
    if (this._sampleIntro) this._sampleIntro.takeOver();
    const app = getApp();
    app.globalData.requestedWorksTab = "drafts";
    this._openingTool = true;
    wx.switchTab({
      url: "/pages/history/history",
      fail: () => {
        delete app.globalData.requestedWorksTab;
        if (!this._unloaded) this.setData({ entryError: "作品页未能打开，请重试" });
      },
      complete: () => { this._openingTool = false; },
    });
  },
});

const drafts = require("../../utils/drafts");
const catalog = require("../../utils/tool-catalog");
const launcher = require("../../utils/tool-launcher");
const { sizes } = require("../../utils/photo-specs");
Page({
  data: {
    draft: null,
    quickTools: catalog.quickTools(),
    featuredTool: catalog.featuredTool() || null,
    specVisible: false,
    specTitle: "选择照片规格",
    size: sizes[0],
    entryError: "",
  },
  ...launcher,
  onShow() {
    this._unloaded = false;
    const draft = drafts.list()[0];
    this.setData({ draft: draft ? catalog.presentDraft(draft) : null });
  },
  onHide() {
    this.setData({ specVisible: false });
  },
  onUnload() {
    this._unloaded = true;
  },
  openLibrary(e) {
    if (this._openingLibrary) return;
    this._openingLibrary = true;
    wx.navigateTo({
      url: `/pages/library/library${e && e.currentTarget.dataset.search ? "?focus=1" : ""}`,
      complete: () => {
        this._openingLibrary = false;
      },
      fail: () => {
        if (!this._unloaded)
          this.setData({ entryError: "工具目录暂时无法打开，请重试" });
      },
    });
  },
  openTool(e) {
    this.openToolEntry(
      e.currentTarget.dataset.id || e.currentTarget.dataset.mode,
    );
  },
  chooseImage() {
    this.startIdPhoto();
  },
  resumeDraft() {
    if (this._resuming || !this.data.draft) return;
    const url = catalog.draftUrl(this.data.draft);
    if (!url) {
      this.setData({ entryError: "暂时无法打开这份草稿，可在作品页查看" });
      return;
    }
    this._resuming = true;
    wx.navigateTo({
      url,
      complete: () => {
        this._resuming = false;
      },
      fail: () => {
        if (!this._unloaded)
          this.setData({ entryError: "草稿未能打开，请在作品页重试" });
      },
    });
  },
  showWorks() {
    const app = getApp();
    app.globalData.requestedWorksTab = "drafts";
    wx.switchTab({
      url: "/pages/history/history",
      fail: () => {
        delete app.globalData.requestedWorksTab;
      },
    });
  },
});

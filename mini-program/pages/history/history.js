const { createMotion } = require("../../utils/skyline-motion");
const app = getApp();
const api = require("../../utils/api");
const drafts = require("../../utils/drafts");
const catalog = require("../../utils/tool-catalog");
const { call } = require("../../utils/files");
Page({
  data: {
    tab: "drafts",
    drafts: [],
    historyList: [],
    isLoading: false,
    hasLogin: false,
    loggingIn: false,
    error: "",
    loadError: "",
  },
  onReady() {
    this._motion = createMotion(this, wx);
    this.updateTabMotion();
  },
  updateTabMotion() {
    if (this._motion)
      this._motion.indicator(
        ".segment",
        ".segment-item.active",
        ".works-indicator",
      );
  },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().init();
    this._unloaded = false;
    if (["drafts", "cloud"].includes(app.globalData.requestedWorksTab)) {
      this.setData({ tab: app.globalData.requestedWorksTab }, () =>
        this.updateTabMotion(),
      );
      delete app.globalData.requestedWorksTab;
    }
    if (this._historyOwner !== app.globalData.openid) {
      this._historySeq = (this._historySeq || 0) + 1;
      this._historyOwner = app.globalData.openid;
      this.setData({
        historyList: [],
        isLoading: false,
        error: "",
        loadError: "",
      });
    }
    this.setData({
      hasLogin: Boolean(app.globalData.openid),
      drafts: drafts.list().map((item) => catalog.presentDraft(item)),
    });
    if (this.data.tab === "cloud") this.fetchHistoryList();
  },
  onUnload() {
    this._unloaded = true;
    if (this._motion) this._motion.dispose();
  },
  draftImageError(e) {
    if (this._unloaded) return;
    const id = e.currentTarget.dataset.id;
    this.setData({
      drafts: this.data.drafts.map((item) =>
        item.id === id ? { ...item, thumbnailMissing: true } : item,
      ),
    });
  },
  selectTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!["drafts", "cloud"].includes(tab) || tab === this.data.tab) return;
    this.setData({ tab, error: "" }, () => {
      this.updateTabMotion();
      if (this._motion) this._motion.fade(".works-panel");
    });
    if (tab === "cloud") this.fetchHistoryList();
    else
      this.setData({
        drafts: drafts.list().map((item) => catalog.presentDraft(item)),
      });
  },
  async login() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true, error: "" });
    try {
      if (
        (await app.ensureLogin()) &&
        !this._unloaded &&
        app.globalData.openid
      ) {
        this.setData({ hasLogin: true });
        this.fetchHistoryList();
      }
    } catch (error) {
      if (!this._unloaded && !error.cancelled)
        this.setData({ error: error.message || "登录失败，请重试" });
    } finally {
      if (!this._unloaded) this.setData({ loggingIn: false });
    }
  },
  async fetchHistoryList() {
    if (!app.globalData.openid || this.data.isLoading) return;
    const owner = app.globalData.openid;
    const seq = (this._historySeq = (this._historySeq || 0) + 1);
    this.setData({ isLoading: true, loadError: "" });
    try {
      const list = api.unwrap(
        await api.request("/api/history/list", { data: { openid: owner } }),
      );
      if (
        !this._unloaded &&
        seq === this._historySeq &&
        app.globalData.openid === owner
      )
        this.setData({
          historyList: (list || []).map((item) => ({
            ...item,
            timeStr: (item.createTime || "").replace("T", " ").slice(0, 16),
          })),
        });
    } catch (error) {
      if (
        !this._unloaded &&
        seq === this._historySeq &&
        app.globalData.openid === owner
      )
        this.setData({
          loadError: error.message || "作品加载失败，请稍后重试",
        });
    } finally {
      if (
        !this._unloaded &&
        seq === this._historySeq &&
        app.globalData.openid === owner
      )
        this.setData({ isLoading: false });
    }
  },
  retryHistory() {
    return this.fetchHistoryList();
  },
  resume(e) {
    const item = drafts.get(e.currentTarget.dataset.id);
    if (!item) return;
    const url = catalog.draftUrl(item);
    if (url) wx.navigateTo({ url });
    else this.setData({ error: "暂时无法打开这份草稿" });
  },
  async clearDrafts() {
    if (this._clearingDrafts || this._removingDraft || !this.data.drafts.length)
      return;
    this._clearingDrafts = true;
    try {
      const res = await call("showModal", {
        title: "清理本地草稿",
        content:
          "将删除这台设备上的草稿及草稿图片。云端作品、手机相册和头像昵称会保留。",
        confirmText: "清理",
        confirmColor: "#ac4939",
      });
      if (!res.confirm || this._unloaded) return;
      await drafts.clear();
      if (!this._unloaded) {
        this.setData({ drafts: [] });
        wx.showToast({ title: "本地草稿已清理", icon: "success" });
      }
    } catch (error) {
      if (!this._unloaded) this.setData({ error: "草稿未能清理，请重试" });
    } finally {
      this._clearingDrafts = false;
    }
  },
  async removeDraft(e) {
    if (this._removingDraft || this._clearingDrafts || this._unloaded) return;
    const id = e.currentTarget.dataset.id;
    this._removingDraft = true;
    try {
      const res = await call("showModal", {
        title: "删除本地草稿",
        content: "删除后无法继续编辑此草稿，手机相册和云端作品不受影响。",
        confirmText: "删除",
        confirmColor: "#ac4939",
      });
      if (res.confirm && !this._unloaded) {
        await drafts.remove(id);
        if (!this._unloaded)
          this.setData({
            drafts: drafts.list().map((item) => catalog.presentDraft(item)),
          });
      }
    } catch (error) {
      if (!this._unloaded) this.setData({ error: "草稿未能删除，请重试" });
    } finally {
      this._removingDraft = false;
    }
  },
  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    wx.previewImage({ urls: [url], current: url });
  },
  async onDelete(e) {
    if (this._deleting || this._unloaded) return;
    this._deleting = true;
    const owner = app.globalData.openid;
    const id = e.currentTarget.dataset.id;
    try {
      const res = await call("showModal", {
        title: "删除云端记录",
        content: "此操作删除历史列表中的记录，已保存到手机相册的照片不受影响。",
        confirmText: "删除",
        confirmColor: "#ac4939",
      });
      if (!res.confirm || this._unloaded || app.globalData.openid !== owner)
        return;
      api.unwrap(await api.request(`/api/history/${id}`, { method: "DELETE" }));
      if (!this._unloaded && app.globalData.openid === owner) {
        wx.showToast({ title: "已删除", icon: "success" });
        this.fetchHistoryList();
      }
    } catch (error) {
      if (!this._unloaded && app.globalData.openid === owner)
        this.setData({ error: error.message || "记录未能删除，请重试" });
    } finally {
      this._deleting = false;
    }
  },
  goToIndex() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});

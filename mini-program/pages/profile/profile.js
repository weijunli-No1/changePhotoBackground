const app = getApp();
const api = require("../../utils/api");
const drafts = require("../../utils/drafts");
const { call } = require("../../utils/files");
const profiles = require("../../utils/user-profile");
Page({
  data: {
    hasLogin: false,
    nickname: "",
    avatarUrl: "",
    busy: false,
    loggingOut: false,
    usageKnown: false,
    usageBusy: false,
    usageError: "",
    remaining: 0,
    unlimited: false,
    error: "",
    draftCount: 0,
  },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().init();
    this._unloaded = false;
    this.syncUsageOwner();
    this.setData({
      hasLogin: Boolean(app.globalData.openid),
      draftCount: drafts.list().length,
      error: "",
    });
    this.loadIdentity();
    this.fetchUsage();
  },
  syncUsageOwner() {
    const owner = app.globalData.openid || "";
    if (this._usageOwner === owner) return;
    this._usageOwner = owner;
    this._usageSeq = (this._usageSeq || 0) + 1;
    this.setData({
      usageKnown: false,
      usageBusy: false,
      usageError: "",
      remaining: 0,
      unlimited: false,
    });
  },
  loadIdentity() {
    const owner = app.globalData.openid;
    const local = profiles.get(owner);
    const remote = app.globalData.userInfo || {};
    const sameOwner = Boolean(owner && remote.openid === owner);
    this.setData({
      nickname: owner
        ? (local && local.nickname) ||
          (sameOwner && remote.nickname) ||
          "微信用户"
        : "",
      avatarUrl: owner
        ? (local && local.avatarUrl) || (sameOwner && remote.avatar) || ""
        : "",
    });
  },
  avatarError() {
    this.setData({ avatarUrl: "" });
  },
  editProfile() {
    if (!app.globalData.openid || this._openingAccount) return;
    this._openingAccount = true;
    wx.navigateTo({
      url: "/pages/account/account",
      complete: () => {
        this._openingAccount = false;
      },
    });
  },
  onUnload() {
    this._unloaded = true;
  },
  async onLogin() {
    if (this.data.busy || app.globalData.openid) return;
    const attempt = (this._loginAttempt = (this._loginAttempt || 0) + 1);
    this.setData({ busy: true, error: "" });
    try {
      await app.doLogin();
      if (
        !this._unloaded &&
        attempt === this._loginAttempt &&
        app.globalData.openid
      ) {
        this.setData({ hasLogin: true });
        this.loadIdentity();
        this.fetchUsage();
      }
    } catch (error) {
      if (!this._unloaded && attempt === this._loginAttempt && !error.cancelled)
        this.setData({ error: error.message || "登录失败，请重试" });
    } finally {
      if (!this._unloaded && attempt === this._loginAttempt)
        this.setData({ busy: false });
    }
  },
  cancelLogin() {
    if (!this.data.busy || app.globalData.openid) return;
    app.cancelLogin();
    this._loginAttempt = (this._loginAttempt || 0) + 1;
    this.setData({ busy: false, error: "" });
  },
  async fetchUsage() {
    this.syncUsageOwner();
    if (!app.globalData.openid || this.data.usageBusy) return;
    const openid = app.globalData.openid;
    const seq = (this._usageSeq = (this._usageSeq || 0) + 1);
    this.setData({ usageBusy: true, usageError: "" });
    try {
      const usage = api.unwrap(
        await api.request("/api/user/usage", { data: { openid } }),
      );
      if (
        !this._unloaded &&
        seq === this._usageSeq &&
        app.globalData.openid === openid
      )
        this.setData({
          usageKnown: true,
          remaining: Math.max(
            0,
            5 + (usage.adViewCount || 0) - (usage.saveCount || 0),
          ),
          unlimited: usage.adViewCount >= 5,
        });
    } catch (error) {
      if (
        !this._unloaded &&
        seq === this._usageSeq &&
        app.globalData.openid === openid
      )
        this.setData({
          usageError: this.data.usageKnown
            ? "次数暂未更新，当前显示上次查询结果"
            : "暂时无法查询剩余次数，请重试",
        });
    } finally {
      if (!this._unloaded && seq === this._usageSeq)
        this.setData({ usageBusy: false });
    }
  },
  openDrafts() {
    app.globalData.requestedWorksTab = "drafts";
    wx.switchTab({
      url: "/pages/history/history",
      fail: () => {
        delete app.globalData.requestedWorksTab;
        if (!this._unloaded) this.setData({ error: "作品页未能打开，请重试" });
      },
    });
  },
  async onLogout() {
    if (!app.globalData.openid || this.data.loggingOut) return;
    this.setData({ loggingOut: true, error: "" });
    try {
      const res = await call("showModal", {
        title: "退出当前账号？",
        content:
          "退出后，查看云端作品和保存证件照需要重新登录。本机草稿、头像昵称及手机相册里的照片会保留。",
        confirmText: "退出登录",
        cancelText: "继续使用",
        confirmColor: "#ac4939",
      });
      if (!res.confirm || this._unloaded) return;
      app.logout();
      this.syncUsageOwner();
      this.setData({ hasLogin: false });
      this.loadIdentity();
      wx.showToast({ title: "已退出登录", icon: "success" });
    } catch (error) {
      if (!this._unloaded) this.setData({ error: "退出失败，请稍后重试" });
    } finally {
      if (!this._unloaded) this.setData({ loggingOut: false });
    }
  },
  openSupport() {
    if (this._openingSupport) return;
    this._openingSupport = true;
    wx.navigateTo({
      url: "/pages/support/support",
      complete: () => {
        this._openingSupport = false;
      },
    });
  },
  navToPrivacy() {
    wx.navigateTo({ url: "/pages/document/document?type=privacy" });
  },
  navToAgreement() {
    wx.navigateTo({ url: "/pages/document/document?type=agreement" });
  },
  goToTools() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});

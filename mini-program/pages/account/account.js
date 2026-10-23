const app = getApp();
const profiles = require("../../utils/user-profile");
Page({
  data: {
    nickname: "",
    avatarUrl: "",
    saving: false,
    error: "",
    ownerValid: false,
  },
  onLoad() {
    this._owner = app.globalData.openid;
    this._unloaded = false;
    const cached = profiles.get(this._owner);
    const remote = app.globalData.userInfo || {};
    const sameOwner = remote.openid === this._owner;
    const nickname =
      (cached && cached.nickname) ||
      (sameOwner && remote.nickname) ||
      "微信用户";
    const avatarUrl =
      (cached && cached.avatarUrl) || (sameOwner && remote.avatar) || "";
    this.setData({
      nickname,
      avatarUrl,
      ownerValid: Boolean(this._owner),
      error: this._owner ? "" : "请返回“我的”登录后再编辑资料",
    });
  },
  onShow() {
    if (this._owner !== app.globalData.openid)
      this.setData({
        ownerValid: false,
        error: "登录状态已变化，请返回后重新进入",
      });
  },
  onUnload() {
    this._unloaded = true;
  },
  onChooseAvatar(e) {
    if (this._unloaded || this.data.saving || !this.data.ownerValid) return;
    if (e.detail && e.detail.avatarUrl)
      this.setData({ avatarUrl: e.detail.avatarUrl, error: "" });
  },
  avatarError() {
    this.setData({ avatarUrl: "" });
  },
  nicknameInput(e) {
    if (this._unloaded || this.data.saving) return;
    this.setData({ nickname: e.detail.value, error: "" });
  },
  nicknameBlur(e) {
    if (this._unloaded || this.data.saving) return;
    this.setData({ nickname: e.detail.value });
  },
  async submit(e) {
    if (this.data.saving || !this.data.ownerValid || this._unloaded) return;
    let nickname;
    try {
      nickname = profiles.normalizeNickname(e.detail.value.nickname);
    } catch (error) {
      this.setData({ error: error.message });
      return;
    }
    this.setData({ nickname, error: "" });
    this.setData({ saving: true });
    try {
      const saved = await profiles.save(
        this._owner,
        { nickname, avatarUrl: this.data.avatarUrl },
        () => !this._unloaded && app.globalData.openid === this._owner,
      );
      if (this._unloaded) return;
      app.globalData.userInfo = {
        ...app.globalData.userInfo,
        openid: this._owner,
        nickname: saved.nickname,
        avatar: saved.avatarUrl,
      };
      wx.showToast({ title: "资料已保存", icon: "success" });
      wx.navigateBack({
        fail: () => wx.switchTab({ url: "/pages/profile/profile" }),
      });
    } catch (error) {
      if (!this._unloaded)
        this.setData({
          error: error.message || "保存失败，请检查可用空间后重试",
        });
    } finally {
      if (!this._unloaded) this.setData({ saving: false });
    }
  },
});

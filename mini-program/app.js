const { isValidAdUnitId } = require("./utils/rewarded-video");

App({
  globalData: {
    userInfo: null,
    openid: "",
    baseUrl: "https://www.myhaibin.top/new-api", // Nginx 照片服务根路径，请求已包含 /api
    rewardedVideoAdUnitIdOverride: "adunit-8643a04d0caed362", // 当前版本指定广告位，避免线上旧配置覆盖
    defaultRewardedVideoAdUnitId: "",
    rewardedVideoAdUnitId: "",
    watermarkEnabled: false,
  },

  onLaunch: function () {
    require("./utils/files").clearTransientImages();
    // 检查缓存的特定信息
    const openid = wx.getStorageSync("openid");
    if (openid) {
      this.globalData.openid = openid;
    }

    this.appConfigReady = this.loadRemoteAppConfig();
  },

  loadRemoteAppConfig: function () {
    return new Promise((resolve) =>
      wx.request({
        url: `${this.globalData.baseUrl}/api/app/config`,
        method: "GET",
        timeout: 8000,
        success: (res) => {
          this.globalData.watermarkEnabled = Boolean(
            res.data &&
            res.data.code === 200 &&
            res.data.data &&
            res.data.data.watermarkEnabled === true,
          );
          if (res.data && res.data.code === 200 && res.data.data) {
            this.globalData.rewardedVideoAdUnitId =
              res.data.data.rewardedVideoAdUnitId || "";
          }
        },
        fail: () => {
          this.globalData.rewardedVideoAdUnitId = "";
          this.globalData.watermarkEnabled = false;
        },
        complete: () => resolve(),
      }),
    );
  },

  async getRewardedVideoAdUnitId() {
    if (isValidAdUnitId(this.globalData.rewardedVideoAdUnitIdOverride)) {
      return this.globalData.rewardedVideoAdUnitIdOverride.trim();
    }
    await this.appConfigReady;
    const candidates = [
      this.globalData.rewardedVideoAdUnitIdOverride,
      this.globalData.rewardedVideoAdUnitId,
      this.globalData.defaultRewardedVideoAdUnitId,
    ];
    const value = candidates.find(isValidAdUnitId);
    return value ? value.trim() : "";
  },

  // 登录代次用于隔离取消／退出之前发出的异步请求。
  cancelLogin() {
    this._authGeneration = (this._authGeneration || 0) + 1;
    this._loginPromise = null;
  },

  logout() {
    // 缓存移除失败时仍保留当前登录，避免下次启动出现意外恢复。
    wx.removeStorageSync("openid");
    this.cancelLogin();
    this.globalData.openid = "";
    this.globalData.userInfo = null;
    this.globalData.exportSession = null;
    const pages =
      typeof getCurrentPages === "function" ? getCurrentPages() : [];
    pages.forEach((page) => {
      if (page.route === "pages/history/history") {
        page._historySeq = (page._historySeq || 0) + 1;
        page.setData({
          hasLogin: false,
          historyList: [],
          isLoading: false,
          error: "",
          loadError: "",
        });
      }
      if (page.route === "pages/profile/profile") {
        page._usageSeq = (page._usageSeq || 0) + 1;
        page._loginAttempt = (page._loginAttempt || 0) + 1;
        page.setData({
          hasLogin: false,
          nickname: "",
          avatarUrl: "",
          busy: false,
          usageKnown: false,
          usageBusy: false,
          usageError: "",
          remaining: 0,
          unlimited: false,
          error: "",
        });
      }
    });
  },

  doLogin() {
    if (this._loginPromise) return this._loginPromise;
    const generation = this._authGeneration || 0;
    const active = () => generation === (this._authGeneration || 0);
    const cancelled = () => {
      const error = new Error("登录已取消");
      error.cancelled = true;
      return error;
    };
    const loginPromise = new Promise((resolve, reject) => {
      wx.login({
        timeout: 10000,
        success: (res) => {
          if (!active()) return reject(cancelled());
          if (!res.code) return reject(new Error("微信登录失败，请重试"));
          wx.request({
            url: `${this.globalData.baseUrl}/api/user/login`,
            method: "POST",
            timeout: 15000,
            data: { code: res.code },
            header: { "content-type": "application/x-www-form-urlencoded" },
            success: (response) => {
              if (!active()) return reject(cancelled());
              if (
                response.statusCode >= 200 &&
                response.statusCode < 300 &&
                response.data &&
                response.data.code === 200 &&
                response.data.data &&
                response.data.data.openid
              ) {
                const data = response.data.data;
                try {
                  wx.setStorageSync("openid", data.openid);
                } catch (error) {
                  reject(new Error("无法保存登录状态，请检查可用空间"));
                  return;
                }
                this.globalData.openid = data.openid;
                this.globalData.userInfo = data;
                resolve(data);
              } else
                reject(
                  new Error(
                    (response.data && response.data.message) ||
                      "登录失败，请重试",
                  ),
                );
            },
            fail: () =>
              reject(active() ? new Error("网络异常，请重试") : cancelled()),
          });
        },
        fail: () =>
          reject(active() ? new Error("微信登录失败，请重试") : cancelled()),
      });
    }).finally(() => {
      // 已取消的旧请求结束时，不能清除新一轮登录的并发保护。
      if (this._loginPromise === loginPromise) this._loginPromise = null;
    });
    this._loginPromise = loginPromise;
    return loginPromise;
  },

  async ensureLogin() {
    if (this.globalData.openid) return true;
    // 在用户发起保存／查看云端作品时建立身份，无需额外的登录确认。
    // wx.login 只换取服务端身份；头像与昵称仍由用户在资料页主动填写。
    await this.doLogin();
    return Boolean(this.globalData.openid);
  },
});

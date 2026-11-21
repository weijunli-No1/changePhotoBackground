const { createMotion } = require("../../utils/skyline-motion");
const app = getApp();
const api = require("../../utils/api");
const drafts = require("../../utils/drafts");
const catalog = require("../../utils/tool-catalog");
const files = require("../../utils/files");
const { call } = files;
Page({
  onShareAppMessage() {
    return { title: "拾光小相｜记录你的照片作品", path: "/pages/index/index" };
  },
  onShareTimeline() {
    return { title: "拾光小相｜记录你的照片作品", query: "" };
  },

  data: {
    tab: "drafts",
    drafts: [],
    managingDrafts: false,
    historyList: [],
    isLoading: false,
    hasLogin: false,
    loggingIn: false,
    error: "",
    loadError: "",
    savingId: null,
  },
  onReady() {
    this._motion = createMotion(this, wx);
    this.updateTabMotion();
  },
  onResize() { this.updateTabMotion(); },
  updateTabMotion() {
    if (this._motion)
      this._motion.indicator(".segment", ".segment-item.active", ".works-indicator", {
        maxWidth: 32,
      });
  },
  onShow() {
    this._unloaded = false;
    if (["drafts", "cloud"].includes(app.globalData.requestedWorksTab)) {
      this.setData({ tab: app.globalData.requestedWorksTab }, () =>
        this.updateTabMotion(),
      );
      delete app.globalData.requestedWorksTab;
    }
    if (this._historyOwner !== app.globalData.openid) {
      this.clearDownloadRetries();
      this._cloudSave = null;
      this._historySeq = (this._historySeq || 0) + 1;
      this._historyOwner = app.globalData.openid;
      this.setData({
        historyList: [],
        isLoading: false,
        error: "",
        loadError: "",
        savingId: null,
      });
    }
    this.setData({
      hasLogin: Boolean(app.globalData.openid),
      managingDrafts: false,
      drafts: drafts.list().map((item) => catalog.presentDraft(item)),
    });
    if (this.data.tab === "cloud") this.fetchHistoryList();
  },
  onUnload() {
    this._unloaded = true;
    this._cloudSave = null;
    this.clearDownloadRetries();
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
    this.setData({ tab, error: "", managingDrafts: false }, () => {
      this.updateTabMotion();
      if (this._motion) this._motion.fade(".works-panel");
    });
    if (tab === "cloud") this.fetchHistoryList();
    else
      this.setData({
        drafts: drafts.list().map((item) => catalog.presentDraft(item)),
      });
  },
  toggleManageDrafts() {
    if (this.data.tab === "drafts" && this.data.drafts.length)
      this.setData({ managingDrafts: !this.data.managingDrafts });
  },
  async login() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true, error: "" });
    try {
      if ((await app.ensureLogin()) && !this._unloaded && app.globalData.openid) {
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
  localCloudCovers(owner) {
    const covers = new Map();
    let local;
    try { local = drafts.list(); } catch (_) { return covers; }
    for (const draft of local) {
      const link = draft.cloudCover;
      if (!link || link.owner !== owner || !Array.isArray(link.ids)) continue;
      const { displayPath } = catalog.presentDraft(draft);
      if (displayPath) for (const id of link.ids) covers.set(String(id), displayPath);
    }
    return covers;
  },
  async fetchHistoryList(force = false) {
    if (!app.globalData.openid || (this.data.isLoading && !force)) return;
    const owner = app.globalData.openid;
    if (this._historyOwner !== owner) {
      if (this._historyOwner !== undefined) {
        this.clearDownloadRetries();
        this._cloudSave = null;
        this.setData({ historyList: [], savingId: null });
      }
      this._historyOwner = owner;
    }
    const seq = (this._historySeq = (this._historySeq || 0) + 1);
    this.setData({ isLoading: true, loadError: "" });
    try {
      if (!app.globalData.sessionToken) {
        if (typeof app.ensureLogin !== "function") throw Error("请重新登录后查看作品");
        const loggedIn = await app.ensureLogin();
        if (this._unloaded || seq !== this._historySeq || app.globalData.openid !== owner) return;
        if (!loggedIn || !app.globalData.sessionToken) throw Error("请重新登录后查看作品");
      }
      const list = api.unwrap(
        await api.request("/api/history/list", { data: { openid: owner } }),
      );
      if (!this._unloaded && seq === this._historySeq && app.globalData.openid === owner) {
        const covers = this.localCloudCovers(owner);
        this.setData({
          historyList: (list || []).map((item) => ({
            id: item.id,
            previewUrl: item.previewUrl || "",
            coverPath: covers.get(String(item.id)) || "",
            coverColor: /^#[0-9a-f]{6}$/i.test(item.bgColor) ? item.bgColor : "",
            createTime: item.createTime || "",
            timeStr: (item.createTime || "").replace("T", " ").slice(0, 16),
          })),
        });
      }
    } catch (error) {
      if (!this._unloaded && seq === this._historySeq && app.globalData.openid === owner)
        this.setData({
          loadError: error.message || "作品加载失败，请稍后重试",
        });
    } finally {
      if (!this._unloaded && seq === this._historySeq && app.globalData.openid === owner)
        this.setData({ isLoading: false });
    }
  },
  retryHistory() {
    return this.fetchHistoryList();
  },
  resume(e) {
    if (this._openingDraft || this._unloaded || this.data.managingDrafts) return;
    const item = drafts.get(e.currentTarget.dataset.id);
    if (!item) {
      this.setData({ error: "草稿已不存在，请刷新作品列表", drafts: drafts.list().map((draft) => catalog.presentDraft(draft)) });
      return;
    }
    const url = catalog.draftUrl(item);
    if (url) {
      this._openingDraft = true;
      this.setData({ error: "" });
      wx.navigateTo({
        url,
        fail: () => { if (!this._unloaded) this.setData({ error: "草稿未能打开，请重试" }); },
        complete: () => { this._openingDraft = false; },
      });
    }
    else this.setData({ error: "暂时无法打开这份草稿" });
  },
  async clearDrafts() {
    if (this._clearingDrafts || this._removingDraft || !this.data.drafts.length) return;
    this._clearingDrafts = true;
    try {
      const res = await call("showModal", {
        title: "清理本地草稿",
        content: "将删除这台设备上的草稿及草稿图片。云端作品、手机相册和头像昵称会保留。",
        confirmText: "清理",
        confirmColor: "#ac4939",
      });
      if (!res.confirm || this._unloaded) return;
      await drafts.clear();
      if (!this._unloaded) {
        this.setData({ drafts: [], managingDrafts: false });
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
        if (!this._unloaded) {
          const remaining = drafts.list().map((item) => catalog.presentDraft(item));
          this.setData({
            drafts: remaining,
            managingDrafts: remaining.length > 0 && this.data.managingDrafts,
          });
        }
      }
    } catch (error) {
      if (!this._unloaded) this.setData({ error: "草稿未能删除，请重试" });
    } finally {
      this._removingDraft = false;
    }
  },
  previewImage(e) {
    const owner = app.globalData.openid;
    if (this._unloaded || !owner || owner !== this._historyOwner) return;
    const available = this.data.historyList.filter((item) => item.previewUrl && !item.previewMissing);
    const current = available.find((item) => String(item.id) === String(e.currentTarget.dataset.id));
    if (current) wx.previewImage({
      urls: available.map((item) => item.previewUrl),
      current: current.previewUrl,
      fail: error => {
        if (!this._unloaded && app.globalData.openid === owner && !/cancel/i.test(error.errMsg || ""))
          this.setData({ error: "大图未能打开，请重试" });
      },
    });
  },
  cloudCoverError(e) {
    if (!this._unloaded)
      this.updateCloudWork(e.currentTarget.dataset.id, { coverPath: "" });
  },
  updateCloudWork(id, values) {
    this.setData({
      historyList: this.data.historyList.map((item) =>
        String(item.id) === String(id) ? { ...item, ...values } : item,
      ),
    });
  },
  clearDownloadRetries() {
    for (const retry of Object.values(this._downloadRetries || {}))
      if (files.removeTemp) files.removeTemp(retry.path);
    this._downloadRetries = {};
  },
  cloudSaveCurrent(operation) {
    return !this._unloaded && this._cloudSave === operation &&
      app.globalData.openid === operation.owner &&
      app.globalData.sessionToken === operation.token;
  },
  async saveCloudPhoto(e) {
    if (this._unloaded || this._cloudSave || this._deleting) return;
    const item = this.data.historyList.find((value) => String(value.id) === String(e.currentTarget.dataset.id));
    const owner = app.globalData.openid;
    if (!item || !owner || (this._historyOwner && this._historyOwner !== owner)) return;
    const operation = { owner, token: app.globalData.sessionToken, id: item.id };
    this._cloudSave = operation;
    this.setData({ savingId: item.id });
    this.updateCloudWork(item.id, { downloadError: "", saveMessage: "", quotaBlocked: false });
    let path = "";
    let albumFailed = false;
    try {
      if (!operation.token) {
        if (typeof app.ensureLogin !== "function") throw Error("请重新登录后保存作品");
        const loggedIn = await app.ensureLogin();
        if (this._unloaded || this._cloudSave !== operation || app.globalData.openid !== owner) return;
        operation.token = app.globalData.sessionToken;
        if (!loggedIn || !operation.token) throw Error("请重新登录后保存作品");
      }
      this._downloadRetries = this._downloadRetries || {};
      const retry = this._downloadRetries[item.id];
      if (retry && retry.owner === owner && retry.token === operation.token) path = retry.path;
      else {
        if (retry && files.removeTemp) files.removeTemp(retry.path);
        delete this._downloadRetries[item.id];
        const response = await api.request(`/api/history/${encodeURIComponent(item.id)}/download`, {
          method: "POST",
          data: { openid: owner },
        });
        if (!this.cloudSaveCurrent(operation)) return;
        const result = api.unwrap(response);
        if (!result || !result.image_base64) throw Error("没有收到可保存的照片，请重试");
        path = await files.writeBase64(result.image_base64, "photo");
      }
      if (!this.cloudSaveCurrent(operation)) return;
      try {
        await files.saveAlbum(path);
      } catch (error) {
        albumFailed = true;
        throw error;
      }
      if (!this.cloudSaveCurrent(operation)) return;
      delete this._downloadRetries[item.id];
      this.updateCloudWork(item.id, {
        downloadError: "", saveMessage: "已保存到手机相册", downloadSaved: true, quotaBlocked: false,
      });
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (error) {
      if (this.cloudSaveCurrent(operation)) {
        if (albumFailed && path)
          this._downloadRetries[item.id] = { owner, token: operation.token, path };
        const quotaBlocked = error.code === 4031;
        this.updateCloudWork(item.id, {
          downloadError: quotaBlocked
            ? "今日保存次数不足，可在制作保存时观看视频，或在「我的」查看会员。"
            : error.message || "保存失败，请重试",
          quotaBlocked,
        });
      }
    } finally {
      let retry = (this._downloadRetries || {})[item.id];
      if (retry && retry.path === path &&
        (this._unloaded || app.globalData.openid !== owner || app.globalData.sessionToken !== operation.token)) {
        delete this._downloadRetries[item.id];
        retry = null;
      }
      if (path && (!retry || retry.path !== path) && files.removeTemp) files.removeTemp(path);
      if (this._cloudSave === operation) {
        this._cloudSave = null;
        if (!this._unloaded && app.globalData.openid === owner) this.setData({ savingId: null });
      }
    }
  },
  async onDelete(e) {
    if (this._deleting || this._cloudSave || this._unloaded) return;
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
      if (!res.confirm || this._unloaded || app.globalData.openid !== owner) return;
      api.unwrap(await api.request(`/api/history/${id}`, { method: "DELETE" }));
      if (!this._unloaded && app.globalData.openid === owner) {
        const retry = (this._downloadRetries || {})[id];
        if (retry && files.removeTemp) files.removeTemp(retry.path);
        if (this._downloadRetries) delete this._downloadRetries[id];
        this.setData({
          historyList: this.data.historyList.filter((item) => item.id !== id),
          error: "",
        });
        wx.showToast({ title: "已删除", icon: "success" });
        // Replace any refresh started before deletion, whose response may still contain it.
        await this.fetchHistoryList(true);
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

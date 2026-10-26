const specs = require("../../utils/photo-specs");
const files = require("../../utils/files");
const { createMotion } = require("../../utils/skyline-motion");
Page({
  data: {
    query: "",
    category: "all",
    categories: specs.categories,
    groups: [],
    count: specs.presets.length,
    detail: null,
    choosing: false,
    error: "",
    specVisible: false,
    selectedSize: specs.sizes[0],
    scrollTop: 0,
  },
  onLoad(options = {}) {
    this._unloaded = false;
    this._selectOnly = options.select === "1";
    this.refresh();
    if (options.id && specs.getSpec(options.id))
      this.setData({ detail: specs.getSpec(options.id) });
    if (options.custom === "1") this.setData({ specVisible: true });
  },
  onReady() {
    this._motion = createMotion(this, wx);
  },
  onUnload() {
    this._unloaded = true;
    if (this._motion) this._motion.dispose();
  },
  refresh() {
    const matches = specs.findSpecs(this.data.query, this.data.category);
    const popular = this.data.category === "all" && !this.data.query.trim();
    const groups = [];
    if (popular)
      groups.push({
        id: "popular",
        name: "热门考试",
        items: matches.filter((s) => s.popular),
      });
    for (const group of specs.categories.filter((c) => c.id !== "all")) {
      const items = matches.filter(
        (s) => s.category === group.id && !(popular && s.popular),
      );
      if (items.length) groups.push({ ...group, items });
    }
    this.setData({
      groups,
      count: matches.length,
      error: "",
      scrollTop: this.data.scrollTop ? 0 : 1,
    });
  },
  search(e) {
    this.setData({ query: e.detail.value });
    this.refresh();
  },
  clearSearch() {
    this.setData({ query: "" });
    this.refresh();
  },
  broadenSearch() {
    this.setData({ category: "all" });
    this.refresh();
  },
  selectCategory(e) {
    const category = e.currentTarget.dataset.id;
    if (!specs.categories.some((c) => c.id === category)) return;
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ category });
    this.refresh();
    if (this._motion) this._motion.fade(".spec-list");
  },
  showDetail(e) {
    const detail = specs.getSpec(e.currentTarget.dataset.id);
    if (!detail || this.data.choosing || this._openingDetail || this._unloaded)
      return;
    this._openingDetail = true;
    if (wx.hideKeyboard) wx.hideKeyboard();
    wx.navigateTo({
      url: `/pages/spec-detail/spec-detail?id=${detail.id}${this._selectOnly ? "&select=1" : ""}`,
      success: (res) => {
        if (this._selectOnly)
          res.eventChannel.on("selected", (value) => {
            if (this._unloaded) return;
            this.getOpenerEventChannel().emit("selected", value);
          });
      },
      fail: () => {
        if (!this._unloaded)
          this.setData({ error: "规格详情未能打开，请重试" });
      },
      complete: () => {
        this._openingDetail = false;
      },
    });
  },
  custom() {
    if (wx.hideKeyboard) wx.hideKeyboard();
    if (!this.data.choosing) this.setData({ specVisible: true });
  },
  closeSpecs() {
    this.setData({ specVisible: false });
  },
  async selectCustom(e) {
    const size = specs.validateSize(e.detail.width, e.detail.height);
    size.name = e.detail.name || "自定义";
    this.setData({ specVisible: false, selectedSize: size });
    if (this._selectOnly) {
      this.getOpenerEventChannel().emit("selected", { size });
      wx.navigateBack();
      return;
    }
    if (this.data.choosing) return;
    this.setData({ choosing: true, error: "" });
    try {
      const media = await files.call("chooseMedia", {
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["original"],
      });
      if (this._unloaded) return;
      const photo = media.tempFiles && media.tempFiles[0];
      if (!photo) throw Error("未能读取照片");
      await files.call("navigateTo", {
        url: `/pages/edit/edit?src=${encodeURIComponent(photo.tempFilePath)}&width=${size.width}&height=${size.height}&name=${encodeURIComponent(size.name)}`,
      });
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || ""))
        this.setData({ error: error.message || "未能打开照片，请重试" });
    } finally {
      if (!this._unloaded) this.setData({ choosing: false });
    }
  },
});

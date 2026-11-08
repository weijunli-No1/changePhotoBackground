const specs = require("../../utils/photo-specs");
const files = require("../../utils/files");
const { createMotion } = require("../../utils/skyline-motion");
Page({
  onShareAppMessage() {
    return { title: "拾光小相｜查找证件照规格", path: "/pages/specs/specs" };
  },
  onShareTimeline() {
    return { title: "拾光小相｜查找证件照规格", query: "" };
  },

  data: {
    query: "",
    category: "all",
    categories: [
      { id: "all", name: "全部" },
      { id: "common", name: "常用证件" },
      { id: "exam", name: "考试报名" },
    ],
    selectOnly: false,
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
    this._toolId = options.tool === "background" ? "background" : "idphoto";
    this.setData({ selectOnly: this._selectOnly });
    if (options.width && options.height) {
      try {
        const size = specs.validateSize(options.width, options.height);
        const preset = specs.sizes.find(
          (item) => item.width === size.width && item.height === size.height,
        );
        this.setData({
          selectedSize: {
            ...size,
            name: options.name || (preset && preset.name) || "自定义",
            ...(specs.getSpec(options.spec) ? { specId: options.spec } : {}),
          },
        });
      } catch (_) {
        // Invalid external query dimensions must not replace the safe default.
      }
    }
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
    const matches =
      this.data.category === "exam"
        ? specs.findSpecs(this.data.query).filter((item) => item.category !== "common")
        : specs.findSpecs(this.data.query, this.data.category);
    const popular = this.data.category === "all" && !this.data.query.trim();
    const groups = [];
    const common = matches.filter((item) => item.category === "common");
    if (common.length)
      groups.push({
        id: "common",
        name: "常用证件",
        items: popular ? common.slice(0, 2) : common,
      });
    if (popular)
      groups.push({
        id: "popular",
        name: "热门考试",
        items: matches.filter((s) => s.popular),
      });
    for (const group of specs.categories.filter(
      (c) => c.id !== "all" && c.id !== "common",
    )) {
      const items = matches.filter(
        (s) => s.category === group.id && !(popular && s.popular),
      );
      if (items.length) groups.push({ ...group, items });
    }
    if (popular && common.length > 2)
      groups.push({ id: "more-common", name: "更多常用尺寸", items: common.slice(2) });
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
    if (!this.data.categories.some((c) => c.id === category)) return;
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ category });
    this.refresh();
    if (this._motion) this._motion.fade(".spec-list");
  },
  selectCommon(e) {
    if (this.data.choosing || this._unloaded) return;
    const spec = specs.getSpec(e.currentTarget.dataset.id);
    if (!spec || spec.category !== "common") return;
    this.setData({
      selectedSize: { name: spec.name, width: spec.width, height: spec.height },
      error: "",
    });
  },
  confirmSelection() {
    if (this.data.choosing || this._unloaded) return;
    return this.selectCustom({ detail: this.data.selectedSize });
  },
  showDetail(e) {
    const detail = specs.getSpec(e.currentTarget.dataset.id);
    if (!detail || this.data.choosing || this._openingDetail || this._unloaded) return;
    this._openingDetail = true;
    if (wx.hideKeyboard) wx.hideKeyboard();
    wx.navigateTo({
      url: `/pages/spec-detail/spec-detail?id=${detail.id}&tool=${this._toolId}${this._selectOnly ? "&select=1" : ""}`,
      success: (res) => {
        if (this._selectOnly)
          res.eventChannel.on("selected", (value) => {
            if (this._unloaded) return;
            this.getOpenerEventChannel().emit("selected", value);
          });
      },
      fail: () => {
        if (!this._unloaded) this.setData({ error: "规格详情未能打开，请重试" });
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
    if (this._unloaded || this.data.choosing || this._returningSelection) return;
    let size;
    try {
      size = specs.validateSize(e.detail.width, e.detail.height);
      size.name = e.detail.name || "自定义";
      if (specs.getSpec(e.detail.specId)) size.specId = e.detail.specId;
    } catch (error) {
      this.setData({ error: error.message });
      return;
    }
    this.setData({ specVisible: false, selectedSize: size });
    if (this._selectOnly) {
      this._returningSelection = true;
      this.getOpenerEventChannel().emit("selected", { size });
      wx.navigateBack({
        fail: () => {
          if (!this._unloaded) {
            this._returningSelection = false;
            this.setData({ error: "未能返回编辑页，请重试" });
          }
        },
      });
      return;
    }
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
      if (!photo || !photo.tempFilePath) throw Error("未能读取照片，请重新选择");
      await files.call("navigateTo", {
        url: `/pages/edit/edit?src=${encodeURIComponent(photo.tempFilePath)}&width=${size.width}&height=${size.height}&name=${encodeURIComponent(size.name)}&tool=${this._toolId}`,
      });
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || ""))
        this.setData({ error: error.message || "未能打开照片，请重试" });
    } finally {
      if (!this._unloaded) this.setData({ choosing: false });
    }
  },
});

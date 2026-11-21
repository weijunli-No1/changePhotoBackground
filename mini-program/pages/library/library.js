const { createMotion } = require("../../utils/skyline-motion");
const catalog = require("../../utils/tool-catalog");
const launcher = require("../../utils/tool-launcher");
const { sizes, findSpecs, getSpec } = require("../../utils/photo-specs");
Page({
  onShareAppMessage() {
    return { title: "拾光小相｜照片工具箱", path: "/pages/library/library" };
  },
  onShareTimeline() {
    return { title: "拾光小相｜照片工具箱", query: "" };
  },

  data: {
    query: "",
    category: "all",
    quickQueries: ["一寸", "四六级", "压缩"],
    categories: catalog.getCategories(),
    groups: catalog.grouped(),
    matchingSpecs: [],
    specMatchCount: 0,
    outsideCategory: false,
    searchFocused: false,
    specVisible: false,
    specTitle: "选择照片规格",
    size: sizes[0],
    entryError: "",
    scrollTop: 0,
  },
  ...launcher,
  onLoad(options) {
    this._unloaded = false;
    this._focusRequested = options.focus === "1";
  },
  onReady() {
    this._motion = createMotion(this, wx);
    this.updateCategoryMotion();
    if (this._focusRequested) this.setData({ searchFocused: true });
  },
  onHide() {
    this.setData({ specVisible: false, searchFocused: false });
  },
  onUnload() {
    this._unloaded = true;
    if (this._motion) this._motion.dispose();
  },
  updateCategoryMotion() {
    if (this._motion)
      this._motion.indicator(
        ".category-row",
        ".category-tab.selected",
        ".catalog-indicator",
        { maxWidth: 32 },
      );
  },
  onResize() { this.updateCategoryMotion(); },
  updateResults(query, category) {
    const switched = category !== this.data.category;
    const groups = catalog.grouped(query, category);
    const keyword = query.trim();
    const specs = keyword && category !== "image" ? findSpecs(keyword) : [];
    this.setData(
      {
        query,
        category,
        groups,
        matchingSpecs: specs.slice(0, 3),
        specMatchCount: specs.length,
        outsideCategory: Boolean(keyword && !groups.length && !specs.length && category !== "all" &&
          (catalog.findTools(keyword).length || findSpecs(keyword).length)),
        scrollTop: this.data.scrollTop ? 0 : 1,
        entryError: "",
      },
      () => {
        this.updateCategoryMotion();
        if (switched && this._motion) this._motion.fade(".catalog-body");
      },
    );
  },
  search(e) {
    this.updateResults(e.detail.value, this.data.category);
  },
  quickSearch(e) {
    const keyword = e.currentTarget.dataset.query;
    if (!this.data.quickQueries.includes(keyword)) return;
    if (wx.hideKeyboard) wx.hideKeyboard({ fail() {} });
    this.updateResults(keyword, "all");
  },
  searchBlur() {
    this.setData({ searchFocused: false });
  },
  selectCategory(e) {
    const category = e.currentTarget.dataset.id;
    if (
      category !== "all" &&
      !catalog.getCategories().some((item) => item.id === category)
    )
      return;
    this.updateResults(this.data.query, category);
  },
  searchAllCategories() {
    this.updateResults(this.data.query, "all");
  },
  openMatchingSpec(e) {
    if (this._openingTool || this._choosing || this._unloaded) return;
    const id = e.currentTarget.dataset.id;
    if (id && !getSpec(id)) return;
    this._openingTool = true;
    this.setData({ entryError: "", searchFocused: false });
    if (wx.hideKeyboard) wx.hideKeyboard({ fail() {} });
    wx.navigateTo({
      url: id
        ? `/pages/spec-detail/spec-detail?id=${encodeURIComponent(id)}`
        : `/pages/specs/specs?query=${encodeURIComponent(this.data.query)}`,
      fail: () => {
        if (!this._unloaded) this.setData({ entryError: "规格未能打开，请重试" });
      },
      complete: () => { this._openingTool = false; },
    });
  },
  clearSearch() {
    this.updateResults("", this.data.category);
  },
  resetSearch() {
    this.updateResults("", "all");
  },
});

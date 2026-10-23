const { createMotion } = require("../../utils/skyline-motion");
const catalog = require("../../utils/tool-catalog");
const launcher = require("../../utils/tool-launcher");
const { sizes } = require("../../utils/photo-specs");
Page({
  data: {
    query: "",
    category: "all",
    categories: catalog.getCategories(),
    groups: catalog.grouped(),
    searchFocused: false,
    specVisible: false,
    specTitle: "选择照片规格",
    size: sizes[0],
    entryError: "",
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
      );
  },
  updateResults(query, category) {
    const switched = category !== this.data.category;
    this.setData(
      {
        query,
        category,
        groups: catalog.grouped(query, category),
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
  clearSearch() {
    this.updateResults("", this.data.category);
  },
  resetSearch() {
    this.updateResults("", "all");
  },
});

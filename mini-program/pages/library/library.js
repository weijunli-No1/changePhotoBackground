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
    if (this._focusRequested) this.setData({ searchFocused: true });
  },
  onHide() {
    this.setData({ specVisible: false, searchFocused: false });
  },
  onUnload() {
    this._unloaded = true;
  },
  updateResults(query, category) {
    this.setData({
      query,
      category,
      groups: catalog.grouped(query, category),
      entryError: "",
    });
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

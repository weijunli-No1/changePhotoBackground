const catalog = require("./tool-catalog");
const { call } = require("./files");
const { validateSize } = require("./photo-specs");
// 仅 portrait 入口进入现有证件照链路；文档等新工具使用独立 page 入口。
module.exports = {
  openToolEntry(e) {
    const id = typeof e === "string" ? e : e.currentTarget.dataset.id;
    const tool = catalog.getTool(id);
    if (!tool || this._choosing || this._openingTool) return;
    this._activeTool = tool.id;
    if (wx.hideKeyboard) wx.hideKeyboard({ fail() {} });
    this.setData({ entryError: "" });
    if (tool.entry.type === "portrait") {
      this.setData({
        specVisible: true,
        specTitle:
          tool.id === "background" ? "更换底色：选择规格" : "选择照片规格",
      });
      return;
    }
    this._openingTool = true;
    wx.navigateTo({
      url: tool.entry.url,
      fail: () => {
        if (!this._unloaded)
          this.setData({ entryError: "工具暂时无法打开，请重新点击" });
      },
      complete: () => {
        this._openingTool = false;
      },
    });
  },
  startIdPhoto() {
    this.openToolEntry("idphoto");
  },
  closeSpecs() {
    this.setData({ specVisible: false });
  },
  async selectSpec(e) {
    if (this._choosing || this._openingTool) return;
    let size;
    try {
      size = {
        ...validateSize(e.detail.width, e.detail.height),
        name: e.detail.name || "自定义",
      };
    } catch (error) {
      this.setData({ entryError: error.message });
      return;
    }
    const tool = catalog.getTool(this._activeTool || "idphoto");
    if (!tool || tool.entry.type !== "portrait") return;
    this._choosing = true;
    this.setData({ size, specVisible: false, entryError: "" });
    try {
      const media = await call("chooseMedia", {
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["original"],
      });
      if (this._unloaded) return;
      const photo = media.tempFiles && media.tempFiles[0];
      if (!photo || !photo.tempFilePath)
        throw new Error("未能读取照片，请重新选择");
      this._openingTool = true;
      wx.navigateTo({
        url: `/pages/edit/edit?src=${encodeURIComponent(photo.tempFilePath)}&width=${size.width}&height=${size.height}&name=${encodeURIComponent(size.name)}&tool=${tool.id}`,
        fail: () => {
          if (!this._unloaded)
            this.setData({ entryError: "编辑页未能打开，请重新选择照片" });
        },
        complete: () => {
          this._openingTool = false;
        },
      });
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || ""))
        this.setData({
          entryError: error.message || "暂时无法选择照片，请重新点击工具重试",
        });
    } finally {
      this._choosing = false;
    }
  },
};

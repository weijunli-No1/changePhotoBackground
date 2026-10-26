const specs = require("../../utils/photo-specs");
const files = require("../../utils/files");
Page({
  data: {
    spec: null,
    choosing: false,
    error: "",
    mode: "smart",
    selectOnly: false,
    expanded: false,
  },
  onLoad(options = {}) {
    this._unloaded = false;
    this._selectOnly = options.select === "1";
    this.setData({
      selectOnly: this._selectOnly,
      spec: specs.getSpec(options.id) || null,
      mode:
        specs.getSpec(options.id) &&
        specs.getSpec(options.id).category === "common"
          ? "smart"
          : "original",
      error: specs.getSpec(options.id) ? "" : "规格不存在，请返回重新选择",
    });
  },
  onUnload() {
    this._unloaded = true;
  },
  source() {
    if (this.data.spec && this.data.spec.sourceUrl)
      wx.setClipboardData({
        data: this.data.spec.sourceUrl,
        success: () => wx.showToast({ title: "已复制官方链接", icon: "none" }),
      });
  },
  toggleRequirements() {
    this.setData({ expanded: !this.data.expanded });
  },
  setMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!this.data.choosing && ["smart", "original"].includes(mode))
      this.setData({ mode });
  },
  async start() {
    if (this._unloaded || this.data.choosing || !this.data.spec) return;
    const spec = this.data.spec;
    if (this._selectOnly) {
      this.getOpenerEventChannel().emit("selected", {
        size: {
          name: spec.name,
          width: spec.width,
          height: spec.height,
          specId: spec.id,
        },
      });
      wx.navigateBack({ delta: 2 });
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
      if (!photo || !photo.tempFilePath) throw Error("未能读取照片，请重试");
      const url =
        this.data.mode === "smart" || spec.category === "common"
          ? `/pages/edit/edit?src=${encodeURIComponent(photo.tempFilePath)}&width=${spec.width}&height=${spec.height}&name=${encodeURIComponent(spec.name)}&spec=${spec.id}`
          : `/pages/exam/exam?spec=${spec.id}&src=${encodeURIComponent(photo.tempFilePath)}`;
      await files.call("navigateTo", { url });
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || ""))
        this.setData({ error: error.message || "照片未能打开，请重试" });
    } finally {
      if (!this._unloaded) this.setData({ choosing: false });
    }
  },
});

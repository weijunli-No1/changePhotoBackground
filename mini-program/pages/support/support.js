const { faqs, deviceSummary } = require("../../utils/support");
const { call } = require("../../utils/files");
Page({
  data: {
    faqs,
    expanded: "",
    error: "",
    copying: false,
    contactSupported: true,
  },
  onLoad() {
    this._unloaded = false;
    this.setData({
      contactSupported: !wx.canIUse || wx.canIUse("button.open-type.contact"),
    });
  },
  onUnload() {
    this._unloaded = true;
  },
  toggleFaq(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expanded: this.data.expanded === id ? "" : id });
  },
  prepareContact() {
    this.setData({ error: "" });
  },
  onContact(e) {
    if (this._unloaded) return;
    const message = (e.detail && e.detail.errMsg) || "";
    if (/cancel/i.test(message)) {
      this.setData({ error: "" });
      return;
    }
    if (/fail|error|deny|denied/i.test(message)) {
      this.contactError();
      return;
    }
    // 回到帮助页，不根据客服消息中的任意路径自动跳转。
    this.setData({ error: "" });
  },
  contactError() {
    if (!this._unloaded)
      this.setData({
        error:
          "微信客服暂时无法打开，请稍后点击重试。你也可以先查看上方常见问题。",
      });
  },
  async copyDeviceInfo() {
    if (this.data.copying || this._unloaded) return;
    this.setData({ copying: true, error: "" });
    try {
      await call("setClipboardData", { data: deviceSummary(wx) });
      if (!this._unloaded)
        wx.showToast({ title: "已复制，可粘贴给客服", icon: "none" });
    } catch (error) {
      if (!this._unloaded)
        this.setData({ error: "复制失败，请重试，或直接向客服描述操作步骤。" });
    } finally {
      if (!this._unloaded) this.setData({ copying: false });
    }
  },
});

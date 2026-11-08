const app = getApp();
const api = require("../../utils/api");
const membership = require("../../utils/membership");
const { call } = require("../../utils/files");
Page({
  onShareAppMessage() {
    return { title: "拾光小相｜永久会员", path: "/pages/member/member" };
  },
  onShareTimeline() {
    return { title: "拾光小相｜永久会员", query: "" };
  },

  data: { checking: true, unavailable: false, statusKnown: false, busy: false, isMember: false, price: "", purchaseEnabled: false, pendingOrder: false, agreed: false, termsExpanded: false, termsAnchor: "", error: "", notice: "", supportError: "" },
  onLoad() { this._unloaded = false; },
  onShow() { if (!this._purchasing) this.reload(); },
  onUnload() { this._unloaded = true; },
  async reload(preserveError = false) {
    if (this._checking || this._unloaded || this.data.busy) return;
    this._checking = true;
    this.setData({ checking: true, unavailable: false, statusKnown: false, ...(!preserveError ? { error: "", notice: "" } : {}) });
    try {
      const state = await membership.refresh(app, true);
      if (this._unloaded) return;
      if (state.available === false) {
        this.setData({ unavailable: true, statusKnown: false, price: "", purchaseEnabled: false, pendingOrder: false, error: "", notice: "" });
        return;
      }
      this.setData({ unavailable: false });
      if (!Number.isInteger(state.priceFen) || state.priceFen <= 0 || typeof state.purchaseEnabled !== "boolean")
        throw Error("会员信息暂不可用，请重试查询");
      this.setData({
        statusKnown: true,
        isMember: state.isLifetimeMember,
        price: (state.priceFen / 100).toFixed(2),
        purchaseEnabled: state.purchaseEnabled,
        pendingOrder: Boolean(membership.getPending(app.globalData.openid)),
        supportError: membership.paymentSupport(state),
      });
    } catch (e) { if (!this._unloaded) this.setData({ statusKnown: false, purchaseEnabled: false, error: e.message || "暂时无法查询会员，请重试" }); }
    finally { this._checking = false; if (!this._unloaded) this.setData({ checking: false }); }
  },
  toggleAgreement() { if (!this.data.busy) this.setData({ agreed: !this.data.agreed }); },
  toggleTerms() { this.setData({ termsExpanded: !this.data.termsExpanded, termsAnchor: "" }); },
  showTerms() {
    this.setData({ termsExpanded: true, termsAnchor: "" }, () => this.setData({ termsAnchor: "member-terms" }));
  },
  primaryAction() {
    if (this.data.busy || this.data.checking || this._unloaded) return;
    if (this.data.unavailable) return this.backHome();
    if (!this.data.statusKnown || this.data.pendingOrder) return this.reload();
    return this.buy();
  },
  async buy() {
    if (this._unloaded || this.data.unavailable || this.data.busy || this.data.checking || this.data.isMember || this._purchasing) return;
    if (!this.data.statusKnown) return this.reload();
    if (this.data.pendingOrder) return this.reload();
    if (!this.data.purchaseEnabled || this.data.supportError) return;
    if (!this.data.agreed) { this.setData({ error: "请先阅读并勾选同意《会员服务说明》" }); return; }
    this._purchasing = true;
    this.setData({ busy: true, error: "", notice: "" });
    let id = "";
    let owner = "";
    try {
      const status = await membership.refresh(app, true);
      if (this._unloaded) return;
      if (status.isLifetimeMember) { this.setData({ isMember: true }); return; }
      owner = app.globalData.openid;
      const supportError = membership.paymentSupport(status);
      if (!status.purchaseEnabled || supportError) throw Error(supportError || "会员暂未开放购买");
      if (membership.getPending(app.globalData.openid)) { this.setData({ pendingOrder: true }); return; }
      // 新 wx.login code 只在后端换取 session_key，禁止把 session_key 传给前端。
      const login = await call("login", { timeout: 10000 });
      if (this._unloaded) return;
      const order = api.unwrap(await api.request("/api/member/orders", { method: "POST", data: { code: login.code } }));
      id = order.outTradeNo;
      membership.setPending(owner, id);
      if (owner !== app.globalData.openid) throw Error("登录账号已变化，请重新打开会员页");
      if (this._unloaded) return;
      try { await call("requestVirtualPayment", order.payData); }
      catch (e) {
        if (e.errCode === -2) {
          // 明确取消时允许重新下单；每次支付使用新业务单号。
          membership.setPending(owner, "");
          throw Error("已取消支付");
        }
        this.setData({ notice: "支付结果待确认，正在查询订单…" });
      }
      if (this._unloaded) return;
      let confirmed = false;
      for (let i=0; i<4 && !this._unloaded; i++) {
        try {
          const state = await membership.refresh(app, true);
          if (state.isLifetimeMember) { confirmed = true; break; }
        } catch (_) { /* 保留订单以便恢复，绝不凭前端回调开会员。 */ }
        if (i<3) await new Promise(resolve => setTimeout(resolve, 1200));
      }
      if (!this._unloaded) this.setData({ isMember: confirmed, pendingOrder: !confirmed, notice: confirmed ? "永久会员已开通，立即享受免广告与无限保存" : "付款状态仍在确认。可点击恢复购买，或稍后重新进入本页。请勿重复付款。" });
    } catch (e) { if (!this._unloaded) this.setData({ error: e.message || "购买未完成，可稍后恢复购买" }); }
    finally {
      this._purchasing = false;
      if (!this._unloaded) {
        this.setData({ busy: false, pendingOrder: Boolean(membership.getPending(app.globalData.openid)) });
        this.reload(true);
      }
    }
  },
  restore() { return this.reload(); },
  backHome() { wx.switchTab({ url: "/pages/index/index" }); },
});

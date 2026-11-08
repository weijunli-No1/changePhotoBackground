const api = require("./api");
let state = { known: false, isLifetimeMember: false, adFree: true };
let generation = 0;
let pending = null;
const listeners = new Set();
function emit() { listeners.forEach((fn) => fn(state)); }
function invalidate() {
  generation += 1;
  pending = null;
  state = { known: false, isLifetimeMember: false, adFree: true };
  emit();
}
function pendingKey(openid) { return "member-order:" + openid; }
function getPending(openid) {
  try { return wx.getStorageSync(pendingKey(openid)) || ""; } catch (_) { return ""; }
}
function setPending(openid, id) {
  // 必须保存恢复线索后才拉起支付；本地记录只用于查单，不能授予权益。
  if (id) wx.setStorageSync(pendingKey(openid), id);
  else wx.removeStorageSync(pendingKey(openid));
  invalidate();
}
function refresh(app, force = false) {
  if (pending) return pending;
  if (!force && state.known) return Promise.resolve(state);
  invalidate();
  const version = generation;
  const request = (async () => {
    await app.appConfigReady;
    if (version !== generation) throw Error("账号状态已变化，请重试");
    // A capability check is distinct from an entitlement check. Never suppress
    // recovery of an existing order, even if the deployment capability changes.
    if (app.globalData.membershipEnabled === false && !getPending(app.globalData.openid)) {
      state = { available: false, known: false, isLifetimeMember: false, adFree: true };
      emit();
      return state;
    }
    await app.ensureLogin();
    const owner = app.globalData.openid;
    let id = getPending(owner);
    let result;
    if (id) {
      result = api.unwrap(await api.request("/api/member/orders/" + encodeURIComponent(id)));
      if (version !== generation || owner !== app.globalData.openid) throw Error("账号状态已变化，请重试");
      if (result.isLifetimeMember || ["CLOSED", "REFUNDED"].includes(result.orderStatus)) {
        wx.removeStorageSync(pendingKey(owner));
      }
    } else {
      result = api.unwrap(await api.request("/api/member/status"));
      if (version !== generation || owner !== app.globalData.openid) throw Error("账号状态已变化，请重试");
      if (!result.isLifetimeMember && result.pendingOrderId) {
        // Server-owned recovery survives storage cleanup and device changes.
        wx.setStorageSync(pendingKey(owner), result.pendingOrderId);
        result = { ...result, orderStatus: result.pendingOrderStatus };
      }
    }
    if (version !== generation || owner !== app.globalData.openid) throw Error("账号状态已变化，请重试");
    if (typeof result.isLifetimeMember !== "boolean" || typeof result.adFree !== "boolean") throw Error("会员状态暂不可用");
    // 支付待确认期间始终抑制广告，避免支付返回时闪现广告。
    state = { ...result, available: true, known: true, adFree: result.adFree || Boolean(getPending(owner)) };
    emit();
    return state;
  })().finally(() => { if (pending === request) pending = null; });
  pending = request;
  return request;
}
function subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
function current() { return state; }
function canShowAds() { return state.known && state.adFree === false && state.isLifetimeMember === false; }
function open() { wx.navigateTo({ url: "/pages/member/member" }); }
function compareVersion(a, b) {
  const x=String(a).split(".").map(Number), y=String(b).split(".").map(Number);
  for (let i=0; i<Math.max(x.length,y.length);i++) { if ((x[i]||0)!==(y[i]||0)) return (x[i]||0)>(y[i]||0)?1:-1; }
  return 0;
}
function paymentSupport(config) {
  const info = typeof wx.getAppBaseInfo === "function" ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
  const device = typeof wx.getDeviceInfo === "function" ? wx.getDeviceInfo() : info;
  if (typeof wx.requestVirtualPayment !== "function") return "当前微信版本不支持购买，请更新微信";
  if (device.platform === "ios" && (!config.iosEnabled || compareVersion(info.version,"8.0.68")<0)) return "当前 iOS 环境暂不支持购买，已购权益正常使用";
  if (!["ios","android"].includes(device.platform)) return "请在手机微信中开通，已购权益正常使用";
  return "";
}
module.exports = { refresh, invalidate, subscribe, current, canShowAds, open, getPending, setPending, paymentSupport };

const membership = require("../../utils/membership");
const { isValidAdUnitId } = require("../../utils/rewarded-video");
Component({
  properties: { placement: { type: String, value: "home" } },
  data: { allowed: false, unitId: "", loaded: false, failed: false },
  lifetimes: {
    attached() {
      this._alive = true;
      this._unsubscribe = membership.subscribe(() => this.sync());
      this.prepare();
    },
    detached() { this._alive = false; if (this._unsubscribe) this._unsubscribe(); },
  },
  pageLifetimes: {
    show() { this.prepare(true); },
    hide() { this._visible = false; this.setData({ allowed: false, loaded: false }); },
  },
  methods: {
    async prepare(force = false) {
      this._visible = true;
      this.setData({ allowed: false, loaded: false, failed: false });
      try {
        const app = getApp();
        await Promise.all([membership.refresh(app, force), app.appConfigReady]);
        if (!this._alive || !this._visible) return;
        const id = (app.globalData.nativeAdUnits || {})[this.data.placement];
        this.setData({ unitId: isValidAdUnitId(id) ? id : "" }, () => this.sync());
      } catch (_) { /* 状态未知或接口失败：不创建广告，不占广告位。 */ }
    },
    sync() {
      if (!this._alive) return;
      const allowed = this._visible && membership.canShowAds() && Boolean(this.data.unitId);
      this.setData({ allowed, ...(!allowed ? { loaded: false } : {}) });
    },
    loaded() { this.setData({ loaded: true, failed: false }); },
    failed() { this.setData({ loaded: false, failed: true }); },
  },
});

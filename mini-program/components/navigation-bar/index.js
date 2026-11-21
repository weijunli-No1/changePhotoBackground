const themes = require("../../utils/themes");
Component({
  properties: {
    title: String,
    brand: Boolean,
    inverse: Boolean,
    showBack: {
      type: Boolean,
      value: false,
    },
    bgColor: {
      type: String,
      value: "",
    },
    titleColor: {
      type: String,
      value: "",
    },
  },
  data: {
    statusBarHeight: 0,
    contentHeight: 44,
    navHeight: 0,
  },
  lifetimes: {
    attached() {
      this._offTheme = themes.subscribe(theme => {
        this.setData({ studioTheme: theme });
        if (this._visible) this.updateForeground();
      });
      this._onThemeChange = (event) => {
        if (this._visible) this.updateForeground(event.theme);
      };
      if (wx.onThemeChange) wx.onThemeChange(this._onThemeChange);
      try {
        const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight = systemInfo.statusBarHeight || 20;
        const menuButtonRect = wx.getMenuButtonBoundingClientRect
          ? wx.getMenuButtonBoundingClientRect()
          : null;

        let contentHeight = 44;
        if (menuButtonRect && menuButtonRect.height) {
          contentHeight =
            menuButtonRect.height + (menuButtonRect.top - statusBarHeight) * 2;
        }

        this.setData({
          statusBarHeight,
          contentHeight,
          navHeight: statusBarHeight + contentHeight,
        });
      } catch (e) {
        console.error("获取导航栏高度失败", e);
        this.setData({
          statusBarHeight: 20,
          contentHeight: 44,
          navHeight: 64,
        });
      }
    },
    ready() { themes.applyCurrentPage(); },
    detached() {
      if (this._offTheme) this._offTheme();
      if (wx.offThemeChange && this._onThemeChange)
        wx.offThemeChange(this._onThemeChange);
    },
  },
  pageLifetimes: {
    show() {
      this._visible = true;
      this.updateForeground();
    },
    hide() {
      this._visible = false;
    },
  },
  methods: {
    updateForeground(theme) {
      themes.applyCurrentPage(theme);
      if (!wx.setNavigationBarColor) return;
      const dark = (theme || (wx.getAppBaseInfo && wx.getAppBaseInfo().theme)) === "dark";
      wx.setNavigationBarColor({
        frontColor: this.properties.inverse || dark ? "#ffffff" : "#000000",
        backgroundColor: this.properties.inverse
          ? "#1b5147"
          : dark
            ? themes.current().darkPaper
            : themes.current().paper,
        fail() {},
      });
    },
    goBack() {
      if (this._returning) return;
      this._returning = true;
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.switchTab({ url: "/pages/index/index" });
        },
        complete: () => { this._returning = false; },
      });
    },
  },
});

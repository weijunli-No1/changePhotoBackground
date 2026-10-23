Component({
  properties: {
    title: String,
    showBack: {
      type: Boolean,
      value: false,
    },
    bgColor: {
      type: String,
      value: 'var(--nav-bg-color, rgba(255, 255, 255, 0.75))',
    },
    titleColor: {
      type: String,
      value: 'var(--td-text-color-primary, #000000)',
    },
  },
  data: {
    statusBarHeight: 0,
    contentHeight: 44,
    navHeight: 0,
  },
  lifetimes: {
    attached() {
      try {
        const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight = systemInfo.statusBarHeight || 20;
        const menuButtonRect = wx.getMenuButtonBoundingClientRect
          ? wx.getMenuButtonBoundingClientRect()
          : null;

        let contentHeight = 44;
        if (menuButtonRect && menuButtonRect.height) {
          contentHeight = menuButtonRect.height + (menuButtonRect.top - statusBarHeight) * 2;
        }

        this.setData({
          statusBarHeight,
          contentHeight,
          navHeight: statusBarHeight + contentHeight,
        });
      } catch (e) {
        console.error('获取导航栏高度失败', e);
        this.setData({
          statusBarHeight: 20,
          contentHeight: 44,
          navHeight: 64,
        });
      }
    },
  },
  methods: {
    goBack() {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.switchTab({ url: '/pages/index/index' });
        },
      });
    },
  },
});

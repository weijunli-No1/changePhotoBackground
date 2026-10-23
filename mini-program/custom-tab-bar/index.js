Component({
  data: {
    visible: true,
    value: '/pages/index/index',
    list: [
      { value: '/pages/index/index', label: '首页', icon: 'app' },
      { value: '/pages/history/history', label: '作品', icon: 'image' },
      { value: '/pages/profile/profile', label: '我的', icon: 'user' },
    ],
  },
  methods: {
    onChange(e) {
      const value = e.currentTarget.dataset.value;
      if (value !== this.data.value) wx.switchTab({ url: value });
    },
    init() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      this.setData({ value: page ? '/' + page.route : '/pages/index/index' });
    },
  },
});

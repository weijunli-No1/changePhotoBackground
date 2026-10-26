const { sizes, validateSize } = require("../../utils/photo-specs");
const OPEN_DURATION = 260;
const CLOSE_DURATION = 180;
Component({
  properties: {
    visible: Boolean,
    description: String,
    currentWidth: Number,
    currentHeight: Number,
    title: { type: String, value: "选择照片规格" },
    showCatalog: { type: Boolean, value: true },
  },
  data: {
    sizes,
    rendered: false,
    closing: false,
    motionOpen: false,
    motionFallback: false,
    selectedIndex: 0,
    selectedName: "一寸",
    width: "295",
    height: "413",
    error: "",
    invalidWidth: false,
    invalidHeight: false,
    keyboardHeight: 0,
    availableHeight: 640,
    compactLayout: false,
  },
  observers: {
    visible(value) {
      if (!this._ready) return;
      if (value) this.openSheet();
      else {
        // 父页面隐藏（例如切换底栏）时撤销尚未送出的选择。
        this._pendingEvent = null;
        this.hideSheet();
      }
    },
  },
  methods: {
    stop() {},
    browse() { if (!this.data.closing) this.hideSheet('browse'); },
    updateWindow() {
      const info = wx.getWindowInfo
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      this._windowHeight = info.windowHeight;
      this._topInset = (info.statusBarHeight || 20) + 48;
      const availableHeight = Math.max(240, info.windowHeight - this._topInset);
      this.setData({ availableHeight, compactLayout: availableHeight < 500 });
    },
    resetSelection() {
      const width = this.data.currentWidth || sizes[0].width;
      const height = this.data.currentHeight || sizes[0].height;
      const index = sizes.findIndex(
        (size) => size.width === width && size.height === height,
      );
      this.setData({
        selectedIndex: index,
        selectedName: index >= 0 ? sizes[index].name : "自定义",
        width: String(width),
        height: String(height),
        error: "",
        invalidWidth: false,
        invalidHeight: false,
      });
    },
    openSheet() {
      clearTimeout(this._closeTimer);
      this._transition = (this._transition || 0) + 1;
      const transition = this._transition;
      this._pendingEvent = null;
      this.releaseMotion();
      this.updateWindow();
      this.resetSelection();
      this.setData(
        {
          rendered: true,
          closing: false,
          keyboardHeight: 0,
          motionOpen: false,
        },
        () => {
          if (this._detached || transition !== this._transition) return;
          this.bindMotion(transition);
        },
      );
    },
    bindMotion(transition) {
      const worklet = wx.worklet;
      if (
        !worklet ||
        !worklet.shared ||
        !worklet.timing ||
        !this.applyAnimatedStyle
      ) {
        this.setData({ motionFallback: true, motionOpen: true });
        return;
      }
      try {
        const progress = worklet.shared(0);
        this._progress = progress;
        this.setData({ motionFallback: false });
        let bound = 0;
        const start = (selector) => (result) => {
          const styleId =
            typeof result === "number" ? result : result && result.styleId;
          if (styleId !== undefined && styleId !== null) {
            if (this._detached || transition !== this._transition) {
              if (this.clearAnimatedStyle)
                this.clearAnimatedStyle(selector, [styleId]);
              return;
            }
            this._styleBindings.push({ selector, id: styleId });
          }
          bound++;
          if (
            bound !== 2 ||
            this._detached ||
            this.data.closing ||
            transition !== this._transition
          )
            return;
          progress.value = worklet.timing(1, {
            duration: OPEN_DURATION,
            easing: worklet.Easing.ease,
          });
        };
        this.applyAnimatedStyle(
          ".spec-scrim",
          () => {
            "worklet";
            return { opacity: progress.value };
          },
          {},
          start(".spec-scrim"),
        );
        this.applyAnimatedStyle(
          ".spec-sheet",
          () => {
            "worklet";
            return { transform: `translateY(${(1 - progress.value) * 100}%)` };
          },
          {},
          start(".spec-sheet"),
        );
      } catch (error) {
        this._progress = null;
        this.setData({ motionFallback: true, motionOpen: true });
      }
    },
    releaseMotion() {
      if (this.clearAnimatedStyle)
        for (const binding of this._styleBindings || [])
          this.clearAnimatedStyle(binding.selector, [binding.id]);
      this._styleBindings = [];
    },
    resetKeyboard() {
      this.setData({
        keyboardHeight: 0,
        availableHeight: Math.max(
          240,
          (this._windowHeight || 730) - (this._topInset || 68),
        ),
      });
    },
    keyboardChange(e) {
      if (this.data.closing) return;
      const height = Math.max(0, Number(e.detail.height) || 0);
      this.setData({
        keyboardHeight: height,
        availableHeight: Math.max(
          200,
          (this._windowHeight || 730) - (this._topInset || 68) - height,
        ),
      });
    },
    focusCustom(e) {
      if (this.data.closing) return;
      this.setData({ selectedIndex: -1, selectedName: "自定义" });
      if (e.detail && Number.isFinite(e.detail.height)) this.keyboardChange(e);
    },
    inputBlur() {
      // 切换宽／高输入框也会 blur；只跟随键盘高度事件，避免弹层反复展开。
    },
    dismissKeyboard() {
      if (wx.hideKeyboard) wx.hideKeyboard({ fail() {} });
    },
    close() {
      if (this.data.closing) return;
      this.hideSheet("close");
    },
    hideSheet(event, value) {
      if (this.data.closing) return;
      if (!this.data.rendered) {
        if (event) this.triggerEvent(event, value);
        return;
      }
      this._pendingEvent = event ? { event, value } : null;
      this.setData({ closing: true, motionOpen: false });
      this.dismissKeyboard();
      if (this._progress && wx.worklet)
        this._progress.value = wx.worklet.timing(0, {
          duration: CLOSE_DURATION,
          easing: wx.worklet.Easing.ease,
        });
      const transition = ++this._transition;
      clearTimeout(this._closeTimer);
      this._closeTimer = setTimeout(() => {
        if (this._detached || transition !== this._transition) return;
        const pending = this._pendingEvent;
        this._pendingEvent = null;
        this._progress = null;
        this.releaseMotion();
        this.setData({ rendered: false, closing: false, keyboardHeight: 0 });
        if (pending) this.triggerEvent(pending.event, pending.value);
      }, CLOSE_DURATION);
    },
    select(e) {
      if (this.data.closing) return;
      const index = Number(e.currentTarget.dataset.index),
        size = sizes[index];
      if (!size) return;
      this.setData({
        selectedIndex: index,
        selectedName: size.name,
        width: String(size.width),
        height: String(size.height),
        error: "",
        invalidWidth: false,
        invalidHeight: false,
      });
      this.dismissKeyboard();
    },
    inputWidth(e) {
      if (this.data.closing) return;
      this.setData({
        selectedIndex: -1,
        selectedName: "自定义",
        width: e.detail.value,
        invalidWidth: false,
        error: "",
      });
    },
    inputHeight(e) {
      if (this.data.closing) return;
      this.setData({
        selectedIndex: -1,
        selectedName: "自定义",
        height: e.detail.value,
        invalidHeight: false,
        error: "",
      });
    },
    confirm() {
      if (this.data.closing) return;
      try {
        const size = validateSize(this.data.width, this.data.height);
        const preset =
          this.data.selectedIndex >= 0 && sizes[this.data.selectedIndex];
        if (
          preset &&
          preset.width === size.width &&
          preset.height === size.height
        )
          size.name = preset.name;
        this.hideSheet("select", size);
      } catch (error) {
        const invalid = (value) =>
          !/^\d+$/.test(String(value)) ||
          Number(value) < 100 ||
          Number(value) > 3000;
        this.setData({
          error: error.message,
          invalidWidth: invalid(this.data.width),
          invalidHeight: invalid(this.data.height),
        });
      }
    },
    custom() {
      this.setData({ selectedIndex: -1, selectedName: "自定义" });
      this.confirm();
    },
  },
  lifetimes: {
    attached() {
      this._detached = false;
      this.updateWindow();
    },
    ready() {
      this._ready = true;
      if (this.data.visible) this.openSheet();
    },
    detached() {
      this._detached = true;
      this._ready = false;
      this._transition = (this._transition || 0) + 1;
      clearTimeout(this._closeTimer);
      this._pendingEvent = null;
      this.releaseMotion();
    },
  },
});

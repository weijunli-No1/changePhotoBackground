const { createMotion } = require("../../utils/skyline-motion");
Component({
  options: { multipleSlots: true },
  properties: { visible: Boolean, label: String },
  data: { rendered: false, closing: false, fallback: false, motionOpen: false },
  observers: {
    visible(value) {
      if (!this._ready) return;
      if (value) this.open();
      else {
        this._pendingAction = null;
        this.close();
      }
    },
  },
  lifetimes: {
    attached() {
      this._detached = false;
    },
    ready() {
      this._ready = true;
      if (this.data.visible) this.open();
    },
    detached() {
      this._detached = true;
      clearTimeout(this._closeTimer);
      this._pendingAction = null;
      if (this._motion) this._motion.dispose();
    },
  },
  methods: {
    stop() {},
    open() {
      clearTimeout(this._closeTimer);
      const version = (this._version = (this._version || 0) + 1);
      if (this._motion) this._motion.dispose();
      this._pendingAction = null;
      const motion = (this._motion = createMotion(this, wx));
      this._progress = motion.enabled ? motion.shared(0) : null;
      this.setData(
        {
          rendered: true,
          closing: false,
          fallback: !motion.enabled,
          motionOpen: false,
        },
        () => {
          if (this._detached || version !== this._version) return;
          if (!motion.enabled) {
            this.setData({ motionOpen: true });
            return;
          }
          const progress = this._progress;
          let count = 0;
          const ready = () => {
            if (
              ++count === 2 &&
              !this._detached &&
              !this.data.closing &&
              version === this._version
            )
              progress.value = motion.timing(1, 260);
          };
          motion.bind(
            ".motion-scrim",
            () => {
              "worklet";
              return { opacity: progress.value };
            },
            ready,
          );
          motion.bind(
            ".motion-panel",
            () => {
              "worklet";
              return {
                transform: `translateY(${(1 - progress.value) * 100}%)`,
              };
            },
            ready,
          );
        },
      );
    },
    dismiss() {
      this.close("dismiss");
    },
    confirm() {
      this.close("confirm");
    },
    close(action) {
      if (this.data.closing || !this.data.rendered) return;
      this._pendingAction = action || null;
      this.setData({ closing: true, motionOpen: false });
      if (this._progress) this._progress.value = this._motion.timing(0, 180);
      this._closeTimer = setTimeout(() => {
        if (this._detached) return;
        const event = this._pendingAction;
        this._pendingAction = null;
        this._motion.dispose();
        this._progress = null;
        this.setData({ rendered: false, closing: false });
        if (event) this.triggerEvent(event);
      }, 180);
    },
  },
});

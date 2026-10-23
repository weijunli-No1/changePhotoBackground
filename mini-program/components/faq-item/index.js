const { createMotion } = require("../../utils/skyline-motion");
Component({
  properties: { title: String, answer: String, expanded: Boolean },
  data: { motionReady: false },
  observers: {
    expanded() {
      if (this._ready) this.update();
    },
  },
  lifetimes: {
    ready() {
      this._ready = true;
      this._motion = createMotion(this, wx);
      this.update();
    },
    detached() {
      this._ready = false;
      if (this._motion) this._motion.dispose();
    },
  },
  methods: {
    toggle() {
      this.triggerEvent("toggle");
    },
    update() {
      if (!this._motion.enabled) return;
      this.createSelectorQuery()
        .select(".faq-answer")
        .boundingClientRect()
        .exec((rects) => {
          if (!this._ready || !rects[0]) return;
          const motion = this._motion;
          if (!this._height) {
            const height = (this._height = motion.shared(0));
            const opacity = (this._opacity = motion.shared(0));
            const angle = (this._angle = motion.shared(0));
            motion.bind(
              ".faq-reveal",
              () => {
                "worklet";
                return { height: `${height.value}px`, opacity: opacity.value };
              },
              () => this.setData({ motionReady: true }),
            );
            motion.bind(".faq-arrow", () => {
              "worklet";
              return { transform: `rotate(${angle.value}deg)` };
            });
          }
          this._height.value = motion.timing(
            this.data.expanded ? rects[0].height : 0,
            180,
          );
          this._opacity.value = motion.timing(this.data.expanded ? 1 : 0, 140);
          this._angle.value = motion.timing(this.data.expanded ? 180 : 0, 180);
        });
    },
  },
});

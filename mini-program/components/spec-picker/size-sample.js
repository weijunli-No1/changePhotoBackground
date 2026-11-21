Component({
  properties: {
    themeId: String,
    photoWidth: Number,
    photoHeight: Number,
    // One common scale lets neighbouring presets show their relative sizes.
    reference: { type: Number, value: 579 },
    edge: { type: Number, value: 72 },
    portrait: String,
    guides: Boolean,
  },
  data: { paperWidth: 0, paperHeight: 0 },
  observers: {
    "photoWidth, photoHeight, reference, edge"(width, height, reference, edge) {
      const valid = width > 0 && height > 0 && edge > 0;
      const scale = valid ? edge / Math.max(width, height, reference) : 0;
      this.setData({ paperWidth: width * scale, paperHeight: height * scale });
    },
  },
});

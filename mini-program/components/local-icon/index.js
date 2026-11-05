// Same TDesign glyphs, bundled with the app so controls do not depend on a font CDN.
const glyphs = require("./glyphs");
Component({
  properties: {
    name: String,
    color: String,
    size: { type: null, value: "32rpx" },
  },
  data: { glyph: "", iconStyle: "", isImage: false },
  observers: {
    "name, size, color"() {
      const { name, size, color } = this.data;
      const unit =
        typeof size === "number" || /^\d+(\.\d+)?$/.test(String(size))
          ? `${size}px`
          : size || "32rpx";
      this.setData({
        glyph: glyphs[name] || glyphs["help-circle"] || "",
        isImage: name.includes("/"),
        iconStyle: `font-size:${unit};width:${unit};height:${unit};${color ? `color:${color};` : ""}`,
      });
    },
  },
  methods: {
    onTap(event) {
      this.triggerEvent("click", event.detail);
    },
  },
});

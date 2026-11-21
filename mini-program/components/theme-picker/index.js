const themes = require("../../utils/themes");
Component({
  data: { choices: themes.choices, selected: "sky" },
  lifetimes: {
    attached() {
      this._off = themes.subscribe(theme => this.setData({ selected: theme.id }));
    },
    detached() { if (this._off) this._off(); },
  },
  methods: {
    selectTheme(event) {
      const id = event.currentTarget.dataset.id;
      if (themes.set(id)) this.triggerEvent("change", { id });
    },
  },
});

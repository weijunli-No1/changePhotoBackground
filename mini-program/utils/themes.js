const choices = [
  { id: "sky", name: "晴空蓝", accent: "#4f55ce", darkAccent: "#b2b5ff", swatch: "#8088ff", paper: "#f6f7fe", darkPaper: "#191b28", printer: "/assets/printers/sky-matte.png" },
  { id: "peach", name: "蜜桃橘", accent: "#ab4445", darkAccent: "#ffb2a0", swatch: "#ff9a86", paper: "#fff7f2", darkPaper: "#251b1e", printer: "/assets/printers/peach.png" },
  { id: "mint", name: "薄荷汽水", accent: "#08796c", darkAccent: "#84e1d1", swatch: "#65d9ca", paper: "#f1faf7", darkPaper: "#152322", printer: "/assets/printers/mint.png" },
];
const STORAGE_KEY = "studio-theme";
const listeners = new Set();
let selected;

function current() {
  if (!selected) {
    let id;
    try { id = wx.getStorageSync(STORAGE_KEY); } catch (_) {}
    selected = choices.find(theme => theme.id === id) || choices[0];
  }
  return selected;
}

function applyPage(page, mode) {
  if (!page || typeof page.setData !== "function") return;
  const theme = current();
  const dark = (mode || (typeof wx !== "undefined" && wx.getAppBaseInfo && wx.getAppBaseInfo().theme)) === "dark";
  const accent = dark ? theme.darkAccent : theme.accent;
  if (page.data.studioTheme?.id !== theme.id || page.data.studioAccent !== accent) {
    page.setData({ studioTheme: theme, studioAccent: accent });
  }
}

function applyCurrentPage(mode) {
  if (typeof getCurrentPages !== "function") return;
  const pages = getCurrentPages();
  applyPage(pages[pages.length - 1], mode);
}

function set(id) {
  const theme = choices.find(option => option.id === id);
  if (!theme || theme === current()) return false;
  selected = theme;
  try { wx.setStorageSync(STORAGE_KEY, id); } catch (_) {}
  applyCurrentPage();
  listeners.forEach(listener => listener(theme));
  return true;
}

function subscribe(listener) {
  listeners.add(listener);
  listener(current());
  return () => listeners.delete(listener);
}

module.exports = { choices, current, set, subscribe, applyPage, applyCurrentPage };

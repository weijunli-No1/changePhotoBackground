// One introduction per running app. A backgrounded or clipped attempt can start again.
let introduced = false;
const DWELL_MS = 1450;
const SWAP_MS = 830;

function sheetStyle(x, y, angle, scale, front) {
  return "z-index:" + (front ? 2 : 1) + ";transform:translate(" +
    x.toFixed(1) + "rpx," + y.toFixed(1) + "rpx) rotate(" +
    angle.toFixed(1) + "deg) scale(" + scale.toFixed(3) + ")";
}

function createSampleIntro(page, api) {
  const loaded = new Set();
  let shown = false, foreground = true, ready = false, disposed = false;
  let timer, scrollTimer, measurement = 0, run, dwellStarted = 0, emptyMeasures = 0;

  function eligible() {
    return !introduced && !disposed && shown && foreground && ready && loaded.size === 2;
  }

  function pause(restore = true) {
    measurement++;
    clearTimeout(timer);
    clearTimeout(scrollTimer);
    timer = scrollTimer = undefined;
    dwellStarted = 0;
    if (run) {
      const frontSample = restore ? run.outgoing : page.data.frontSample;
      run = null;
      if (!disposed) page.setData({ sampleStyles: null, frontSample });
    }
  }

  function frame() {
    if (!eligible() || !run) return;
    const now = Date.now();
    // A suspended JS context may resume before WeChat delivers its show callback.
    if (now - run.last > 360) {
      pause();
      measure();
      return;
    }
    run.last = now;
    const t = Math.min(1, (now - run.start) / SWAP_MS);
    if (t >= 1) {
      introduced = true;
      page.setData({ sampleStyles: null, frontSample: run.incoming });
      run = null;
      return;
    }
    const p = t * t * (3 - 2 * t);
    const lift = Math.sin(Math.PI * t);
    const spread = Math.sin(Math.PI * Math.min(1, t / .45));
    const large = page.data.size.width === 413;
    const dx = large ? 91 : 93, dy = large ? 18 : 20;
    const rotation = large ? 14 : 18, zoom = large ? .13 : .08;
    const incoming = sheetStyle(8 + dx * p - 20 * spread, 1 + dy * p - 34 * lift,
      -11 + rotation * p - 4 * spread, .92 + zoom * p + .035 * lift, p >= .45);
    const outgoing = sheetStyle(8 + dx * (1 - p) + 12 * spread, 1 + dy * (1 - p) + 11 * lift,
      -11 + rotation * (1 - p) + 4 * spread, .92 + zoom * (1 - p), p < .45);
    page.setData({
      sampleStyles: { [run.incoming]: incoming, [run.outgoing]: outgoing },
      frontSample: p >= .45 ? run.incoming : run.outgoing,
    });
    timer = setTimeout(frame, 32);
  }

  function measure() {
    if (!eligible()) return;
    const request = ++measurement;
    const query = page.createSelectorQuery ? page.createSelectorQuery() :
      api.createSelectorQuery && api.createSelectorQuery().in(page);
    if (!query) return;
    query.select(".feature-proof").boundingClientRect();
    query.select(".page-scroll").boundingClientRect();
    query.select(".sample-motion-preference").boundingClientRect();
    query.exec(rects => {
      if (request !== measurement || !eligible()) return;
      const [photo, viewport, preference] = rects || [];
      if (!photo || !viewport || !(photo.height > 0) || !(photo.width > 0)) {
        pause();
        if (++emptyMeasures <= 4) timer = setTimeout(measure, 180);
        return;
      }
      emptyMeasures = 0;
      const h = Math.min(photo.bottom, viewport.bottom) - Math.max(photo.top, viewport.top);
      const w = Math.min(photo.right, viewport.right) - Math.max(photo.left, viewport.left);
      if (h < photo.height * .90 || w < photo.width * .90) {
        pause();
        return;
      }
      if (run) return;
      const now = Date.now();
      if (!dwellStarted || now - dwellStarted > DWELL_MS + 360) dwellStarted = now;
      const remaining = DWELL_MS - (now - dwellStarted);
      clearTimeout(timer);
      if (remaining > 0) {
        timer = setTimeout(measure, remaining);
        return;
      }
      const outgoing = page.data.frontSample;
      const incoming = outgoing === "female" ? "male" : "female";
      if (preference && preference.width > 1.5 && preference.height < 1.5) {
        introduced = true;
        page.setData({ sampleReduced: true, frontSample: incoming });
        return;
      }
      run = { outgoing, incoming, start: now, last: now };
      frame();
    });
  }

  function appShow() { foreground = true; measure(); }
  function appHide() { foreground = false; pause(); }
  if (api.onAppShow) api.onAppShow(appShow);
  if (api.onAppHide) api.onAppHide(appHide);
  return {
    ready() { ready = true; measure(); },
    show() { shown = true; measure(); },
    hide() { shown = false; pause(); },
    image(id) {
      if (id !== "male" && id !== "female") return;
      loaded.add(id);
      measure();
    },
    imageFailed(id) {
      if (loaded.delete(id)) pause();
    },
    layout: measure,
    scroll() {
      if (!eligible()) return;
      // Wait for scrolling to settle before counting continuous visible time again.
      pause();
      scrollTimer = setTimeout(measure, 100);
    },
    takeOver() {
      if (disposed) return;
      introduced = true;
      pause(false);
    },
    dispose() {
      disposed = true;
      pause();
      if (api.offAppShow) api.offAppShow(appShow);
      if (api.offAppHide) api.offAppHide(appHide);
    },
  };
}

module.exports = { createSampleIntro };

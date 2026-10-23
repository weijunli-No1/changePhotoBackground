// 原生样式绑定统一处理数字／对象ID与迟到回调，页面退出后不保留绑定。
function createMotion(host, api) {
  const worklet = api.worklet;
  const enabled = Boolean(
    worklet && worklet.shared && worklet.timing && host.applyAnimatedStyle,
  );
  let disposed = false;
  const bindings = [],
    fades = new Map(),
    indicators = new Map();
  function bind(selector, updater, ready) {
    if (!enabled || disposed) return;
    host.applyAnimatedStyle(selector, updater, {}, (result) => {
      const id = typeof result === "number" ? result : result && result.styleId;
      if (id !== undefined && id !== null) {
        if (disposed) {
          if (host.clearAnimatedStyle) host.clearAnimatedStyle(selector, [id]);
          return;
        }
        bindings.push({ selector, id });
      }
      if (!disposed && ready) ready();
    });
  }
  function timing(value, duration = 160) {
    return worklet.timing(value, { duration, easing: worklet.Easing.ease });
  }
  return {
    enabled,
    bind,
    timing,
    shared(value) {
      return worklet.shared(value);
    },
    fade(selector) {
      if (!enabled || disposed) return;
      let opacity = fades.get(selector);
      if (!opacity) {
        opacity = worklet.shared(1);
        fades.set(selector, opacity);
        bind(selector, () => {
          "worklet";
          return { opacity: opacity.value };
        });
      }
      opacity.value = 0.72;
      opacity.value = timing(1, 140);
    },
    indicator(track, selected, marker) {
      if (!enabled || disposed || !host.createSelectorQuery) return;
      host
        .createSelectorQuery()
        .select(track)
        .boundingClientRect()
        .select(selected)
        .boundingClientRect()
        .exec((rects) => {
          if (disposed || !rects[0] || !rects[1]) return;
          const x = rects[1].left - rects[0].left;
          const width = rects[1].width;
          let state = indicators.get(marker);
          if (!state) {
            state = { x: worklet.shared(x), width: worklet.shared(width) };
            indicators.set(marker, state);
            const offset = state.x,
              size = state.width;
            bind(
              marker,
              () => {
                "worklet";
                return {
                  transform: `translateX(${offset.value}px)`,
                  width: `${size.value}px`,
                  opacity: 1,
                };
              },
              () => host.setData({ motionTabsReady: true }),
            );
          } else {
            state.x.value = timing(x);
            state.width.value = timing(width);
          }
        });
    },
    dispose() {
      disposed = true;
      if (host.clearAnimatedStyle)
        for (const { selector, id } of bindings)
          host.clearAnimatedStyle(selector, [id]);
      bindings.length = 0;
      fades.clear();
      indicators.clear();
    },
  };
}
module.exports = { createMotion };

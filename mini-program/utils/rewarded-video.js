function isValidAdUnitId(value) {
  return typeof value === 'string' && /^adunit-[a-zA-Z0-9]+$/.test(value.trim());
}

// 实例只在所属页面使用；关闭、加载失败和页面退出都会结束本次播放。
function createRewardedVideoPlayer(wxApi) {
  let ad = null;
  let adUnitId = '';
  let pending = null;
  let disposed = false;

  function finish(completed, error) {
    if (!pending) return;
    const current = pending;
    pending = null;
    if (error) current.reject(error);
    else current.resolve(completed);
  }

  function onClose(result) {
    finish(Boolean(result && result.isEnded === true));
  }

  function onError(error) {
    // 打开、加载阶段由对应 Promise 处理失败，以允许首次 show 失败后加载重试。
    if (pending && pending.visible) {
      finish(
        false,
        new Error(
          error && error.errCode === 1004 ? '暂无可用广告，请稍后再试' : '广告暂不可用，请稍后再试',
        ),
      );
    }
  }

  function releaseAd() {
    if (!ad) return;
    ad.offClose(onClose);
    ad.offError(onError);
    if (typeof ad.destroy === 'function') ad.destroy();
    ad = null;
    adUnitId = '';
  }

  return {
    play(value) {
      if (disposed) return Promise.resolve(false);
      if (pending) return Promise.reject(new Error('广告正在播放，请稍候'));
      if (!isValidAdUnitId(value)) {
        return Promise.reject(new Error('广告暂未开放，请稍后再试'));
      }
      if (typeof wxApi.createRewardedVideoAd !== 'function') {
        return Promise.reject(new Error('当前环境不支持视频广告'));
      }

      const nextId = value.trim();
      try {
        if (!ad || adUnitId !== nextId) {
          releaseAd();
          ad = wxApi.createRewardedVideoAd({ adUnitId: nextId });
          adUnitId = nextId;
          ad.onClose(onClose);
          ad.onError(onError);
        }
      } catch (error) {
        return Promise.reject(new Error('广告暂不可用，请稍后再试'));
      }

      return new Promise((resolve, reject) => {
        const current = { resolve, reject, visible: false };
        const currentAd = ad;
        pending = current;
        Promise.resolve()
          .then(() => {
            if (pending === current && !disposed) return currentAd.show();
          })
          .catch(() => {
            if (pending !== current || disposed) return;
            return currentAd.load().then(() => {
              if (pending === current && !disposed) return currentAd.show();
            });
          })
          .then(() => {
            if (pending === current) current.visible = true;
          })
          .catch((error) => {
            if (pending !== current) return;
            finish(
              false,
              new Error(
                error && error.errCode === 1004
                  ? '暂无可用广告，请稍后再试'
                  : '广告加载失败，请稍后再试',
              ),
            );
          });
      });
    },

    dispose() {
      disposed = true;
      finish(false);
      releaseAd();
    },
  };
}

module.exports = { createRewardedVideoPlayer, isValidAdUnitId };

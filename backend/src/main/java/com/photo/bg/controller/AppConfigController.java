package com.photo.bg.controller;

import com.photo.bg.common.Result;
import com.photo.bg.config.WxMaConfiguration;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * 小程序运行配置接口。
 */
@RestController
@RequestMapping("/api/app")
@RequiredArgsConstructor
public class AppConfigController {

    private static final String KEY_REWARDED_VIDEO_AD_UNIT_ID = "rewardedVideoAdUnitId";

    private final WxMaConfiguration wxMaConfiguration;

    /**
     * 获取小程序运行时配置。
     *
     * @return 前端可消费的运行时配置
     */
    @GetMapping("/config")
    public Result<Map<String, Object>> getAppConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put(KEY_REWARDED_VIDEO_AD_UNIT_ID, wxMaConfiguration.getRewardedAdUnitId());
        config.put("watermarkEnabled", true);
        return Result.success(config);
    }
}

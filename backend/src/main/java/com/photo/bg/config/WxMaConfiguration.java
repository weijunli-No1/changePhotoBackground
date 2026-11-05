package com.photo.bg.config;

import cn.binarywang.wx.miniapp.api.WxMaService;
import cn.binarywang.wx.miniapp.api.impl.WxMaServiceImpl;
import cn.binarywang.wx.miniapp.config.impl.WxMaDefaultConfigImpl;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 微信小程序配置。
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "wx.miniapp")
public class WxMaConfiguration {

    /** 微信小程序 AppId。 */
    private String appId;
    /** 微信小程序密钥。 */
    private String secret;
    /** 激励视频广告位 ID。 */
    private String rewardedAdUnitId;
    private String homeNativeAdUnitId = "";
    private String libraryNativeAdUnitId = "";

    /**
     * 初始化微信小程序服务实例。
     *
     * @return 微信小程序服务
     */
    @Bean
    public WxMaService wxMaService() {
        WxMaDefaultConfigImpl config = new WxMaDefaultConfigImpl();
        config.setAppid(appId);
        config.setSecret(secret);

        WxMaService service = new WxMaServiceImpl();
        service.setWxMaConfig(config);
        return service;
    }
}

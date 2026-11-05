package com.photo.bg.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "membership")
public class MemberConfiguration {
    private boolean enabled;
    private String offerId = "";
    @lombok.ToString.Exclude
    private String appKey = "";
    private String productId = "";
    private int priceFen;
    private boolean iosEnabled;
    @lombok.ToString.Exclude
    private String pushToken = "";
    @lombok.ToString.Exclude
    private String pushAesKey = "";
    public boolean purchasable() {
        return enabled && !offerId.isEmpty() && !appKey.isEmpty() && !productId.isEmpty()
                && priceFen > 0 && !pushToken.isEmpty() && pushAesKey.length() == 43;
    }
}

package com.photo.bg.service;

import com.photo.bg.config.MemberConfiguration;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MemberConfigurationTest {
    @Test
    void configurationDiagnosticsExcludeSecretsAndKeepCheckoutDisabledByDefault() {
        MemberConfiguration config = new MemberConfiguration();
        config.setOfferId("test-offer");
        config.setAppKey("private-payment-key");
        config.setPushToken("private-push-token");
        config.setPushAesKey("private-aes-key");

        String diagnostic = config.toString();
        assertTrue(diagnostic.contains("test-offer"));
        assertFalse(diagnostic.contains("private-payment-key"));
        assertFalse(diagnostic.contains("private-push-token"));
        assertFalse(diagnostic.contains("private-aes-key"));
        assertFalse(config.purchasable());
    }
}

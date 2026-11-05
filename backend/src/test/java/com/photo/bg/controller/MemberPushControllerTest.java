package com.photo.bg.controller;

import com.photo.bg.config.MemberConfiguration;
import com.photo.bg.config.WxMaConfiguration;
import com.photo.bg.service.MembershipService;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.http.MediaType;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MemberPushControllerTest {
    @Test void getHandshakeAtIndependentRouteReturnsExactEchoAfterSignatureValidation() throws Exception {
        MemberConfiguration config=new MemberConfiguration();config.setPushToken("token");
        MembershipService membership=mock(MembershipService.class);
        MockMvc mvc=MockMvcBuilders.standaloneSetup(new MemberPushController(config,new WxMaConfiguration(),membership)).build();
        String[] parts={"token","123","nonce"};java.util.Arrays.sort(parts);
        String signature=cn.hutool.crypto.digest.DigestUtil.sha1Hex(String.join("",parts));
        mvc.perform(get("/wechat/member/push").param("signature",signature).param("timestamp","123").param("nonce","nonce").param("echostr","echo-123"))
                .andExpect(status().isOk()).andExpect(content().string("echo-123"));
        mvc.perform(get("/wechat/member/push").param("signature","forged").param("timestamp","123").param("nonce","nonce").param("echostr","echo-123"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(membership);
    }

    @Test void acceptsAuthenticatedEncryptedDeliveryAndRejectsTamperedBody() throws Exception {
        MemberConfiguration config=new MemberConfiguration();config.setPushToken("token");config.setPushAesKey("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
        WxMaConfiguration wx=new WxMaConfiguration();wx.setAppId("wxapp");MembershipService membership=mock(MembershipService.class);
        java.util.Map<String,Object> order=new java.util.HashMap<>();order.put("openid","owner");order.put("product_id","sg_lifetime_vip");order.put("status","ACTIVE");
        when(membership.find("M123")).thenReturn(order);
        MemberPushController controller=new MemberPushController(config,wx,membership);
        me.chanjar.weixin.common.util.crypto.WxCryptUtil crypt=new me.chanjar.weixin.common.util.crypto.WxCryptUtil(config.getPushToken(),config.getPushAesKey(),"wxapp");
        String plain="<xml><Event>xpay_goods_deliver_notify</Event><OpenId>owner</OpenId><OutTradeNo>M123</OutTradeNo><GoodsInfo><ProductId>sg_lifetime_vip</ProductId><Quantity>1</Quantity></GoodsInfo></xml>";
        me.chanjar.weixin.common.util.crypto.WxCryptUtil.EncryptContext encrypted=crypt.encryptContext(plain);
        String body="<xml><Encrypt>"+encrypted.getEncrypt()+"</Encrypt></xml>";
        MockMvc mvc=MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(post("/wechat/member/push").param("msg_signature",encrypted.getSignature()).param("timestamp",encrypted.getTimeStamp()).param("nonce",encrypted.getNonce()).contentType(MediaType.APPLICATION_XML).content(body))
                .andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString("<ErrCode>0</ErrCode>")));
        verify(membership).reconcile("M123",false);
        assertThrows(ResponseStatusException.class,()->controller.notify(body.replace(encrypted.getEncrypt(),encrypted.getEncrypt()+"x"),encrypted.getSignature(),encrypted.getTimeStamp(),encrypted.getNonce()));
    }

    @Test void rejectsForgedAndUnsignedNotificationBeforeAnyOrderMutation() {
        MemberConfiguration config=new MemberConfiguration();config.setPushToken("token");config.setPushAesKey("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
        WxMaConfiguration wx=new WxMaConfiguration();wx.setAppId("wxapp");MembershipService membership=mock(MembershipService.class);
        MemberPushController controller=new MemberPushController(config,wx,membership);
        assertThrows(ResponseStatusException.class,()->controller.notify("<xml><Event>xpay_goods_deliver_notify</Event></xml>","forged","123","nonce"));
        assertThrows(ResponseStatusException.class,()->controller.verify("forged","123","nonce","echo"));
        verifyNoInteractions(membership);
    }
}

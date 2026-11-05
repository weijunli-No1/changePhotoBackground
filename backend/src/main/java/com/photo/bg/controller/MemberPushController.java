package com.photo.bg.controller;

import com.photo.bg.config.MemberConfiguration;
import com.photo.bg.config.WxMaConfiguration;
import com.photo.bg.service.MembershipService;
import lombok.RequiredArgsConstructor;
import me.chanjar.weixin.common.util.crypto.WxCryptUtil;
import cn.hutool.crypto.digest.DigestUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/**
 * 公网地址 /shiguang-api/wechat/member/push，由 Nginx 剥离统一前缀后进入本路由。
 * MP 消息推送配置为 XML + 安全模式；拒绝无正文签名保护的明文通知。
 */
@RestController
@RequestMapping("/wechat/member/push")
@RequiredArgsConstructor
public class MemberPushController {
    private final MemberConfiguration config;
    private final WxMaConfiguration wxConfig;
    private final MembershipService membership;
    @GetMapping(produces="text/plain;charset=UTF-8")
    public String verify(@RequestParam String signature, @RequestParam String timestamp, @RequestParam String nonce, @RequestParam String echostr) {
        if (config.getPushToken().isEmpty()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
        String[] parts = {config.getPushToken(),timestamp,nonce}; Arrays.sort(parts);
        String expected = DigestUtil.sha1Hex(String.join("",parts));
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),signature.getBytes(StandardCharsets.UTF_8))) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return echostr;
    }
    @PostMapping(produces="application/xml;charset=UTF-8")
    public String notify(@RequestBody String body, @RequestParam("msg_signature") String signature, @RequestParam String timestamp, @RequestParam String nonce) {
        if (config.getPushToken().isEmpty() || config.getPushAesKey().length()!=43) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
        final Document doc;
        try {
            // SDK 同时验证密文签名、AES、接收 AppID；解析器禁止外部实体。
            String plain = new WxCryptUtil(config.getPushToken(),config.getPushAesKey(),wxConfig.getAppId()).decryptXml(signature,timestamp,nonce,body);
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities",false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
            factory.setXIncludeAware(false); factory.setExpandEntityReferences(false);
            doc = factory.newDocumentBuilder().parse(new ByteArrayInputStream(plain.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new ResponseStatusException(HttpStatus.FORBIDDEN); }
        String event = value(doc,"Event");
        try {
            if ("xpay_goods_deliver_notify".equals(event)) {
                String id=value(doc,"OutTradeNo");
                java.util.Map<String,Object> order=membership.find(id);
                if (!order.get("openid").equals(value(doc,"OpenId")) || !order.get("product_id").equals(value(doc,"ProductId")) || !"1".equals(value(doc,"Quantity")))
                    throw new IllegalArgumentException("订单不匹配");
                membership.reconcile(id,false);
                String state=(String)membership.find(id).get("status");
                if (!"ACTIVE".equals(state) && !"REFUNDED".equals(state)) throw new IllegalStateException("尚未发货");
            } else if ("xpay_refund_notify".equals(event)) {
                String owner=value(doc,"OpenId");
                if (owner.isEmpty()) owner=value(doc,"FromUserName");
                if (owner.isEmpty()) throw new IllegalArgumentException("缺少用户");
                membership.reconcileUser(owner);
            }
            return "<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>";
        } catch (Exception e) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"订单核对待重试"); }
    }
    private String value(Document doc,String name) {
        return doc.getElementsByTagName(name).getLength()==0 ? "" : doc.getElementsByTagName(name).item(0).getTextContent();
    }
}

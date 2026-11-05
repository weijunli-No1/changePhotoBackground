package com.photo.bg.service;

import cn.binarywang.wx.miniapp.api.WxMaService;
import cn.hutool.http.HttpRequest;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.photo.bg.config.MemberConfiguration;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class VirtualPaymentGateway {
    private final WxMaService wx;
    private final MemberConfiguration config;
    public static String hmac(String key, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] bytes = mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) hex.append(String.format("%02x", b & 255));
            return hex.toString();
        } catch (Exception e) { throw new IllegalStateException("签名失败"); }
    }
    public JSONObject query(String openid, String orderId) {
        Map<String,Object> body = new LinkedHashMap<>();
        body.put("openid", openid); body.put("env", 0); body.put("order_id", orderId);
        JSONObject response = post("/xpay/query_order", body, true);
        JSONObject order = response.getJSONObject("order");
        if (order == null) throw new IllegalStateException("订单暂未确认，请稍后查询");
        return order;
    }
    public void delivered(String orderId) {
        Map<String,Object> body = new LinkedHashMap<>();
        body.put("order_id", orderId); body.put("env", 0);
        post("/xpay/notify_provide_goods", body, false);
    }
    private JSONObject post(String path, Map<String,Object> payload, boolean signed) {
        try {
            String body = JSON.toJSONString(payload);
            String url = "https://api.weixin.qq.com" + path + "?access_token=" + wx.getAccessToken();
            if (signed) url += "&pay_sig=" + hmac(config.getAppKey(), path + "&" + body);
            String raw = HttpRequest.post(url).header("Content-Type", "application/json").body(body).timeout(8000).execute().body();
            JSONObject response = JSON.parseObject(raw);
            if (response == null || (response.containsKey("errcode") && response.getIntValue("errcode") != 0))
                throw new IllegalStateException("支付平台暂未确认订单，请稍后查询");
            return response;
        } catch (Exception e) { throw new IllegalStateException("支付平台暂未确认订单，请稍后查询"); }
    }
}

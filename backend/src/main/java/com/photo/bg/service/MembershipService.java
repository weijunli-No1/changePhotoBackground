package com.photo.bg.service;

import cn.binarywang.wx.miniapp.api.WxMaService;
import cn.binarywang.wx.miniapp.bean.WxMaJscode2SessionResult;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.photo.bg.config.MemberConfiguration;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class MembershipService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final MemberConfiguration config;
    private final VirtualPaymentGateway gateway;
    private final WxMaService wx;

    public boolean isMember(Long userId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM t_member_order WHERE user_id=? AND status='ACTIVE'", Integer.class, userId);
        return count != null && count > 0;
    }
    public Map<String,Object> status(Long userId) {
        Map<String,Object> result = new LinkedHashMap<>();
        boolean member = isMember(userId);
        result.put("isLifetimeMember", member);
        result.put("adFree", member);
        result.put("unlimitedSaves", member);
        result.put("purchaseEnabled", config.purchasable());
        result.put("iosEnabled", config.isIosEnabled());
        result.put("priceFen", config.getPriceFen());
        return result;
    }
    public Map<String,Object> createOrder(Long userId, String code) throws Exception {
        if (!config.purchasable()) throw new IllegalStateException("会员暂未开放购买");
        if (code == null || code.length() > 256 || code.isEmpty()) throw new IllegalArgumentException("请重新登录后购买");
        WxMaJscode2SessionResult session = wx.getUserService().getSessionInfo(code);
        String owner = jdbc.queryForObject("SELECT openid FROM t_user WHERE id=?", String.class, userId);
        if (!Objects.equals(owner, session.getOpenid())) throw new IllegalArgumentException("登录账号发生变化，请重新打开会员页");
        return transactions.execute(tx -> {
            // 同一用户串行下单；付款后的重复点击不会重复收费。
            jdbc.queryForObject("SELECT id FROM t_user WHERE id=? FOR UPDATE", Long.class, userId);
            if (isMember(userId)) throw new IllegalStateException("你已开通永久会员");
            String id = "M" + UUID.randomUUID().toString().replace("-", "").substring(0,31);
            String attach = "lifetime:" + id;
            Map<String,Object> sign = new LinkedHashMap<>();
            sign.put("offerId", config.getOfferId()); sign.put("buyQuantity",1); sign.put("env",0);
            sign.put("currencyType","CNY"); sign.put("productId",config.getProductId());
            sign.put("goodsPrice",config.getPriceFen()); sign.put("outTradeNo",id); sign.put("attach",attach);
            String signData = JSON.toJSONString(sign);
            jdbc.update("INSERT INTO t_member_order(out_trade_no,user_id,openid,product_id,price_fen,attach) VALUES (?,?,?,?,?,?)", id,userId,owner,config.getProductId(),config.getPriceFen(),attach);
            Map<String,Object> pay = new LinkedHashMap<>();
            pay.put("mode","short_series_goods"); pay.put("signData",signData);
            pay.put("paySig",VirtualPaymentGateway.hmac(config.getAppKey(),"requestVirtualPayment&"+signData));
            pay.put("signature",VirtualPaymentGateway.hmac(session.getSessionKey(),signData));
            Map<String,Object> result = new LinkedHashMap<>(); result.put("outTradeNo",id); result.put("payData",pay);
            return result;
        });
    }
    public Map<String,Object> queryOwnOrder(Long userId, String id) {
        Map<String,Object> order = find(id);
        if (!Objects.equals(((Number)order.get("user_id")).longValue(), userId)) throw new IllegalArgumentException("订单不存在");
        reconcile(id, true);
        Map<String,Object> result = status(userId);
        result.put("orderStatus",find(id).get("status"));
        return result;
    }
    public Map<String,Object> find(String id) {
        List<Map<String,Object>> rows = jdbc.queryForList("SELECT * FROM t_member_order WHERE out_trade_no=?",id);
        if (rows.isEmpty()) throw new IllegalArgumentException("订单不存在");
        return rows.get(0);
    }
    public void reconcile(String id, boolean notifyDelivery) {
        Map<String,Object> local = find(id);
        JSONObject remote = gateway.query((String)local.get("openid"), id);
        // 严格验证平台返回的数据，绝不信任客户端的金额、会员标记或付款回调。
        if (!id.equals(remote.getString("order_id")) || !Objects.equals(local.get("attach"),remote.getString("biz_meta"))
                || !Objects.equals(((Number)local.get("price_fen")).intValue(),remote.getInteger("order_fee"))
                || !Integer.valueOf(1).equals(remote.getInteger("env_type"))
                || !(Integer.valueOf(0).equals(remote.getInteger("order_type")) || Integer.valueOf(7).equals(remote.getInteger("order_type"))))
            throw new IllegalStateException("平台订单信息不匹配");
        Integer state = remote.getInteger("status");
        String wxId = remote.getString("wx_order_id");
        if (state == null) throw new IllegalStateException("订单状态缺失");
        if ((state == 2 || state == 3 || state == 4 || state == 5 || state == 8) && (wxId == null || wxId.isEmpty()))
            throw new IllegalStateException("平台单号缺失");
        transactions.execute(tx -> {
            Map<String,Object> locked = jdbc.queryForMap("SELECT * FROM t_member_order WHERE out_trade_no=? FOR UPDATE",id);
            String next = null;
            if (state == 5 || state == 8) next = "REFUNDED";
            else if (state == 6) next = "CLOSED";
            else if ((state == 2 || state == 3 || state == 4) && !"REFUNDED".equals(locked.get("status"))) next = "ACTIVE";
            if (next != null) jdbc.update("UPDATE t_member_order SET status=?,wx_order_id=?,checked_at=NOW() WHERE out_trade_no=?",next,wxId,id);
            else jdbc.update("UPDATE t_member_order SET checked_at=NOW() WHERE out_trade_no=?",id);
            return null;
        });
        if (notifyDelivery && state == 2 && "ACTIVE".equals(find(id).get("status"))) gateway.delivered(id);
    }
    /** 收到退款通知时按用户重新核对原支付单，避免把退款单状态当支付状态。 */
    public void reconcileUser(String openid) {
        for (String id : jdbc.queryForList("SELECT out_trade_no FROM t_member_order WHERE openid=? AND status IN ('PENDING','ACTIVE')",String.class,openid)) reconcile(id,true);
    }
}

package com.photo.bg.task;

import com.photo.bg.config.MemberConfiguration;
import com.photo.bg.service.MembershipService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class MemberOrderReconcileTask {
    private final JdbcTemplate jdbc;
    private final MembershipService membership;
    private final MemberConfiguration config;
    @Scheduled(fixedDelay = 300000)
    public void reconcile() {
        jdbc.update("DELETE FROM t_member_session WHERE expires_at<NOW()");
        if (!config.purchasable()) return;
        // checked_at 先更新使长期查不到的取消订单不阻塞后续订单，ACTIVE 轮询兜底退款通知。
        for (String id : jdbc.queryForList("SELECT out_trade_no FROM t_member_order WHERE status IN ('PENDING','ACTIVE') ORDER BY COALESCE(checked_at,'1970-01-01'),created_at LIMIT 50",String.class)) {
            jdbc.update("UPDATE t_member_order SET checked_at=NOW() WHERE out_trade_no=?",id);
            try { membership.reconcile(id,true); }
            catch (Exception e) { log.warn("会员订单核对暂未完成: {}",id); }
        }
    }
}

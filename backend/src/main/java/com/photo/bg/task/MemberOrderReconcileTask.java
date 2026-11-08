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
        // Unresolved orders are quarantined, never assumed unpaid just because time elapsed.
        jdbc.update("UPDATE t_member_order SET status='REVIEW' WHERE status='PENDING' AND created_at<DATE_SUB(NOW(),INTERVAL 1 DAY)");
        for (String id : jdbc.queryForList("SELECT o.out_trade_no FROM t_member_order o LEFT JOIN t_member_order_recovery r ON r.out_trade_no=o.out_trade_no "
                + "WHERE o.status IN ('PENDING','ACTIVE') AND COALESCE(r.suspended,0)=0 AND (r.next_check_at IS NULL OR r.next_check_at<=NOW()) "
                + "ORDER BY COALESCE(r.next_check_at,o.checked_at,o.created_at),o.created_at LIMIT 50",String.class)) {
            jdbc.update("UPDATE t_member_order SET checked_at=NOW() WHERE out_trade_no=?",id);
            try { membership.reconcile(id,true); }
            catch (Exception e) { log.warn("会员订单核对暂未完成: {}",id); }
        }
    }
}

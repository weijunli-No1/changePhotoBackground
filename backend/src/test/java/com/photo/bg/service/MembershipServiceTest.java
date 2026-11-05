package com.photo.bg.service;

import cn.binarywang.wx.miniapp.api.WxMaService;
import com.alibaba.fastjson2.JSONObject;
import com.photo.bg.config.MemberConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class MembershipServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final TransactionTemplate tx = mock(TransactionTemplate.class);
    private final VirtualPaymentGateway gateway = mock(VirtualPaymentGateway.class);
    private final MembershipService service = new MembershipService(jdbc,tx,new MemberConfiguration(),gateway,mock(WxMaService.class));
    private Map<String,Object> row(String state) {
        Map<String,Object> row = new HashMap<>();
        row.put("user_id",1L); row.put("openid","owner"); row.put("price_fen",990); row.put("attach","lifetime:M123"); row.put("status",state);
        when(jdbc.queryForList(anyString(),eq("M123"))).thenReturn(Collections.singletonList(row));
        when(jdbc.queryForMap(anyString(),eq("M123"))).thenReturn(row);
        when(tx.execute(any())).thenAnswer(inv -> ((TransactionCallback<?>)inv.getArgument(0)).doInTransaction(null));
        when(jdbc.update(anyString(),any(),any(),eq("M123"))).thenAnswer(inv -> { row.put("status",inv.getArgument(1)); return 1; });
        return row;
    }
    private JSONObject remote(int state) {
        JSONObject order = new JSONObject();
        order.put("order_id","M123");order.put("biz_meta","lifetime:M123");order.put("order_fee",990);order.put("env_type",1);order.put("order_type",0);order.put("wx_order_id","WX123");order.put("status",state);
        when(gateway.query("owner","M123")).thenReturn(order);
        return order;
    }
    @Test void pendingOrderNeverGrantsMemberAndPaidOrderIsIdempotent() {
        Map<String,Object> row=row("PENDING");remote(1);service.reconcile("M123",false);assertEquals("PENDING",row.get("status"));
        remote(2);service.reconcile("M123",false);assertEquals("ACTIVE",row.get("status"));
        service.reconcile("M123",false);assertEquals("ACTIVE",row.get("status"));verify(gateway,never()).delivered(anyString());
    }
    @Test void refundsRevokeAndLateDeliveryCannotRestoreRefundedMembership() {
        Map<String,Object> row=row("ACTIVE");remote(5);service.reconcile("M123",false);assertEquals("REFUNDED",row.get("status"));
        remote(2);service.reconcile("M123",true);assertEquals("REFUNDED",row.get("status"));verify(gateway,never()).delivered(anyString());
    }
    @Test void fallbackPersistsMemberBeforeAcknowledgingDeliveryAndCanRetry() {
        Map<String,Object> row=row("PENDING");remote(2);doThrow(new IllegalStateException("timeout")).doNothing().when(gateway).delivered("M123");
        assertThrows(IllegalStateException.class,()->service.reconcile("M123",true));assertEquals("ACTIVE",row.get("status"));
        service.reconcile("M123",true);verify(gateway,times(2)).delivered("M123");
    }
    @Test void incorrectAmountEnvironmentMetadataOrderAndMissingIdDoNotGrant() {
        row("PENDING");
        for (String key : Arrays.asList("order_fee","env_type","biz_meta","order_id","order_type","wx_order_id")) {
            JSONObject order=remote(2);order.put(key, key.equals("wx_order_id")?"":-1);
            assertThrows(IllegalStateException.class,()->service.reconcile("M123",false),key);
        }
        verify(tx,never()).execute(any());
    }
    @Test void cannotQueryAnotherUsersOrder() {
        row("PENDING");assertThrows(IllegalArgumentException.class,()->service.queryOwnOrder(2L,"M123"));verifyNoInteractions(gateway);
    }
    @Test void hmacMatchesPublishedRfc4231Vector() {
        assertEquals("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",VirtualPaymentGateway.hmac("Jefe","what do ya want for nothing?"));
        assertNotEquals(VirtualPaymentGateway.hmac("key","requestVirtualPayment&{}"),VirtualPaymentGateway.hmac("key","requestVirtualPayment&{ }"));
    }
    @Test void memberHasUnlimitedSavesEvenWhenDailyQuotaExhausted() {
        when(jdbc.queryForObject(anyString(),eq(Integer.class),eq(1L))).thenReturn(1);
        assertTrue(service.isMember(1L));assertEquals(true,service.status(1L).get("adFree"));assertEquals(true,service.status(1L).get("unlimitedSaves"));
        com.photo.bg.service.impl.UserDailyUsageServiceImpl quota = new com.photo.bg.service.impl.UserDailyUsageServiceImpl(service);
        assertTrue(quota.checkSaveConstraint(1L,java.time.LocalDate.now()));
    }
}

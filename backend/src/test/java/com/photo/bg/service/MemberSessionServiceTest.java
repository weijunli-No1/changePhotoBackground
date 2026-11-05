package com.photo.bg.service;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.util.Collections;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class MemberSessionServiceTest {
    @Test void absentExpiredForgedAndOtherOwnerTokensAreRejected() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);MemberSessionService sessions=new MemberSessionService(jdbc);
        assertThrows(ResponseStatusException.class,()->sessions.requireUser(null));
        when(jdbc.queryForList(anyString(),eq(Long.class),any())).thenReturn(Collections.emptyList());
        assertThrows(ResponseStatusException.class,()->sessions.requireUser("Bearer forged"));
        when(jdbc.queryForList(anyString(),eq(Long.class),any())).thenReturn(Collections.singletonList(1L));
        com.photo.bg.entity.User user=new com.photo.bg.entity.User();user.setId(2L);
        assertThrows(ResponseStatusException.class,()->sessions.requireOwner("Bearer token",user));
    }
    @Test void issuedTokenHasEnoughEntropyAndOnlyItsHashIsPersisted() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);MemberSessionService sessions=new MemberSessionService(jdbc);
        String token=sessions.issue(1L);assertEquals(43,token.length());
        verify(jdbc).update(anyString(),eq(cn.hutool.crypto.digest.DigestUtil.sha256Hex(token)),eq(1L));
    }
}

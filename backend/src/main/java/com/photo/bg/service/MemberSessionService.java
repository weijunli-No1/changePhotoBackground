package com.photo.bg.service;

import cn.hutool.crypto.digest.DigestUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;

/** 只持久化令牌哈希；微信 session_key 仅用于当前下单请求，不落库或下发。 */
@Service
@RequiredArgsConstructor
public class MemberSessionService {
    private final JdbcTemplate jdbc;
    public String issue(Long userId) {
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        jdbc.update("INSERT INTO t_member_session(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 2 HOUR))", DigestUtil.sha256Hex(token), userId);
        return token;
    }
    public Long requireUser(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) throw unauthorized();
        List<Long> ids = jdbc.queryForList("SELECT user_id FROM t_member_session WHERE token_hash=? AND expires_at>NOW()", Long.class, DigestUtil.sha256Hex(authorization.substring(7)));
        if (ids.isEmpty()) throw unauthorized();
        return ids.get(0);
    }
    public void requireOwner(String authorization, com.photo.bg.entity.User user) {
        if (user == null || !requireUser(authorization).equals(user.getId())) throw unauthorized();
    }
    private ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "登录已过期，请重新登录");
    }
}

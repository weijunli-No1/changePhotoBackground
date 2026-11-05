-- 上线前执行；不修改已有用户与每日额度数据。
CREATE TABLE IF NOT EXISTS t_member_session (
 token_hash char(64) NOT NULL PRIMARY KEY,
 user_id bigint NOT NULL,
 expires_at datetime NOT NULL,
 KEY idx_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS t_member_order (
 out_trade_no varchar(32) NOT NULL PRIMARY KEY,
 user_id bigint NOT NULL,
 openid varchar(64) NOT NULL,
 product_id varchar(128) NOT NULL,
 price_fen int NOT NULL,
 attach varchar(256) NOT NULL,
 wx_order_id varchar(128) DEFAULT NULL,
 status varchar(16) NOT NULL DEFAULT 'PENDING',
 created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 checked_at datetime DEFAULT NULL,
 UNIQUE KEY uk_member_wx_order (wx_order_id),
 KEY idx_member_user_status (user_id,status),
 KEY idx_member_reconcile (status,checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

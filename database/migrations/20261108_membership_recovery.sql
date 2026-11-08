-- Additive and repeatable; preserves all existing orders and entitlements.
CREATE TABLE IF NOT EXISTS t_member_order_recovery (
 out_trade_no varchar(32) NOT NULL PRIMARY KEY,
 attempts int NOT NULL DEFAULT 0,
 next_check_at datetime NOT NULL,
 last_error varchar(64) NOT NULL DEFAULT '',
 suspended tinyint NOT NULL DEFAULT 0,
 KEY idx_recovery_due(next_check_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS t_member_refund_inquiry (
 payment_order_id varchar(128) NOT NULL PRIMARY KEY,
 result_code int NOT NULL,
 evidence varchar(1024) NOT NULL,
 created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE DATABASE IF NOT EXISTS `photo_bg` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `photo_bg`;

-- 用户表
CREATE TABLE IF NOT EXISTS `t_user` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键，自增',
  `openid` varchar(64) NOT NULL COMMENT '微信 openid，唯一索引',
  `nickname` varchar(128) DEFAULT NULL COMMENT '用户昵称',
  `avatar` varchar(256) DEFAULT NULL COMMENT '用户头像 URL',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 照片历史表
CREATE TABLE IF NOT EXISTS `t_photo_history` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键，自增',
  `user_id` bigint(20) NOT NULL COMMENT '关联用户表 id',
  `photo_url` varchar(512) NOT NULL COMMENT '处理后证件照存储文件 URL',
  `original_photo_url` varchar(512) DEFAULT NULL COMMENT '原图 URL',
  `bg_color` varchar(16) DEFAULT NULL COMMENT '背景色值（如 #638cce）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '处理时间',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '逻辑删除，0 - 未删 1 - 已删',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='照片历史表';
CREATE TABLE IF NOT EXISTS `t_user_daily_usage` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `record_date` date NOT NULL,
  `save_count` int(11) NOT NULL DEFAULT '0',
  `ad_view_count` int(11) NOT NULL DEFAULT '0',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date` (`user_id`, `record_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

package com.photo.bg.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@TableName("t_user_daily_usage")
public class UserDailyUsage {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private LocalDate recordDate;

    @com.baomidou.mybatisplus.annotation.TableField(exist = false)
    private Boolean isLifetimeMember;

    private Integer saveCount;

    private Integer adViewCount;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;
}

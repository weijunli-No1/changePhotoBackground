package com.photo.bg.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.photo.bg.entity.UserDailyUsage;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDate;

@Mapper
public interface UserDailyUsageMapper extends BaseMapper<UserDailyUsage> {

    @Insert("INSERT INTO t_user_daily_usage(user_id, record_date, save_count, ad_view_count) "
            + "VALUES (#{userId}, #{recordDate}, 0, 0) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)")
    int insertUsageIfAbsent(@Param("userId") Long userId, @Param("recordDate") LocalDate recordDate);

    @Update("UPDATE t_user_daily_usage SET save_count = save_count + 1 "
            + "WHERE user_id = #{userId} AND record_date = #{recordDate} "
            + "AND (#{member} = TRUE OR ad_view_count >= #{dailyLimit} OR save_count < #{dailyLimit} + ad_view_count)")
    int tryConsumeSave(@Param("userId") Long userId, @Param("recordDate") LocalDate recordDate,
                       @Param("member") boolean member, @Param("dailyLimit") int dailyLimit);

    @Update("UPDATE t_user_daily_usage SET save_count = GREATEST(0, save_count - 1) "
            + "WHERE user_id = #{userId} AND record_date = #{recordDate}")
    int releaseSave(@Param("userId") Long userId, @Param("recordDate") LocalDate recordDate);

    @Update("UPDATE t_user_daily_usage SET save_count = save_count + 1 WHERE user_id = #{userId} AND record_date = #{recordDate}")
    int incrementSaveCount(@Param("userId") Long userId, @Param("recordDate") LocalDate recordDate);

    @Update("UPDATE t_user_daily_usage SET ad_view_count = ad_view_count + 1 WHERE user_id = #{userId} AND record_date = #{recordDate}")
    int incrementAdViewCount(@Param("userId") Long userId, @Param("recordDate") LocalDate recordDate);
}

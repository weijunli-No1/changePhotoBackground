package com.photo.bg.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.photo.bg.entity.UserDailyUsage;

import java.time.LocalDate;

public interface UserDailyUsageService extends IService<UserDailyUsage> {

    /**
     * 查询指定用户在指定日期的使用记录，不存在则创建。
     *
     * @param userId 用户 ID
     * @param date 日期
     * @return 使用记录
     */
    UserDailyUsage getOrCreateUsage(Long userId, LocalDate date);

    /**
     * 查询用户是否仍可继续保存照片。仅用于展示，不会预留次数；实际保存使用 tryConsumeSave。
     *
     * @param userId 用户 ID
     * @param date 日期
     * @return true-可保存，false-不可保存
     */
    boolean checkSaveConstraint(Long userId, LocalDate date);

    /**
     * 原子校验并预留一次保存；会员及每日已看满五次广告的用户保持无限保存权益。
     * 成功后不得再次调用 recordSave；生成或持久化失败时必须仅补偿一次 releaseSave。
     */
    boolean tryConsumeSave(Long userId, LocalDate date);

    /** 释放本次未完成保存的预留次数，调用方必须传入预留时的同一日期。 */
    void releaseSave(Long userId, LocalDate date);

    /**
     * 记录一次保存行为。
     *
     * @param userId 用户 ID
     * @param date 日期
     */
    void recordSave(Long userId, LocalDate date);

    /**
     * 记录一次广告观看行为。
     *
     * @param userId 用户 ID
     * @param date 日期
     */
    void recordAdView(Long userId, LocalDate date);
}

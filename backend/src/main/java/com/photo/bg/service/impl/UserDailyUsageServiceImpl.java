package com.photo.bg.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.photo.bg.entity.UserDailyUsage;
import com.photo.bg.mapper.UserDailyUsageMapper;
import com.photo.bg.service.UserDailyUsageService;
import org.springframework.stereotype.Service;

import java.time.LocalDate;

/**
 * 用户每日配额服务实现。
 */
@Service
@lombok.RequiredArgsConstructor
public class UserDailyUsageServiceImpl extends ServiceImpl<UserDailyUsageMapper, UserDailyUsage> implements UserDailyUsageService {

    private static final int MAX_DAILY_SAVE_COUNT = 5;
    private final com.photo.bg.service.MembershipService membership;

    @Override
    public UserDailyUsage getOrCreateUsage(Long userId, LocalDate date) {
        baseMapper.insertUsageIfAbsent(userId, date);
        QueryWrapper<UserDailyUsage> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("user_id", userId).eq("record_date", date);
        return getOne(queryWrapper);
    }

    @Override
    public boolean tryConsumeSave(Long userId, LocalDate date) {
        baseMapper.insertUsageIfAbsent(userId, date);
        return baseMapper.tryConsumeSave(userId, date, membership.isMember(userId), MAX_DAILY_SAVE_COUNT) == 1;
    }

    @Override
    public void releaseSave(Long userId, LocalDate date) {
        baseMapper.releaseSave(userId, date);
    }

    @Override
    public boolean checkSaveConstraint(Long userId, LocalDate date) {
        if (membership.isMember(userId)) return true;
        UserDailyUsage usage = getOrCreateUsage(userId, date);
        if (usage.getAdViewCount() >= MAX_DAILY_SAVE_COUNT) {
            return true;
        }
        return usage.getSaveCount() < MAX_DAILY_SAVE_COUNT + usage.getAdViewCount();
    }

    @Override
    public void recordSave(Long userId, LocalDate date) {
        baseMapper.insertUsageIfAbsent(userId, date);
        baseMapper.incrementSaveCount(userId, date);
    }

    @Override
    public void recordAdView(Long userId, LocalDate date) {
        baseMapper.insertUsageIfAbsent(userId, date);
        baseMapper.incrementAdViewCount(userId, date);
    }
}

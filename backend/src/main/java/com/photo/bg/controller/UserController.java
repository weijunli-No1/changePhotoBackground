package com.photo.bg.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.photo.bg.common.Result;
import com.photo.bg.entity.User;
import com.photo.bg.entity.UserDailyUsage;
import com.photo.bg.service.UserDailyUsageService;
import com.photo.bg.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

/**
 * 用户登录与配额相关接口。
 */
@RestController
@RequestMapping("/api/user")
@RequiredArgsConstructor
public class UserController {

    private static final Integer UNAUTHORIZED_CODE = 401;

    private final UserService userService;
    private final com.photo.bg.service.MemberSessionService sessions;
    private final com.photo.bg.service.MembershipService membership;
    private final UserDailyUsageService userDailyUsageService;

    /**
     * 微信登录。
     *
     * @param code 微信登录临时凭证
     * @return 用户信息
     */
    @PostMapping("/login")
    public Result<User> login(@RequestParam String code) {
        User user = userService.loginOrRegister(code);
        return Result.success(user);
    }

    /**
     * 记录用户观看广告行为。
     *
     * @param openid 用户 openid
     * @return 操作结果
     */
    @PostMapping("/recordAd")
    public Result<Void> recordAd(@RequestParam String openid, @RequestHeader(value="Authorization",required=false) String auth) {
        User user = userService.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, openid));
        if (user == null) {
            return Result.error(UNAUTHORIZED_CODE, "用户未登录");
        }
        sessions.requireOwner(auth, user);
        if (membership.isMember(user.getId())) return Result.success(null);
        userDailyUsageService.recordAdView(user.getId(), LocalDate.now());
        return Result.success(null);
    }

    /**
     * 查询用户当日配额使用情况。
     *
     * @param openid 用户 openid
     * @return 当日配额信息
     */
    @GetMapping("/usage")
    public Result<UserDailyUsage> getUsage(@RequestParam String openid, @RequestHeader(value="Authorization",required=false) String auth) {
        User user = userService.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, openid));
        if (user == null) {
            return Result.error(UNAUTHORIZED_CODE, "用户未登录");
        }
        sessions.requireOwner(auth, user);
        UserDailyUsage usage = userDailyUsageService.getOrCreateUsage(user.getId(), LocalDate.now());
        usage.setIsLifetimeMember(membership.isMember(user.getId()));
        return Result.success(usage);
    }
}

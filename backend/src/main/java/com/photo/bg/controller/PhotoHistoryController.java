package com.photo.bg.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.photo.bg.common.Result;
import com.photo.bg.dto.HistorySaveParam;
import com.photo.bg.entity.PhotoHistory;
import com.photo.bg.entity.User;
import com.photo.bg.service.MinioStorageService;
import com.photo.bg.service.PhotoHistoryService;
import com.photo.bg.service.UserDailyUsageService;
import com.photo.bg.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 证件照历史记录管理接口。
 */
@RestController
@RequestMapping("/api/history")
@RequiredArgsConstructor
public class PhotoHistoryController {

    private static final Integer UNAUTHORIZED_CODE = 401;
    private static final Integer SAVE_LIMIT_REACHED_CODE = 4031;

    private final PhotoHistoryService photoHistoryService;
    private final MinioStorageService minioStorageService;
    private final UserService userService;
    private final com.photo.bg.service.MemberSessionService sessions;
    private final UserDailyUsageService userDailyUsageService;

    /**
     * 保存证件照历史记录。
     *
     * @param param 保存参数
     * @return 保存后的历史记录
     */
    @PostMapping("/save")
    public Result<PhotoHistory> saveHistory(@RequestBody HistorySaveParam param, @RequestHeader(value="Authorization",required=false) String auth) {
        User user = userService.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, param.getOpenid()));
        if (user == null) {
            return Result.error(UNAUTHORIZED_CODE, "用户未登录");
        }

        sessions.requireOwner(auth, user);
        LocalDate today = LocalDate.now();
        boolean canSave = userDailyUsageService.checkSaveConstraint(user.getId(), today);
        if (!canSave) {
            return Result.error(SAVE_LIMIT_REACHED_CODE, "今日免费保存次数已达上限，请观看广告后继续保存");
        }

        String photoUrl = minioStorageService.uploadBase64(param.getBase64Image(), ".png");

        PhotoHistory history = new PhotoHistory();
        history.setUserId(user.getId());
        history.setPhotoUrl(photoUrl);
        history.setBgColor(param.getBgColor());
        history.setOriginalPhotoUrl(param.getOriginalPhotoUrl());
        history.setCreateTime(LocalDateTime.now());
        history.setIsDeleted(0);
        
        photoHistoryService.save(history);
        
        userDailyUsageService.recordSave(user.getId(), today);

        return Result.success(history);
    }

    /**
     * 查询用户历史证件照。
     *
     * @param openid 用户 openid
     * @return 历史记录列表
     */
    @GetMapping("/list")
    public Result<List<PhotoHistory>> listHistory(@RequestParam String openid) {
        User user = userService.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, openid));
        if (user == null) {
            return Result.error(UNAUTHORIZED_CODE, "用户未登录");
        }

        List<PhotoHistory> list = photoHistoryService.list(
                new LambdaQueryWrapper<PhotoHistory>()
                        .eq(PhotoHistory::getUserId, user.getId())
                        .orderByDesc(PhotoHistory::getCreateTime)
        );

        return Result.success(list);
    }

    /**
     * 删除指定历史记录。
     *
     * @param id 历史记录主键
     * @return 删除结果
     */
    @DeleteMapping("/{id}")
    public Result<Boolean> deleteHistory(@PathVariable Long id) {
        boolean removed = photoHistoryService.removeById(id);
        return Result.success(removed);
    }
}

package com.photo.bg.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.photo.bg.common.Result;
import com.photo.bg.dto.HistorySaveParam;
import com.photo.bg.dto.PhotoHistoryView;
import com.photo.bg.entity.PhotoHistory;
import com.photo.bg.entity.User;
import com.photo.bg.service.MinioStorageService;
import com.photo.bg.service.PhotoHistoryService;
import com.photo.bg.service.UserDailyUsageService;
import com.photo.bg.service.UserService;
import com.photo.bg.service.PhotoPreviewService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Collections;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

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
    private final PhotoPreviewService previews;

    /**
     * 保存证件照历史记录。
     *
     * @param param 保存参数
     * @return 保存后的历史记录
     */
    @PostMapping("/save")
    public Result<PhotoHistoryView> saveHistory(@RequestBody HistorySaveParam param, @RequestHeader(value="Authorization",required=false) String auth) {
        User user = userService.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, param.getOpenid()));
        if (user == null) {
            return Result.error(UNAUTHORIZED_CODE, "用户未登录");
        }

        sessions.requireOwner(auth, user);
        LocalDate today = LocalDate.now();
        if (!userDailyUsageService.tryConsumeSave(user.getId(), today)) {
            return Result.error(SAVE_LIMIT_REACHED_CODE, "今日免费保存次数已达上限，请观看广告后继续保存");
        }

        String photoUrl = null;
        boolean saved = false;
        try {
            photoUrl = minioStorageService.uploadBase64(param.getBase64Image(), ".png");
            String previewUrl = previews.preview(photoUrl);
            PhotoHistory history = new PhotoHistory();
            history.setUserId(user.getId());
            history.setPhotoUrl(photoUrl);
            history.setBgColor(param.getBgColor());
            history.setCreateTime(LocalDateTime.now());
            history.setIsDeleted(0);
            if (!photoHistoryService.save(history)) throw new IllegalStateException("作品未能保存，请重试");
            saved = true;
            return Result.success(view(history, previewUrl));
        } finally {
            if (!saved) {
                userDailyUsageService.releaseSave(user.getId(), today);
                if (photoUrl != null) minioStorageService.deleteFile(photoUrl);
            }
        }
    }

    /**
     * 查询用户历史证件照。
     *
     * @param openid 用户 openid
     * @return 历史记录列表
     */
    @GetMapping("/list")
    public Result<List<PhotoHistoryView>> listHistory(@RequestParam String openid,
            @RequestHeader(value="Authorization",required=false) String auth) {
        User user = userService.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, openid));
        if (user == null) {
            return Result.error(UNAUTHORIZED_CODE, "用户未登录");
        }
        sessions.requireOwner(auth, user);

        List<PhotoHistory> list = photoHistoryService.list(
                new LambdaQueryWrapper<PhotoHistory>()
                        .eq(PhotoHistory::getUserId, user.getId())
                        .orderByDesc(PhotoHistory::getCreateTime)
        );

        return Result.success(list.stream().map(history -> {
            try { return view(history, previews.preview(history.getPhotoUrl())); }
            catch (RuntimeException error) {
                PhotoHistoryView unavailable = view(history, null);
                unavailable.setPreviewUnavailable(true);
                return unavailable;
            }
        }).collect(Collectors.toList()));
    }

    private PhotoHistoryView view(PhotoHistory history, String previewUrl) {
        PhotoHistoryView view = new PhotoHistoryView();
        view.setId(history.getId());
        view.setBgColor(history.getBgColor());
        view.setCreateTime(history.getCreateTime());
        view.setPreviewUrl(previewUrl);
        view.setPhotoUrl(previewUrl);
        return view;
    }

    /** Each explicit clean download consumes a server-authorized save. */
    @PostMapping("/{id}/download")
    public Result<Map<String, String>> download(@PathVariable Long id,
            @RequestHeader(value="Authorization",required=false) String auth) {
        Long userId = sessions.requireUser(auth);
        PhotoHistory history = requireHistory(id, userId);
        LocalDate today = LocalDate.now();
        if (!userDailyUsageService.tryConsumeSave(userId, today))
            return Result.error(SAVE_LIMIT_REACHED_CODE, "今日免费保存次数已用完，请观看视频增加次数或开通会员");
        boolean delivered = false;
        try {
            byte[] image = minioStorageService.readFile(history.getPhotoUrl());
            String base64 = java.util.Base64.getEncoder().encodeToString(image);
            delivered = true;
            return Result.success(Collections.singletonMap("image_base64", base64));
        } finally {
            if (!delivered) userDailyUsageService.releaseSave(userId, today);
        }
    }

    private PhotoHistory requireHistory(Long id, Long userId) {
        PhotoHistory history = photoHistoryService.getById(id);
        if (history == null || !userId.equals(history.getUserId()))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "作品不存在或已删除");
        return history;
    }

    /**
     * 删除指定历史记录。
     *
     * @param id 历史记录主键
     * @return 删除结果
     */
    @DeleteMapping("/{id}")
    public Result<Boolean> deleteHistory(@PathVariable Long id,
            @RequestHeader(value="Authorization",required=false) String auth) {
        Long userId = sessions.requireUser(auth);
        requireHistory(id, userId);
        boolean removed = photoHistoryService.removeById(id);
        return Result.success(removed);
    }
}

package com.photo.bg.controller;

import cn.binarywang.wx.miniapp.api.WxMaService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.photo.bg.common.Result;
import com.photo.bg.entity.User;
import com.photo.bg.service.PythonApiService;
import com.photo.bg.service.UserDailyUsageService;
import com.photo.bg.service.UserService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.Map;

/**
 * 证件照图片处理相关接口。
 */
@RestController
@RequestMapping("/api/photo")
@RequiredArgsConstructor
@Slf4j
public class PhotoController {

    private static final Integer BAD_REQUEST_CODE = 400;
    private static final Integer SAVE_LIMIT_REACHED_CODE = 4031;
    private static final Integer WX_RISK_CONTENT_CODE = 87014;
    private static final float MAX_IMAGE_EDGE_LENGTH = 800f;

    private final PythonApiService pythonApiService;
    private final UserService userService;
    private final com.photo.bg.service.MemberSessionService sessions;
    private final UserDailyUsageService userDailyUsageService;
    private final WxMaService wxMaService;

    @Value("${nsfw.enabled:false}")
    private boolean nsfwEnabled;

    @Value("${nsfw.api-url:http://127.0.0.1:3006/checkImg}")
    private String nsfwApiUrl;

    /**
     * 上传并生成人像抠图（透明底）证件照。
     *
     * @param file 上传文件
     * @param height 目标高度（可选）
     * @param width 目标宽度（可选）
     * @return 证件照结果
     */
    @PostMapping("/generate-idphoto")
    public Result<Map<String, Object>> generateIdPhoto(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "height", required = false) Integer height,
            @RequestParam(value = "width", required = false) Integer width) {
        
        // 敏感性校验（微信API）
        java.io.File tempFile = null;
        try {
            tempFile = java.io.File.createTempFile("check_", ".jpg");
            java.awt.image.BufferedImage img = cn.hutool.core.img.ImgUtil.read(file.getInputStream());
            if (img != null) {
                int w = img.getWidth();
                int h = img.getHeight();
                // 压缩图片以满足微信检测大小限制（1MB内）
                if (w > MAX_IMAGE_EDGE_LENGTH || h > MAX_IMAGE_EDGE_LENGTH) {
                    float ratio = MAX_IMAGE_EDGE_LENGTH / Math.max(w, h);
                    cn.hutool.core.img.ImgUtil.scale(img, tempFile, ratio);
                } else {
                    cn.hutool.core.img.ImgUtil.write(img, tempFile);
                }

                // ------ 自定义鉴黄服务双重校验 ------
                if (nsfwEnabled) {
                    try {
                        java.util.Map<String, Object> paramMap = new java.util.HashMap<>();
                        paramMap.put("file", tempFile);
                        String responseStr = cn.hutool.http.HttpUtil.post(nsfwApiUrl, paramMap);
                        cn.hutool.json.JSONObject resObj = cn.hutool.json.JSONUtil.parseObj(responseStr);
                        if (resObj.getInt("code") == 0) {
                            cn.hutool.json.JSONObject dataObj = resObj.getJSONObject("data");
                            if (dataObj != null && !dataObj.getBool("isSafe", true)) {
                                return Result.error(BAD_REQUEST_CODE, "图片存在不合规风险，请更换后重试");
                            }
                        }
                    } catch (Exception ex) {
                        log.error("自定义NSFW校验服务调用异常", ex);
                    }
                }

                boolean isSafe = wxMaService.getSecCheckService().checkImage(tempFile);
                if (!isSafe) {
                    return Result.error(BAD_REQUEST_CODE, "图片包含敏感内容，请更换后重试");
                }
            }
        } catch (me.chanjar.weixin.common.error.WxErrorException e) {
            log.error("微信敏感检查异常", e);
            if (e.getError().getErrorCode() == WX_RISK_CONTENT_CODE) {
                return Result.error(BAD_REQUEST_CODE, "图片包含违规内容(涉黄/涉暴/涉政)，请更换后重试");
            }
        } catch (Exception e) {
            log.error("图片敏感度校验过程发生异常", e);
        } finally {
            if (tempFile != null && tempFile.exists()) {
                boolean deleted = tempFile.delete();
                if (!deleted) {
                    log.warn("临时文件删除失败: {}", tempFile.getAbsolutePath());
                }
            }
        }

        Map<String, Object> result = pythonApiService.generateIdPhoto(file, height, width);
        return Result.success(result);
    }

    @PostMapping("/add-background")
    public Result<Map<String, Object>> addBackground(
            @RequestParam("base64Image") String base64Image,
            @RequestParam("color") String color) {
        Map<String, Object> result = pythonApiService.addBackground(base64Image, color);
        return Result.success(result);
    }

    /**
     * 生成证件照排版图。
     *
     * @param openid 用户 openid（可选）
     * @param base64Image Base64 图片数据
     * @param height 目标高度（可选）
     * @param width 目标宽度（可选）
     * @return 排版图结果
     */
    @PostMapping("/generate-layout")
    public Result<Map<String, Object>> generateLayoutPhotos(
            @RequestParam("openid") String openid,
            @RequestHeader(value="Authorization",required=false) String auth,
            @RequestParam("base64Image") String base64Image,
            @RequestParam(value = "height", required = false) Integer height,
            @RequestParam(value = "width", required = false) Integer width) {
        
        User user = userService.getOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, openid));
        sessions.requireOwner(auth, user);
        LocalDate today = LocalDate.now();
        if (!userDailyUsageService.checkSaveConstraint(user.getId(), today)) {
            return Result.error(SAVE_LIMIT_REACHED_CODE, "今日免费保存次数已达上限");
        }

        Map<String, Object> result = pythonApiService.generateLayoutPhotos(base64Image, height, width);
        if (result != null && !Boolean.FALSE.equals(result.get("status"))) userDailyUsageService.recordSave(user.getId(), today);
        return Result.success(result);
    }
}

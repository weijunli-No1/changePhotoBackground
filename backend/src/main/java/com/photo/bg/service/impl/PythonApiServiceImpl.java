package com.photo.bg.service.impl;

import cn.hutool.core.io.IoUtil;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.TypeReference;
import com.photo.bg.service.PythonApiService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.util.Map;

/**
 * Python 图像处理服务实现。
 */
@Slf4j
@Service
public class PythonApiServiceImpl implements PythonApiService {

    private static final TypeReference<Map<String, Object>> MAP_TYPE_REFERENCE = new TypeReference<Map<String, Object>>() {
    };

    @Value("${python-api.base-url}")
    private String baseUrl;

    @Override
    public Map<String, Object> watermark(MultipartFile file, String text, int size, double opacity,
                                         int angle, String color, int space, int dpi) {
        // Python /watermark 的样式参数是 query，图片、文字和DPI为 multipart。
        String url = baseUrl.replaceAll("/+$", "") + "/watermark?size=" + size
                + "&opacity=" + opacity + "&angle=" + angle + "&color="
                + color.replace("#", "%23")
                + "&space=" + space;
        try (HttpResponse response = HttpRequest.post(url).timeout(60000)
                .form("input_image", file.getBytes(), "watermark-input.jpg")
                .form("text", text).form("dpi", dpi).execute()) {
            if (!response.isOk()) throw new IllegalStateException("水印服务暂不可用，请重试");
            Map<String, Object> result = JSON.parseObject(response.body(), MAP_TYPE_REFERENCE);
            Object status = result == null ? null : result.get("status");
            if (result == null || Boolean.FALSE.equals(status) || Integer.valueOf(0).equals(status)
                    || !(result.get("image_base64") instanceof String)
                    || ((String) result.get("image_base64")).isEmpty())
                throw new IllegalStateException("水印生成失败，请重试");
            return result;
        } catch (IllegalStateException error) {
            throw error;
        } catch (Exception error) {
            log.warn("Python水印服务调用失败: {}", error.getClass().getSimpleName());
            throw new IllegalStateException("水印处理失败，请稍后重试");
        }
    }

    /**
     * 调用 Python 服务生成人像抠图结果。
     */
    @Override
    public Map<String, Object> generateIdPhoto(MultipartFile file, Integer height, Integer width) {
        String url = baseUrl + "/idphoto";
        try (InputStream inputStream = file.getInputStream()) {
            byte[] bytes = IoUtil.readBytes(inputStream);
            
            HttpRequest request = HttpRequest.post(url)
                    .form("input_image", bytes, file.getOriginalFilename())
                    .form("hd", "true");
                    
            if (height != null) {
                request.form("height", height);
            }
            if (width != null) {
                request.form("width", width);
            }
            
            HttpResponse response = request.execute();

            if (response.isOk()) {
                return JSON.parseObject(response.body(), MAP_TYPE_REFERENCE);
            } else {
                log.error("调用Python接口 idphoto 失败: {}", response.body());
                throw new RuntimeException("处理图像失败");
            }
        } catch (Exception e) {
            log.error("生成证件照异常", e);
            throw new RuntimeException("生成证件照异常", e);
        }
    }

    /**
     * 调用 Python 服务进行背景换色。
     */
    @Override
    public Map<String, Object> addBackground(String base64Image, String color) {
        String url = baseUrl + "/add_background";
        try {
            HttpResponse response = HttpRequest.post(url)
                    .form("input_image_base64", base64Image)
                    .form("color", color.replace("#", ""))
                    .execute();

            if (response.isOk()) {
                return JSON.parseObject(response.body(), MAP_TYPE_REFERENCE);
            } else {
                log.error("调用Python接口 add_background 失败: {}", response.body());
                throw new RuntimeException("处理图像失败");
            }
        } catch (Exception e) {
            log.error("添加背景色异常", e);
            throw new RuntimeException("添加背景色异常", e);
        }
    }

    /**
     * 调用 Python 服务生成排版照。
     */
    @Override
    public Map<String, Object> generateLayoutPhotos(String base64Image, Integer height, Integer width) {
        String url = baseUrl + "/generate_layout_photos";
        try {
            HttpRequest request = HttpRequest.post(url)
                    .form("input_image_base64", base64Image);
            
            if (height != null) {
                request.form("height", height);
            }
            if (width != null) {
                request.form("width", width);
            }
            
            HttpResponse response = request.execute();

            if (response.isOk()) {
                return JSON.parseObject(response.body(), MAP_TYPE_REFERENCE);
            } else {
                log.error("调用Python接口 generate_layout_photos 失败: {}", response.body());
                throw new RuntimeException("处理排版图像失败");
            }
        } catch (Exception e) {
            log.error("生成排版照异常", e);
            throw new RuntimeException("生成排版照异常", e);
        }
    }
}

package com.photo.bg.controller;

import com.photo.bg.common.Result;
import com.photo.bg.service.PythonApiService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.util.Iterator;
import java.util.Map;
import java.io.InputStream;

/** 独立水印接口，不改变既有证件照处理与保存配额链路。 */
@RestController
@RequestMapping("/api/photo")
@RequiredArgsConstructor
public class WatermarkController {
    private final PythonApiService pythonApiService;

    @PostMapping("/watermark")
    public Result<Map<String, Object>> watermark(
            @RequestParam("file") MultipartFile file,
            @RequestParam("text") String text,
            @RequestParam(value = "size", defaultValue = "48") int size,
            @RequestParam(value = "opacity", defaultValue = "0.25") double opacity,
            @RequestParam(value = "angle", defaultValue = "30") int angle,
            @RequestParam(value = "color", defaultValue = "#000000") String color,
            @RequestParam(value = "space", defaultValue = "25") int space,
            @RequestParam(value = "dpi", defaultValue = "300") int dpi) {
        if (text == null || text.trim().isEmpty() || text.trim().length() > 60
                || text.chars().anyMatch(ch -> ch < 32 || ch == 127))
            return Result.error(400, "请输入1至60个字的单行水印文字");
        if (size < 8 || size > 200 || !Double.isFinite(opacity) || opacity < 0.05 || opacity > 1
                || angle < -90 || angle > 90 || space < 5 || space > 200 || dpi < 72 || dpi > 600
                || color == null || !color.matches("#[a-fA-F0-9]{6}"))
            return Result.error(400, "水印样式参数超出支持范围");
        if (file == null || file.isEmpty() || file.getSize() > 10L * 1024 * 1024)
            return Result.error(400, "请选择10 MB以内的图片");
        // 先读取头部尺寸，避免仅依据后缀接收无效文件或解码超大图像。
        try (InputStream source = file.getInputStream(); ImageInputStream input = ImageIO.createImageInputStream(source)) {
            if (input == null) return Result.error(400, "无法读取图片，请选择JPEG或PNG图片");
            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) return Result.error(400, "请选择有效的JPEG或PNG图片");
            ImageReader reader = readers.next();
            try {
                reader.setInput(input);
                String format = reader.getFormatName();
                if (!("JPEG".equalsIgnoreCase(format) || "JPG".equalsIgnoreCase(format) || "PNG".equalsIgnoreCase(format)))
                    return Result.error(400, "水印仅支持JPEG或PNG图片");
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 6000 || height > 6000 || (long) width * height > 16000000)
                    return Result.error(400, "请选择1600万像素以内且单边不超过6000像素的照片");
            } finally { reader.dispose(); }
        } catch (Exception error) { return Result.error(400, "图片读取失败，请更换图片"); }
        try {
            return Result.success(pythonApiService.watermark(file, text.trim(), size, opacity, angle, color, space, dpi));
        } catch (IllegalStateException error) {
            return Result.error(502, error.getMessage());
        }
    }
}

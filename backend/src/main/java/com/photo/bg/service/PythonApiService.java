package com.photo.bg.service;

import org.springframework.web.multipart.MultipartFile;
import java.util.Map;

public interface PythonApiService {
    /**
     * 调用 Python 生成透明底证件照接口 (idphoto)
     */
    Map<String, Object> generateIdPhoto(MultipartFile file, Integer height, Integer width);

    /**
     * 调用 Python 添加背景色接口 (add_background)
     */
    Map<String, Object> addBackground(String base64Image, String color);

    /**
     * 调用 Python 生成排版照接口 (generate_layout_photos)
     */
    Map<String, Object> generateLayoutPhotos(String base64Image, Integer height, Integer width);

    Map<String, Object> watermark(MultipartFile file, String text, int size, double opacity,
                                  int angle, String color, int space, int dpi);
}

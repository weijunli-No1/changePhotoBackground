package com.photo.bg.service;

import java.io.InputStream;

public interface MinioStorageService {

    /**
     * 上传 Base64 格式的图片
     *
     * @param base64 带或不带前缀的 base64 字符串
     * @param extension 文件扩展名，如 .png, .jpg
     * @return 返回文件的访问 URL
     */
    String uploadBase64(String base64, String extension);

    /**
     * 上传输入流
     *
     * @param inputStream 数据流
     * @param fileName 文件名
     * @param contentType 文件类型
     * @return 返回文件的访问 URL
     */
    String uploadFile(InputStream inputStream, String fileName, String contentType);

    /** Read an original using server credentials; never fetch arbitrary URLs. */
    byte[] readFile(String fileUrl);

    /** Public preview objects contain a burned-in watermark. */
    String uploadPreview(byte[] image, String sourceUrl);

    /**
     * 删除文件
     *
     * @param fileUrl 文件的访问 URL
     */
    void deleteFile(String fileUrl);
}

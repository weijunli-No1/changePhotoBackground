package com.photo.bg.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageReadParam;
import javax.imageio.stream.ImageInputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Creates independent preview bitmaps. Original object URLs never reach views. */
@Service
@RequiredArgsConstructor
public class PhotoPreviewService {
    private final MinioStorageService storage;
    private final Map<String, String> previews = new ConcurrentHashMap<>();

    public String preview(String sourceUrl) {
        if (previews.size() > 512) previews.clear();
        return previews.computeIfAbsent(sourceUrl,
                key -> storage.uploadPreview(watermark(storage.readFile(key)), key));
    }

    public byte[] watermark(byte[] original) {
        if (original == null || original.length == 0 || original.length > 50 * 1024 * 1024)
            throw new IllegalArgumentException("照片内容无效");
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(original))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw new IllegalArgumentException("照片格式无效");
            ImageReader reader = readers.next();
            BufferedImage source;
            try {
                reader.setInput(input);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 12000 || height > 12000 || (long) width * height > 24000000)
                    throw new IllegalArgumentException("照片尺寸超出支持范围");
                ImageReadParam parameters = reader.getDefaultReadParam();
                int subsampling = Math.max(1, (int) Math.floor(Math.max(width, height) / 1600d));
                parameters.setSourceSubsampling(subsampling, subsampling, 0, 0);
                source = reader.read(0, parameters);
            } finally { reader.dispose(); }
            double scale = Math.min(1, 1600d / Math.max(source.getWidth(), source.getHeight()));
            int width = Math.max(1, (int) Math.round(source.getWidth() * scale));
            int height = Math.max(1, (int) Math.round(source.getHeight() * scale));
            BufferedImage preview = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
            Graphics2D graphics = preview.createGraphics();
            try {
                graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                graphics.setColor(Color.WHITE);
                graphics.fillRect(0, 0, width, height);
                graphics.drawImage(source, 0, 0, width, height, null);
                graphics.translate(width / 2d, height / 2d);
                graphics.rotate(-Math.PI / 7);
                int font = Math.max(14, (int) (Math.min(width, height) * 0.075));
                graphics.setFont(new Font(Font.SANS_SERIF, Font.BOLD, font));
                graphics.setColor(new Color(35, 55, 90, 90));
                int diagonal = (int) Math.ceil(Math.hypot(width, height));
                for (int y = -diagonal; y <= diagonal; y += font * 4)
                    for (int x = -diagonal; x <= diagonal; x += font * 13) {
                        graphics.drawString("拾光小相", x, y);
                        // ASCII remains legible on servers without CJK fonts.
                        graphics.drawString("SHIGUANG PREVIEW", x, y + font);
                    }
            } finally { graphics.dispose(); }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!ImageIO.write(preview, "jpg", output)) throw new IllegalStateException("水印编码失败");
            return output.toByteArray();
        } catch (Exception error) {
            throw new IllegalStateException("水印预览暂时无法生成", error);
        }
    }
}

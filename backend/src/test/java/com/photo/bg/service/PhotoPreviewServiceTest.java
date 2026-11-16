package com.photo.bg.service;

import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PhotoPreviewServiceTest {
    private byte[] image() throws Exception {
        BufferedImage image = new BufferedImage(300, 420, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics(); g.setColor(Color.WHITE); g.fillRect(0, 0, 300, 420); g.dispose();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); ImageIO.write(image, "png", bytes); return bytes.toByteArray();
    }

    @Test
    void watermarkIsBurnedIntoPixelsAndOnlyMarkedBytesArePublished() throws Exception {
        MinioStorageService storage = mock(MinioStorageService.class);
        byte[] original = image(); when(storage.readFile("PRIVATE")).thenReturn(original);
        when(storage.uploadPreview(any(), eq("PRIVATE"))).thenAnswer(call -> {
            byte[] bytes = call.getArgument(0);
            BufferedImage marked = ImageIO.read(new ByteArrayInputStream(bytes));
            assertEquals(300, marked.getWidth()); assertEquals(420, marked.getHeight());
            int changed = 0;
            for (int y = 0; y < marked.getHeight(); y++) for (int x = 0; x < marked.getWidth(); x++)
                if ((marked.getRGB(x, y) & 0xffffff) < 0xf0f0f0) changed++;
            assertTrue(changed > 1000, "watermark must alter the actual bitmap");
            return "PUBLIC_WATERMARKED";
        });
        PhotoPreviewService previews = new PhotoPreviewService(storage);
        assertEquals("PUBLIC_WATERMARKED", previews.preview("PRIVATE"));
        assertEquals("PUBLIC_WATERMARKED", previews.preview("PRIVATE"));
        verify(storage, times(1)).uploadPreview(any(), anyString());
        verify(storage, never()).uploadBase64(anyString(), anyString());
    }

    @Test
    void invalidImageFailsClosed() {
        MinioStorageService storage = mock(MinioStorageService.class);
        when(storage.readFile("PRIVATE")).thenReturn(new byte[]{1, 2, 3});
        assertThrows(IllegalStateException.class, () -> new PhotoPreviewService(storage).preview("PRIVATE"));
        verify(storage, never()).uploadPreview(any(), anyString());
    }
}

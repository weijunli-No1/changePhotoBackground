package com.photo.bg.controller;

import com.photo.bg.service.PythonApiService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class WatermarkControllerTest {
    private MockMultipartFile image() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(64, 96, BufferedImage.TYPE_INT_RGB), "jpg", output);
        return new MockMultipartFile("file", "portrait.jpg", "image/jpeg", output.toByteArray());
    }

    @Test
    void acceptsImageAndForwardsStyleWithoutChangingExistingEndpoints() throws Exception {
        PythonApiService python = mock(PythonApiService.class);
        Map<String,Object> result = new HashMap<>();
        result.put("status",true); result.put("image_base64","aW1hZ2U=");
        when(python.watermark(any(),eq("仅供报名使用"),eq(48),eq(0.25),eq(30),eq("#000000"),eq(25),eq(300))).thenReturn(result);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new WatermarkController(python)).build();
        mvc.perform(multipart("/api/photo/watermark").file(image()).param("text"," 仅供报名使用 "))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.image_base64").value("aW1hZ2U="));
        verify(python).watermark(any(),eq("仅供报名使用"),eq(48),eq(0.25),eq(30),eq("#000000"),eq(25),eq(300));
    }

    @Test
    void rejectsInvalidImageTextAndStyleBeforeCallingPython() throws Exception {
        PythonApiService python = mock(PythonApiService.class);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new WatermarkController(python)).build();
        mvc.perform(multipart("/api/photo/watermark").file(image()).param("text"," "))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(multipart("/api/photo/watermark").file(image()).param("text","test").param("opacity","NaN"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(multipart("/api/photo/watermark").file(image()).param("text","test").param("color","red"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(multipart("/api/photo/watermark").file(new MockMultipartFile("file","bad.jpg","image/jpeg",new byte[]{1,2,3})).param("text","test"))
                .andExpect(jsonPath("$.code").value(400));
        verifyNoInteractions(python);
    }

    @Test
    void acceptsMixedTextButRejectsControlCharacters() throws Exception {
        PythonApiService python = mock(PythonApiService.class);
        when(python.watermark(any(),anyString(),anyInt(),anyDouble(),anyInt(),anyString(),anyInt(),anyInt()))
                .thenReturn(new HashMap<>());
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new WatermarkController(python)).build();
        mvc.perform(multipart("/api/photo/watermark").file(image()).param("text", "报名 ID 2026"))
                .andExpect(jsonPath("$.code").value(200));
        clearInvocations(python);
        for (String text : new String[]{"hello\nworld", "name\tID", "用途" + (char) 0 + "test", "用途" + (char) 127}) {
            mvc.perform(multipart("/api/photo/watermark").file(image()).param("text", text))
                    .andExpect(jsonPath("$.code").value(400));
        }
        verifyNoInteractions(python);
    }

    @Test
    void pythonFailureIsRetryableBusinessError() throws Exception {
        PythonApiService python = mock(PythonApiService.class);
        when(python.watermark(any(),anyString(),anyInt(),anyDouble(),anyInt(),anyString(),anyInt(),anyInt()))
                .thenThrow(new IllegalStateException("水印生成失败，请重试"));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new WatermarkController(python)).build();
        mvc.perform(multipart("/api/photo/watermark").file(image()).param("text","test"))
                .andExpect(jsonPath("$.code").value(502)).andExpect(jsonPath("$.message").value("水印生成失败，请重试"));
    }
}

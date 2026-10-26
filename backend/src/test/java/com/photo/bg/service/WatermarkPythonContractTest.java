package com.photo.bg.service;

import com.photo.bg.service.impl.PythonApiServiceImpl;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class WatermarkPythonContractTest {
    @Test
    void stylesUseQueryAndTextImageDpiUseMultipart() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicReference<String> query = new AtomicReference<>(), body = new AtomicReference<>();
        AtomicReference<String> reply = new AtomicReference<>("{\"status\":true,\"image_base64\":\"aW1hZ2U=\"}");
        server.createContext("/watermark",exchange -> {
            query.set(exchange.getRequestURI().getRawQuery());
            try (InputStream input = exchange.getRequestBody(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024]; int length;
                while ((length = input.read(buffer)) != -1) output.write(buffer,0,length);
                body.set(new String(output.toByteArray(),StandardCharsets.UTF_8));
            }
            byte[] bytes = reply.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        try {
            PythonApiServiceImpl service = new PythonApiServiceImpl();
            ReflectionTestUtils.setField(service,"baseUrl","http://127.0.0.1:"+server.getAddress().getPort()+"/");
            MockMultipartFile image = new MockMultipartFile("file","a.jpg","image/jpeg",new byte[]{1,2,3});
            assertEquals("aW1hZ2U=",service.watermark(image,"仅供报名",48,0.25,30,"#123456",25,300).get("image_base64"));
            assertTrue(query.get().contains("color=%23123456"));
            assertTrue(query.get().contains("size=48")); assertTrue(query.get().contains("opacity=0.25"));
            assertTrue(body.get().contains("name=\"input_image\"")); assertTrue(body.get().contains("仅供报名"));
            assertTrue(body.get().contains("name=\"dpi\""));
            reply.set("{\"status\":false,\"error\":\"internal details\"}");
            assertThrows(IllegalStateException.class,()->service.watermark(image,"test",48,0.25,30,"#000000",25,300));
        } finally { server.stop(0); }
    }
}

package com.photo.bg.controller;

import cn.binarywang.wx.miniapp.api.WxMaService;
import com.photo.bg.entity.User;
import com.photo.bg.service.*;
import org.junit.jupiter.api.Test;
import java.util.HashMap;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class LayoutQuotaTest {
    @Test
    void layoutReservesOnceAndRefundsFailedOrEmptyGeneration() {
        PythonApiService python = mock(PythonApiService.class);
        UserService users = mock(UserService.class);
        UserDailyUsageService usage = mock(UserDailyUsageService.class);
        MemberSessionService sessions = mock(MemberSessionService.class);
        User user = new User(); user.setId(7L);
        when(users.getOne(any())).thenReturn(user);
        PhotoController controller = new PhotoController(python, users, sessions, usage, mock(WxMaService.class));
        assertEquals(4031, controller.generateLayoutPhotos("owner", "Bearer owner", "IMAGE", 413, 295).getCode());
        verifyNoInteractions(python);
        when(usage.tryConsumeSave(eq(7L), any())).thenReturn(true);
        Map<String,Object> result = new HashMap<>(); result.put("status", false);
        when(python.generateLayoutPhotos(anyString(), anyInt(), anyInt())).thenReturn(result);
        assertEquals(502, controller.generateLayoutPhotos("owner", "Bearer owner", "IMAGE", 413, 295).getCode());
        verify(usage).releaseSave(eq(7L), any());
        result.put("status", true); result.put("image_base64", "LAYOUT");
        assertEquals(200, controller.generateLayoutPhotos("owner", "Bearer owner", "IMAGE", 413, 295).getCode());
        verify(usage, times(1)).releaseSave(eq(7L), any());
        when(python.generateLayoutPhotos(anyString(), anyInt(), anyInt())).thenThrow(new IllegalStateException("offline"));
        assertThrows(IllegalStateException.class, () -> controller.generateLayoutPhotos("owner", "Bearer owner", "IMAGE", 413, 295));
        verify(usage, times(2)).releaseSave(eq(7L), any());
    }
}

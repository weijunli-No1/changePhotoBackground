package com.photo.bg.controller;

import com.photo.bg.dto.HistorySaveParam;
import com.photo.bg.entity.PhotoHistory;
import com.photo.bg.entity.User;
import com.photo.bg.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ProtectedPhotoHistoryTest {
    private PhotoHistoryService histories;
    private MinioStorageService storage;
    private UserService users;
    private MemberSessionService sessions;
    private UserDailyUsageService usage;
    private PhotoPreviewService previews;
    private PhotoHistoryController controller;
    private PhotoHistory history;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        histories = mock(PhotoHistoryService.class); storage = mock(MinioStorageService.class);
        users = mock(UserService.class); sessions = mock(MemberSessionService.class);
        usage = mock(UserDailyUsageService.class); previews = mock(PhotoPreviewService.class);
        controller = new PhotoHistoryController(histories, storage, users, sessions, usage, previews);
        User user = new User(); user.setId(7L); user.setOpenid("owner");
        when(users.getOne(any())).thenReturn(user);
        when(sessions.requireUser("Bearer owner")).thenReturn(7L);
        history = new PhotoHistory(); history.setId(11L); history.setUserId(7L);
        history.setPhotoUrl("PRIVATE_ORIGINAL"); history.setOriginalPhotoUrl("PRIVATE_SOURCE");
        history.setCreateTime(LocalDateTime.now()); history.setIsDeleted(0);
        when(histories.getById(11L)).thenReturn(history);
        when(histories.list(any())).thenReturn(Collections.singletonList(history));
        when(previews.preview("PRIVATE_ORIGINAL")).thenReturn("WATERMARKED_PREVIEW");
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void listContainsOnlyWatermarkedUrlsAndRequiresOwnerSession() throws Exception {
        doThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED)).when(sessions).requireOwner(isNull(), any());
        mvc.perform(get("/api/history/list").param("openid", "owner"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/history/list").param("openid", "owner").header("Authorization", "Bearer owner"))
                .andExpect(jsonPath("$.data[0].previewUrl").value("WATERMARKED_PREVIEW"))
                .andExpect(jsonPath("$.data[0].photoUrl").value("WATERMARKED_PREVIEW"))
                .andExpect(jsonPath("$.data[0].originalPhotoUrl").doesNotExist())
                .andExpect(jsonPath("$.data[0].userId").doesNotExist());
    }

    @Test
    void failedWatermarkNeverFallsBackToOriginal() throws Exception {
        when(previews.preview(anyString())).thenThrow(new IllegalStateException("unavailable"));
        String response = mvc.perform(get("/api/history/list").param("openid", "owner").header("Authorization", "Bearer owner"))
                .andExpect(jsonPath("$.data[0].previewUnavailable").value(true))
                .andReturn().getResponse().getContentAsString();
        assertFalse(response.contains("PRIVATE_ORIGINAL"));
        assertFalse(response.contains("PRIVATE_SOURCE"));
    }

    @Test
    void cleanDownloadChecksOwnershipAndAtomicallyConsumesBeforeReading() throws Exception {
        when(sessions.requireUser("Bearer other")).thenReturn(8L);
        mvc.perform(post("/api/history/11/download").header("Authorization", "Bearer other"))
                .andExpect(status().isNotFound());
        verifyNoInteractions(usage, storage);
        mvc.perform(post("/api/history/11/download").header("Authorization", "Bearer owner"))
                .andExpect(jsonPath("$.code").value(4031));
        verify(storage, never()).readFile(anyString());
        when(usage.tryConsumeSave(eq(7L), any(LocalDate.class))).thenReturn(true);
        when(storage.readFile("PRIVATE_ORIGINAL")).thenReturn("clean".getBytes(StandardCharsets.UTF_8));
        mvc.perform(post("/api/history/11/download").header("Authorization", "Bearer owner"))
                .andExpect(jsonPath("$.data.image_base64").value("Y2xlYW4="))
                .andExpect(jsonPath("$.data.downloadUrl").doesNotExist());
        verify(usage, never()).releaseSave(anyLong(), any());
    }

    @Test
    void failedDownloadRefundsOnlyItsReservedSave() {
        when(usage.tryConsumeSave(eq(7L), any())).thenReturn(true);
        when(storage.readFile(anyString())).thenThrow(new IllegalStateException("offline"));
        assertThrows(IllegalStateException.class, () -> controller.download(11L, "Bearer owner"));
        verify(usage).releaseSave(eq(7L), any());
    }

    @Test
    void saveReturnsWatermarkOnlyAndRefundsFailedPersistence() {
        HistorySaveParam param = new HistorySaveParam(); param.setOpenid("owner"); param.setBase64Image("IMAGE");
        param.setOriginalPhotoUrl("UNTRUSTED_SOURCE");
        when(usage.tryConsumeSave(eq(7L), any())).thenReturn(true);
        when(storage.uploadBase64("IMAGE", ".png")).thenReturn("PRIVATE_ORIGINAL");
        when(histories.save(any())).thenReturn(true);
        assertEquals("WATERMARKED_PREVIEW", controller.saveHistory(param, "Bearer owner").getData().getPhotoUrl());
        verify(histories).save(argThat(value -> value.getOriginalPhotoUrl() == null));
        verify(usage, never()).releaseSave(anyLong(), any());
        when(histories.save(any())).thenReturn(false);
        assertThrows(IllegalStateException.class, () -> controller.saveHistory(param, "Bearer owner"));
        verify(usage).releaseSave(eq(7L), any());
        verify(storage).deleteFile("PRIVATE_ORIGINAL");
    }

    @Test
    void deletingAnotherUsersPhotoIsRejected() throws Exception {
        when(sessions.requireUser("Bearer other")).thenReturn(8L);
        mvc.perform(delete("/api/history/11").header("Authorization", "Bearer other"))
                .andExpect(status().isNotFound());
        verify(histories, never()).removeById(anyLong());
    }
}

package com.photo.bg.service.impl;

import com.photo.bg.config.MinioConfig;
import io.minio.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MinioProtectedAccessTest {
    @Test
    void existingBucketAlsoLosesAnonymousOriginalAccess() throws Exception {
        MinioClient client = mock(MinioClient.class);
        MinioConfig config = new MinioConfig(); config.setBucketName("photos");
        when(client.bucketExists(any())).thenReturn(true);
        new MinioStorageServiceImpl(client, config).init();
        ArgumentCaptor<SetBucketPolicyArgs> policy = ArgumentCaptor.forClass(SetBucketPolicyArgs.class);
        verify(client).setBucketPolicy(policy.capture());
        assertTrue(policy.getValue().config().contains("arn:aws:s3:::photos/previews/*"));
        assertFalse(policy.getValue().config().contains("arn:aws:s3:::photos/*\""));
        verify(client, never()).makeBucket(any());
    }

    @Test
    void policyFailureStopsStartupAndExternalUrlsAreNeverFetched() throws Exception {
        MinioClient client = mock(MinioClient.class);
        MinioConfig config = new MinioConfig(); config.setBucketName("photos"); config.setEndpoint("https://storage.example");
        when(client.bucketExists(any())).thenReturn(true);
        doThrow(new RuntimeException("denied")).when(client).setBucketPolicy(any());
        MinioStorageServiceImpl storage = new MinioStorageServiceImpl(client, config);
        assertThrows(IllegalStateException.class, storage::init);
        assertThrows(IllegalStateException.class, () -> storage.readFile("http://127.0.0.1/private"));
        verify(client, never()).getObject(any());
    }
}

package com.photo.bg.dto;

import lombok.Data;
import java.time.LocalDateTime;

/** Public history representation deliberately excludes original URLs. */
@Data
public class PhotoHistoryView {
    private Long id;
    private String previewUrl;
    // Compatibility for older clients: this is also watermarked, never clean.
    private String photoUrl;
    private String bgColor;
    private LocalDateTime createTime;
    private boolean previewUnavailable;
}

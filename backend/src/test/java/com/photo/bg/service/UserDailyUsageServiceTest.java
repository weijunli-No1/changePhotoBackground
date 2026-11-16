package com.photo.bg.service;

import com.photo.bg.entity.UserDailyUsage;
import com.photo.bg.mapper.UserDailyUsageMapper;
import com.photo.bg.service.impl.UserDailyUsageServiceImpl;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class UserDailyUsageServiceTest {
    private final UserDailyUsageMapper mapper = mock(UserDailyUsageMapper.class);
    private final MembershipService membership = mock(MembershipService.class);
    private final UserDailyUsageServiceImpl service = new UserDailyUsageServiceImpl(membership);
    private final LocalDate date = LocalDate.of(2026, 11, 16);

    UserDailyUsageServiceTest() {
        ReflectionTestUtils.setField(service, "baseMapper", mapper);
    }

    @Test void consumingUsesOneConditionalDatabaseIncrementAndItsAffectedRowCount() {
        when(mapper.tryConsumeSave(7L, date, false, 5)).thenReturn(1, 0);
        assertTrue(service.tryConsumeSave(7L, date));
        assertFalse(service.tryConsumeSave(7L, date));
        InOrder operations = inOrder(mapper);
        operations.verify(mapper).insertUsageIfAbsent(7L, date);
        operations.verify(mapper).tryConsumeSave(7L, date, false, 5);
        operations.verify(mapper).insertUsageIfAbsent(7L, date);
        operations.verify(mapper).tryConsumeSave(7L, date, false, 5);
        verifyNoMoreInteractions(mapper);
    }

    @Test void membershipComesFromServerAndStillUsesTheAtomicIncrement() {
        when(membership.isMember(7L)).thenReturn(true);
        when(mapper.tryConsumeSave(7L, date, true, 5)).thenReturn(1);
        assertTrue(service.tryConsumeSave(7L, date));
        verify(mapper).tryConsumeSave(7L, date, true, 5);
    }

    @Test void compensatingKeepsTheReservationDateAndDoesNotCreateOrReadUsage() {
        service.releaseSave(7L, date);
        verify(mapper).releaseSave(7L, date);
        verifyNoMoreInteractions(mapper);
        verifyNoInteractions(membership);
    }

    @Test void usageCreationUsesAnUpsertRatherThanReadThenInsert() {
        UserDailyUsage usage = new UserDailyUsage();
        usage.setUserId(7L);
        usage.setRecordDate(date);
        when(mapper.selectOne(any())).thenReturn(usage);
        assertSame(usage, service.getOrCreateUsage(7L, date));
        InOrder operations = inOrder(mapper);
        operations.verify(mapper).insertUsageIfAbsent(7L, date);
        operations.verify(mapper).selectOne(any());
        verify(mapper, never()).insert(any());
    }

    @Test void legacySaveAndAdCountersUseIndependentAtomicColumnsWithoutEntityWrites() {
        service.recordAdView(7L, date);
        service.recordSave(7L, date);
        verify(mapper, times(2)).insertUsageIfAbsent(7L, date);
        verify(mapper).incrementAdViewCount(7L, date);
        verify(mapper).incrementSaveCount(7L, date);
        verify(mapper, never()).updateById(any());
        verify(mapper, never()).selectOne(any());
    }
}

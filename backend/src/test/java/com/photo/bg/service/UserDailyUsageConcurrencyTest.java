package com.photo.bg.service;

import com.photo.bg.mapper.UserDailyUsageMapper;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

/** Runs the actual annotated mapper SQL and parameter bindings, not a counter substitute. */
class UserDailyUsageConcurrencyTest {
    private JdbcDataSource dataSource;
    private SqlSessionFactory sessions;
    private final LocalDate date = LocalDate.of(2026, 11, 16);

    @BeforeEach void database() throws Exception {
        dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:quota_" + UUID.randomUUID().toString().replace("-", "")
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=15000");
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE t_user_daily_usage (id BIGINT AUTO_INCREMENT PRIMARY KEY, "
                    + "user_id BIGINT NOT NULL, record_date DATE NOT NULL, save_count INT NOT NULL DEFAULT 0, "
                    + "ad_view_count INT NOT NULL DEFAULT 0, UNIQUE(user_id, record_date))");
        }
        Configuration configuration = new Configuration(new Environment("quota-test", new JdbcTransactionFactory(), dataSource));
        configuration.setLogImpl(org.apache.ibatis.logging.nologging.NoLoggingImpl.class);
        configuration.addMapper(UserDailyUsageMapper.class);
        sessions = new SqlSessionFactoryBuilder().build(configuration);
    }

    @AfterEach void closeDatabase() throws Exception {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("SHUTDOWN");
        }
    }

    private int mapper(Function<UserDailyUsageMapper, Integer> operation) {
        try (SqlSession session = sessions.openSession(true)) {
            return operation.apply(session.getMapper(UserDailyUsageMapper.class));
        }
    }

    private int consume(long user, boolean member) {
        return mapper(mapper -> {
            mapper.insertUsageIfAbsent(user, date);
            return mapper.tryConsumeSave(user, date, member, 5);
        });
    }

    private int parallelConsumes(long user, boolean member) throws Exception {
        ExecutorService workers = Executors.newFixedThreadPool(24);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> results = new ArrayList<>();
        try {
            for (int i = 0; i < 120; i++) {
                results.add(workers.submit(() -> { start.await(); return consume(user, member); }));
            }
            start.countDown();
            int accepted = 0;
            for (Future<Integer> result : results) accepted += result.get(20, TimeUnit.SECONDS);
            return accepted;
        } finally {
            workers.shutdownNow();
            assertTrue(workers.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    private int counter(long user, String column) throws Exception {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement("SELECT " + column
                     + " FROM t_user_daily_usage WHERE user_id=? AND record_date=?")) {
            statement.setLong(1, user);
            statement.setDate(2, java.sql.Date.valueOf(date));
            try (ResultSet result = statement.executeQuery()) {
                assertTrue(result.next());
                return result.getInt(1);
            }
        }
    }

    private void ads(long user, int views) {
        mapper(mapper -> {
            mapper.insertUsageIfAbsent(user, date);
            for (int i = 0; i < views; i++) mapper.incrementAdViewCount(user, date);
            return 0;
        });
    }

    @Test void simultaneousFirstDayRequestsCreateOneRowAndPermitOnlyFiveSaves() throws Exception {
        assertEquals(5, parallelConsumes(1L, false));
        assertEquals(5, counter(1L, "save_count"));
        assertEquals(0, counter(1L, "ad_view_count"));
        assertEquals(0, consume(1L, false));
    }

    @Test void fourAdsAllowExactlyNineConcurrentSaves() throws Exception {
        ads(2L, 4);
        assertEquals(9, parallelConsumes(2L, false));
        assertEquals(9, counter(2L, "save_count"));
        assertEquals(4, counter(2L, "ad_view_count"));
    }

    @Test void memberAndFiveAdsKeepUnlimitedSavesWithoutLosingCounts() throws Exception {
        assertEquals(120, parallelConsumes(3L, true));
        assertEquals(120, counter(3L, "save_count"));
        ads(4L, 5);
        assertEquals(120, parallelConsumes(4L, false));
        assertEquals(120, counter(4L, "save_count"));
        assertEquals(5, counter(4L, "ad_view_count"));
    }

    @Test void failureReleaseRestoresOnlyReservedQuotaAndCannotMakeCountsNegative() throws Exception {
        assertEquals(5, parallelConsumes(5L, false));
        mapper(mapper -> mapper.releaseSave(5L, date));
        assertEquals(4, counter(5L, "save_count"));
        assertEquals(1, consume(5L, false));
        assertEquals(0, consume(5L, false));
        // A late failure after midnight must target the reservation's original date.
        mapper(mapper -> mapper.releaseSave(5L, date.plusDays(1)));
        assertEquals(5, counter(5L, "save_count"));
        for (int i = 0; i < 8; i++) mapper(mapper -> mapper.releaseSave(5L, date));
        assertEquals(0, counter(5L, "save_count"));
    }
}

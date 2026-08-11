/**
 * stats.test.js —— Stats 统计模块单元测试（node:test）
 *
 * 运行：node --test test/stats.test.js
 * 覆盖：概览统计（环比/距上次/平均分）、按月/趋势、评分分布、热力图、
 *       星期分布、时段分布、标签计数。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateUtils } from "../js/pure/date-utils.js";
import { Stats } from "../js/pure/stats.js";

/** 构造测试记录：缺省字段不写入（模拟真实数据形态） */
function mk(date, time, rating, tags) {
  const r = { date };
  if (time !== undefined) r.time = time;
  if (rating !== undefined) r.rating = rating;
  if (tags !== undefined) r.tags = tags;
  return r;
}

const TODAY = DateUtils.todayStr();

// ---------- getStats ----------

test("getStats 空数据：total 0 / changePct null / lastDays null / avgRating null", () => {
  assert.deepEqual(Stats.getStats([], null), {
    total: 0,
    changePct: null,
    lastDays: null,
    avgRating: null,
  });
});

test("getStats 单条（今天）：total 1 / lastDays 0 / avgRating 取该条评分", () => {
  const s = Stats.getStats([mk(TODAY, "10:00", 4)], null);
  assert.equal(s.total, 1);
  assert.equal(s.changePct, null); // 无 range → 无环比
  assert.equal(s.lastDays, 0); // 今天有记录 = 0
  assert.equal(s.avgRating, 4);
});

test("getStats lastDays：昨天有记录 = 1（以今天为基准）", () => {
  const yesterday = DateUtils.addDays(TODAY, -1);
  const s = Stats.getStats([mk(yesterday, null, null)], null);
  assert.equal(s.total, 1);
  assert.equal(s.lastDays, 1);
  assert.equal(s.avgRating, null); // 无评分 → null
});

test("getStats lastDays：指定 range 时仍以今天为基准（plan 2.2「距上次天数」语义）", () => {
  const s = Stats.getStats([mk("2026-07-15", null, null)], {
    start: "2026-07-01",
    end: "2026-07-31",
  });
  assert.equal(s.total, 1);
  // 与 range.end（07-31）无关，取距今天的天数（动态计算）
  assert.equal(
    s.lastDays,
    DateUtils.getDaysBetween(DateUtils.todayStr(), "2026-07-15")
  );
});

test("getStats lastDays：range 内今天有记录 → 0（即使 range.end 不是今天）", () => {
  const s = Stats.getStats([mk(TODAY, null, null)], {
    start: DateUtils.addDays(TODAY, -5),
    end: DateUtils.addDays(TODAY, 5),
  });
  assert.equal(s.total, 1);
  assert.equal(s.lastDays, 0); // 今天有记录 = 0
});

test("getStats 环比：本月 3 条 vs 上月 5 条 → -40（完整月对比）", () => {
  const now = new Date();
  const monthStart = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)); // 本月最后一天
  const prevMid = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 15)); // 上月 15 日
  const records = [];
  for (let i = 0; i < 3; i++) records.push(mk(monthStart, null, null)); // 本月 3 条
  for (let i = 0; i < 5; i++) records.push(mk(prevMid, null, null)); // 上月 5 条
  // 完整本月范围 → 上一等长时段 = 整个上月
  const s = Stats.getStats(records, { start: monthStart, end: monthEnd });
  assert.equal(s.total, 3);
  assert.equal(s.changePct, -40); // round((3-5)/5*100) = -40
});

test("getStats 环比：上一时段无记录 → null（无法计算百分比）", () => {
  const now = new Date();
  const monthStart = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const s = Stats.getStats([mk(TODAY, null, null)], { start: monthStart, end: TODAY });
  assert.equal(s.total, 1);
  assert.equal(s.changePct, null);
});

test("getStats 环比：增长为正数（无符号，符号由 UI 处理）", () => {
  const now = new Date();
  const monthStart = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const prevMid = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  const records = [];
  for (let i = 0; i < 6; i++) records.push(mk(monthStart, null, null)); // 本月 6 条
  records.push(mk(prevMid, null, null)); // 上月 1 条
  const s = Stats.getStats(records, { start: monthStart, end: monthEnd });
  assert.equal(s.changePct, 500); // round((6-1)/1*100) = 500
});

test("getStats avgRating：四舍五入保留 1 位小数", () => {
  const s = Stats.getStats(
    [mk(TODAY, null, 5), mk(TODAY, null, 5), mk(TODAY, null, 4)],
    null
  );
  assert.equal(s.avgRating, 4.7); // 14/3 = 4.666... → 4.7
});

test("getStats avgRating：无评分记录不计入分母", () => {
  const s = Stats.getStats(
    [mk(TODAY, null, 5), mk(TODAY, null, null), mk(TODAY, null, 5)],
    null
  );
  assert.equal(s.total, 3);
  assert.equal(s.avgRating, 5); // 只有 2 条有评分
});

// ---------- monthlyCounts / trendCounts ----------

test("monthlyCounts：跨月统计、ym 升序（乱序输入）", () => {
  const records = [
    mk("2026-08-02", null, null),
    mk("2026-06-15", null, null),
    mk("2026-07-01", null, null),
    mk("2026-07-20", null, null),
    mk("2026-07-31", null, null),
  ];
  assert.deepEqual(Stats.monthlyCounts(records, null), [
    { ym: "2026-06", count: 1 },
    { ym: "2026-07", count: 3 },
    { ym: "2026-08", count: 1 },
  ]);
});

test("monthlyCounts：范围过滤只统计范围内", () => {
  const records = [
    mk("2026-06-15", null, null),
    mk("2026-07-01", null, null),
    mk("2026-07-20", null, null),
    mk("2026-08-02", null, null),
  ];
  assert.deepEqual(
    Stats.monthlyCounts(records, { start: "2026-07-01", end: "2026-07-31" }),
    [{ ym: "2026-07", count: 2 }]
  );
});

test("trendCounts：与 monthlyCounts 同构", () => {
  const records = [
    mk("2026-08-02", null, null),
    mk("2026-06-15", null, null),
    mk("2026-07-01", null, null),
  ];
  assert.deepEqual(Stats.trendCounts(records, null), Stats.monthlyCounts(records, null));
});

// ---------- ratingDistribution ----------

test("ratingDistribution：只统计有评分，1-5 顺序且 0 计数段包含", () => {
  const records = [
    mk("2026-08-11", null, 5),
    mk("2026-08-11", null, 3),
    mk("2026-08-11", null, 3),
    mk("2026-08-11", null, null), // 无评分不计入
    mk("2026-08-11", null, 5),
    mk("2026-08-11", null, 2),
    mk("2026-08-11", null), // 无 rating 字段也不计入
  ];
  assert.deepEqual(Stats.ratingDistribution(records, null), [
    { rating: 1, count: 0 },
    { rating: 2, count: 1 },
    { rating: 3, count: 2 },
    { rating: 4, count: 0 },
    { rating: 5, count: 2 },
  ]);
});

// ---------- heatmapData ----------

test("heatmapData：近 6 个月跨度（首日 = 5 个月前 1 号，终点 = 今天），无记录日期不输出", () => {
  const now = new Date();
  const start = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  const records = [
    mk(start, null, null),
    mk(start, null, null), // 首日 2 条 → count 2
    mk(DateUtils.addDays(start, 1), null, null), // 次日 1 条
    mk(DateUtils.addDays(start, -1), null, null), // 首日前一天：范围外
    mk(TODAY, null, null), // 今天 1 条
    mk(DateUtils.addDays(TODAY, 1), null, null), // 明天：范围外
  ];
  const h = Stats.heatmapData(records, 6);
  // 只有 3 个有记录的日期被输出（无记录日期不输出），升序
  assert.deepEqual(h, [
    { date: start, count: 2 },
    { date: DateUtils.addDays(start, 1), count: 1 },
    { date: TODAY, count: 1 },
  ]);
});

// ---------- weekdayDistribution ----------

test("weekdayDistribution：已知日期（2026-08-11 周二=2），固定 1-7 顺序", () => {
  const records = [
    mk("2026-08-11", null, null), // 周二
    mk("2026-08-11", null, null), // 周二
    mk("2026-08-10", null, null), // 周一
    mk("2026-08-09", null, null), // 周日
  ];
  assert.deepEqual(Stats.weekdayDistribution(records, null), [
    { weekday: 1, count: 1 },
    { weekday: 2, count: 2 },
    { weekday: 3, count: 0 },
    { weekday: 4, count: 0 },
    { weekday: 5, count: 0 },
    { weekday: 6, count: 0 },
    { weekday: 7, count: 1 },
  ]);
});

test("weekdayDistribution：范围过滤", () => {
  const records = [
    mk("2026-08-11", null, null), // 周二
    mk("2026-08-10", null, null), // 周一
    mk("2026-08-09", null, null), // 周日（范围外）
  ];
  const w = Stats.weekdayDistribution(records, {
    start: "2026-08-10",
    end: "2026-08-11",
  });
  assert.equal(w[0].count, 1); // 周一
  assert.equal(w[1].count, 1); // 周二
  assert.equal(w[6].count, 0); // 周日被过滤
});

// ---------- periodDistribution ----------

test("periodDistribution：早/午/晚/未记录（复用 inferPeriod 边界）", () => {
  const records = [
    mk("2026-08-11", "05:00"), // 早
    mk("2026-08-11", "12:00"), // 午
    mk("2026-08-11", "17:00"), // 晚
    mk("2026-08-11", "00:00"), // 晚（跨午夜）
    mk("2026-08-11", null), // time 为 null → none
    mk("2026-08-11"), // 无 time 字段 → none
  ];
  assert.deepEqual(Stats.periodDistribution(records, null), [
    { period: "morning", count: 1 },
    { period: "afternoon", count: 1 },
    { period: "evening", count: 2 },
    { period: "none", count: 2 },
  ]);
});

// ---------- tagCounts ----------

test("tagCounts：多标签各计 1 次、同名合并、降序、无标签不计入", () => {
  const records = [
    mk("2026-08-11", null, null, ["工作", "生活"]),
    mk("2026-08-12", null, null, ["工作"]),
    mk("2026-08-13", null, null, []), // 空标签数组不计入
    mk("2026-08-14", null, null, ["健身"]),
    mk("2026-08-15", null, null), // 无 tags 字段不计入
  ];
  // 降序：工作 2 第一；健身/生活并列 1，按名称升序（'健' < '生'）
  assert.deepEqual(Stats.tagCounts(records, null), [
    { name: "工作", count: 2 },
    { name: "健身", count: 1 },
    { name: "生活", count: 1 },
  ]);
});

test("tagCounts：范围过滤", () => {
  const records = [
    mk("2026-08-11", null, null, ["工作", "生活"]),
    mk("2026-08-12", null, null, ["工作"]),
    mk("2026-08-14", null, null, ["健身"]), // 范围外
  ];
  assert.deepEqual(
    Stats.tagCounts(records, { start: "2026-08-11", end: "2026-08-12" }),
    [
      { name: "工作", count: 2 },
      { name: "生活", count: 1 },
    ]
  );
});

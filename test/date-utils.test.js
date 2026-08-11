/**
 * date-utils.test.js —— DateUtils 单元测试（node:test）
 *
 * 运行：node --test test/   （或 node --test test/date-utils.test.js）
 * 覆盖：格式化/解析往返、时段推断边界、日期加减跨月跨年、天数差、
 *       星期、月份标签、日历网格（周起始对齐 + inMonth 标记）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateUtils } from "../js/pure/date-utils.js";

// ---------- formatDate / formatTime / parseDate ----------

test("formatDate 输出 YYYY-MM-DD", () => {
  assert.equal(DateUtils.formatDate(new Date(2024, 4, 28)), "2024-05-28");
  assert.equal(DateUtils.formatDate(new Date(2024, 0, 5)), "2024-01-05");
  assert.equal(DateUtils.formatDate(new Date(2023, 11, 31)), "2023-12-31");
});

test("formatTime 输出 HH:mm（补零）", () => {
  assert.equal(DateUtils.formatTime(new Date(2024, 4, 28, 9, 5)), "09:05");
  assert.equal(DateUtils.formatTime(new Date(2024, 4, 28, 23, 59)), "23:59");
  assert.equal(DateUtils.formatTime(new Date(2024, 4, 28, 0, 0)), "00:00");
});

test("parseDate 本地时区解析", () => {
  const d = DateUtils.parseDate("2024-05-28");
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 4); // 0 基
  assert.equal(d.getDate(), 28);
});

test("parseDate 与 formatDate 往返一致", () => {
  const samples = ["2024-05-28", "2023-12-31", "2024-01-01", "2024-02-29"];
  for (const s of samples) {
    assert.equal(DateUtils.formatDate(DateUtils.parseDate(s)), s);
  }
});

test("parseDate 非法输入返回 null", () => {
  assert.equal(DateUtils.parseDate("2024-5-28"), null);
  assert.equal(DateUtils.parseDate("2024/05/28"), null);
  assert.equal(DateUtils.parseDate("abc"), null);
  assert.equal(DateUtils.parseDate(null), null);
});

// ---------- inferPeriod 边界 ----------

test("inferPeriod 边界：morning 05:00-11:59", () => {
  assert.equal(DateUtils.inferPeriod("05:00"), "morning");
  assert.equal(DateUtils.inferPeriod("11:59"), "morning");
});

test("inferPeriod 边界：afternoon 12:00-16:59", () => {
  assert.equal(DateUtils.inferPeriod("12:00"), "afternoon");
  assert.equal(DateUtils.inferPeriod("16:59"), "afternoon");
});

test("inferPeriod 边界：evening 17:00-次日04:59（跨午夜）", () => {
  assert.equal(DateUtils.inferPeriod("17:00"), "evening");
  assert.equal(DateUtils.inferPeriod("23:59"), "evening");
  assert.equal(DateUtils.inferPeriod("00:00"), "evening");
  assert.equal(DateUtils.inferPeriod("04:59"), "evening");
});

test("inferPeriod 非法/空输入返回 null", () => {
  assert.equal(DateUtils.inferPeriod(null), null);
  assert.equal(DateUtils.inferPeriod(""), null);
  assert.equal(DateUtils.inferPeriod("24:00"), null);
  assert.equal(DateUtils.inferPeriod("5:00"), null);
  assert.equal(DateUtils.inferPeriod("abc"), null);
  assert.equal(DateUtils.inferPeriod(undefined), null);
});

// ---------- addDays ----------

test("addDays 跨月", () => {
  assert.equal(DateUtils.addDays("2024-01-31", 1), "2024-02-01");
  assert.equal(DateUtils.addDays("2024-02-01", -1), "2024-01-31");
});

test("addDays 跨年", () => {
  assert.equal(DateUtils.addDays("2023-12-31", 1), "2024-01-01");
  assert.equal(DateUtils.addDays("2024-01-01", -1), "2023-12-31");
});

test("addDays 闰年与负数", () => {
  assert.equal(DateUtils.addDays("2024-03-01", -1), "2024-02-29"); // 2024 闰年
  assert.equal(DateUtils.addDays("2024-05-28", 0), "2024-05-28");
  assert.equal(DateUtils.addDays("2024-05-28", -28), "2024-04-30");
  assert.equal(DateUtils.addDays("2024-05-28", 100), "2024-09-05");
});

// ---------- getDaysBetween ----------

test("getDaysBetween 正负方向", () => {
  assert.equal(DateUtils.getDaysBetween("2024-05-28", "2024-05-20"), 8);
  assert.equal(DateUtils.getDaysBetween("2024-05-20", "2024-05-28"), -8);
  assert.equal(DateUtils.getDaysBetween("2024-05-28", "2024-05-28"), 0);
});

test("getDaysBetween 跨月跨年", () => {
  assert.equal(DateUtils.getDaysBetween("2024-01-01", "2023-12-31"), 1);
  assert.equal(DateUtils.getDaysBetween("2024-03-01", "2024-02-01"), 29); // 闰年 2 月
});

// ---------- getWeekday ----------

test("getWeekday 周一=1 ... 周日=7", () => {
  assert.equal(DateUtils.getWeekday("2024-05-27"), 1); // 周一
  assert.equal(DateUtils.getWeekday("2024-05-28"), 2); // 周二
  assert.equal(DateUtils.getWeekday("2024-05-29"), 3); // 周三
  assert.equal(DateUtils.getWeekday("2024-05-30"), 4); // 周四
  assert.equal(DateUtils.getWeekday("2024-05-31"), 5); // 周五
  assert.equal(DateUtils.getWeekday("2024-06-01"), 6); // 周六
  assert.equal(DateUtils.getWeekday("2024-05-26"), 7); // 周日
});

// ---------- getMonthLabel ----------

test("getMonthLabel", () => {
  assert.equal(DateUtils.getMonthLabel("2024-05"), "2024年5月");
  assert.equal(DateUtils.getMonthLabel("2024-12"), "2024年12月");
  assert.equal(DateUtils.getMonthLabel("2023-01"), "2023年1月");
});

// ---------- monthMatrix ----------

test("monthMatrix 2024-05 monday 起始：第一格为 2024-04-29", () => {
  const m = DateUtils.monthMatrix(2024, 5, "monday");
  assert.equal(m.year, 2024);
  assert.equal(m.month, 5);
  // 网格总格数为整周
  assert.equal(m.days.length % 7, 0);
  // 2024-05-01 是周三，周一起始时月初前补 2 格（4-29、4-30）
  assert.equal(m.days[0].date, "2024-04-29");
  assert.equal(m.days[0].inMonth, false);
  assert.equal(m.days[1].date, "2024-04-30");
  assert.equal(m.days[1].inMonth, false);
  // 本月 1 号位于第 3 格
  assert.equal(m.days[2].date, "2024-05-01");
  assert.equal(m.days[2].day, 1);
  assert.equal(m.days[2].inMonth, true);
  // 末尾补位为下月（inMonth=false）
  assert.equal(m.days[m.days.length - 1].inMonth, false);
  assert.ok(m.days[m.days.length - 1].date.startsWith("2024-06-"));
});

test("monthMatrix 2024-05 sunday 起始：第一格为 2024-04-28", () => {
  const m = DateUtils.monthMatrix(2024, 5, "sunday");
  assert.equal(m.days.length % 7, 0);
  // 周日起始时月初前补 3 格（4-28、4-29、4-30）
  assert.equal(m.days[0].date, "2024-04-28");
  assert.equal(m.days[0].inMonth, false);
  assert.equal(m.days[1].date, "2024-04-29");
  assert.equal(m.days[2].date, "2024-04-30");
  // 本月 1 号位于第 4 格
  assert.equal(m.days[3].date, "2024-05-01");
  assert.equal(m.days[3].inMonth, true);
});

test("monthMatrix inMonth 标记正确（2024-02 闰月 29 天）", () => {
  const m = DateUtils.monthMatrix(2024, 2, "monday");
  const inMonthDays = m.days.filter((d) => d.inMonth);
  assert.equal(inMonthDays.length, 29);
  assert.equal(inMonthDays[0].date, "2024-02-01");
  assert.equal(inMonthDays[28].date, "2024-02-29");
  // 补位格子全部 inMonth=false
  const outMonthDays = m.days.filter((d) => !d.inMonth);
  assert.ok(outMonthDays.length > 0);
  assert.ok(outMonthDays.every((d) => !d.inMonth));
  // day 字段与 date 的日部分一致
  for (const d of m.days) {
    assert.equal(d.day, Number(d.date.slice(8, 10)));
  }
});

test("monthMatrix 默认 weekStart 为 monday", () => {
  const m = DateUtils.monthMatrix(2024, 5);
  assert.equal(m.days[0].date, "2024-04-29");
});

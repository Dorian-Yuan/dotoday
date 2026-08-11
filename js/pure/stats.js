/**
 * stats.js —— 统计计算纯逻辑模块（DoToday v0.3.0 预实现）
 *
 * 纯逻辑模块：仅依赖 js/pure/date-utils.js，无浏览器 / Node 专属 API，
 * 可在 Node 下直接运行单元测试（node --test）。
 *
 * 接口定义见计划文档 6.1 节 stats 部分：
 *   getStats / monthlyCounts / trendCounts / ratingDistribution
 *   heatmapData / weekdayDistribution / periodDistribution / tagCounts
 *
 * 记录结构（计划文档 2.1）：{ date:"YYYY-MM-DD", time:"HH:mm"|null,
 *   rating:1-5|null, note, tags:[] }；所有函数接收 records 数组与可选 range。
 */
import { DateUtils } from "./date-utils.js";

/**
 * 范围过滤辅助（内部）：
 * range 为 null 或缺少 start/end 时视为全部记录；
 * YYYY-MM-DD 字符串比较即时间序，含边界。
 */
function inRange(records, range) {
  if (!range || !range.start || !range.end) return (records || []).slice();
  const { start, end } = range;
  return (records || []).filter(
    (r) => r && typeof r.date === "string" && r.date >= start && r.date <= end
  );
}

/**
 * getStats(records, range) → 时间段概览统计
 * range: {start, end}（YYYY-MM-DD 含边界）或 null（全部）
 *
 * 返回 { total, changePct, lastDays, avgRating }：
 *   - total：范围内记录数
 *   - changePct：当前范围 vs 上一等长时段（与当前范围天数相同的紧邻前一区间）
 *     的百分比变化（整数，如 -40；"全部"或无上一时段 → null）
 *   - lastDays：范围内最近一条记录日期 → 今天（todayStr）的天数差
 *     （plan 2.2「距离上一次」语义，与 range.end 无关）；今天有记录 = 0；无记录 → null
 *   - avgRating：有评分记录的平均分（保留 1 位小数，四舍五入）；无评分 → null
 */
function getStats(records, range) {
  const list = inRange(records, range);
  const total = list.length;

  // 环比：上一等长时段 = 与当前范围天数相同、紧邻其前的区间
  let changePct = null;
  if (range && range.start && range.end) {
    const days = DateUtils.getDaysBetween(range.end, range.start) + 1; // 当前范围天数
    const prevEnd = DateUtils.addDays(range.start, -1); // 上一区间终点 = 当前起点前一天
    const prevStart = DateUtils.addDays(prevEnd, -(days - 1)); // 上一区间起点
    const prevCount = inRange(records, { start: prevStart, end: prevEnd }).length;
    // 上一时段 0 条记录时无法计算百分比（除零），返回 null 由 UI 处理
    if (prevCount > 0) {
      changePct = Math.round(((total - prevCount) / prevCount) * 100);
    }
  }

  // 距上次天数（plan 2.2 语义）：范围内最近一条记录日期 → 今天 的天数差
  let lastDays = null;
  let maxDate = null;
  for (const r of list) {
    if (r && typeof r.date === "string" && (!maxDate || r.date > maxDate)) {
      maxDate = r.date;
    }
  }
  if (maxDate) {
    // 「最近记录日期 → 今天」的天数差（今天有记录 = 0）
    lastDays = DateUtils.getDaysBetween(DateUtils.todayStr(), maxDate);
  }

  // 平均评分：仅统计 rating 为数字的记录（null 无评分不计入分母）
  let avgRating = null;
  const rated = list.filter((r) => r && typeof r.rating === "number");
  if (rated.length > 0) {
    const sum = rated.reduce((s, r) => s + r.rating, 0);
    // 保留 1 位小数（四舍五入）
    avgRating = Math.round((sum / rated.length) * 10) / 10;
  }

  return { total, changePct, lastDays, avgRating };
}

/**
 * monthlyCounts(records, range) → 柱状图数据：按月次数 [{ym, count}]（ym 升序）
 * ym 为 "YYYY-MM"（date 前 7 位）。
 */
function monthlyCounts(records, range) {
  const map = new Map();
  for (const r of inRange(records, range)) {
    if (!r || typeof r.date !== "string") continue;
    const ym = r.date.slice(0, 7);
    map.set(ym, (map.get(ym) || 0) + 1);
  }
  return [...map.entries()]
    .map(([ym, count]) => ({ ym, count }))
    .sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0)); // 升序（字典序=时间序）
}

/**
 * trendCounts(records, range) → 折线图数据：按月频率趋势
 * 与 monthlyCounts 同构（[{ym, count}]，升序）。
 */
function trendCounts(records, range) {
  return monthlyCounts(records, range);
}

/**
 * ratingDistribution(records, range) → 环形图数据：评分分布
 * 只统计 rating 非 null 的记录，输出固定 1-5 顺序，count 为 0 的段也包含。
 */
function ratingDistribution(records, range) {
  const counts = new Map([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  for (const r of inRange(records, range)) {
    if (
      r &&
      typeof r.rating === "number" &&
      r.rating >= 1 &&
      r.rating <= 5 // 越界脏数据忽略
    ) {
      counts.set(r.rating, counts.get(r.rating) + 1);
    }
  }
  return [1, 2, 3, 4, 5].map((rating) => ({ rating, count: counts.get(rating) }));
}

/**
 * heatmapData(records, months) → 热力图数据：近 N 个月（含当月）每日次数
 * 时间范围：从 (months-1) 个月前第一天 → 今天（含）；
 * 输出 [{date:"YYYY-MM-DD", count}] 按日期升序；
 * 无记录的日期不输出（UI 端补 0 渲染）。
 */
function heatmapData(records, months = 6) {
  const now = new Date();
  // 起始日期：(months-1) 个月前第一天（new Date 自动跨年进位）
  const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const start = DateUtils.formatDate(startDate);
  const end = DateUtils.todayStr();

  const map = new Map();
  for (const r of records || []) {
    if (!r || typeof r.date !== "string") continue;
    if (r.date < start || r.date > end) continue; // 超出近 N 个月范围
    map.set(r.date, (map.get(r.date) || 0) + 1);
  }
  return [...map.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * weekdayDistribution(records, range) → 星期分布
 * 输出 [{weekday:1,count}, ... weekday:7]（1=周一 ... 7=周日，固定顺序，0 计数包含）。
 */
function weekdayDistribution(records, range) {
  const counts = new Map([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
    [6, 0],
    [7, 0],
  ]);
  for (const r of inRange(records, range)) {
    if (!r || typeof r.date !== "string") continue;
    const wd = DateUtils.getWeekday(r.date); // 1-7；非法日期返回 null
    if (wd !== null) counts.set(wd, counts.get(wd) + 1);
  }
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    count: counts.get(weekday),
  }));
}

/**
 * periodDistribution(records, range) → 时段分布
 * 用 DateUtils.inferPeriod(r.time) 推断（规则见计划文档 2.1）：
 *   早 05:00-11:59 / 午 12:00-16:59 / 晚 17:00-次日04:59；
 *   time 为 null 或非法 → "none"（未记录时段）。
 * 输出固定顺序：morning / afternoon / evening / none。
 */
function periodDistribution(records, range) {
  const counts = { morning: 0, afternoon: 0, evening: 0, none: 0 };
  for (const r of inRange(records, range)) {
    if (!r) continue;
    const period = DateUtils.inferPeriod(r.time); // null | "morning"|"afternoon"|"evening"
    if (period === null) counts.none += 1;
    else counts[period] += 1;
  }
  return [
    { period: "morning", count: counts.morning },
    { period: "afternoon", count: counts.afternoon },
    { period: "evening", count: counts.evening },
    { period: "none", count: counts.none },
  ];
}

/**
 * tagCounts(records, range) → 标签次数统计
 * 同一记录多个标签各计 1 次；同名标签合并；无标签记录不计入；
 * 输出 [{name, count}] 按次数降序（同次数按名称升序）。
 */
function tagCounts(records, range) {
  const map = new Map();
  for (const r of inRange(records, range)) {
    if (!r || !Array.isArray(r.tags) || r.tags.length === 0) continue;
    for (const tag of r.tags) {
      map.set(tag, (map.get(tag) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count; // 次数降序
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; // 同次数按名称升序
    });
}

/** 统一导出对象（接口见计划文档 6.1） */
export const Stats = {
  getStats,
  monthlyCounts,
  trendCounts,
  ratingDistribution,
  heatmapData,
  weekdayDistribution,
  periodDistribution,
  tagCounts,
};

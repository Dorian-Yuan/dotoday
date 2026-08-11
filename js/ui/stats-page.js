/**
 * stats-page.js —— 统计页（DoToday v0.4.8）
 *
 * 时间范围（默认本月，快捷 本周/本月/本年/全部 + 自定义日期范围）联动：
 * 4 张概览卡片 + 手写 SVG 图表（柱状/折线/环形/热力图/星期/时段/标签排行）。
 * 单月范围隐藏按月图；图表自动压缩适配宽度；点击数据点 → 图中铅笔手绘风 tooltip。
 * 热力图默认近 1 年按周、可切换年份；统计页独立容器滚动。
 * 依赖 Stats（js/pure/stats.js）：动态加载，未就绪时 UI 降级为空态。
 */

import { $, $$, esc } from "./common.js";
import { DateUtils } from "../pure/date-utils.js";
import { DataModule } from "../data.js";
import { getPref } from "../config.js";
import { ICONS } from "../icon-config.js";
import { openDateRangePicker } from "./date-range-picker.js";

/* ============ Stats 动态加载（防御） ============ */
let Stats = null;
let statsReady = false;

async function loadStats() {
  try {
    const mod = await import("../pure/stats.js");
    Stats = mod.Stats;
    statsReady = true;
  } catch (e) {
    Stats = null;
    statsReady = false;
  }
}

function call(name, ...args) {
  return statsReady && Stats && typeof Stats[name] === "function" ? Stats[name](...args) : null;
}

/* ============ 范围状态 ============ */
let rangeKey = "month"; // week / month / year / all / custom
let customStart = "";
let customEnd = "";

function dateCN(d) {
  const x = DateUtils.parseDate(d);
  return x ? `${x.getMonth() + 1}月${x.getDate()}日` : d;
}

function computeRange() {
  const today = DateUtils.todayStr();
  const now = new Date();
  switch (rangeKey) {
    case "week": {
      const ws = getPref("weekStartDay") === "sunday" ? 0 : 1;
      const diff = (now.getDay() - ws + 7) % 7;
      const start = DateUtils.addDays(today, -diff);
      return { start, end: today, label: `${dateCN(start)} - ${dateCN(today)}` };
    }
    case "month": {
      const start = DateUtils.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      return { start, end: today, label: `${now.getFullYear()}年${now.getMonth() + 1}月` };
    }
    case "year":
      return { start: `${now.getFullYear()}-01-01`, end: today, label: `${now.getFullYear()}年` };
    case "all":
      return { start: null, end: null, label: "全部时间" };
    default:
      return { start: customStart, end: customEnd, label: `${dateCN(customStart)} - ${dateCN(customEnd)}` };
  }
}

function statsRange(range) {
  return rangeKey === "all" ? null : { start: range.start, end: range.end };
}

/* ============ SVG 工具 ============ */
function labelStep(n) {
  return n > 14 ? 3 : n > 8 ? 2 : 1;
}

function ymLabel(ym) {
  return Number(ym.slice(5)) + "月";
}

function svgWrap(inner, w, h) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">${inner}</svg>`;
}

function chartEmptyHtml(text = "无数据") {
  return `<div class="chart-empty">${esc(text)}</div>`;
}

/* ============ 图表 tooltip 组件（铅笔手绘风，点击位置附近，防溢出） ============ */
let tooltipEl = null;

function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "chart-tooltip";
    tooltipEl.id = "chart-tooltip";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showTooltip(e, html) {
  const el = ensureTooltip();
  el.innerHTML = html;
  el.hidden = false;
  const pad = 10;
  const tw = el.offsetWidth, th = el.offsetHeight;
  let x = e.clientX + 12, y = e.clientY + 12;
  if (x + tw > window.innerWidth - pad) x = e.clientX - tw - 12;
  if (y + th > window.innerHeight - pad) y = e.clientY - th - 12;
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.classList.remove("show");
    setTimeout(() => {
      tooltipEl.hidden = true;
    }, 150);
  }
}

/* ============ 概览卡片（4 张） ============ */
function renderCards(records, range) {
  const wrap = $("#stats-cards");
  const st = call("getStats", records, statsRange(range));
  const total = st && typeof st.total === "number" ? st.total : records.length;
  let changeText = "—";
  if (st && st.changePct !== null && st.changePct !== undefined) {
    const v = st.changePct;
    changeText = v > 0 ? `↑ ${v}%` : v < 0 ? `↓ ${Math.abs(v)}%` : "持平";
  }
  let lastText = "—";
  if (st && st.lastDays !== null && st.lastDays !== undefined) {
    lastText = st.lastDays === 0 ? "今天" : `${st.lastDays} 天`;
  }
  let avgText = "—";
  if (st && typeof st.avgRating === "number") avgText = st.avgRating.toFixed(1);
  const cards = [
    { label: "总次数", value: String(total), hint: range.label },
    { label: "环比", value: changeText, hint: rangeKey === "all" ? "全部时间" : "较上一时段" },
    { label: "距上次", value: lastText, hint: "有记录以来" },
    { label: "平均评分", value: avgText, hint: "满分 5 星" },
  ];
  wrap.innerHTML = cards
    .map(
      (c) => `<div class="stat-card">
        <span class="stat-card-value">${esc(c.value)}</span>
        <span class="stat-card-label">${esc(c.label)}</span>
        <span class="stat-card-hint">${esc(c.hint)}</span>
      </div>`
    )
    .join("");
}

/* ============ 柱状图（按月次数，自动压缩 + y 轴刻度） ============ */
function yTicksHtml(max, H, PT, PB, PL, plotW) {
  const ticks = [0, Math.round(max / 2), max];
  const plotH = H - PT - PB;
  let html = "";
  ticks.forEach((v) => {
    const y = H - PB - (v / max) * plotH;
    html += `<line class="y-grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + plotW}" y2="${y.toFixed(1)}"/>
      <text class="y-label" x="${PL - 5}" y="${(y + 3).toFixed(1)}">${v}</text>`;
  });
  return html;
}

function renderMonthlyChart(records, range) {
  const el = $("#chart-monthly");
  const data = call("monthlyCounts", records, statsRange(range));
  if (!data || !data.length) {
    el.innerHTML = chartEmptyHtml();
    el.dataset.chartType = "monthly";
    return;
  }
  const W = 320, H = 150, PL = 30, PR = 30, PT = 10, PB = 24;
  const plotW = W - PL - PR;
  const n = data.length;
  const max = Math.max(...data.map((d) => d.count), 1);
  const barW = Math.min(30, Math.max(4, (plotW / n) * 0.6));
  const stepX = plotW / n;
  const step = labelStep(n);
  let bars = "";
  data.forEach((d, i) => {
    const x = PL + i * stepX + (stepX - barW) / 2;
    const h = (d.count / max) * (H - PT - PB);
    const y = H - PB - h;
    bars += `<g class="chart-click" data-index="${i}">
      <rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}"/>
      ${i % step === 0 ? `<text class="axis-label" x="${(x + barW / 2).toFixed(1)}" y="${H - 8}">${ymLabel(d.ym)}</text>` : ""}
    </g>`;
  });
  el.innerHTML = svgWrap(
    `<rect class="grid-line" x="${PL}" y="${PT}" width="${plotW}" height="${H - PT - PB}"/>
     ${yTicksHtml(max, H, PT, PB, PL, plotW)}
     ${bars}`,
    W, H
  );
  el.dataset.chartType = "monthly";
}

/* ============ 折线图（按月趋势，与柱状图同粒度 + y 轴刻度） ============ */
function renderTrendChart(records, range) {
  const el = $("#chart-trend");
  const data = call("trendCounts", records, statsRange(range));
  if (!data || !data.length) {
    el.innerHTML = chartEmptyHtml();
    el.dataset.chartType = "trend";
    return;
  }
  const W = 320, H = 150, PL = 30, PR = 30, PT = 14, PB = 24;
  const plotW = W - PL - PR;
  const n = data.length;
  const max = Math.max(...data.map((d) => d.count), 1);
  const stepX = plotW / (n > 1 ? n - 1 : 1);
  const step = labelStep(n);
  const r = n > 14 ? 2 : 3;
  const pts = data.map((d, i) => {
    const x = PL + i * stepX;
    const y = H - PB - (d.count / max) * (H - PT - PB);
    return { x, y, i };
  });
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  let dots = "";
  pts.forEach((p) => {
    dots += `<g class="chart-click" data-index="${p.i}">
      <circle class="point" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"/>
      ${p.i % step === 0 ? `<text class="axis-label" x="${p.x.toFixed(1)}" y="${H - 8}">${ymLabel(data[p.i].ym)}</text>` : ""}
    </g>`;
  });
  el.innerHTML = svgWrap(
    `${yTicksHtml(max, H, PT, PB, PL, plotW)}
     <polyline class="trend-line" points="${line}"/>${dots}`,
    W, H
  );
  el.dataset.chartType = "trend";
}

/* ============ 水平堆叠条通用组件（评分分布 / 时段分布共用） ============ */
/**
 * stackBarHtml(rows, dataKey) → 100% 水平堆叠条 + 一行图例
 * rows: [{ key, label, count, color, gray? }]（key 写入 data-{dataKey}，点击取回）
 * 段宽按占比；0 次段为最小可见淡色段；gray 段（未记录）用灰阶弱化区分。
 */
function stackBarHtml(rows, dataKey) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  let bar = "";
  rows.forEach((r) => {
    const pct = (r.count / total) * 100;
    const cls = `chart-click stack-seg${r.count > 0 ? "" : " zero"}${r.gray ? " pd-none" : ""}`;
    const bg = !r.gray && r.color ? `background:${r.color}` : "";
    bar += `<div class="${cls}" data-${dataKey}="${r.key}" style="width:${pct.toFixed(2)}%;${bg}"></div>`;
  });
  let legend = "";
  rows.forEach((r) => {
    const sw = r.count > 0 ? (r.gray ? "var(--text-muted)" : r.color) : "var(--line-soft)";
    legend += `<span class="chart-click stack-legend-item" data-${dataKey}="${r.key}" title="${r.label} · ${r.count} 次">
      <i class="stack-swatch" style="background:${sw}${r.gray && r.count > 0 ? ";opacity:.6" : ""}"></i>
      <span>${r.label}</span><em>${r.count}次</em>
    </span>`;
  });
  return `<div class="stack-bar-wrap">
    <div class="stack-bar">${bar}</div>
    <div class="stack-legend">${legend}</div>
  </div>`;
}

/* ============ 评分分布（1-5 星水平堆叠条，长方形卡片友好） ============ */
function renderRatingChart(records, range) {
  const el = $("#chart-rating");
  const data = call("ratingDistribution", records, statsRange(range));
  if (!data) {
    el.innerHTML = chartEmptyHtml();
    el.dataset.chartType = "rating";
    return;
  }
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) {
    el.innerHTML = chartEmptyHtml("暂无评分记录");
    el.dataset.chartType = "rating";
    return;
  }
  // 5 档图表色阶（1 星最浅 → 5 星最深，由设置页"图表配色"主色生成）
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
  const rows = data.map((d, i) => ({
    key: d.rating,
    label: `${d.rating}星`,
    count: d.count,
    color: colors[i % colors.length],
  }));
  el.innerHTML = stackBarHtml(rows, "rating");
  el.dataset.chartType = "rating";
  el.dataset.ratingTotal = String(total);
}

/* ============ 日历热力图（近 1 年 52 格每周一格；年份自定义；格子 tooltip） ============ */
let heatMode = "recent"; // "recent"（近1年）| "year-YYYY"（指定年）
let heatYear = new Date().getFullYear();

function dateCNFull(ds) {
  const d = DateUtils.parseDate(ds);
  return d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : ds;
}

/** 判断一周区间（周一 start ~ 周日 end）是否包含某月 1 号，返回月份数字或 null */
function month1InWeek(w) {
  const m1 = new Date(w.start.getFullYear(), w.start.getMonth(), 1);
  if (m1 >= w.start && m1 <= w.end) return m1.getMonth() + 1;
  const m2 = new Date(w.end.getFullYear(), w.end.getMonth(), 1);
  if (m2 > m1 && m2 >= w.start && m2 <= w.end) return m2.getMonth() + 1;
  return null;
}

function renderHeatmap() {
  const el = $("#chart-heatmap");
  const records = DataModule.getAllRecords();
  const now = new Date();
  // 周起始（跟随应用配置 weekStartDay，与日历一致）；起点 = 本周起始日往前 51 周
  const ws = getPref("weekStartDay") === "sunday" ? 0 : 1; // Date.getDay() 基准：0=周日
  const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() - ws + 7) % 7));
  let rangeStart, weeksCount = 52;
  if (heatMode === "recent") {
    rangeStart = new Date(thisWeekStart.getFullYear(), thisWeekStart.getMonth(), thisWeekStart.getDate() - 51 * 7);
  } else {
    const jan1 = new Date(heatYear, 0, 1);
    rangeStart = new Date(heatYear, 0, 1 - ((jan1.getDay() - ws + 7) % 7));
  }
  // 52 个自然周（每周 = 周起始日起 7 天），聚合周计数；最后一周 = 本周
  const weeks = [];
  for (let i = 0; i < weeksCount; i++) {
    const wsD = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + i * 7);
    const we = new Date(wsD.getFullYear(), wsD.getMonth(), wsD.getDate() + 6);
    weeks.push({ start: wsD, end: we, count: 0 });
  }
  const week0 = weeks[0].start.getTime();
  const DAY = 86400000;
  for (const r of records) {
    const rd = DateUtils.parseDate(r.date);
    if (!rd) continue;
    const idx = Math.floor((rd.getTime() - week0) / DAY / 7);
    if (idx >= 0 && idx < weeks.length) weeks[idx].count++;
  }
  // 布局：11 列 × 5 行，按列填充（第 1 列 = 第 1-5 周（最早）… 第 11 列 = 第 51-52 周 + 3 空位；
  // 按列从上到下为旧到新、按行从左到右为旧到新）
  const cols = 11, rows = 5;
  const gap = 4, cell = 24; // 每列 28px，11 列 = 304px
  const side = 6;           // 左右对称留白（viewBox 内）
  const gridW = cols * (cell + gap) - gap;
  const W = gridW + side * 2;
  const H = 10 + rows * (cell + gap) - gap + 10;
  let cells = "";
  for (let i = 0; i < cols * rows; i++) {
    const col = Math.floor(i / rows), row = i % rows; // 列优先填充
    const x = side + col * (cell + gap);
    const y = 8 + row * (cell + gap);
    const w = weeks[i];
    if (!w) {
      // 空位（第 11 列末尾 3 格）：淡色占位格，保持网格规整
      cells += `<rect class="heat h0" x="${x}" y="${y}" width="${cell}" height="${cell}"/>`;
      continue;
    }
    const c = w.count;
    const lvl = c === 0 ? "h0" : c === 1 ? "h1" : c <= 3 ? "h2" : "h3";
    cells += `<rect class="chart-click heat ${lvl}" data-start="${DateUtils.formatDate(w.start)}" data-end="${DateUtils.formatDate(w.end)}" data-count="${c}" x="${x}" y="${y}" width="${cell}" height="${cell}"/>`;
    // 格内月份数字：该周区间包含某月 1 号时，在格内显示该月数字（对比色）
    const mn = month1InWeek(w);
    if (mn) {
      const onDark = lvl === "h3";
      cells += `<text class="heat-month${onDark ? " on-dark" : ""}" x="${x + cell / 2}" y="${y + cell / 2 + 4}">${mn}</text>`;
    }
  }
  // 极简图例（少 → 多）
  const legend = `<div class="heat-legend">少
    <span class="heat-lv h0"></span><span class="heat-lv h1"></span>
    <span class="heat-lv h2"></span><span class="heat-lv h3"></span> 多</div>`;
  el.innerHTML = svgWrap(cells, W, H) + legend;
  el.dataset.chartType = "heatmap";
  $("#heatmap-switch .chip").textContent = heatMode === "recent" ? "近1年" : `${heatYear}年`;
}

function openHeatmapYearPicker() {
  const yearNow = new Date().getFullYear();
  const opts = [{ mode: "recent", label: "近1年" }];
  for (let y = yearNow; y >= yearNow - 3; y--) opts.push({ mode: "year-" + y, label: `${y}年` });
  $("#hy-options").innerHTML = opts
    .map((o) => `<button type="button" class="hy-opt${heatMode === o.mode ? " on" : ""}" data-mode="${o.mode}">${o.label}</button>`)
    .join("");
  $("#hy-mask").hidden = false;
  $("#hy-picker").hidden = false;
  requestAnimationFrame(() => {
    $("#hy-mask").classList.add("open");
    $("#hy-picker").classList.add("open");
  });
}

function closeHeatmapYearPicker() {
  $("#hy-mask").classList.remove("open");
  $("#hy-picker").classList.remove("open");
  setTimeout(() => {
    $("#hy-mask").hidden = true;
    $("#hy-picker").hidden = true;
  }, 220);
}

/* ============ 星期分布（周一~周日柱状） ============ */
function renderWeekdayChart(records, range) {
  const el = $("#chart-weekday");
  const data = call("weekdayDistribution", records, statsRange(range));
  if (!data || !data.length) {
    el.innerHTML = chartEmptyHtml();
    el.dataset.chartType = "weekday";
    return;
  }
  const W = 320, H = 150, PL = 30, PR = 8, PT = 10, PB = 24;
  const plotW = W - PL - PR;
  const max = Math.max(...data.map((d) => d.count), 1);
  const barW = Math.min(30, Math.max(4, (plotW / 7) * 0.6));
  const stepX = plotW / 7;
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  let bars = "";
  data.forEach((d, i) => {
    const x = PL + i * stepX + (stepX - barW) / 2;
    const h = (d.count / max) * (H - PT - PB);
    const y = H - PB - h;
    bars += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}"/>
      <text class="axis-label" x="${(x + barW / 2).toFixed(1)}" y="${H - 8}">${labels[d.weekday - 1] || "?"}</text>`;
  });
  el.innerHTML = svgWrap(bars, W, H);
  el.dataset.chartType = "weekday";
}

/* ============ 时段分布（早/午/晚/未记录 → 水平堆叠条，复用堆叠条组件） ============ */
function renderPeriodChart(records, range) {
  const el = $("#chart-period");
  const data = call("periodDistribution", records, statsRange(range));
  if (!data || !data.length) {
    el.innerHTML = chartEmptyHtml();
    el.dataset.chartType = "period";
    return;
  }
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) {
    el.innerHTML = chartEmptyHtml("暂无时段记录");
    el.dataset.chartType = "period";
    return;
  }
  // 4 档：早/午/晚 图表色阶三档 + 未记录灰阶（--text-muted 弱化区分）
  const labels = { morning: "早", afternoon: "午", evening: "晚", none: "未记录" };
  const colors = { morning: "var(--chart-1)", afternoon: "var(--chart-2)", evening: "var(--chart-3)" };
  const rows = data.map((d) => ({
    key: d.period,
    label: labels[d.period] || d.period,
    count: d.count,
    color: colors[d.period] || "",
    gray: d.period === "none",
  }));
  el.innerHTML = stackBarHtml(rows, "period");
  el.dataset.chartType = "period";
  el.dataset.periodTotal = String(total);
}

/* ============ 标签排行（行式布局：色点 + 固定宽标签列 + 次数/占比 + 独立比例条，标签自带颜色） ============ */
function renderTagChart(records, range) {
  const el = $("#chart-tags");
  const data = call("tagCounts", records, statsRange(range));
  if (!data || !data.length) {
    el.innerHTML = chartEmptyHtml("暂无标签记录");
    el.dataset.chartType = "tags";
    return;
  }
  const total = data.reduce((s, d) => s + d.count, 0);
  // 名称列宽按最长标签自适应（上限 140px；超长省略号，title 完整可读）
  const maxLen = Math.max(...data.map((d) => d.name.length));
  const nameColW = Math.min(140, Math.max(40, maxLen * 13 + 6));
  const rows = data.map((d) => {
    // 标签自带颜色（与记录页 tagColor 同模式：getTags().find(name).color）；标签已删除则回退铅笔红
    const t = DataModule.getTags().find((x) => x.name === d.name);
    const color = t ? t.color : "var(--accent)";
    const pct = total ? Math.round((d.count / total) * 100) : 0;
    return `<div class="chart-click tag-row" data-tag="${esc(d.name)}" title="${esc(d.name)}">
      <i class="tag-row-dot" style="background:${color}"></i>
      <span class="tag-row-name" style="width:${nameColW}px">${esc(d.name)}</span>
      <span class="tag-row-meta">${d.count}次 · ${pct}%</span>
      <span class="tag-row-bar"><i style="width:${pct}%;background:${color}"></i></span>
    </div>`;
  });
  el.innerHTML = `<div class="tag-list">${rows.join("")}</div>`;
  el.dataset.chartType = "tags";
}

/* ============ 图表区渲染 ============ */
function renderCharts(records, range, singleMonth) {
  if (!singleMonth) {
    renderMonthlyChart(records, range);
    renderTrendChart(records, range);
  }
  renderRatingChart(records, range);
  renderHeatmap();
  renderWeekdayChart(records, range);
  renderPeriodChart(records, range);
  renderTagChart(records, range);
}

/* ============ 主流程 ============ */
export function renderStatsPage() {
  const records = DataModule.getAllRecords();
  const range = computeRange();
  $("#stats-range-label").textContent = range.label;
  $$("#range-chips .chip").forEach((c) => c.classList.toggle("on", c.dataset.range === rangeKey));
  const singleMonth = rangeKey !== "all" && range.start && range.end && range.start.slice(0, 7) === range.end.slice(0, 7);
  $('[data-chart="monthly"]').hidden = singleMonth;
  $('[data-chart="trend"]').hidden = singleMonth;

  const empty = $("#stats-empty");
  if (!records.length) {
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-art" aria-hidden="true">${ICONS.chart}</div>
      <p class="empty-title">还没有可统计的记录</p>
      <p class="empty-desc">去记录页添加第一条记录吧</p>`;
    $("#stats-cards").innerHTML = "";
    $("#stats-charts").hidden = true;
    return;
  }
  empty.hidden = true;
  $("#stats-charts").hidden = false;
  renderCards(records, range);
  renderCharts(records, range, singleMonth);
}

/* ============ 事件绑定（由 app.js 启动时调用一次） ============ */
export function initStatsPage() {
  loadStats().then(() => {
    if (uiStateTab() === "stats") renderStatsPage();
  });

  // 范围快捷切换
  $("#range-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const key = chip.dataset.range;
    if (key === "custom") {
      openDateRangePicker({
        start: customStart || null,
        end: customEnd || null,
        onConfirm: ({ start, end }) => {
          customStart = start;
          customEnd = end;
          rangeKey = "custom";
          renderStatsPage();
        },
      });
      return;
    }
    rangeKey = key;
    renderStatsPage();
  });

  // 热力图 chip 点击 → 年份选择器（近1年 / 当前年及前 3 年）
  $("#heatmap-switch").addEventListener("click", () => openHeatmapYearPicker());
  $("#hy-options").addEventListener("click", (e) => {
    const opt = e.target.closest(".hy-opt");
    if (!opt) return;
    heatMode = opt.dataset.mode;
    if (heatMode.startsWith("year-")) heatYear = Number(heatMode.slice(5));
    closeHeatmapYearPicker();
    renderHeatmap();
  });
  $("#hy-cancel").addEventListener("click", closeHeatmapYearPicker);
  $("#hy-mask").addEventListener("click", closeHeatmapYearPicker);

  // 图表点击 → 图中 tooltip（统一组件；热力图格子含日期/次数）
  $("#stats-charts").addEventListener("click", (e) => {
    const g = e.target.closest(".chart-click");
    if (!g) return;
    const chart = g.closest(".chart-card");
    if (!chart) return;
    const type = chart.dataset.chart;
    const records = DataModule.getAllRecords();
    const range = computeRange();
    if (type === "monthly" || type === "trend") {
      const idx = Number(g.dataset.index);
      const data = type === "monthly"
        ? call("monthlyCounts", records, statsRange(range))
        : call("trendCounts", records, statsRange(range));
      if (!data || !data[idx]) return;
      const d = data[idx];
      showTooltip(e, `<span class="tooltip-key">${DateUtils.getMonthLabel(d.ym)}</span><span class="tooltip-sep"> · </span><span class="tooltip-val">${d.count} 次</span>`);
    } else if (type === "rating") {
      const r = Number(g.dataset.rating);
      const total = Number(g.closest(".chart-body").dataset.ratingTotal || 0);
      const data = call("ratingDistribution", records, statsRange(range)) || [];
      const d = data.find((x) => x.rating === r);
      if (!d) return;
      const pct = total ? Math.round((d.count / total) * 100) : 0;
      showTooltip(e, `<span class="tooltip-key">${r} 星</span><span class="tooltip-sep"> · </span><span class="tooltip-val">${d.count} 次 · ${pct}%</span>`);
    } else if (type === "period") {
      const p = g.dataset.period;
      const total = Number(g.closest(".chart-body").dataset.periodTotal || 0);
      const data = call("periodDistribution", records, statsRange(range)) || [];
      const d = data.find((x) => x.period === p);
      if (!d) return;
      const labels = { morning: "早", afternoon: "午", evening: "晚", none: "未记录" };
      const label = labels[d.period] || d.period;
      const pct = total ? Math.round((d.count / total) * 100) : 0;
      showTooltip(e, `<span class="tooltip-key">${label}</span><span class="tooltip-sep"> · </span><span class="tooltip-val">${d.count} 次 · ${pct}%</span>`);
    } else if (type === "tags") {
      const name = g.dataset.tag;
      const data = call("tagCounts", records, statsRange(range)) || [];
      const d = data.find((x) => x.name === name);
      if (!d) return;
      const sum = data.reduce((s, x) => s + x.count, 0);
      const pct = sum ? Math.round((d.count / sum) * 100) : 0;
      showTooltip(e, `<span class="tooltip-key">${esc(d.name)}</span><span class="tooltip-sep"> · </span><span class="tooltip-val">${d.count} 次 · ${pct}%</span>`);
    } else if (type === "heatmap") {
      const start = g.dataset.start, end = g.dataset.end;
      if (!start || !end) return;
      const c = Number(g.dataset.count || 0);
      const val = c > 0 ? `${c} 次` : "无记录";
      showTooltip(e, `<span class="tooltip-key">${dateCNFull(start)} - ${dateCN(end)}</span><span class="tooltip-sep"> · </span><span class="tooltip-val">${val}</span>`);
    }
    e.stopPropagation();
  });

  // 点击图表数据点以外的区域 → 关闭 tooltip
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".chart-click")) hideTooltip();
  });
}

/** 读取当前 Tab（避免循环依赖 uiState） */
function uiStateTab() {
  return document.getElementById("page-stats").classList.contains("active") ? "stats" : "record";
}

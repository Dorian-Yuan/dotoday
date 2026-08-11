/**
 * settings-page.js —— 设置页（DoToday v0.5.2）
 *
 * 分组卡片：通用设置（周起始日 / 列表排序 / 图表配色）即时生效 +
 * 标签管理 / 数据管理 / GitHub 同步（框架占位）+ 关于（版本 / 开发者）。
 * 配置读写走 config.js（loadConfig / saveConfig / getPref），
 * 变更后 emit "config-changed"，由 app.js 编排联动重渲染（日历 / 单周条 / 列表）。
 * 图表配色：色板点击 → 生成 5 档色阶 CSS 变量（--chart-1..5）覆盖在
 * documentElement 上，统计页全部图表引用（默认回退 --accent-*）。
 */

import { $, $$, bus } from "./common.js";
import { APP_VERSION, loadConfig, saveConfig, getPref } from "../config.js";

/** 热力图主色色板：第一项为默认铅笔红（null 跟随主题 --accent），其余低饱和铅笔灰阶 */
const HEAT_PALETTE = [
  { value: null, label: "铅笔红", color: "#9c5236" },
  { value: "#9c8f84", label: "灰棕", color: "#9c8f84" },
  { value: "#8fa3a8", label: "灰蓝", color: "#8fa3a8" },
  { value: "#a3a88f", label: "灰绿", color: "#a3a88f" },
  { value: "#a88f9c", label: "灰紫", color: "#a88f9c" },
  { value: "#b0a08a", label: "暖灰", color: "#b0a08a" },
  { value: "#8f9ca8", label: "蓝灰", color: "#8f9ca8" },
];

/* ============ 主色 → 5 档色阶（浅透明 / 中透明 / 实色 / 加深 15% / 加深 30%） ============ */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbA(c, a) {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

function rgbStr(c) {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function darkenRgb(c, pct) {
  return { r: Math.round(c.r * (1 - pct)), g: Math.round(c.g * (1 - pct)), b: Math.round(c.b * (1 - pct)) };
}

function lightenRgb(c, pct) {
  return { r: Math.round(c.r + (255 - c.r) * pct), g: Math.round(c.g + (255 - c.g) * pct), b: Math.round(c.b + (255 - c.b) * pct) };
}

/** 当前主题是否为深色（用于主色提亮） */
function isDarkScheme() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** 默认铅笔红（与 css --accent 一致：浅色 #9c5236 / 深色提亮 #c98b6d） */
const CHART_DEFAULT = { light: "#9c5236", dark: "#c98b6d" };

/**
 * 应用图表配色：由主色生成 5 档色阶写入 --chart-1..5（统计页全部图表引用）。
 * hex 为 null → 默认铅笔红（深色下用提亮值）；自定义色在深色下提亮 12%（深色纸张上保证可见）。
 */
export function applyChartColors(hex) {
  const root = document.documentElement;
  const dark = isDarkScheme();
  let base = hex ? hexToRgb(hex) : hexToRgb(dark ? CHART_DEFAULT.dark : CHART_DEFAULT.light);
  if (!base) return;
  if (dark && hex) base = lightenRgb(base, 0.12);
  root.style.setProperty("--chart-1", rgbA(base, 0.15));   // 浅档（同 --accent-soft 风格）
  root.style.setProperty("--chart-2", rgbA(base, 0.35));   // 中档（同 --accent-mid 风格）
  root.style.setProperty("--chart-3", rgbStr(base));        // 主色实色
  root.style.setProperty("--chart-4", rgbStr(darkenRgb(base, 0.15))); // 加深 15%
  root.style.setProperty("--chart-5", rgbStr(darkenRgb(base, 0.3)));  // 加深 30%
}

/* ============ 渲染 ============ */

/** 同步单选 chip 组的选中态（key → data-pref 组，value 匹配 data-value） */
function syncChips(key) {
  const val = getPref(key);
  $$(`[data-pref="${key}"] .chip`).forEach((c) => c.classList.toggle("on", c.dataset.value === val));
}

/** 渲染色板圆点（每点显示其色值 + 选中双圈高亮） */
function renderSwatches() {
  const cur = getPref("heatmapColor") || null;
  $("#heatmap-swatches").innerHTML = HEAT_PALETTE.map(
    (p) =>
      `<button type="button" class="color-dot${p.value === cur ? " on" : ""}" data-value="${p.value || ""}" title="${p.label}" aria-label="${p.label}" style="background:${p.color}"></button>`
  ).join("");
}

/** 渲染设置页（版本号 + 全部选项选中态 + 色板 + 图表配色变量） */
export function renderSettingsPage() {
  $("#settings-version").textContent = "v" + APP_VERSION;
  syncChips("weekStartDay");
  syncChips("defaultSortOrder");
  renderSwatches();
  applyChartColors(getPref("heatmapColor"));
}

/* ============ 配置保存（读改写，保留其余字段） ============ */

function savePref(key, value) {
  const config = loadConfig();
  config.preferences = config.preferences || {};
  config.preferences[key] = value;
  saveConfig(config);
}

/* ============ 事件绑定（由 app.js 启动时调用一次） ============ */

export function initSettingsPage() {
  // 周起始日 / 列表排序：chip 单选
  $("#page-settings").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip[data-value]");
    if (!chip) return;
    const group = chip.closest("[data-pref]");
    if (!group) return;
    savePref(group.dataset.pref, chip.dataset.value);
    syncChips(group.dataset.pref);
    bus.emit("config-changed");
  });

  // 图表配色：色板圆点单选
  $("#heatmap-swatches").addEventListener("click", (e) => {
    const dot = e.target.closest(".color-dot");
    if (!dot) return;
    const value = dot.dataset.value || null;
    savePref("heatmapColor", value);
    renderSwatches();
    applyChartColors(value);
    bus.emit("config-changed");
  });

  // 系统主题切换（浅/深）时按深色提亮规则重建色阶
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const onThemeChange = () => applyChartColors(getPref("heatmapColor"));
  if (mq && mq.addEventListener) mq.addEventListener("change", onThemeChange);
  else if (mq && mq.addListener) mq.addListener(onThemeChange);
}

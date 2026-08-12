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

import { $, $$, esc, bus } from "./common.js";
import { APP_VERSION, loadConfig, saveConfig, getPref } from "../config.js";
import { DataModule } from "../data.js";
import { showToast } from "./toast.js";

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

/* ============ 数据管理：文本导入（parse-import.js 动态加载，未就绪时降级提示） ============ */

let importParser = null;  // ImportParser（懒加载缓存）
let importItems = [];     // 当前解析项 [{date, count, note, ok, raw}]
let importExpanded = false;

async function loadImportParser() {
  if (importParser) return importParser;
  try {
    const mod = await import("../pure/parse-import.js");
    importParser = mod.ImportParser || null;
  } catch (e) {
    importParser = null;
  }
  return importParser;
}

function setImportStatus(msg, isError) {
  const el = $("#import-status");
  if (msg) {
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  } else {
    el.hidden = true;
  }
}

/** 渲染解析结果：ok 项进预览（可编辑）、失败项进坏行列表（原样显示 + 修复） */
function renderImportPreview() {
  const okPairs = importItems.map((it, i) => ({ it, i })).filter((x) => x.it.ok);
  const badPairs = importItems.map((it, i) => ({ it, i })).filter((x) => !x.it.ok);
  $("#import-ok-list").innerHTML = okPairs
    .map(
      ({ it, i }) => `<div class="import-item" data-idx="${i}">
        <input type="text" class="import-date" value="${esc(it.date)}" inputmode="numeric" aria-label="日期">
        <input type="number" class="import-count" value="${it.count}" min="1" max="99" aria-label="次数">
        <input type="text" class="import-note" value="${esc(it.note)}" placeholder="备注（可选）" aria-label="备注">
        <button type="button" class="btn-ghost btn-sm import-remove" aria-label="移除">×</button>
      </div>`
    )
    .join("");
  $("#import-bad-list").innerHTML = badPairs
    .map(
      ({ it, i }) => `<div class="import-bad-item" data-idx="${i}">
        <span class="import-bad-text" title="${esc(it.raw)}">${esc(it.raw) || "（空行）"}</span>
        <button type="button" class="btn-ghost btn-sm import-fix">修复</button>
      </div>`
    )
    .join("");
  $("#import-bad-title").hidden = !badPairs.length;
  $("#import-confirm").hidden = !okPairs.length;
  $("#import-preview").hidden = !(okPairs.length || badPairs.length);
  $("#import-clear").hidden = false;
}

/** 清空输入与结果，面板回到初始态 */
function resetImportPanel() {
  importItems = [];
  $("#import-input").value = "";
  $("#import-preview").hidden = true;
  $("#import-confirm").hidden = true;
  $("#import-clear").hidden = true;
  setImportStatus("");
}

/** 展开/收起导入面板 */
function toggleImportPanel() {
  importExpanded = !importExpanded;
  $("#import-panel").hidden = !importExpanded;
  $("#import-toggle").textContent = importExpanded ? "收起" : "展开";
  if (importExpanded) loadImportParser(); // 预加载解析器
}

/** 开始解析：normalize → parse → validate，按 ok 分组渲染 */
async function onImportParse() {
  const text = $("#import-input").value;
  if (!text.trim()) {
    setImportStatus("请先粘贴或输入文本", true);
    return;
  }
  const parser = await loadImportParser();
  if (!parser) {
    setImportStatus("解析器未就绪，请稍后重试", true);
    return;
  }
  const normalized = parser.normalizeText(text);
  importItems = parser.validateItems(parser.parseText(normalized, new Date().getFullYear())) || [];
  if (!importItems.length) {
    setImportStatus("没有可解析的内容", true);
    return;
  }
  setImportStatus("");
  renderImportPreview();
}

/** 确认导入：校验 → expandRecords 展开 → 逐条写入（date+note 相同跳过） */
async function onImportConfirm() {
  const parser = await loadImportParser();
  if (!parser) {
    setImportStatus("解析器未就绪，请稍后重试", true);
    return;
  }
  const items = parser.validateItems(importItems.filter((it) => it.ok));
  const okItems = items.filter((it) => it.ok);
  const badCount = items.length - okItems.length;
  if (!okItems.length) {
    setImportStatus("没有可导入的有效行", true);
    return;
  }
  const expanded = parser.expandRecords(okItems);
  const existing = DataModule.getAllRecords();
  let added = 0;
  let skipped = 0;
  setImportStatus("正在导入…");
  for (const item of expanded) {
    // 合并跳过：date + note 相同的记录视为重复（重复日期不同备注仍允许）
    if (existing.some((r) => r.date === item.date && (r.note || "") === (item.note || ""))) {
      skipped++;
      continue;
    }
    try {
      await DataModule.addRecord({ date: item.date, note: item.note, rating: null, tags: [] });
      added++;
    } catch (e) {
      skipped++;
    }
  }
  if (badCount) setImportStatus(`${badCount} 条日期无效未导入`, true);
  showToast(`已导入 ${added} 条${skipped ? `，跳过 ${skipped} 条` : ""}`, { type: added > 0 ? "info" : "error" });
  bus.emit("records-changed"); // 记录页/统计页刷新
  if (added > 0) resetImportPanel();
}

/** 读取文件内容填入文本框（.txt/.json 均按文本读取） */
async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    $("#import-input").value = await file.text();
    setImportStatus(`已读取「${file.name}」，点击开始解析`);
  } catch (err) {
    setImportStatus("文件读取失败", true);
  }
  e.target.value = ""; // 允许重复选择同一文件
}

/** 绑定导入面板事件（initSettingsPage 内调用） */
function bindImportEvents() {
  $("#import-toggle").addEventListener("click", toggleImportPanel);
  $("#import-file-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", onImportFile);
  $("#import-clear").addEventListener("click", resetImportPanel);
  $("#import-parse").addEventListener("click", onImportParse);
  $("#import-confirm").addEventListener("click", onImportConfirm);
  $("#import-reset").addEventListener("click", resetImportPanel);

  // 预览项编辑（实时同步回 importItems）
  $("#import-panel").addEventListener("input", (e) => {
    const item = e.target.closest(".import-item");
    if (!item) return;
    const it = importItems[Number(item.dataset.idx)];
    if (!it) return;
    if (e.target.classList.contains("import-date")) it.date = e.target.value.trim();
    else if (e.target.classList.contains("import-count")) it.count = e.target.value ? Number(e.target.value) : 1;
    else if (e.target.classList.contains("import-note")) it.note = e.target.value;
  });

  // 移除预览项 / 修复坏行（放回输入框）
  $("#import-panel").addEventListener("click", (e) => {
    const rm = e.target.closest(".import-remove");
    if (rm) {
      importItems.splice(Number(rm.closest(".import-item").dataset.idx), 1);
      renderImportPreview();
      return;
    }
    const fix = e.target.closest(".import-fix");
    if (fix) {
      const bad = importItems[Number(fix.closest(".import-bad-item").dataset.idx)];
      if (bad) {
        $("#import-input").value = bad.raw || "";
        $("#import-input").focus();
        setImportStatus("已把该行放回输入框，修改后重新解析");
      }
    }
  });
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

  // 数据管理：文本导入
  bindImportEvents();
}

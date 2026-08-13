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
import { APP_VERSION, loadConfig, saveConfig, getPref, DEFAULT_TAG_COLORS, resolveColor, STORAGE_KEYS } from "../config.js";
import { DataModule } from "../data.js";
import { LoggerModule } from "../logger.js";
import { showToast } from "./toast.js";
import { showConfirm } from "./list.js";
import { uploadSync, listRemote, fetchRemote } from "../sync.js";

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

/** 统一重置可收起面板（文本导入 / 本地备份 / 日志 / 导出 / 标签管理 / GitHub 同步）：
 *  每次进入设置页强制回到收起态（模块状态与 DOM 同步，避免切 Tab 后状态脱节） */
function resetCollapsiblePanels() {
  importExpanded = false;
  backupExpanded = false;
  logExpanded = false;
  exportExpanded = false;
  tagManageExpanded = false;
  syncExpanded = false;
  $("#import-panel").hidden = true;
  $("#import-toggle").textContent = "展开";
  $("#backup-panel").hidden = true;
  $("#backup-toggle").textContent = "展开";
  $("#log-panel").hidden = true;
  $("#log-toggle").textContent = "展开";
  $("#export-panel").hidden = true;
  $("#export-toggle").textContent = "展开";
  $("#tag-manage-panel").hidden = true;
  $("#tag-manage-toggle").textContent = "展开";
  $("#sync-panel").hidden = true;
  $("#sync-toggle").textContent = "展开";
}

/** 渲染设置页（版本号 + 全部选项选中态 + 色板 + 图表配色变量 + 标签列表 + 同步配置） */
export function renderSettingsPage() {
  resetCollapsiblePanels(); // 进入设置页：三面板回到收起态（状态与 DOM 强一致）
  $("#settings-version").textContent = "v" + APP_VERSION;
  syncChips("weekStartDay");
  syncChips("defaultSortOrder");
  renderSwatches();
  applyChartColors(getPref("heatmapColor"));
  renderTagManage();
  renderSyncPage();
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

/* ============ 标签管理（新增 / 重命名 / 改色 / 删除，联动记录页与统计页） ============ */

let tagManageExpanded = false; // 标签管理分组展开状态（默认收起，与文本导入一致）

/** 展开/收起标签管理分组 */
function toggleTagManage() {
  tagManageExpanded = !tagManageExpanded;
  $("#tag-manage-panel").hidden = !tagManageExpanded;
  $("#tag-manage-toggle").textContent = tagManageExpanded ? "收起" : "展开";
  if (tagManageExpanded) renderTagManage(); // 展开时刷新列表
}

/** 标签使用次数（统计自全部记录） */
function tagUsage(name) {
  return DataModule.getAllRecords().filter((r) => Array.isArray(r.tags) && r.tags.includes(name)).length;
}

/** 渲染标签列表（色点 / 名称 / 次数 / 操作；空态提示） */
function renderTagManage() {
  const tags = DataModule.getTags();
  const list = $("#tag-manage-list");
  if (!tags.length) {
    list.innerHTML = `<div class="tag-manage-empty">还没有标签，输入上方新建</div>`;
    return;
  }
  list.innerHTML = tags
    .map(
      (t) => `<div class="tag-manage-item" data-name="${esc(t.name)}">
        <i class="tag-row-dot" style="background:${esc(t.color)}" aria-hidden="true"></i>
        <span class="tag-manage-name" title="${esc(t.name)}">${esc(t.name)}</span>
        <span class="tag-manage-count">× ${tagUsage(t.name)}</span>
        <span class="tag-manage-ops">
          <button type="button" class="btn-ghost btn-sm" data-act="rename">重命名</button>
          <button type="button" class="btn-ghost btn-sm" data-act="color">改色</button>
          <button type="button" class="btn-ghost btn-sm danger" data-act="delete">删除</button>
        </span>
      </div>`
    )
    .join("");
}

/** 新增标签（空名 / 重名提示） */
async function addTagFlow(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    showToast("标签名不能为空", { type: "error" });
    return;
  }
  try {
    await DataModule.addTag(trimmed); // 自动从色板配色
    showToast(`已添加标签「${trimmed}」`);
    $("#tag-new-input").value = "";
    // 先刷新标签列表（不依赖 records-changed 订阅者成败，避免级联失败导致列表不更新）
    renderTagManage();
    bus.emit("records-changed");
  } catch (e) {
    showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
  }
}

/** 重命名：行内编辑（回车提交 / Esc 取消 / 失焦提交），同步更新所有记录 */
function startTagRename(name, row) {
  const nameEl = row.querySelector(".tag-manage-name");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "input-text tag-rename-input";
  input.value = name;
  input.maxLength = 12;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    if (commit && val && val !== name) {
      try {
        const affected = await DataModule.renameTag(name, val);
        showToast(`已重命名「${name}」→「${val}」${affected ? `（更新 ${affected} 条记录）` : ""}`);
        renderTagManage(); // 先刷新列表（不依赖 records-changed 订阅者成败）
        bus.emit("records-changed");
        return; // 成功：已刷新
      } catch (e) {
        showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
        // 失败：落到末尾恢复行显示
      }
    }
    renderTagManage(); // 失败 / 未修改 / Esc 取消：恢复行显示
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/** 改色：7 色板弹层（简单圆点行，当前色双圈高亮；冲突由 resolveColor 自动变体） */
let tagColorTarget = null; // 当前改色目标标签名

function openTagColorPicker(name, currentColor) {
  tagColorTarget = name;
  $("#tag-color-name").textContent = `「${name}」`;
  $("#tag-color-palette").innerHTML = DEFAULT_TAG_COLORS.map(
    (c) =>
      `<button type="button" class="color-dot${c === currentColor ? " on" : ""}" data-value="${c}" title="${c}" aria-label="${c}" style="background:${c}"></button>`
  ).join("");
  $("#tag-color-mask").hidden = false;
  $("#tag-color-modal").hidden = false;
  requestAnimationFrame(() => {
    $("#tag-color-mask").classList.add("open");
    $("#tag-color-modal").classList.add("open");
  });
}

function closeTagColorPicker() {
  $("#tag-color-mask").classList.remove("open");
  $("#tag-color-modal").classList.remove("open");
  setTimeout(() => {
    $("#tag-color-mask").hidden = true;
    $("#tag-color-modal").hidden = true;
  }, 220);
}

/** 删除标签：二次确认 → 全局删除（同步移除记录引用） */
function deleteTagFlow(name) {
  const usage = tagUsage(name);
  showConfirm({
    text: `删除标签「${name}」？将同步移除 ${usage} 条记录中的该标签`,
    yesText: "删除",
    onYes: async () => {
      try {
        const affected = await DataModule.deleteTag(name);
        showToast(`已删除标签「${name}」${affected ? `（移除 ${affected} 条记录中的引用）` : ""}`);
        renderTagManage(); // 先刷新列表（不依赖 records-changed 订阅者成败）
        bus.emit("records-changed");
      } catch (e) {
        showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
      }
    },
  });
}

/** 绑定标签管理事件（initSettingsPage 内调用） */
function bindTagManageEvents() {
  // 分组展开/收起
  $("#tag-manage-toggle").addEventListener("click", toggleTagManage);

  // 新增：按钮 + 回车
  $("#tag-add-btn").addEventListener("click", () => addTagFlow($("#tag-new-input").value));
  $("#tag-new-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTagFlow(e.target.value);
  });

  // 列表操作：重命名 / 改色 / 删除
  $("#tag-manage-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const row = btn.closest(".tag-manage-item");
    if (!row) return;
    const name = row.dataset.name;
    const act = btn.dataset.act;
    if (act === "rename") startTagRename(name, row);
    else if (act === "color") {
      const t = DataModule.getTags().find((x) => x.name === name);
      if (t) openTagColorPicker(name, t.color);
    } else if (act === "delete") deleteTagFlow(name);
  });

  // 改色弹层（7 色板；选中已用色 → 自动变体区分）
  $("#tag-color-palette").addEventListener("click", async (e) => {
    const dot = e.target.closest(".color-dot");
    if (!dot || !tagColorTarget) return;
    // 冲突变体：目标色被其他标签占用 → resolveColor 自动微调（明度阶梯）
    const usedByOthers = DataModule.getTags()
      .filter((t) => t.name !== tagColorTarget)
      .map((t) => t.color);
    const resolved = resolveColor(dot.dataset.value, usedByOthers);
    const autoAdjusted = resolved !== dot.dataset.value;
    try {
      await DataModule.changeTagColor(tagColorTarget, resolved);
      showToast(
        autoAdjusted
          ? "该色已被使用，已自动微调以区分"
          : `已更新「${tagColorTarget}」的颜色`
      );
      renderTagManage(); // 先刷新列表（不依赖 records-changed 订阅者成败）
      bus.emit("records-changed");
    } catch (err) {
      showToast(err.message.replace("[DataModule] ", ""), { type: "error" });
    }
    closeTagColorPicker();
  });
  $("#tag-color-cancel").addEventListener("click", closeTagColorPicker);
  $("#tag-color-mask").addEventListener("click", closeTagColorPicker);
}

/* ============ GitHub 同步（本地为权威：上传日常备份，恢复覆盖式） ============ */

let syncSecretInput = ""; // 私钥内存值（未记住时页面关闭即失）
let syncExpanded = false; // 分组展开状态（默认收起，与标签管理/文本导入一致）

/** 展开/收起同步分组（展开时刷新最近上传时间） */
function toggleSyncPanel() {
  syncExpanded = !syncExpanded;
  $("#sync-panel").hidden = !syncExpanded;
  $("#sync-toggle").textContent = syncExpanded ? "收起" : "展开";
  if (syncExpanded) renderSyncPage();
}

/** 渲染同步配置：token/repo/私钥（记住则回填）/最近上传时间 */
function renderSyncPage() {
  const config = loadConfig();
  const sync = config.sync || {};
  $("#sync-token").value = sync.githubToken || "";
  $("#sync-repo").value = sync.repo || "";
  const remembered = localStorage.getItem(STORAGE_KEYS.SECRET) || "";
  $("#sync-secret").value = remembered;
  syncSecretInput = remembered;
  $("#sync-remember").checked = !!remembered;
  $("#sync-last").textContent = sync.lastSyncAt
    ? `最近上传：${new Date(sync.lastSyncAt).toLocaleString()}`
    : "最近上传：—";
}

/** 保存 token/repo 到配置 sync 字段 */
function saveSyncConfig(patch) {
  const config = loadConfig();
  config.sync = Object.assign({}, config.sync || {}, patch);
  saveConfig(config);
}

/** 校验同步配置；返回 {token, repo, secret} 或 null（缺项提示） */
function collectSyncConfig() {
  const token = $("#sync-token").value.trim();
  const repo = $("#sync-repo").value.trim();
  const secret = $("#sync-secret").value;
  if (!token) {
    showToast("请填写 GitHub Token", { type: "error" });
    return null;
  }
  if (!repo || !repo.includes("/")) {
    showToast("请填写仓库（格式 owner/repo）", { type: "error" });
    return null;
  }
  if (!secret) {
    showToast("请填写加密私钥", { type: "error" });
    return null;
  }
  saveSyncConfig({ githubToken: token, repo });
  return { token, repo, secret };
}

/** 记住私钥：勾选 → 明文存 localStorage；取消 → 清除 */
function handleRememberSecret(e) {
  const checked = e.target.checked;
  const secret = $("#sync-secret").value;
  if (checked) {
    if (secret) {
      try {
        localStorage.setItem(STORAGE_KEYS.SECRET, secret);
        syncSecretInput = secret;
        showToast("私钥已保存在本机（明文），请注意风险");
      } catch (err) {
        showToast("保存失败：存储不可用", { type: "error" });
      }
    } else {
      e.target.checked = false;
      showToast("请先输入私钥", { type: "error" });
    }
  } else {
    localStorage.removeItem(STORAGE_KEYS.SECRET);
    syncSecretInput = "";
    showToast("已清除本机保存的私钥");
  }
}

/** 上传备份（日常）：加密 → current 覆盖 + 时间戳备份 → 清理超 20 份 */
async function handleSyncUpload() {
  const cfg = collectSyncConfig();
  if (!cfg) return;
  showToast("正在上传备份…", { duration: 2000 });
  try {
    const result = await uploadSync(cfg.token, cfg.repo, cfg.secret);
    saveSyncConfig({ lastSyncAt: Date.now() });
    renderSyncPage();
    showToast(`已上传 ${result.uploaded.length} 个文件（共 ${result.backups} 份备份${result.cleaned.length ? `，清理 ${result.cleaned.length} 份旧备份` : ""}）`, { duration: 4000 });
  } catch (err) {
    showToast(err.message, { type: "error", duration: 4000 });
  }
}

/** 恢复弹层状态 */
let syncModalStep = "list"; // list | preview
let syncPreviewData = null; // 解密后的远端数据
let syncFiles = [];

function showSyncModal() {
  $("#sync-mask").hidden = false;
  $("#sync-modal").hidden = false;
  requestAnimationFrame(() => {
    $("#sync-mask").classList.add("open");
    $("#sync-modal").classList.add("open");
  });
}

function closeSyncModal() {
  $("#sync-mask").classList.remove("open");
  $("#sync-modal").classList.remove("open");
  setTimeout(() => {
    $("#sync-mask").hidden = true;
    $("#sync-modal").hidden = true;
  }, 220);
}

function setSyncStep(step) {
  syncModalStep = step;
  $("#sync-step-list").hidden = step !== "list";
  $("#sync-step-preview").hidden = step !== "preview";
  $("#sync-modal-back").hidden = step !== "preview";
  $("#sync-modal-confirm").hidden = step !== "preview";
}

/** 恢复流程：列出远端 → 选择 → 解密预览 → 确认覆盖 */
async function handleSyncRestore() {
  const cfg = collectSyncConfig();
  if (!cfg) return;
  showToast("正在获取远端列表…", { duration: 2000 });
  try {
    syncFiles = await listRemote(cfg.token, cfg.repo);
  } catch (err) {
    showToast(err.message, { type: "error", duration: 4000 });
    return;
  }
  if (!syncFiles.length) {
    showToast("远端暂无备份文件", { type: "error" });
    return;
  }
  $("#sync-list-hint").textContent = `远端备份（${syncFiles.length} 个文件）：`;
  $("#sync-file-list").innerHTML = syncFiles
    .map(
      (f) => `<div class="sync-file-item" data-name="${esc(f.name)}">
        <span class="sync-file-name">${esc(f.name)}</span>
        <span class="sync-file-size">${(f.size / 1024).toFixed(1)} KB</span>
      </div>`
    )
    .join("");
  setSyncStep("list");
  showSyncModal();
}

/** 预览远端数据概要 */
function renderSyncPreview(data) {
  const records = Array.isArray(data.records) ? data.records : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  let dateRange = "—";
  if (records.length) {
    const dates = records.map((r) => r.date).sort();
    dateRange = `${dates[0]} ~ ${dates[dates.length - 1]}`;
  }
  const savedAt = data.savedAt ? new Date(data.savedAt).toLocaleString() : "—";
  $("#sync-preview-info").textContent = `${syncPreviewName}（${(syncPreviewSize / 1024).toFixed(1)} KB）`;
  $("#sync-preview-box").innerHTML = `
    记录：${records.length} 条<br>
    标签：${tags.length} 个<br>
    日期范围：${dateRange}<br>
    备份时间：${savedAt}`;
  $("#sync-modal-confirm").textContent = `确认覆盖（${records.length} 条记录）`;
}

let syncPreviewName = "";
let syncPreviewSize = 0;

/** 恢复弹层事件 */
function bindSyncModalEvents() {
  $("#sync-file-list").addEventListener("click", async (e) => {
    const item = e.target.closest(".sync-file-item");
    if (!item) return;
    const cfg = collectSyncConfig();
    if (!cfg) return;
    const name = item.dataset.name;
    showToast("正在下载并解密…", { duration: 2000 });
    try {
      const file = syncFiles.find((f) => f.name === name);
      syncPreviewName = name;
      syncPreviewSize = file ? file.size : 0;
      syncPreviewData = await fetchRemote(cfg.token, cfg.repo, name, cfg.secret);
      renderSyncPreview(syncPreviewData);
      setSyncStep("preview");
    } catch (err) {
      showToast(err.message, { type: "error", duration: 4000 });
    }
  });
  $("#sync-modal-confirm").addEventListener("click", async () => {
    if (!syncPreviewData) return;
    const cfg = collectSyncConfig();
    if (!cfg) return;
    const n = Array.isArray(syncPreviewData.records) ? syncPreviewData.records.length : 0;
    showConfirm({
      text: `将用远端数据覆盖本地 ${DataModule.getAllRecords().length} 条记录（远端 ${n} 条），且不做合并。确定继续？`,
      yesText: "覆盖",
      onYes: async () => {
        try {
          const result = await DataModule.replaceAll({
            records: syncPreviewData.records || [],
            tags: syncPreviewData.tags || [],
          });
          closeSyncModal();
          showToast(`已恢复 ${result.records} 条记录（覆盖本地）`, { duration: 4000 });
          bus.emit("records-changed");
        } catch (err) {
          showToast(`恢复失败：${err.message}`, { type: "error" });
        }
      },
    });
  });
  $("#sync-modal-back").addEventListener("click", () => setSyncStep("list"));
  $("#sync-modal-cancel").addEventListener("click", closeSyncModal);
  $("#sync-mask").addEventListener("click", closeSyncModal);
}

/** 绑定同步事件（initSettingsPage 内调用） */
function bindSyncEvents() {
  // 分组展开/收起
  $("#sync-toggle").addEventListener("click", toggleSyncPanel);

  // 配置输入即时保存（token/repo 失焦保存；私钥仅存内存）
  $("#sync-token").addEventListener("change", (e) => saveSyncConfig({ githubToken: e.target.value.trim() }));
  $("#sync-repo").addEventListener("change", (e) => saveSyncConfig({ repo: e.target.value.trim() }));
  $("#sync-secret").addEventListener("input", (e) => {
    syncSecretInput = e.target.value;
    // 记住态下实时同步
    if ($("#sync-remember").checked) {
      if (syncSecretInput) localStorage.setItem(STORAGE_KEYS.SECRET, syncSecretInput);
      else localStorage.removeItem(STORAGE_KEYS.SECRET);
    }
  });
  $("#sync-remember").addEventListener("change", handleRememberSecret);
  $("#sync-upload").addEventListener("click", handleSyncUpload);
  $("#sync-restore").addEventListener("click", handleSyncRestore);
  bindSyncModalEvents();
}

/* ============ 本地备份管理（创建 / 恢复预览覆盖 / 删除 / 导出） ============ */

let backupExpanded = false;
let logExpanded = false;

function toggleBackupPanel() {
  backupExpanded = !backupExpanded;
  $("#backup-panel").hidden = !backupExpanded;
  $("#backup-toggle").textContent = backupExpanded ? "收起" : "展开";
  if (backupExpanded) renderBackupList();
}

/** 备份名称 → 可读时间（dotoday_backup_YYYYMMDD_HHMMSS → YYYY-MM-DD HH:MM:SS） */
function backupNameToTime(name) {
  const m = /dotoday_backup_(\d{8})_(\d{6})/.exec(name || "");
  if (!m) return "";
  const d = m[1];
  const t = m[2];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

/** 渲染备份列表（名称 / 时间 / 恢复 / 删除 / 导出；空态） */
async function renderBackupList() {
  const list = $("#backup-list");
  let backups;
  try {
    backups = await DataModule.listBackups();
  } catch (e) {
    list.innerHTML = `<div class="backup-empty">读取备份失败：${esc(e.message)}</div>`;
    return;
  }
  if (!backups.length) {
    list.innerHTML = `<div class="backup-empty">暂无备份，点击"创建备份"手动备份</div>`;
    return;
  }
  list.innerHTML = backups
    .map(
      (b) => `<div class="backup-item" data-name="${esc(b.name)}">
        <div class="backup-item-main">
          <span class="backup-item-name" title="${esc(b.name)}">${esc(b.name)}</span>
          <span class="backup-item-time">${esc(backupNameToTime(b.name) || new Date(b.createdAt).toLocaleString())}</span>
        </div>
        <span class="backup-item-ops">
          <button type="button" class="btn-ghost btn-sm" data-act="restore">恢复</button>
          <button type="button" class="btn-ghost btn-sm" data-act="download">导出</button>
          <button type="button" class="btn-ghost btn-sm danger" data-act="delete">删除</button>
        </span>
      </div>`
    )
    .join("");
  $("#backup-refresh").hidden = false;
}

/** 手动创建备份（强制） */
async function handleBackupCreate() {
  showToast("正在创建备份…", { duration: 2000 });
  try {
    const name = await DataModule.createBackup(true);
    if (!name) {
      showToast("创建备份失败", { type: "error" });
      return;
    }
    showToast(`已创建备份：${name}`);
    renderBackupList();
  } catch (e) {
    showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
  }
}

/** 恢复备份：预览（记录数 / 日期范围）→ 二次确认 → 覆盖本地 */
async function handleBackupRestore(name) {
  let backup;
  try {
    backup = await DataModule.getBackup(name);
  } catch (e) {
    showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
    return;
  }
  const records = Array.isArray(backup.data.records) ? backup.data.records : [];
  const tags = Array.isArray(backup.data.tags) ? backup.data.tags : [];
  let dateRange = "—";
  if (records.length) {
    const dates = records.map((r) => r.date).sort();
    dateRange = `${dates[0]} ~ ${dates[dates.length - 1]}`;
  }
  const current = DataModule.getAllRecords().length;
  showConfirm({
    text: `备份「${name}」：${records.length} 条记录 · ${tags.length} 个标签 · ${dateRange}\n将用备份覆盖当前 ${current} 条记录，确定恢复？`,
    yesText: "恢复",
    onYes: async () => {
      try {
        await DataModule.restoreBackup(name);
        showToast(`已从备份恢复 ${records.length} 条记录`, { duration: 4000 });
        bus.emit("records-changed");
        renderBackupList();
      } catch (e) {
        showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
      }
    },
  });
}

/** 删除备份（二次确认） */
function handleBackupDelete(name) {
  showConfirm({
    text: `删除备份「${name}」？此操作不可恢复`,
    yesText: "删除",
    onYes: async () => {
      try {
        const ok = await DataModule.deleteBackup(name);
        showToast(ok ? `已删除备份：${name}` : "备份不存在");
        renderBackupList();
      } catch (e) {
        showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
      }
    },
  });
}

/** 导出备份 → JSON Blob（dotoday_backup_时间戳.json） */
async function handleBackupDownload(name) {
  try {
    const backup = await DataModule.getBackup(name);
    const blob = new Blob([JSON.stringify(backup.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("备份已导出为 JSON 文件");
  } catch (e) {
    showToast(e.message.replace("[DataModule] ", ""), { type: "error" });
  }
}

/* ============ 日志查看 / 清空 ============ */

function toggleLogPanel() {
  logExpanded = !logExpanded;
  $("#log-panel").hidden = !logExpanded;
  $("#log-toggle").textContent = logExpanded ? "收起" : "展开";
  if (logExpanded) renderLogView();
}

/** 渲染日志（最近 200 行） */
function renderLogView() {
  const logs = LoggerModule.getLogs();
  const lines = logs ? logs.split("\n").filter((l) => l.trim()) : [];
  $("#log-view").textContent = lines.slice(-200).join("\n");
}

/** 清空日志（轻确认） */
function handleLogClear() {
  showConfirm({
    text: "清空全部日志？",
    yesText: "清空",
    onYes: () => {
      LoggerModule.clearLogs();
      renderLogView();
      showToast("日志已清空");
    },
  });
}

/** 绑定备份/日志事件（initSettingsPage 内调用） */
function bindBackupLogEvents() {
  // 备份面板
  $("#backup-toggle").addEventListener("click", toggleBackupPanel);
  $("#backup-create").addEventListener("click", handleBackupCreate);
  $("#backup-refresh").addEventListener("click", renderBackupList);
  $("#backup-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const item = btn.closest(".backup-item");
    if (!item) return;
    const name = item.dataset.name;
    const act = btn.dataset.act;
    if (act === "restore") handleBackupRestore(name);
    else if (act === "delete") handleBackupDelete(name);
    else if (act === "download") handleBackupDownload(name);
  });

  // 日志面板
  $("#log-toggle").addEventListener("click", toggleLogPanel);
  $("#log-refresh").addEventListener("click", renderLogView);
  $("#log-clear").addEventListener("click", handleLogClear);
}

/* ============ 数据导出（格式 / 筛选 / 脱敏 / Blob 下载） ============ */

let exportExpanded = false;

function toggleExportPanel() {
  exportExpanded = !exportExpanded;
  $("#export-panel").hidden = !exportExpanded;
  $("#export-toggle").textContent = exportExpanded ? "收起" : "展开";
  if (exportExpanded) renderExportPanel();
}

/** 渲染导出面板：标签下拉填充（"全部" + 现有标签） */
function renderExportPanel() {
  const tags = DataModule.getTags();
  const cur = $("#export-tag").value;
  $("#export-tag").innerHTML =
    `<option value="">全部</option>` +
    tags.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join("");
  if (cur && tags.some((t) => t.name === cur)) $("#export-tag").value = cur;
}

/** 时间戳文件名：dotoday_export_YYYYMMDD_HHMMSS.ext */
function exportFileName(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `dotoday_export_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/** 触发 Blob 下载 */
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 动态加载 ExportModule（未就绪返回 null） */
async function loadExportModule() {
  try {
    const mod = await import("../export.js");
    return mod.ExportModule || null;
  } catch (e) {
    return null;
  }
}

/** 导出：收集筛选 → applyFilters → 空提示 → toX → Blob 下载（CSV 加 BOM） */
async function handleExport() {
  const fmt = document.querySelector("#export-format .chip.on").dataset.value;
  const start = document.getElementById("export-start").value || null;
  const end = document.getElementById("export-end").value || null;
  const rating = document.getElementById("export-rating").value;
  const tag = document.getElementById("export-tag").value;
  const desensitize = document.getElementById("export-desensitize").checked;

  const exp = await loadExportModule();
  if (!exp) {
    showToast("导出模块未就绪，请稍后重试", { type: "error" });
    return;
  }
  const records = exp.applyFilters(DataModule.getAllRecords(), {
    start,
    end,
    rating: rating === "" ? null : Number(rating),
    tags: tag ? [tag] : [],
  });
  if (!records.length) {
    showToast("没有符合筛选条件的记录", { type: "error" });
    return;
  }
  const options = { desensitize };
  let content;
  let mime;
  if (fmt === "json") {
    content = exp.toJSON(records, options);
    mime = "application/json";
  } else if (fmt === "csv") {
    content = "\uFEFF" + exp.toCSV(records, options); // UTF-8 BOM（Excel 兼容）
    mime = "text/csv;charset=utf-8";
  } else {
    content = exp.toTXT(records, options);
    mime = "text/plain;charset=utf-8";
  }
  downloadBlob(content, exportFileName(fmt), mime);
  showToast(`已导出 ${records.length} 条记录（${fmt.toUpperCase()}${desensitize ? "，已脱敏" : ""}）`, { duration: 4000 });
}

/** 绑定导出事件（initSettingsPage 内调用） */
function bindExportEvents() {
  $("#export-toggle").addEventListener("click", toggleExportPanel);
  $("#export-format").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    $$("#export-format .chip").forEach((c) => c.classList.toggle("on", c === chip));
  });
  $("#export-btn").addEventListener("click", handleExport);
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

  // 数据管理：本地备份 / 日志
  bindBackupLogEvents();

  // 数据管理：导出
  bindExportEvents();

  // 标签管理：新增 / 重命名 / 改色 / 删除
  bindTagManageEvents();

  // GitHub 同步：上传 / 恢复
  bindSyncEvents();
}

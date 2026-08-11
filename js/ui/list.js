/**
 * list.js —— Timeline 列表组件（DoToday v0.2.0）
 *
 * 全量时间线：按月分组、左侧时间轴 + 右侧卡片；点击展开详情、左滑编辑/删除、
 * 删除 5 秒撤销（Toast）、长按批量删除、月份浮层、空态、骨架屏。
 * 订阅 "records-changed"（数据变更后刷新列表）；提供滚动联动工具
 * （topVisibleDate / scrollToDate，供入口编排日历折叠与点选定位）。
 * 数据以 DataModule 为唯一事实源，渲染前实时读取。
 */

import { $, $$, esc, dateCN, setBodyLock, bus } from "./common.js";
import { uiState } from "./state.js";
import { DateUtils } from "../pure/date-utils.js";
import { DataModule } from "../data.js";
import { LoggerModule } from "../logger.js";
import { LIMITS, TOAST_MS, SCROLL, getPref } from "../config.js";
import { showToast } from "./toast.js";
import { openForm } from "./form.js";
import { ICONS } from "../icon-config.js";

/* ============ 列表排序（plan 2.2：时间正/倒序、评分、标签；默认时间倒序） ============ */
function sortRecords(list) {
  const arr = [...list];
  const dateAsc = (a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "");
  const dateDesc = (a, b) => b.date.localeCompare(a.date) || (b.time || "").localeCompare(a.time || "");
  switch (getPref("defaultSortOrder")) {
    case "dateAsc":
      return arr.sort(dateAsc);
    case "rating":
      return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0) || dateDesc(a, b)); // 无评分排最后
    case "tag":
      return arr.sort((a, b) => (a.tags[0] || "").localeCompare(b.tags[0] || "") || dateDesc(a, b)); // 按首个标签
    default:
      return arr.sort(dateDesc);
  }
}

/** 按月分组（list 已排序，分组自然按月份倒序） */
function groupByMonth(list) {
  const groups = [];
  let cur = null;
  for (const r of list) {
    const ym = r.date.slice(0, 7);
    if (!cur || cur.ym !== ym) {
      cur = { ym, label: DateUtils.getMonthLabel(ym), items: [] };
      groups.push(cur);
    }
    cur.items.push(r);
  }
  return groups;
}

/** 星星：填充 = 铅笔红；空星 = 弱化色轮廓（无评分全灰星）
 *  注意：空星类名用 blank，避免与空态容器 .empty 的 padding 规则冲突 */
function starsHtml(rating) {
  let h = "";
  for (let i = 1; i <= 5; i++) {
    const fill = rating && i <= rating;
    h += `<span class="star${fill ? " fill" : " blank"}">${fill ? ICONS.starFill : ICONS.star}</span>`;
  }
  return h;
}

/** 标签颜色（未找到时返回空，CSS 回退弱化色） */
function tagColor(name) {
  const t = DataModule.getTags().find((t) => t.name === name);
  return t ? t.color : "";
}

/** 单条记录卡片 HTML（data-date 供滚动联动取日期） */
function itemHtml(r) {
  const datePart = `${dateCN(r.date)} `; // 全量视图：每条记录都显示日期
  const timePart = r.time || "--:--"; // 时间占位
  const timeCls = r.time ? "tl-time" : "tl-time placeholder";
  const tags = r.tags && r.tags.length ? r.tags : [];
  // 主行标签（默认显示，铅笔手绘小 chip）
  const tagsInline = tags.length
    ? `<div class="tl-tags-inline">${tags.map((t) => `<span class="tl-tag" style="--tag-color:${tagColor(t)}"><i class="tag-dot" aria-hidden="true"></i>${esc(t)}</span>`).join("")}</div>`
    : "";
  // 展开详情：仅备注（标签已在主行默认显示，不再重复渲染）
  const detail = r.note
    ? `<div class="tl-detail"><div class="tl-note">${esc(r.note)}</div></div>`
    : "";
  const selected = batchMode && batchIds.has(r.id);
  return `<div class="tl-item${selected ? " selected" : ""}" data-id="${r.id}" data-date="${r.date}">
    <span class="tl-line" aria-hidden="true"></span>
    <span class="tl-dot${r.rating >= 4 ? " filled" : ""}" aria-hidden="true"></span>
    <div class="tl-actions" aria-hidden="true">
      <button type="button" class="act-btn act-edit" data-act="edit" data-id="${r.id}">${ICONS.edit}<span>编辑</span></button>
      <button type="button" class="act-btn act-del" data-act="del" data-id="${r.id}">${ICONS.trash}<span>删除</span></button>
    </div>
    <div class="tl-card" role="button" tabindex="0">
      <div class="tl-card-top">
        <span class="tl-stars">${starsHtml(r.rating)}</span>
        <span class="${timeCls}">${datePart}${timePart}</span>
      </div>
      ${tagsInline}
      ${detail}
    </div>
  </div>`;
}

/** 空态（SVG 插图 + 文案 + 添加按钮） */
function emptyHtml() {
  const plusSvg = ICONS.plus.replace("<svg", '<svg class="ic"');
  return `<div class="empty">
    <div class="empty-art" aria-hidden="true">${ICONS.empty}</div>
    <p class="empty-title">还没有任何记录</p>
    <p class="empty-desc">点击添加按钮，记录今天做了什么</p>
    <button type="button" class="btn-primary" id="empty-add">${plusSvg}添加记录</button>
  </div>`;
}

/** 骨架屏（加载态） */
export function renderSkeleton() {
  $("#timeline").innerHTML = Array.from({ length: 4 }, () => `
    <div class="skeleton-card">
      <div class="skeleton-line w40"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line w70"></div>
    </div>`).join("");
}

/**
 * 渲染 Timeline：全量时间线（时间倒序，最新在最上），按月分组标题。
 * 不做日期筛选——滚动浏览全部记录，日历联动负责高亮与定位。
 */
export function renderTimeline() {
  const head = $("#list-head");
  const tl = $("#timeline");
  const list = sortRecords(DataModule.getAllRecords());
  head.textContent = `全部记录 · 共 ${list.length} 条`;

  if (!list.length) {
    head.textContent = "";
    tl.innerHTML = emptyHtml();
    $("#empty-add").addEventListener("click", () => openForm(null));
    return;
  }

  const groups = groupByMonth(list);
  tl.innerHTML = groups
    .map(
      (g) => `<div class="tl-group" data-label="${g.label}">
      <h3 class="tl-group-title">${g.label}<span class="tl-count">(${g.items.length}条)</span></h3>
      ${g.items.map(itemHtml).join("")}
    </div>`
    )
    .join("");

  // 绑定每条记录的左滑与长按交互
  $$(".tl-item", tl).forEach((item) => {
    bindSwipe(item);
    bindLongPress(item);
  });
}

/* ============ 滚动联动工具（供入口编排） ============ */

/**
 * 可视区顶部第一条记录的日期（滚动联动取当前日期用）。
 * 独立容器滚动模型：可视起点 = timeline 容器顶部 + 8px 内容间距
 * （单周条在容器上方预留空间内，不参与容器坐标）。
 * @returns {string|null} "YYYY-MM-DD" 或 null（无记录）
 */
export function topVisibleDate() {
  const scroller = $("#timeline-scroll");
  const items = $$(".tl-item");
  if (!items.length) return null;
  const top = scroller.getBoundingClientRect().top + 8;
  for (const it of items) {
    if (it.getBoundingClientRect().top >= top) return it.dataset.date;
  }
  return items[items.length - 1].dataset.date; // 已滚过全部 → 取最后一条
}

/**
 * 滚动定位到某日期第一条记录（日历 / 单周条点选调用）。
 * 容器滚动模型三步：
 *   1. 同步强制折叠（布局稳定：单周条在预留空间内全显）
 *   2. 目标记录在容器内容中的自然位置 T（offsetTop 相对 .timeline-inner）
 *   3. 容器 scrollTop = T + COLLAPSE_RANGE：折叠阶段（0-600）内容不动，
 *      折叠完成后内容位移 = scrollTop - 600，目标记录恰好位于容器顶部 + 8px；
 *      最旧记录由 maxScroll 限位（列表底部自然停住 / 原生回弹，不越界）
 * @returns {boolean} 是否找到该日期记录
 */
export function scrollToDate(dateStr) {
  const item = $(`.tl-item[data-date="${dateStr}"]`);
  if (!item) return false;

  // 第一步：同步强制折叠（布局稳定）
  bus.emit("force-collapse");

  // 第二步：目标记录在容器内容中的自然位置（相对 .timeline-inner）
  const scroller = $("#timeline-scroll");
  const T = item.offsetTop;

  // 第三步：设置容器 scrollTop（折叠完成位之后内容位移 = scrollTop - 200，
  // 记录视觉位置 = padding(8) + 偏移(200) + T - scrollTop = 8 → scrollTop = T + 200）
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  const final = Math.max(0, Math.min(T + SCROLL.COLLAPSE_RANGE, maxScroll));
  scroller.scrollTop = final;
  return true;
}

/* ============ 卡片交互：展开 / 左滑 / 长按批量 ============ */

/** 左滑状态（鼠标拖动单例，触摸逐条处理） */
let swipe = null;

/** 左滑：显示编辑 / 删除（触摸逐条 + 鼠标单例） */
function bindSwipe(item) {
  const card = $(".tl-card", item);
  item.addEventListener(
    "touchstart",
    (e) => {
      if (batchMode) return;
      const t = e.touches[0];
      swipe = { item, card, startX: t.clientX, startY: t.clientY, dx: 0, moved: false };
    },
    { passive: true }
  );
  item.addEventListener(
    "touchmove",
    (e) => {
      if (swipe && swipe.item === item) swipeUpdate(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true }
  );
  item.addEventListener("touchend", () => {
    if (swipe && swipe.item === item) swipeEnd();
  });
  item.addEventListener("mousedown", (e) => {
    if (batchMode || e.button !== 0) return;
    swipe = { item, card, startX: e.clientX, startY: e.clientY, dx: 0, moved: false };
  });
}

function swipeUpdate(x, y) {
  const s = swipe;
  const dx = x - s.startX;
  const dy = y - s.startY;
  if (!s.moved) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      swipe = null; // 纵向滚动，交给页面滚动
      return;
    }
    s.moved = true;
  }
  s.dx = Math.min(0, Math.max(-LIMITS.SWIPE_MAX_PX, dx));
  s.card.style.transform = `translateX(${s.dx}px)`;
}

function swipeEnd() {
  const s = swipe;
  swipe = null;
  if (!s || !s.moved) return;
  const open = s.dx <= -LIMITS.SWIPE_OPEN_PX;
  if (open) {
    closeOtherSwipes(s.item);
    s.item.classList.add("swiped");
  } else {
    s.item.classList.remove("swiped");
  }
  setTimeout(() => {
    if (!s.item.classList.contains("swiped")) s.card.style.transform = "";
  }, 220);
}

function closeOtherSwipes(except) {
  $$(".tl-item.swiped").forEach((i) => {
    if (i !== except) i.classList.remove("swiped");
  });
}

/** 长按进入批量模式（触摸 550ms / 鼠标 600ms） */
function bindLongPress(item) {
  let timer = null;
  const start = () => {
    if (batchMode || uiState.tab !== "record") return;
    timer = setTimeout(() => {
      enterBatchMode(Number(item.dataset.id));
      if (navigator.vibrate) navigator.vibrate(15);
    }, LIMITS.LONG_PRESS_MS);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  item.addEventListener("touchstart", start, { passive: true });
  item.addEventListener("touchmove", cancel, { passive: true });
  item.addEventListener("touchend", cancel);
  item.addEventListener("mousedown", start);
  item.addEventListener("mousemove", cancel);
  item.addEventListener("mouseup", cancel);
}

/* ============ 批量删除 ============ */
let batchMode = false;
const batchIds = new Set();

function enterBatchMode(firstId) {
  batchMode = true;
  batchIds.clear();
  if (firstId) batchIds.add(firstId);
  document.body.classList.add("batch-mode");
  $("#batch-bar").hidden = false;
  closeOtherSwipes(null);
  updateBatchCount();
  // 同步选中态（不整体重渲染，保留滚动位置）
  $$(".tl-item").forEach((item) => {
    item.classList.toggle("selected", batchIds.has(Number(item.dataset.id)));
  });
}

function exitBatchMode() {
  batchMode = false;
  batchIds.clear();
  document.body.classList.remove("batch-mode");
  $("#batch-bar").hidden = true;
  renderTimeline();
}

function toggleSelect(id) {
  const num = Number(id);
  if (batchIds.has(num)) batchIds.delete(num);
  else batchIds.add(num);
  const item = $(`.tl-item[data-id="${id}"]`);
  if (item) item.classList.toggle("selected", batchIds.has(num));
  updateBatchCount();
}

function updateBatchCount() {
  $("#batch-count").textContent = `已选 ${batchIds.size} 条`;
}

/* ============ 删除 + 撤销（5 秒窗口，Toast 撤销按钮） ============ */

/** 删除记录（带撤销 Toast，LIMITS.DELETE_UNDO_MS 内可恢复） */
function removeRecords(recs, fromBatch = false) {
  const ids = recs.map((r) => r.id);
  DataModule.batchDelete(ids)
    .then(() => {
      if (fromBatch) exitBatchMode();
      renderTimeline();
      bus.emit("records-changed"); // 刷新日历记录标记
      showToast(`已删除 ${recs.length} 条记录`, {
        duration: TOAST_MS.UNDO,
        action: { label: "撤销", fn: () => restoreRecords(recs) },
      });
    })
    .catch((err) => {
      LoggerModule.error("删除记录失败", err && err.stack);
      showToast("删除失败，请重试", { type: "error" });
    });
}

/** 撤销删除：重新写入记录 */
async function restoreRecords(recs) {
  try {
    for (const r of recs) {
      await DataModule.addRecord({ date: r.date, time: r.time, rating: r.rating, note: r.note, tags: r.tags });
    }
    renderTimeline();
    bus.emit("records-changed");
    showToast("已恢复删除的记录");
  } catch (err) {
    LoggerModule.error("恢复记录失败", err && err.stack);
    showToast("恢复失败，请重试", { type: "error" });
  }
}

/* ============ 通用确认弹层（删除 / 批量删除） ============ */
let confirmCallback = null;

function showConfirm({ text, yesText = "删除", onYes }) {
  $("#confirm-text").textContent = text;
  $("#confirm-yes").textContent = yesText;
  confirmCallback = onYes;
  $("#confirm-mask").hidden = false;
  $("#confirm-modal").hidden = false;
  requestAnimationFrame(() => {
    $("#confirm-mask").classList.add("open");
    $("#confirm-modal").classList.add("open");
  });
  setBodyLock(true);
}

function hideConfirm() {
  confirmCallback = null;
  $("#confirm-mask").classList.remove("open");
  $("#confirm-modal").classList.remove("open");
  setTimeout(() => {
    $("#confirm-mask").hidden = true;
    $("#confirm-modal").hidden = true;
  }, 220);
  setBodyLock(false);
}

/* ============ 月份浮层（列表滚动提示） ============ */
let monthFloatLabel = "";
let monthFloatTimer = null;

function onPageScroll() {
  if (uiState.tab !== "record") return;
  const groups = $$(".tl-group");
  if (!groups.length) return;
  // 容器坐标：可视起点 = timeline 容器顶部 + 8px
  const containerTop = $("#timeline-scroll").getBoundingClientRect().top + 8;
  let current = groups[0].dataset.label;
  for (const g of groups) {
    if (g.getBoundingClientRect().top <= containerTop) current = g.dataset.label;
    else break;
  }
  showMonthFloat(current);
}

function showMonthFloat(label) {
  const el = $("#month-float");
  if (monthFloatLabel !== label) {
    monthFloatLabel = label;
    el.textContent = label;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth; // 强制回流，重触发淡入
    el.classList.add("show");
  }
  clearTimeout(monthFloatTimer);
  monthFloatTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => {
      el.hidden = true;
    }, 220);
  }, 800);
}

/* ============ 事件绑定（由 app.js 启动时调用一次） ============ */
export function bindListEvents() {
  // 订阅数据变更（添加 / 编辑保存 / 删除）→ 立即刷新列表（全量视图）
  bus.on("records-changed", renderTimeline);

  // 鼠标左滑（全局单例）
  document.addEventListener("mousemove", (e) => {
    if (swipe) swipeUpdate(e.clientX, e.clientY);
  });
  document.addEventListener("mouseup", () => {
    if (swipe) swipeEnd();
  });

  // 批量工具栏
  $("#batch-cancel").addEventListener("click", exitBatchMode);
  $("#batch-delete").addEventListener("click", () => {
    const recs = DataModule.getAllRecords().filter((r) => batchIds.has(r.id));
    if (!recs.length) return;
    showConfirm({
      text: `确定删除选中的 ${recs.length} 条记录？`,
      onYes: () => removeRecords(recs, true),
    });
  });

  // 确认弹层
  $("#confirm-yes").addEventListener("click", () => {
    const fn = confirmCallback;
    hideConfirm();
    if (fn) fn();
  });
  $("#confirm-no").addEventListener("click", hideConfirm);
  $("#confirm-mask").addEventListener("click", hideConfirm);

  // 列表：点击卡片展开 / 操作按钮（编辑 / 删除）
  $("#timeline").addEventListener("click", (e) => {
    // 左滑操作按钮
    const act = e.target.closest(".act-btn");
    if (act) {
      const rec = DataModule.getAllRecords().find((r) => r.id === Number(act.dataset.id));
      if (!rec) return;
      if (act.dataset.act === "edit") {
        openForm(rec);
      } else {
        showConfirm({ text: "确定删除这条记录？", onYes: () => removeRecords([rec]) });
      }
      return;
    }
    // 卡片：批量模式下切换选择；普通模式展开详情
    const card = e.target.closest(".tl-card");
    if (!card) return;
    const item = card.closest(".tl-item");
    const id = Number(item.dataset.id);
    if (batchMode) {
      toggleSelect(id);
      return;
    }
    if (swipe && swipe.item === item && swipe.moved) return; // 滑动后不触发点击
    $$(".tl-item.open").forEach((i) => {
      if (i !== item) i.classList.remove("open");
    });
    item.classList.toggle("open");
  });

  // 月份浮层（timeline 容器滚动监听）
  const scroller = $("#timeline-scroll");
  if (scroller) scroller.addEventListener("scroll", onPageScroll, { passive: true });
}

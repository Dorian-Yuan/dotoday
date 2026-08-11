/**
 * date-range-picker.js —— 日期范围选择器（DoToday v0.4.0）
 *
 * 统计页自定义时间范围：起止两日期，日历风格弹层（复用主日历 .cal-* 视觉）。
 * 规则：结束日期不可早于开始日期（自动跟随调整）、不可晚于今天（未来禁用）。
 * 确认后回调 onConfirm({start, end})。
 */

import { $, $$, setBodyLock } from "./common.js";
import { DateUtils } from "../pure/date-utils.js";
import { getPref } from "../config.js";

let drpYear = 0;
let drpMonth = 0;         // 面板当前显示年月（1-12）
let drpStart = "";        // "YYYY-MM-DD"
let drpEnd = "";
let activeTarget = "start"; // 当前编辑目标：start / end
let onConfirm = null;

/** 周起始日（与主日历一致） */
function weekStart() {
  return getPref("weekStartDay") === "sunday" ? "sunday" : "monday";
}

/**
 * 打开范围选择器：value = {start, end}（YYYY-MM-DD 或空）
 * onConfirmCb({start, end})：确认后回调
 */
export function openDateRangePicker({ start, end, onConfirm: cb }) {
  drpStart = start || DateUtils.addDays(DateUtils.todayStr(), -6);
  drpEnd = end || DateUtils.todayStr();
  if (drpEnd < drpStart) drpEnd = drpStart;
  activeTarget = "start";
  onConfirm = cb;
  const d = DateUtils.parseDate(drpStart);
  drpYear = d.getFullYear();
  drpMonth = d.getMonth() + 1;
  renderTargets();
  renderCalendar();
  $("#drp-mask").hidden = false;
  $("#drp-picker").hidden = false;
  requestAnimationFrame(() => {
    $("#drp-mask").classList.add("open");
    $("#drp-picker").classList.add("open");
  });
  setBodyLock(true);
}

export function closeDateRangePicker() {
  onConfirm = null;
  $("#drp-mask").classList.remove("open");
  $("#drp-picker").classList.remove("open");
  setTimeout(() => {
    $("#drp-mask").hidden = true;
    $("#drp-picker").hidden = true;
  }, 220);
  setBodyLock(false);
}

/** 渲染起止目标按钮（激活态高亮当前编辑目标）+ 操作提示 */
function renderTargets() {
  const d = DateUtils.parseDate(drpStart);
  $("#drp-start-btn").textContent = `开始日期：${d ? `${d.getMonth() + 1}月${d.getDate()}日` : "未选"}`;
  const e = DateUtils.parseDate(drpEnd);
  $("#drp-end-btn").textContent = `结束日期：${e ? `${e.getMonth() + 1}月${e.getDate()}日` : "未选"}`;
  $("#drp-start-btn").classList.toggle("on", activeTarget === "start");
  $("#drp-end-btn").classList.toggle("on", activeTarget === "end");
  // 操作提示：引导用户先选开始、再选结束
  const hint = $("#drp-hint");
  if (activeTarget === "start") {
    hint.innerHTML = "点击日历选择 <span class=\"accent\">开始</span> 日期";
  } else if (activeTarget === "end") {
    hint.innerHTML = "点击日历选择 <span class=\"accent\">结束</span> 日期";
  } else {
    hint.innerHTML = `范围：${dateCN(drpStart)} - ${dateCN(drpEnd)}`;
  }
}

/** 日期串 → "8月5日" */
function dateCN(d) {
  const x = DateUtils.parseDate(d);
  return x ? `${x.getMonth() + 1}月${x.getDate()}日` : d;
}

/** 渲染日历网格：今天标记、已选起止高亮、未来禁用 */
function renderCalendar() {
  $("#drp-month-label").textContent = `${drpYear}年${drpMonth}月`;
  const labels = weekStart() === "sunday" ? ["日", "一", "二", "三", "四", "五", "六"] : ["一", "二", "三", "四", "五", "六", "日"];
  $("#drp-weekdays").innerHTML = labels.map((l) => `<span>${l}</span>`).join("");
  const matrix = DateUtils.monthMatrix(drpYear, drpMonth, weekStart());
  const today = DateUtils.todayStr();
  $("#drp-grid").innerHTML = matrix.days
    .map((cell) => {
      const cls = ["cal-cell"];
      if (!cell.inMonth) cls.push("out");
      if (cell.date === today) cls.push("today");
      if (cell.date === drpStart || cell.date === drpEnd) cls.push("selected");
      // 起止区间内：淡色底
      if (cell.date > drpStart && cell.date < drpEnd) cls.push("in-range");
      const future = cell.date > today;
      return `<button type="button" class="${cls.join(" ")}" data-date="${cell.date}"${future ? " disabled" : ""}${cell.inMonth ? "" : ' tabindex="-1"'}>${cell.day}</button>`;
    })
    .join("");
}

/** 应用日期：结束不可早于开始（自动跟随）、不可晚于今天；选择开始后自动切到结束选择 */
function applyPick(dateStr) {
  if (activeTarget === "start") {
    drpStart = dateStr;
    if (drpEnd < drpStart) drpEnd = drpStart; // 结束跟随开始
    activeTarget = "end"; // 自动进入结束选择
  } else {
    drpEnd = dateStr;
    if (drpEnd < drpStart) drpStart = drpEnd; // 开始跟随结束
  }
  renderTargets();
  renderCalendar();
}

/** 绑定事件（由 app.js 启动时调用一次） */
export function bindDateRangePickerEvents() {
  $("#drp-start-btn").addEventListener("click", () => {
    activeTarget = "start";
    renderTargets();
  });
  $("#drp-end-btn").addEventListener("click", () => {
    activeTarget = "end";
    renderTargets();
  });
  $("#drp-prev").addEventListener("click", () => {
    const d = new Date(drpYear, drpMonth - 2, 1);
    drpYear = d.getFullYear();
    drpMonth = d.getMonth() + 1;
    renderCalendar();
  });
  $("#drp-next").addEventListener("click", () => {
    const d = new Date(drpYear, drpMonth, 1);
    drpYear = d.getFullYear();
    drpMonth = d.getMonth() + 1;
    renderCalendar();
  });
  $("#drp-grid").addEventListener("click", (e) => {
    const cell = e.target.closest(".cal-cell");
    if (!cell || cell.disabled || !cell.dataset.date) return;
    applyPick(cell.dataset.date);
  });
  $("#drp-ok").addEventListener("click", () => {
    const cb = onConfirm;
    closeDateRangePicker();
    if (cb) cb({ start: drpStart, end: drpEnd });
  });
  $("#drp-cancel").addEventListener("click", closeDateRangePicker);
  $("#drp-mask").addEventListener("click", closeDateRangePicker);
}

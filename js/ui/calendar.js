/**
 * calendar.js —— 主日历组件（DoToday v0.2.0）
 *
 * 网格渲染（周起始对齐）/ 月切换（滑动动画）/ 年月选择器弹层 /
 * 今天按钮 / 记录日深浅标记 / 今天铅笔红 / 选中日期 /
 * 折叠单周条（滚动联动）/ 跨月跟随（setCalendarDate）。
 * 点击日期 → bus.emit("date-picked", date)，由入口编排列表滚动定位。
 */

import { $, $$, pad2, setBodyLock, bus } from "./common.js";
import { uiState } from "./state.js";
import { DateUtils } from "../pure/date-utils.js";
import { DataModule } from "../data.js";
import { getPref, SCROLL } from "../config.js";

/** 周起始日（默认周一，配置可切换） */
function weekStart() {
  return getPref("weekStartDay") === "sunday" ? "sunday" : "monday";
}

/** 周标题（按周起始日对齐） */
function renderWeekdays() {
  const labels = weekStart() === "sunday" ? ["日", "一", "二", "三", "四", "五", "六"] : ["一", "二", "三", "四", "五", "六", "日"];
  $("#cal-weekdays").innerHTML = labels.map((l) => `<span>${l}</span>`).join("");
}

/** 渲染日历网格：记录日按条数深浅标记，今天铅笔红，选中实底 */
export function renderCalendar() {
  $("#cal-month-label").textContent = `${uiState.calYear}年${uiState.calMonth}月`;
  renderWeekdays();

  const matrix = DateUtils.monthMatrix(uiState.calYear, uiState.calMonth, weekStart());
  // 本月每日记录数统计（数据以 DataModule 为唯一事实源）
  const prefix = `${uiState.calYear}-${pad2(uiState.calMonth)}`;
  const counts = {};
  for (const r of DataModule.getAllRecords()) {
    if (r.date.startsWith(prefix)) counts[r.date] = (counts[r.date] || 0) + 1;
  }
  const today = DateUtils.todayStr();

  $("#cal-grid").innerHTML = matrix.days
    .map((cell) => {
      const n = counts[cell.date] || 0;
      const cls = ["cal-cell"];
      if (!cell.inMonth) cls.push("out"); // 补位格弱化
      if (cell.date === today) cls.push("today"); // 今天：铅笔红
      if (cell.date === uiState.selectedDate) cls.push("selected");
      if (n > 0) {
        cls.push("has-record"); // 有记录：虚线圈住数字
        cls.push(n >= 4 ? "lvl3" : n >= 2 ? "lvl2" : "lvl1");
        if (cell.date === today) cls.push("today-record");
      }
      return `<button type="button" class="${cls.join(" ")}" data-date="${cell.date}"${cell.inMonth ? "" : ' tabindex="-1"'}>${cell.day}</button>`;
    })
    .join("");
}

/** 切换月份（带滑动动画，0.2s） */
export function shiftMonth(delta) {
  const d = new Date(uiState.calYear, uiState.calMonth - 1 + delta, 1);
  uiState.calYear = d.getFullYear();
  uiState.calMonth = d.getMonth() + 1;
  const grid = $("#cal-grid");
  grid.classList.add(delta > 0 ? "slide-in-left" : "slide-in-right");
  renderCalendar();
  setTimeout(() => grid.classList.remove("slide-in-left", "slide-in-right"), 260);
}

/** 今天按钮：回到今天所在月并选中今天，通知入口定位列表（含点选保护） */
export function goToday() {
  const t = DateUtils.todayStr();
  uiState.pickGuardUntil = Date.now() + SCROLL.PICK_GUARD_MS; // 用户点选：保护期内跟随不覆盖
  setCalendarDate(t);
  bus.emit("date-picked", t);
}

/* ============ 折叠单周条（滚动联动） ============ */

/**
 * 渲染折叠单周条：选中日期所在的一周 7 天（周起始规则与主日历一致）。
 * 今天铅笔红、选中实底、有记录显示小圆点。
 */
export function renderWeekStrip() {
  const strip = $("#cal-week-strip");
  const d = DateUtils.parseDate(uiState.selectedDate || DateUtils.todayStr());
  if (!d) return;
  const matrix = DateUtils.monthMatrix(d.getFullYear(), d.getMonth() + 1, weekStart());
  const idx = matrix.days.findIndex((c) => c.date === uiState.selectedDate);
  if (idx < 0) return;
  const rowStart = Math.floor(idx / 7) * 7;
  const row = matrix.days.slice(rowStart, rowStart + 7);
  const labels = weekStart() === "sunday" ? ["日", "一", "二", "三", "四", "五", "六"] : ["一", "二", "三", "四", "五", "六", "日"];
  const today = DateUtils.todayStr();
  const records = DataModule.getAllRecords();
  strip.innerHTML = row
    .map((c, i) => {
      const cls = ["strip-cell"];
      if (c.date === today) cls.push("today");
      if (c.date === uiState.selectedDate) cls.push("selected");
      if (records.some((r) => r.date === c.date)) cls.push("has-record");
      return `<div class="${cls.join(" ")}" data-date="${c.date}">
        <span class="strip-day">${labels[i]}</span>
        <span class="strip-num">${c.day}</span>
      </div>`;
    })
    .join("");
}

/**
 * 设置日历选中日期（滚动联动 / 今天按钮调用）：
 * 跨月自动切换月份并重渲染完整月历；同月仅轻量更新选中高亮；同步单周条。
 */
export function setCalendarDate(dateStr) {
  const d = DateUtils.parseDate(dateStr);
  if (!d) return;
  uiState.selectedDate = dateStr; // 先赋值：renderCalendar 依赖它标 selected
  if (d.getFullYear() !== uiState.calYear || d.getMonth() + 1 !== uiState.calMonth) {
    uiState.calYear = d.getFullYear();
    uiState.calMonth = d.getMonth() + 1;
    renderCalendar();
  } else {
    // 同月：轻量更新选中态（不重渲染整月，避免滚动中闪烁）
    $$(".cal-cell").forEach((c) => c.classList.toggle("selected", c.dataset.date === dateStr));
  }
  renderWeekStrip();
}

/* ============ 年月选择器弹层 ============ */
let ymYear = 0;
let ymMonth = 0;

export function openYmPicker() {
  ymYear = uiState.calYear;
  ymMonth = uiState.calMonth;
  $("#ym-year-text").textContent = ymYear;
  renderYmMonths();
  $("#ym-mask").hidden = false;
  $("#ym-picker").hidden = false;
  requestAnimationFrame(() => {
    $("#ym-mask").classList.add("open");
    $("#ym-picker").classList.add("open");
  });
  setBodyLock(true);
}

function renderYmMonths() {
  $("#ym-months").innerHTML = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return `<button type="button" class="ym-month${m === ymMonth ? " on" : ""}" data-m="${m}">${m}月</button>`;
  }).join("");
}

function closeYmPicker() {
  $("#ym-mask").classList.remove("open");
  $("#ym-picker").classList.remove("open");
  setTimeout(() => {
    $("#ym-mask").hidden = true;
    $("#ym-picker").hidden = true;
  }, 220);
  setBodyLock(false);
}

/** 绑定日历与年月选择器事件（由 app.js 启动时调用一次） */
export function bindCalendarEvents() {
  // 月切换 / 今天 / 月份名
  $("#cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("#cal-next").addEventListener("click", () => shiftMonth(1));
  $("#cal-today").addEventListener("click", goToday);
  $("#cal-month-label").addEventListener("click", openYmPicker);

  // 日历格点击：选中该日期（全量视图不筛选列表），通知入口滚动定位到该日记录
  $("#cal-grid").addEventListener("click", (e) => {
    const cell = e.target.closest(".cal-cell");
    if (!cell || !cell.dataset.date) return;
    const date = cell.dataset.date;
    uiState.pickGuardUntil = Date.now() + SCROLL.PICK_GUARD_MS; // 用户点选：保护期内跟随不覆盖
    setCalendarDate(date); // 内部处理选中态 / 跨月切月 / 单周条同步
    bus.emit("date-picked", date);
  });

  // 折叠单周条日期格点击：与完整日历行为一致（更新选中、跨月切月、定位列表）
  $("#cal-week-strip").addEventListener("click", (e) => {
    const cell = e.target.closest(".strip-cell");
    if (!cell || !cell.dataset.date) return;
    const date = cell.dataset.date;
    uiState.pickGuardUntil = Date.now() + SCROLL.PICK_GUARD_MS; // 用户点选：保护期内跟随不覆盖
    setCalendarDate(date); // 内部处理选中态 / 跨月切月 / 单周条同步
    bus.emit("date-picked", date); // 入口监听 → 列表滚动定位（含折叠偏移）
  });

  // 年月选择器
  $("#ym-year-prev").addEventListener("click", () => {
    ymYear--;
    $("#ym-year-text").textContent = ymYear;
  });
  $("#ym-year-next").addEventListener("click", () => {
    ymYear++;
    $("#ym-year-text").textContent = ymYear;
  });
  $("#ym-months").addEventListener("click", (e) => {
    const b = e.target.closest(".ym-month");
    if (!b) return;
    ymMonth = Number(b.dataset.m);
    renderYmMonths();
  });
  $("#ym-ok").addEventListener("click", () => {
    uiState.calYear = ymYear;
    uiState.calMonth = ymMonth;
    closeYmPicker();
    renderCalendar();
  });
  $("#ym-cancel").addEventListener("click", closeYmPicker);
  $("#ym-mask").addEventListener("click", closeYmPicker);
}

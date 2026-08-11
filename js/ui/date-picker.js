/**
 * date-picker.js —— 表单日期选择面板（DoToday v0.1.1）
 *
 * 自定义小月历（替代原生 input[type=date]，规避 WebKit 宽度不可控），
 * 样式与主日历一致（复用 .cal-* 类）。点选日期即应用并关闭。
 * 通过回调与表单通信：openDatePicker({ value, onChange })。
 * 未来日期禁用（禁止未来日期逻辑）。
 */

import { $, setBodyLock } from "./common.js";
import { DateUtils } from "../pure/date-utils.js";
import { getPref } from "../config.js";

let dpYear = 0;
let dpMonth = 0;      // 面板当前显示年月（1-12）
let dpSelDate = "";   // 面板内暂选日期
let onChange = null;  // 点选回调（表单注入：更新 formDate 并渲染）

/** 打开面板：定位到当前已选日期所在月，已选日期高亮 */
export function openDatePicker({ value, onChange: cb }) {
  const d = DateUtils.parseDate(value || DateUtils.todayStr());
  dpYear = d.getFullYear();
  dpMonth = d.getMonth() + 1;
  dpSelDate = value || DateUtils.todayStr();
  onChange = cb;
  renderDatePicker();
  $("#dp-mask").hidden = false;
  $("#date-picker").hidden = false;
  requestAnimationFrame(() => {
    $("#dp-mask").classList.add("open");
    $("#date-picker").classList.add("open");
  });
  setBodyLock(true);
}

export function closeDatePicker() {
  onChange = null;
  $("#dp-mask").classList.remove("open");
  $("#date-picker").classList.remove("open");
  setTimeout(() => {
    $("#dp-mask").hidden = true;
    $("#date-picker").hidden = true;
  }, 220);
  setBodyLock(false);
}

/** 渲染面板月历：复用主日历样式，未来日期禁用 */
function renderDatePicker() {
  $("#dp-month-label").textContent = `${dpYear}年${dpMonth}月`;
  const labels = getPref("weekStartDay") === "sunday" ? ["日", "一", "二", "三", "四", "五", "六"] : ["一", "二", "三", "四", "五", "六", "日"];
  $("#dp-weekdays").innerHTML = labels.map((l) => `<span>${l}</span>`).join("");
  const matrix = DateUtils.monthMatrix(dpYear, dpMonth, getPref("weekStartDay") === "sunday" ? "sunday" : "monday");
  const today = DateUtils.todayStr();
  $("#dp-grid").innerHTML = matrix.days
    .map((cell) => {
      const cls = ["cal-cell"];
      if (!cell.inMonth) cls.push("out");
      if (cell.date === today) cls.push("today"); // 今天铅笔红
      if (cell.date === dpSelDate) cls.push("selected");
      const future = cell.date > today;
      return `<button type="button" class="${cls.join(" ")}" data-date="${cell.date}"${future ? " disabled" : ""}${cell.inMonth ? "" : ' tabindex="-1"'}>${cell.day}</button>`;
    })
    .join("");
}

/** 点选日期：应用并关闭 */
function pickDate(dateStr) {
  const cb = onChange;
  closeDatePicker();
  if (cb) cb(dateStr);
}

/** 绑定日期面板事件（由 app.js 启动时调用一次） */
export function bindDatePickerEvents() {
  $("#dp-prev").addEventListener("click", () => {
    const d = new Date(dpYear, dpMonth - 2, 1); // 上个月
    dpYear = d.getFullYear();
    dpMonth = d.getMonth() + 1;
    renderDatePicker();
  });
  $("#dp-next").addEventListener("click", () => {
    const d = new Date(dpYear, dpMonth, 1); // 下个月
    dpYear = d.getFullYear();
    dpMonth = d.getMonth() + 1;
    renderDatePicker();
  });
  $("#dp-today").addEventListener("click", () => pickDate(DateUtils.todayStr()));
  $("#dp-cancel").addEventListener("click", closeDatePicker);
  $("#dp-mask").addEventListener("click", closeDatePicker);
  $("#dp-grid").addEventListener("click", (e) => {
    const cell = e.target.closest(".cal-cell");
    if (!cell || cell.disabled || !cell.dataset.date) return;
    pickDate(cell.dataset.date); // 点选即应用并关闭
  });
}

/**
 * time-wheel.js —— 时间滚轮选择器（DoToday v0.1.1）
 *
 * 自定义滚轮式时间选择（精确到分钟），可清除。
 * 通过回调与表单通信：openTimeWheel({ value, onConfirm, onClear })。
 * 定位算法：把目标项滚动到可视区中央（scrollTop 几何计算，无需 padding 补偿），
 * 首尾项自动钳制（仍可见可点）；定位/点击后短暂抑制 scroll 回调，避免高亮被覆盖。
 */

import { $, pad2 } from "./common.js";
import { LIMITS } from "../config.js";

const WHEEL_ITEM_H = LIMITS.WHEEL_ITEM_H; // 滚轮单项高度（与 css .wheel-item 一致）
const SUPPRESS_MS = 120; // 定位/点击后抑制滚动回调的时长

let wheelHour = 0;
let wheelMin = 0;
let wheelPickedAt = 0; // 定位/点击抑制时间戳
let callbacks = null;  // 当前打开的回调 { onConfirm, onClear }

/** 滚轮定位：把第 index 项（0 起）滚动到可视区中央；首尾项自动钳制 */
function scrollWheelTo(el, index) {
  const max = el.scrollHeight - el.clientHeight;
  const target = index * WHEEL_ITEM_H - (el.clientHeight - WHEEL_ITEM_H) / 2;
  el.scrollTop = Math.max(0, Math.min(max, target));
}

/** 可视区中央对应的项索引（滚动中的实时值） */
function wheelIndexAt(el) {
  return Math.round((el.scrollTop + el.clientHeight / 2 - WHEEL_ITEM_H / 2) / WHEEL_ITEM_H);
}

function buildWheel(el, min, max, value) {
  el.innerHTML = "";
  for (let i = min; i <= max; i++) {
    const d = document.createElement("div");
    d.className = "wheel-item" + (i === value ? " on" : "");
    d.textContent = pad2(i);
    d.dataset.idx = i - min; // 相对索引（0 起）
    el.appendChild(d);
  }
  // 展开时自动定位到当前值（未选过 = 此刻时间；选过 = 已选值），滚到可视区中央
  wheelPickedAt = Date.now(); // 抑制定位触发的 scroll 回调（首尾项无法居中时保持高亮）
  scrollWheelTo(el, value - min);
}

function bindWheelScroll(el, onPick) {
  let timer = null;
  const highlight = (idx) => {
    [...el.children].forEach((c, i) => c.classList.toggle("on", i === idx));
  };
  el.addEventListener(
    "scroll",
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (Date.now() - wheelPickedAt < SUPPRESS_MS) return; // 定位/点击刚发生，跳过本次回调
        const idx = Math.max(0, Math.min(el.children.length - 1, wheelIndexAt(el)));
        highlight(idx);
        onPick(idx);
      }, 60);
    },
    { passive: true }
  );
  // 点击单项：直接选中 + 高亮 + 滚动定位（不依赖中心计算）
  el.addEventListener("click", (e) => {
    const item = e.target.closest(".wheel-item");
    if (!item) return;
    const idx = Number(item.dataset.idx);
    wheelPickedAt = Date.now();
    highlight(idx);
    onPick(idx);
    scrollWheelTo(el, idx);
  });
}

/**
 * 打开滚轮面板并定位到当前值
 * @param {{value: string|null, onConfirm: function, onClear: function}} opts
 *   value 为 "HH:mm" 或 null（null 时定位到此刻时间）；onConfirm(time) / onClear() 由表单注入
 */
export function openTimeWheel({ value, onConfirm, onClear }) {
  const panel = $("#wheel-panel");
  const now = new Date();
  wheelHour = value ? Number(value.slice(0, 2)) : now.getHours();
  wheelMin = value ? Number(value.slice(3, 5)) : now.getMinutes();
  callbacks = { onConfirm, onClear };
  // 先显示面板再构建滚轮，保证 clientHeight 可读（居中定位公式依赖）
  panel.hidden = false;
  buildWheel($("#wheel-hour"), 0, 23, wheelHour);
  buildWheel($("#wheel-minute"), 0, 59, wheelMin);
}

/** 关闭滚轮面板（清空回调） */
export function closeTimeWheel() {
  $("#wheel-panel").hidden = true;
  callbacks = null;
}

/** 绑定滚轮面板事件（由 app.js 启动时调用一次） */
export function bindTimeWheelEvents() {
  bindWheelScroll($("#wheel-hour"), (i) => (wheelHour = i));
  bindWheelScroll($("#wheel-minute"), (i) => (wheelMin = i));
  // 确定：应用所选时间
  $("#wheel-ok").addEventListener("click", () => {
    const time = `${pad2(wheelHour)}:${pad2(wheelMin)}`;
    const cb = callbacks;
    closeTimeWheel();
    if (cb) cb.onConfirm(time);
  });
  // 清除：不填时间
  $("#wheel-clear").addEventListener("click", () => {
    const cb = callbacks;
    closeTimeWheel();
    if (cb) cb.onClear();
  });
  // 取消：放弃选择
  $("#wheel-cancel").addEventListener("click", closeTimeWheel);
}

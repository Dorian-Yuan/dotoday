/**
 * toast.js —— Toast 组件（DoToday v0.1.1）
 *
 * 成功 / 错误提示，可携带撤销动作按钮（如删除后 5 秒内撤销）。
 */

import { $, esc } from "./common.js";
import { TOAST_MS } from "../config.js";

let toastTimer = null;

/** 显示 Toast：showToast(msg, { type, duration, action: {label, fn} }) */
export function showToast(msg, opts = {}) {
  const { type = "info", duration = TOAST_MS.DEFAULT, action = null } = opts;
  const el = $("#toast");
  el.hidden = false;
  el.className = "toast show" + (type === "error" ? " error" : "");
  el.innerHTML =
    `<span class="toast-msg">${esc(msg)}</span>` +
    (action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : "");
  if (action) {
    $(".toast-action", el).addEventListener("click", () => {
      clearTimeout(toastTimer);
      hideToast();
      action.fn();
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

/** 隐藏 Toast（滑出动画后隐藏节点） */
export function hideToast() {
  const el = $("#toast");
  el.classList.remove("show");
  setTimeout(() => {
    el.hidden = true;
  }, 220);
}

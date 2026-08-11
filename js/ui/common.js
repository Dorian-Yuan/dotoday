/**
 * common.js —— UI 公共工具（DoToday v0.1.1）
 *
 * DOM 简写 / HTML 转义 / 补零 / 中文日期显示 / 页面滚动锁定，
 * 以及轻量事件总线（模块间通信，避免引入框架）。
 */

import { DateUtils } from "../pure/date-utils.js";

/** DOM 简写：querySelector */
export const $ = (sel, root = document) => root.querySelector(sel);

/** DOM 简写：querySelectorAll → 数组 */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** HTML 转义（用户内容防注入） */
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 两位补零 */
export const pad2 = (n) => String(n).padStart(2, "0");

/** 日期串 → "8月11日"（同一年内省略年份） */
export function dateCN(dateStr) {
  const d = DateUtils.parseDate(dateStr);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日` : dateStr;
}

/** 完整日期显示："2026-08-11" → "2026年8月11日"（表单日期框用） */
export function dateFullCN(dateStr) {
  const d = DateUtils.parseDate(dateStr);
  return d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : dateStr;
}

/** 页面滚动锁定（表单 / 弹层打开时） */
export function setBodyLock(lock) {
  document.body.style.overflow = lock ? "hidden" : "";
}

/**
 * 轻量事件总线：模块间通信
 * 用法：bus.on("records-changed", fn) / bus.emit("records-changed")
 * 约定事件：records-changed（数据增删改后，刷新日历标记与列表）、
 *          date-picked（日历点选日期后，列表滚动定位）
 */
export const bus = {
  _handlers: {},
  /** 订阅事件 */
  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  },
  /** 取消订阅 */
  off(event, fn) {
    const list = this._handlers[event];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  },
  /** 发布事件（同步调用所有订阅者） */
  emit(event, data) {
    const list = this._handlers[event];
    if (!list) return;
    for (const fn of list.slice()) fn(data);
  },
};

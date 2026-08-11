/**
 * tabs.js —— Tab 路由（DoToday v0.1.1）
 *
 * 记录 / 统计 / 设置三页切换，滑块滑动动画（0.2s）。
 */

import { $, $$, bus } from "./common.js";
import { uiState } from "./state.js";

const TAB_ORDER = ["record", "stats", "settings"];

/** 切换 Tab：页面显隐 + 激活态 + 滑块位移（通知入口按需渲染统计页） */
export function switchTab(name) {
  uiState.tab = name;
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
  $$(".tab-item").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("#tab-slider").style.transform = `translateX(${TAB_ORDER.indexOf(name) * 100}%)`;
  bus.emit("tab-changed", name);
}

/** 绑定 Tab 栏点击事件（由 app.js 启动时调用一次） */
export function bindTabs() {
  $("#tabbar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-item");
    if (btn) switchTab(btn.dataset.tab);
  });
}

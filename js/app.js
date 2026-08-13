/**
 * app.js —— DoToday 应用入口（v0.2.0）
 *
 * 职责（入口层）：
 *   启动初始化（图标注入、配置加载、组件事件绑定、DataModule.init）、
 *   首屏渲染（日历 + 单周条 + 列表）、Service Worker 注册、首次使用欢迎提示、
 *   跨组件编排：records-changed → 刷新日历标记；date-picked → 列表滚动定位；
 *   【主界面滚动联动】rAF 节流监听滚动：日历折叠为单周 + 添加按钮隐藏、
 *   可视区日期跟随（跨月自动切月）、下滑回滚恢复。
 *
 * 页面逻辑在 js/ui/ 各组件模块，本文件负责组装与联动编排。
 */

import { $, $$, bus } from "./ui/common.js";
import { uiState } from "./ui/state.js";
import { DateUtils } from "./pure/date-utils.js";
import { DataModule } from "./data.js";
import { LoggerModule } from "./logger.js";
import { ICONS } from "./icon-config.js";
import { APP_VERSION, loadConfig, saveConfig, getPref, TOAST_MS, SCROLL } from "./config.js";
import { showToast } from "./ui/toast.js";
import { bindTabs } from "./ui/tabs.js";
import { renderCalendar, renderWeekStrip, setCalendarDate, bindCalendarEvents } from "./ui/calendar.js";
import { renderTimeline, renderSkeleton, scrollToDate, topVisibleDate, bindListEvents } from "./ui/list.js";
import { openForm, bindFormEvents } from "./ui/form.js";
import { bindDatePickerEvents } from "./ui/date-picker.js";
import { bindTimeWheelEvents } from "./ui/time-wheel.js";
import { initStatsPage, renderStatsPage } from "./ui/stats-page.js";
import { initSettingsPage, renderSettingsPage, applyChartColors } from "./ui/settings-page.js";
import { bindDateRangePickerEvents } from "./ui/date-range-picker.js";

/* ============ 图标注入（静态 data-icon 占位） ============ */
function renderStaticIcons() {
  $$("[data-icon]").forEach((el) => {
    const name = el.dataset.icon;
    if (ICONS[name]) el.innerHTML = ICONS[name].replace("<svg", '<svg class="ic"');
  });
}

/* ============ Service Worker 注册（module 类型，失败静默，渐进增强） ============ */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("./sw.js", { type: "module" })
    .then(() => {
      // 新版本 SW 激活后提示刷新（sw.js activate 发送 SW_UPDATE_READY）
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data && e.data.type === "SW_UPDATE_READY") {
          showToast("发现新版本，请刷新页面后使用", { duration: 4000 });
        }
      });
    })
    .catch((err) => {
      LoggerModule.warn("Service Worker 注册失败（不影响使用）: " + err.message);
    });
}

/* ============ 主界面滚动联动（timeline 容器滚动驱动折叠 + 日期跟随） ============ */
let scrollTicking = false; // rAF 节流标记
let collapsed = false;     // 折叠 class 状态
let collapseProgress = 0;  // 当前折叠进度 0→1（指数趋近目标，可中断 / 可暂停）
let lastFollowAt = 0;      // 日期跟随节流时间戳
let lastInnerOffset = -1;  // 内容偏移上一次值（避免重复写 transform）

/** 滚动帧处理：折叠进度连续插值 + 内容偏移抵消 + 折叠状态判定 + 日期跟随 */
function onScrollFrame() {
  scrollTicking = false;
  if (uiState.tab !== "record") return;

  const scroller = $("#timeline-scroll");
  const y = scroller.scrollTop;
  // 回顶（scrollTop=0）：取消强制折叠（点击定位的折叠保持），恢复滚动驱动展开
  if (y <= 1 && uiState.forcedCollapse) {
    uiState.forcedCollapse = false;
  }
  // 目标进度：强制折叠恒为 1；否则容器 scrollTop 0→COLLAPSE_RANGE 映射 0→1
  const target = uiState.forcedCollapse ? 1 : Math.max(0, Math.min(1, y / SCROLL.COLLAPSE_RANGE));
  // 指数趋近平滑：滚动停下进度自然收敛（0.3.1 系数 0.3→0.1，收敛动画放慢约 3 倍）
  collapseProgress += (target - collapseProgress) * 0.3;
  const settled = Math.abs(target - collapseProgress) < 0.004;
  if (settled) collapseProgress = target;
  document.documentElement.style.setProperty("--collapse-progress", collapseProgress.toFixed(4));

  // 折叠阶段（scrollTop 0-200px）内容偏移抵消：内容视觉不动（先折叠、后滚动）
  const innerOffset = Math.min(y, SCROLL.COLLAPSE_RANGE);
  if (innerOffset !== lastInnerOffset) {
    lastInnerOffset = innerOffset;
    $("#timeline-inner").style.transform = `translateY(${innerOffset}px)`;
  }

  // 折叠 class 判定（hysteresis：>0.6 折叠、<0.4 展开，避免临界抖动）
  const flag = collapseProgress > 0.6;
  if (flag !== collapsed) {
    collapsed = flag;
    document.body.classList.toggle("cal-collapsed", collapsed);
  }

  // 进度未收敛：滚动已停止但动画需继续趋近目标（自驱动下一帧）
  if (!settled) {
    scrollTicking = true;
    requestAnimationFrame(onScrollFrame);
  }

  // 可视区日期跟随：用户点选保护窗口内跳过（保留点选日期）
  if (Date.now() < uiState.pickGuardUntil) return;
  const date = topVisibleDate();
  if (date && date !== uiState.selectedDate) {
    // 跨月（月份变化）即时切月重渲染；同月内跟随做最小间隔节流
    const crossMonth = date.slice(0, 7) !== `${uiState.calYear}-${String(uiState.calMonth).padStart(2, "0")}`;
    const now = Date.now();
    if (crossMonth || now - lastFollowAt >= SCROLL.FOLLOW_MS) {
      lastFollowAt = now;
      setCalendarDate(date);
    }
  }
}

/** 滚动监听（timeline 容器，rAF 节流，passive）+ 强制折叠管理 */
function bindScrollLink() {
  // 强制完整折叠（点击定位调用）：同步收敛布局（单周条全显），
  // scrollToDate 的定位计算依赖稳定布局；保持折叠态直到用户交互（forcedCollapse）
  bus.on("force-collapse", () => {
    uiState.forcedCollapse = true;
    collapseProgress = 1;
    document.documentElement.style.setProperty("--collapse-progress", "1");
    if (!collapsed) {
      collapsed = true;
      document.body.classList.add("cal-collapsed");
    }
  });
  // 用户任何滚动 / 触摸 / 鼠标交互后取消强制折叠，恢复滚动驱动（并主动调度一帧）
  ["touchstart", "mousedown", "wheel"].forEach((evt) => {
    window.addEventListener(
      evt,
      () => {
        if (uiState.forcedCollapse) {
          uiState.forcedCollapse = false;
          if (!scrollTicking) {
            scrollTicking = true;
            requestAnimationFrame(onScrollFrame);
          }
        }
      },
      { passive: true }
    );
  });
  const scroller = $("#timeline-scroll");
  if (scroller) {
    scroller.addEventListener(
      "scroll",
      () => {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(onScrollFrame);
      },
      { passive: true }
    );
  }
}

/* ============ 启动 ============ */
function init() {
  renderStaticIcons();
  loadConfig(); // 生成/读取应用配置（localStorage，plan 5.2）
  applyChartColors(getPref("heatmapColor")); // 启动即应用已保存的图表配色（--chart-1..5，页面刷新后需重建）
  bindTabs();
  bindCalendarEvents();
  bindListEvents();
  bindFormEvents();
  bindDatePickerEvents();
  bindTimeWheelEvents();
  bindScrollLink();
  initStatsPage();
  bindDateRangePickerEvents();
  initSettingsPage();

  // 切到统计 Tab 时渲染/刷新统计页；切到设置 Tab 时渲染设置页（选项选中态/色板/版本）
  bus.on("tab-changed", (name) => {
    if (name === "stats") renderStatsPage();
    if (name === "settings") renderSettingsPage();
  });

  // 设置变更（周起始日/排序/热力图主色）即时生效：重渲染日历、单周条与列表
  // （统计页热力图主色变量已在 settings-page 内直接应用，切 Tab 时自然生效）
  bus.on("config-changed", () => {
    renderCalendar();
    renderWeekStrip();
    renderTimeline();
  });

  // 数据变更后刷新日历记录标记与单周条（列表由 list.js 内部自行刷新）
  bus.on("records-changed", () => {
    renderCalendar();
    renderWeekStrip();
  });
  // 日历点选日期 → 列表滚动定位（保持全量视图）
  bus.on("date-picked", (date) => scrollToDate(date));

  // 添加记录按钮（入口级）
  $("#btn-add").addEventListener("click", () => openForm(null));

  // 日历初始：当前月，默认选中今天
  const now = new Date();
  uiState.calYear = now.getFullYear();
  uiState.calMonth = now.getMonth() + 1;
  uiState.selectedDate = DateUtils.todayStr();

  renderSkeleton();
  bootstrap();
}

async function bootstrap() {
  try {
    await DataModule.init(); // 打开 IndexedDB、加载数据、每日备份
  } catch (err) {
    LoggerModule.error("数据初始化失败", err && err.stack);
    showToast("数据初始化失败，请检查浏览器存储", { type: "error", duration: TOAST_MS.ERROR });
  }
  renderCalendar();
  renderWeekStrip();
  renderTimeline();
  registerSW();

  // 首次使用欢迎提示
  const config = loadConfig();
  if (!config.createdAt) {
    config.createdAt = Date.now();
    saveConfig(config);
    setTimeout(() => showToast("欢迎使用 DoToday，点击下方按钮开始记录", { duration: TOAST_MS.WELCOME }), 600);
  }
  LoggerModule.info(`DoToday v${APP_VERSION} 启动完成`);
}

init();

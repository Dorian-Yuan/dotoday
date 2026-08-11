/**
 * state.js —— 跨模块共享 UI 状态（DoToday v0.2.5）
 *
 * 仅存放跨模块共享的轻量 UI 状态（日历年月、选中日期、当前 Tab、
 * 点选保护窗口）。数据本体始终以 DataModule（IndexedDB 内存镜像）
 * 为唯一事实源，各模块按需直接调用 DataModule 读取，不在此维护数据副本。
 */

export const uiState = {
  tab: "record",          // 当前 Tab：record / stats / settings
  calYear: 0,             // 日历显示年份
  calMonth: 0,            // 日历显示月份（1-12）
  selectedDate: null,     // 日历选中日期（null = 显示全部时间线）
  pickGuardUntil: 0,      // 用户点选保护窗口截止时间戳：期间滚动跟随不覆盖选中
  forcedCollapse: false,  // 强制折叠（点击定位）：同步折叠后保持，用户交互/回顶后取消
};

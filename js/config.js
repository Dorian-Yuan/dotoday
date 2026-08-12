/**
 * config.js —— DoToday 应用常量与配置管理（v0.1.1）
 *
 * 集中所有应用常量（版本号 / 存储键 / 色板 / 限制值 / 缓存名等），
 * 所有 js 模块统一从这里 import，禁止散落魔法数字。
 * 本模块不依赖任何其他模块（避免循环依赖），配置读写失败时静默降级。
 */

/** 应用版本号（A.B.C 规则：C=修复/优化 +1） */
export const APP_VERSION = "0.6.1";

/** app_config 结构版本（plan 5.2） */
export const CONFIG_VERSION = "0.3.0";

/** localStorage / IndexedDB 存储键 */
export const STORAGE_KEYS = {
  CONFIG: "dotoday:config",      // 应用配置（plan 5.2）
  LOG: "dotoday:errorlog",       // 错误日志（logger.js）
  LOG_OLD: "dotoday:errorlog.old", // 轮转后的旧日志（仅保留 1 份）
  SECRET: "dotoday:secret",      // 「记住私钥」明文存储（v0.5.0 同步功能用）
};

/** IndexedDB 数据库结构 */
export const DB = {
  NAME: "dotoday",
  VERSION: 1,
  STORE_MAIN: "main",       // 主数据（单 key 保存 {version, records, tags}）
  STORE_BACKUP: "backup",   // 备份存储（主键 name）
  MAIN_KEY: "data",         // main store 固定主键
};

/** 默认标签色板（低饱和铅笔灰阶风，新建标签自动配色） */
export const DEFAULT_TAG_COLORS = [
  "#9c8f84", // 灰棕
  "#8fa3a8", // 灰蓝
  "#a3a88f", // 灰绿
  "#a88f9c", // 灰紫
  "#b0a08a", // 暖灰
  "#8f9ca8", // 蓝灰
];

/** 功能限制值 */
export const LIMITS = {
  NOTE_MAX_LEN: 500,        // 备注最大字数
  TAG_NAME_MAX: 12,         // 标签名最大长度
  DELETE_UNDO_MS: 5000,     // 删除后撤销窗口（5 秒）
  BACKUP_KEEP: 10,          // 保留最近备份份数
  LOG_MAX_BYTES: 200 * 1024, // 日志轮转阈值（200KB）
  LONG_PRESS_MS: 550,       // 长按进入批量模式阈值
  SWIPE_OPEN_PX: 52,        // 左滑判定为展开的位移阈值
  SWIPE_MAX_PX: 112,        // 左滑最大位移（按钮组 104px + 与卡片间距 8px，与 css 一致）
  WHEEL_ITEM_H: 36,         // 时间滚轮单项高度（与 css .wheel-item 一致）
};

/** Toast 展示时长（ms） */
export const TOAST_MS = {
  DEFAULT: 3000,
  ERROR: 4000,
  UNDO: 5000,   // 删除撤销 Toast（与 LIMITS.DELETE_UNDO_MS 一致）
  WELCOME: 4000,
};

/** 主界面滚动联动（Timeline 全量滚动 + 日历折叠） */
export const SCROLL = {
  COLLAPSE_RANGE: 200, // 折叠进度映射范围：容器 scrollTop 0→200px 连续映射 progress 0→1
  FOLLOW_MS: 250,      // 日期跟随最小切换间隔（快速滑动时避免疯狂跳变，ms）
  STRIP_H: 66,         // 折叠单周条高度（与 css .cal-week-strip 折叠态 max-height 一致）
  PICK_GUARD_MS: 1000, // 用户点选保护窗口：期间滚动跟随不覆盖选中
};

/** Service Worker 缓存名（发布时随 APP_VERSION 递增触发更新） */
export const CACHE_NAME = "dotoday-" + APP_VERSION;

/** 列表排序方式（plan 2.2） */
export const SORT_ORDERS = ["dateAsc", "dateDesc", "rating", "tag"];

/** app_config 默认值（plan 5.2 结构） */
export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  appVersion: APP_VERSION,
  debug: { enabled: false, logLevel: "error" },
  preferences: { weekStartDay: "monday", defaultSortOrder: "dateDesc", heatmapColor: null },
  sync: { githubToken: "", repo: "", lastSyncAt: null },
  createdAt: null, // 首次使用标记（用于欢迎提示）
};

/* ============ 配置读写（plan 5.2，localStorage） ============ */

/** 内存缓存（避免重复读写 localStorage） */
let _config = null;

/** 读取配置；不存在或损坏时自动生成默认值；首次读取后缓存 */
export function loadConfig() {
  if (_config) return _config;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFIG) || "null");
  } catch (e) {
    /* 配置损坏则回退默认值（不依赖 logger，避免循环引用） */
  }
  _config = Object.assign({}, DEFAULT_CONFIG, saved || {});
  saveConfig(_config);
  return _config;
}

/** 保存配置（同步内存缓存；失败静默，不影响使用） */
export function saveConfig(config) {
  _config = config;
  try {
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
  } catch (e) {
    /* 忽略 */
  }
}

/** 获取某偏好值（如 "weekStartDay"），无配置时返回默认 */
export function getPref(key) {
  const c = loadConfig();
  return c.preferences ? c.preferences[key] : DEFAULT_CONFIG.preferences[key];
}

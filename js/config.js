/**
 * config.js —— DoToday 应用常量与配置管理（v0.6.2）
 *
 * 集中所有应用常量（版本号 / 存储键 / 色板 / 限制值 / 缓存名等），
 * 所有 js 模块统一从这里 import，禁止散落魔法数字。
 * 本模块不依赖任何其他模块（避免循环依赖），配置读写失败时静默降级。
 */

/** 应用版本号（A.B.C 规则：C=修复/优化 +1） */
export const APP_VERSION = "0.12.1";

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

/** 默认标签色板（7 基础色：铅笔红 + 6 低饱和灰阶；冲突时由 resolveColor 自动生成变体） */
export const DEFAULT_TAG_COLORS = [
  "#9c5236", // 铅笔红
  "#9c8f84", // 灰棕
  "#8fa3a8", // 灰蓝
  "#a3a88f", // 灰绿
  "#a88f9c", // 灰紫
  "#b0a08a", // 暖灰
  "#8f9ca8", // 蓝灰
];

/* ============ 颜色冲突自动变体（HSL 明度阶梯） ============ */

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const to255 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const r = to255(f(hue + 1 / 3));
  const g = to255(f(hue));
  const b = to255(f(hue - 1 / 3));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

const clamp01 = (v) => Math.min(0.95, Math.max(0.05, v));

/**
 * 颜色变体序列：明度阶梯 ±0.15 → ±0.3 → ±0.45（夹紧），再补饱和度微调档。
 * @param {string} base hex 色
 * @returns {string[]} 去重变体列表（不含 base 本身）
 */
function colorVariants(base) {
  const { h, s, l } = hexToHsl(base);
  const out = [];
  for (const dl of [0.15, -0.15, 0.3, -0.3, 0.45, -0.45]) {
    out.push(hslToHex(h, s, clamp01(l + dl)));
  }
  for (const ds of [0.12, -0.12]) {
    out.push(hslToHex(h, clamp01(s + ds), clamp01(l - 0.22)));
  }
  return [...new Set(out)];
}

/**
 * 冲突自动变体：base 未被使用 → 返回 base；
 * 已被使用 → 沿变体阶梯取第一个未使用变体；全部用尽才允许同色。
 * @param {string} base 期望的基础色
 * @param {string[]} usedColors 已被占用的颜色集合
 * @returns {string} 实际应使用的颜色
 */
export function resolveColor(base, usedColors) {
  const used = new Set(usedColors || []);
  if (!used.has(base)) return base;
  const variant = colorVariants(base).find((v) => !used.has(v));
  return variant || base;
}

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

/** 统计图表默认顺序（与 index.html #stats-charts 卡片初始顺序一致） */
export const DEFAULT_CHART_ORDER = ["monthly", "trend", "rating", "heatmap", "weekday", "period", "tags"];

/** 统计图表默认显示状态（全开） */
export const DEFAULT_CHART_VISIBLE = {
  monthly: true,
  trend: true,
  rating: true,
  heatmap: true,
  weekday: true,
  period: true,
  tags: true,
};

/** app_config 默认值（plan 5.2 结构） */
export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  appVersion: APP_VERSION,
  debug: { enabled: false, logLevel: "error" },
  preferences: {
    weekStartDay: "monday",
    defaultSortOrder: "dateDesc",
    heatmapColor: null,
    chartOrder: DEFAULT_CHART_ORDER,
    chartVisible: DEFAULT_CHART_VISIBLE,
  },
  sync: { githubToken: "", repo: "", lastSyncAt: null },
  createdAt: null, // 首次使用标记（用于欢迎提示）
};

/* ============ 配置读写（plan 5.2，localStorage） ============ */

/** 内存缓存（避免重复读写 localStorage） */
let _config = null;

/** 读取配置；不存在或损坏时自动生成默认值；首次读取后缓存
 *  注意：preferences 需深合并（旧配置缺新字段时补齐默认值） */
export function loadConfig() {
  if (_config) return _config;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFIG) || "null");
  } catch (e) {
    /* 配置损坏则回退默认值（不依赖 logger，避免循环引用） */
  }
  _config = Object.assign({}, DEFAULT_CONFIG, saved || {});
  _config.preferences = Object.assign({}, DEFAULT_CONFIG.preferences, (saved && saved.preferences) || {});
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

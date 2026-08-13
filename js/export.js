/**
 * export.js —— 数据导出纯逻辑模块（DoToday v0.2.0 预实现）
 *
 * 纯逻辑模块：仅依赖 js/config.js 常量（顶层无副作用，node 可测），
 * 不涉及 Blob / 下载（下载由 UI 侧完成），可在 Node 下直接运行单元测试。
 *
 * 接口设计见计划文档 6.3 节：
 *   applyFilters / applyDesensitize / toJSON / toCSV / toTXT
 *
 * 导出规则（计划文档 2.5）：
 *   - JSON：完整数据结构 {version, exportedAt, records} 或脱敏后 {records}
 *   - CSV：表头 + 每行一条记录，tags 用中文顿号连接；BOM 由下载侧按需添加
 *   - TXT：每行一条记录（日期 时间 评分 备注 标签），空值用占位"无"
 *   - 脱敏：只保留日期与评分
 */
import { APP_VERSION } from "./config.js";

// ============ 筛选与脱敏 ============

/**
 * applyFilters(records, filters) → 按条件筛选记录（返回新数组，不改原数据）
 * filters: { start, end, rating, tags }
 *   - start / end：日期范围（YYYY-MM-DD，含边界；缺省不限）
 *   - rating：评分精确匹配（数字；null / undefined 表示不筛）
 *   - tags：标签数组，记录 tags **包含任一**即匹配（数组为空/缺省不筛）
 * 空 filters（null / 空对象 / 全空条件）返回全部记录副本。
 *
 * @param {Array} records
 * @param {{start?:string, end?:string, rating?:number|null, tags?:string[]}} [filters]
 * @returns {Array}
 */
function applyFilters(records, filters = {}) {
  const list = records || [];
  if (!filters) return list.slice();
  const { start, end, rating, tags } = filters;
  return list.filter((r) => {
    if (!r || typeof r.date !== "string") return false;
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    if (rating !== undefined && rating !== null && r.rating !== rating) return false;
    if (Array.isArray(tags) && tags.length > 0) {
      const rTags = Array.isArray(r.tags) ? r.tags : [];
      if (!tags.some((t) => rTags.includes(t))) return false; // 任一标签匹配
    }
    return true;
  });
}

/**
 * applyDesensitize(records) → 脱敏处理
 * 每条记录只保留 {date, rating}（其余字段省略），用于导出隐私保护。
 *
 * @param {Array} records
 * @returns {Array<{date:string, rating:number|null}>}
 */
function applyDesensitize(records) {
  return (records || []).map((r) => ({
    date: r && typeof r.date === "string" ? r.date : "",
    rating: r && typeof r.rating === "number" ? r.rating : null,
  }));
}

// ============ 导出格式生成（纯逻辑，返回字符串） ============

/**
 * toJSON(records, options) → JSON 字符串（缩进 2）
 * options: { desensitize }
 *   - 完整：{ version, exportedAt, records }（exportedAt 为 ISO 时间戳）
 *   - 脱敏：{ records: [{date, rating}] }（不输出 version/exportedAt）
 *
 * @param {Array} records
 * @param {{desensitize?:boolean}} [options]
 * @returns {string}
 */
function toJSON(records, options = {}) {
  if (options.desensitize) {
    return JSON.stringify({ records: applyDesensitize(records) }, null, 2);
  }
  return JSON.stringify(
    {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      records: (records || []).slice(),
    },
    null,
    2
  );
}

/**
 * CSV 字段转义：含逗号 / 引号 / 换行的字段用双引号包裹，内部引号翻倍
 * （标准 CSV 规则，Excel 兼容；BOM 由下载侧按需添加）。
 */
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * toCSV(records, options) → CSV 字符串
 * options: { desensitize }
 *   - 完整：表头 date,time,rating,note,tags；tags 用中文顿号"、"连接；
 *     空值输出为空字段
 *   - 脱敏：仅 date,rating 两列（表头 date,rating）
 * 不含 BOM（由下载侧按需加）。
 *
 * @param {Array} records
 * @param {{desensitize?:boolean}} [options]
 * @returns {string}
 */
function toCSV(records, options = {}) {
  const list = (records || []).slice();
  const lines = [];
  if (options.desensitize) {
    lines.push("date,rating");
    for (const r of applyDesensitize(list)) {
      lines.push(
        [r.date, r.rating === null ? "" : r.rating].map(csvEscape).join(",")
      );
    }
  } else {
    lines.push("date,time,rating,note,tags");
    for (const r of list) {
      lines.push(
        [
          r.date !== undefined && r.date !== null ? r.date : "",
          r.time !== undefined && r.time !== null ? r.time : "",
          r.rating !== undefined && r.rating !== null ? r.rating : "",
          r.note !== undefined && r.note !== null ? r.note : "",
          Array.isArray(r.tags) ? r.tags.join("、") : "", // 标签顿号连接
        ]
          .map(csvEscape)
          .join(",")
      );
    }
  }
  return lines.join("\n");
}

/**
 * toTXT(records, options) → TXT 字符串（每行一条记录）
 * options: { desensitize }
 *   - 完整：`日期 时间 评分 备注 标签`（空格分隔，空值用占位"无"）
 *   - 脱敏：`日期 评分`（只输出日期与评分）
 *
 * @param {Array} records
 * @param {{desensitize?:boolean}} [options]
 * @returns {string}
 */
function toTXT(records, options = {}) {
  const list = (records || []).slice();
  const lines = [];
  for (const r of list) {
    if (options.desensitize) {
      // 脱敏：仅日期与评分
      lines.push(
        `${r.date !== undefined && r.date !== null ? r.date : "无"} ${
          r.rating !== undefined && r.rating !== null ? r.rating : "无"
        }`
      );
    } else {
      lines.push(
        [
          r.date !== undefined && r.date !== null ? r.date : "无",
          r.time !== undefined && r.time !== null ? r.time : "无",
          r.rating !== undefined && r.rating !== null ? r.rating : "无",
          r.note !== undefined && r.note !== null && r.note !== "" ? r.note : "无",
          Array.isArray(r.tags) && r.tags.length > 0 ? r.tags.join("、") : "无",
        ].join(" ")
      );
    }
  }
  return lines.join("\n");
}

/** 统一导出对象（接口见计划文档 6.3） */
export const ExportModule = {
  applyFilters,
  applyDesensitize,
  toJSON,
  toCSV,
  toTXT,
};

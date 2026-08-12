/**
 * parse-import.js —— 文本导入解析纯逻辑模块（DoToday v0.2.0 预实现）
 *
 * 纯逻辑模块：仅依赖 js/pure/date-utils.js，无浏览器 / Node 专属 API，
 * 可在 Node 下直接运行单元测试（node --test）。
 *
 * 接口定义见计划文档 6.1 节 parse-import 部分：
 *   normalizeText / parseText / expandRecords / validateItems
 *
 * 导入格式规则（计划文档 2.4）：
 *   - 位置相对固定：日期 → 括号内次数 → 备注
 *   - 括号内数字表示次数（全角半角自动转换，normalize 后统一半角）
 *   - 备注在最后，到下一个日期模式为止（可跨行）
 *   - 省略年份时按上下文（上一条记录年份）推断，无则用 refYear
 *   - 次数 > 1 由 expandRecords 展开为多条独立记录
 *   - 无法解析的行：ok=false 标记，raw 保留原文（UI 端单独列出）
 *
 * 支持的日期格式（计划文档 2.4 / 6.1 正则）：
 *   2024 1.1 / 2024-1-1 / 2024/1/1 / 2024.1.1 / 2024-01-01
 *   2024年7月17日 / 2024年7月17号（v0.6.2 新增：年 + 中文月日）
 *   2月2日 / 2月2号
 *   1.1（省略年份）
 */
import { DateUtils } from "./date-utils.js";

/** 补零：数字转 2 位字符串 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * normalizeText(text) → 全角转半角
 * 转换：全角数字（０-９）、全角括号（（））、全角点（．）、全角短横（－）、
 *       全角斜杠（／）、全角空格（　）；
 * 保留：中文（年月日等）与其余字符。
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (typeof text !== "string") return "";
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0xff10 && code <= 0xff19) {
      out += String.fromCharCode(code - 0xfee0); // 全角数字 → 半角（差值 0xFEE0）
    } else if (ch === "\u3000") {
      out += " "; // 全角空格
    } else if (ch === "\uff08") {
      out += "("; // 全角左括号
    } else if (ch === "\uff09") {
      out += ")"; // 全角右括号
    } else if (ch === "\uff0e") {
      out += "."; // 全角点
    } else if (ch === "\uff0d") {
      out += "-"; // 全角短横
    } else if (ch === "\uff0f") {
      out += "/"; // 全角斜杠
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 日期模式（组合正则，计划文档 6.1 核心正则 + 「年 空格 月.日」+「年 中文月日」扩展）：
 *   分支1 完整年月日：2024.1.1 / 2024-1-1 / 2024/1/1 / 2024-01-01（组1年 组2月 组3日）
 *   分支2 年 + 空格 + 月.日：2024 1.1 / 2024 1-1（组4年 组5月 组6日）
 *   分支3 年 + 中文月日：2024年7月17日 / 2024年7月17号（组7年 组8月 组9日）
 *     必须放在省略年份的中文月日模式之前：否则 "2024年7月17日" 会在年位置
 *     之后被 "7月17日" 部分抢匹配，导致年份丢失（误用 refYear 推断）
 *   分支4 中文月日（省略年份）：2月2日 / 2月2号（组10月 组11日）
 *   分支5 省略年份月.日：1.1（组12月 组13日）
 */
const DATE_PATTERN = new RegExp(
  "(\\d{4})\\s*[./-]\\s*(\\d{1,2})\\s*[./-]\\s*(\\d{1,2})" +
    "|(\\d{4})\\s+(\\d{1,2})\\s*[./-]\\s*(\\d{1,2})" +
    "|(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*[日号]" +
    "|(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*[日号]" +
    "|(\\d{1,2})\\s*[./-]\\s*(\\d{1,2})",
  "g"
);

/** 次数模式：日期后紧跟（允许空白）的括号数字，如 (3) / （2） */
const COUNT_PATTERN = /^\s*[（(]\s*(\d+)\s*[）)]/;

/** 从日期匹配分组中提取 年/月/日（省略年份时 year 为 null） */
function extractDateParts(g) {
  if (g[1]) return { year: Number(g[1]), month: Number(g[2]), day: Number(g[3]) };
  if (g[4]) return { year: Number(g[4]), month: Number(g[5]), day: Number(g[6]) };
  if (g[7]) return { year: Number(g[7]), month: Number(g[8]), day: Number(g[9]) };
  if (g[10]) return { year: null, month: Number(g[10]), day: Number(g[11]) };
  return { year: null, month: Number(g[12]), day: Number(g[13]) };
}

/**
 * parseText(text, refYear) → 解析纯文本为记录项数组
 *
 * @param {string} text 待解析的纯文本
 * @param {number} [refYear] 参考年份（省略年份且无上下文时使用；默认当前年份）
 * @returns {Array<{date:string|null, count:number|null, note:string|null, ok:boolean, raw:string|null}>}
 *   - 正常项：date="YYYY-MM-DD"、count>=1、note 去首尾空白、ok=true、raw=null
 *   - 坏行（无日期归属的文本段）：date/count/note 为 null、ok=false、raw 保留原文
 *
 * 说明：date 为严格拼接（不自动进位，如 2月30日 保留原样），
 *       日期真实合法性由 validateItems 用 DateUtils 往返校验标记。
 */
function parseText(text, refYear = new Date().getFullYear()) {
  const input = normalizeText(text);
  const items = [];
  if (!input) return items;

  // 1. 收集全部日期匹配；跳过月/日超出合理范围（1-12 / 1-31）的误匹配
  //    （如备注里的 "72.5" 不应被当作日期）
  const matches = [];
  DATE_PATTERN.lastIndex = 0; // 复用全局正则，重置搜索位置
  let m;
  while ((m = DATE_PATTERN.exec(input)) !== null) {
    const { month, day } = extractDateParts(m);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    matches.push({ index: m.index, end: m.index + m[0].length, groups: m });
  }

  if (matches.length === 0) {
    // 整段文本无日期：整段作为坏行（保留原文，UI 端单独列出）
    const trimmed = input.trim();
    if (trimmed) {
      items.push({ date: null, count: null, note: null, ok: false, raw: trimmed });
    }
    return items;
  }

  // 2. 首个日期之前的前导文本（无日期归属）→ 坏行
  const head = input.slice(0, matches[0].index).trim();
  if (head) {
    items.push({ date: null, count: null, note: null, ok: false, raw: head });
  }

  // 3. 逐项解析：日期 → 次数 → 备注
  let lastYear = null; // 上下文年份（上一条已解析项的年份）
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const { year, month, day } = extractDateParts(match.groups);
    // 年份推断：省略年份 → 上一条项年份；仍无 → refYear
    const resolvedYear = year !== null ? year : lastYear !== null ? lastYear : refYear;
    const dateStr = `${pad2(resolvedYear)}-${pad2(month)}-${pad2(day)}`;

    // 备注：日期匹配结束 → 下一个日期匹配开始（可跨行）
    const noteEnd = i + 1 < matches.length ? matches[i + 1].index : input.length;
    let rest = input.slice(match.end, noteEnd);

    // 次数：备注起始紧跟的括号数字（如 "(3)" / "（2）"）；无括号默认 1
    let count = 1;
    const cm = COUNT_PATTERN.exec(rest);
    if (cm) {
      count = Math.max(1, Number(cm[1]));
      rest = rest.slice(cm[0].length); // 移除次数括号，剩余为备注
    }
    const note = rest.trim();

    items.push({ date: dateStr, count, note, ok: true, raw: null });
    lastYear = resolvedYear; // 更新上下文年份
  }
  return items;
}

/**
 * expandRecords(items) → 次数 > 1 的项展开为多条独立记录
 * 纯逻辑：输出 [{date, note}] 列表，不含 id/时间戳（由 UI/数据层生成）；
 * 无效项（无 date）跳过。
 * @param {Array<{date:string, count:number, note?:string}>} items
 * @returns {Array<{date:string, note:string}>}
 */
function expandRecords(items) {
  const out = [];
  for (const item of items || []) {
    if (!item || !item.date) continue;
    const count = Math.max(1, Number(item.count) || 1);
    for (let i = 0; i < count; i++) {
      out.push({ date: item.date, note: item.note || "" });
    }
  }
  return out;
}

/**
 * validateItems(items) → 校验解析/编辑后的项，返回带 ok 标记的副本（不改原数组）
 * 规则：date 为真实合法日期（YYYY-MM-DD 格式且 DateUtils.parseDate 往返一致，
 *       如 2024-02-30 自动进位为 03-01 → 判非法）；count 为 >= 1 的数字。
 * @param {Array} items
 * @returns {Array<{ok:boolean}>}
 */
function validateItems(items) {
  return (items || []).map((item) => {
    if (!item || typeof item !== "object") return { ...item, ok: false };
    // 日期合法性：格式 + 真实存在（parseDate 往返，拒绝 2月30日 等不存在的日期）
    let dateOk = false;
    if (typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      const d = DateUtils.parseDate(item.date);
      dateOk = d !== null && DateUtils.formatDate(d) === item.date;
    }
    const countOk = typeof item.count === "number" && item.count >= 1;
    return { ...item, ok: dateOk && countOk };
  });
}

/** 统一导出对象（接口见计划文档 6.1） */
export const ImportParser = {
  normalizeText,
  parseText,
  expandRecords,
  validateItems,
};

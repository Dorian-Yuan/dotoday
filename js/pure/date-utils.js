/**
 * date-utils.js —— 日期工具纯逻辑模块（DoToday v0.1.0）
 *
 * 纯逻辑模块：仅使用 Date 对象，禁止任何浏览器 / Node 专属 API，
 * 可在 Node 下直接运行单元测试（node --test）。
 *
 * 接口定义见计划文档 6.1 节。
 */

/** 补零：数字转 2 位字符串（如 5 → "05"） */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * formatDate(date) → "YYYY-MM-DD"
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * formatTime(date) → "HH:mm"
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * parseDate(str) → Date（本地时区解析）
 * 仅接受严格 "YYYY-MM-DD" 格式，非法输入返回 null。
 * @param {string} str
 * @returns {Date|null}
 */
function parseDate(str) {
  if (typeof str !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  // 使用本地时区构造（月从 0 开始，需 -1）
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * todayStr() → 今天 "YYYY-MM-DD"
 * @returns {string}
 */
function todayStr() {
  return formatDate(new Date());
}

/**
 * inferPeriod(time) → "morning"|"afternoon"|"evening"|null
 * 时段规则（计划文档 2.1）：
 *   早 = 05:00-11:59、午 = 12:00-16:59、晚 = 17:00-次日04:59（跨午夜）
 * time 为 null / 非 "HH:mm" 格式返回 null。
 * @param {string|null} time 形如 "HH:mm" 的字符串
 * @returns {string|null}
 */
function inferPeriod(time) {
  if (typeof time !== "string") return null;
  // 严格匹配 "HH:mm"（00-23 时、00-59 分）
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  // 17:00-23:59 与 00:00-04:59 均属「晚」（跨午夜）
  return "evening";
}

/**
 * getDaysBetween(a, b) → 两个日期串相差的整数天数（a - b）
 * 非法输入返回 NaN。
 * @param {string} a 起始日期 "YYYY-MM-DD"
 * @param {string} b 结束日期 "YYYY-MM-DD"
 * @returns {number}
 */
function getDaysBetween(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return NaN;
  // 本地时区解析后相减，除以一天的毫秒数；round 消除 DST 等毫秒误差
  return Math.round((da - db) / 86400000);
}

/**
 * addDays(dateStr, n) → 日期加减 n 天，返回 "YYYY-MM-DD"
 * 跨月 / 跨年 / 负数均由 Date 自动进位处理。
 * 非法输入返回 null。
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {number} n 天数（可为负）
 * @returns {string|null}
 */
function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/**
 * getMonthLabel(ym) → 月份显示标签："2024-05" → "2024年5月"
 * @param {string} ym 形如 "YYYY-MM" 的月份串
 * @returns {string}
 */
function getMonthLabel(ym) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(ym));
  if (!m) return String(ym);
  // Number 去掉前导零（"05" → 5）
  return `${m[1]}年${Number(m[2])}月`;
}

/**
 * getWeekday(dateStr) → 1-7（周一=1 ... 周日=7）
 * @param {string} dateStr "YYYY-MM-DD"
 * @returns {number|null} 非法输入返回 null
 */
function getWeekday(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  // Date.getDay()：周日=0、周一=1 ... 周六=6，转换为周一=1...周日=7
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

/**
 * monthMatrix(year, month, weekStart) → 日历网格数据
 * 网格从周起始日对齐：当月首日前的空格用上月末补位，末尾用下月初补位，
 * 总格数恒为 7 的整数倍（整周）。
 *
 * @param {number} year  年份（如 2024）
 * @param {number} month 月份（1-12，自然月）
 * @param {"monday"|"sunday"} weekStart 周起始日
 * @returns {{year:number, month:number, days:Array<{date:string, day:number, inMonth:boolean}>}}
 */
function monthMatrix(year, month, weekStart = "monday") {
  // 本月第一天与本月天数（new Date(y, m, 0) 为上月最后一天，即本月 0 日）
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();

  // 计算首日相对周起始日的偏移（即月初前需要补位的格数）
  let offset;
  if (weekStart === "sunday") {
    offset = first.getDay(); // 周日=0 → 补 0 格；周三=3 → 补 3 格
  } else {
    // monday 起始：周日(0)→6、周一(1)→0 ...
    offset = (first.getDay() + 6) % 7;
  }

  const days = [];
  // 前置补位：上月末（offset 个格子），inMonth=false
  for (let i = offset - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, -i); // Date 自动处理负数日期（回退到上月）
    days.push({ date: formatDate(d), day: d.getDate(), inMonth: false });
  }
  // 本月天数，inMonth=true
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month - 1, day);
    days.push({ date: formatDate(d), day, inMonth: true });
  }
  // 后置补位：下月初，凑成整周，inMonth=false
  const remainder = days.length % 7;
  if (remainder !== 0) {
    for (let i = 1; i <= 7 - remainder; i++) {
      const d = new Date(year, month, i); // 下月的第 i 天
      days.push({ date: formatDate(d), day: d.getDate(), inMonth: false });
    }
  }

  return { year, month, days };
}

/** 统一导出对象（接口见计划文档 6.1） */
export const DateUtils = {
  formatDate,
  formatTime,
  parseDate,
  todayStr,
  inferPeriod,
  getDaysBetween,
  addDays,
  getMonthLabel,
  getWeekday,
  monthMatrix,
};

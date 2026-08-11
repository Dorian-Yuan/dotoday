/**
 * logger.js —— 日志模块（DoToday v0.1.0）
 *
 * 接口定义见计划文档 6.6 节：
 *   info(message) / warn(message) / error(message, stack)
 *   getLogs() / clearLogs() / rotateIfNeeded()
 *
 * 存储：localStorage（key "dotoday:errorlog"），超过 200KB 轮转
 *   —— 当前内容改名 "dotoday:errorlog.old"（只保留最近 1 份旧日志），重新记录。
 * 日志行格式：[YYYY-MM-DD HH:mm:ss] [LEVEL] message
 *
 * 健壮性：
 *   - localStorage 不可用（隐私模式/配额满/非浏览器）时静默降级为内存数组
 *   - 非浏览器环境（Node）可正常 import，不抛错
 */

// 常量统一来自 config.js（禁止硬编码）
import { STORAGE_KEYS, LIMITS } from "./config.js";

const LOG_KEY = STORAGE_KEYS.LOG;
const OLD_LOG_KEY = STORAGE_KEYS.LOG_OLD;
const MAX_LOG_SIZE = LIMITS.LOG_MAX_BYTES; // 200KB（按 UTF-8 字节计）

/** localStorage 可用性：null=未检测，true/false=结果（惰性检测，顶层不触碰浏览器 API） */
let storageAvailable = null;

/** 内存降级存储（localStorage 不可用时使用） */
let memoryLogs = [];

/** 计算字符串 UTF-8 编码后的字节数（中文 3 字节，用于 200KB 上限判断） */
function utf8Bytes(str) {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    if (code > 0xffff) {
      bytes += 4; // 4 字节字符（emoji 等）
      i++;
    } else if (code > 0x7ff) {
      bytes += 3;
    } else if (code > 0x7f) {
      bytes += 2;
    } else {
      bytes += 1;
    }
  }
  return bytes;
}

/** 惰性检测 localStorage 是否可用（探测写入+删除，异常即视为不可用） */
function detectStorage() {
  if (typeof localStorage === "undefined") return false;
  try {
    const probe = "__dotoday_log_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function ensureStorageDetected() {
  if (storageAvailable === null) storageAvailable = detectStorage();
}

/** 时间戳格式化：[YYYY-MM-DD HH:mm:ss] */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatTimestamp(d) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/**
 * 核心写入：组装日志行并追加存储
 * @param {"info"|"warn"|"error"} level
 * @param {string} message
 * @param {string} [stack] 错误堆栈（仅 error 使用）
 */
function log(level, message, stack) {
  ensureStorageDetected();
  const line =
    `[${formatTimestamp(new Date())}] [${level}] ${message}` +
    (stack ? `\n${stack}` : "");

  if (storageAvailable) {
    try {
      // 写入前检查大小，超过 200KB 先轮转
      rotateIfNeeded();
      const current = localStorage.getItem(LOG_KEY) || "";
      localStorage.setItem(LOG_KEY, current ? current + "\n" + line : line);
    } catch {
      // localStorage 写入失败（如配额耗尽）→ 静默降级内存
      memoryLogs.push(line);
    }
  } else {
    memoryLogs.push(line);
  }
  return line;
}

/**
 * info(message) → 信息日志
 */
function info(message) {
  return log("info", message);
}

/**
 * warn(message) → 警告日志
 */
function warn(message) {
  return log("warn", message);
}

/**
 * error(message, stack) → 错误日志（可附带堆栈）
 */
function error(message, stack) {
  return log("error", message, stack);
}

/**
 * getLogs() → 获取当前日志内容（字符串，行为 \n 分隔；无日志返回空串）
 */
function getLogs() {
  ensureStorageDetected();
  if (storageAvailable) {
    try {
      return localStorage.getItem(LOG_KEY) || "";
    } catch {
      return memoryLogs.join("\n");
    }
  }
  return memoryLogs.join("\n");
}

/**
 * clearLogs() → 清空日志（同时清内存降级数组）
 */
function clearLogs() {
  ensureStorageDetected();
  if (storageAvailable) {
    try {
      localStorage.removeItem(LOG_KEY);
    } catch {
      /* 忽略：内存数组随后清空 */
    }
  }
  memoryLogs = [];
}

/**
 * rotateIfNeeded() → 日志超过 200KB 时轮转
 * 当前内容改名 "dotoday:errorlog.old"（覆盖旧 .old，只保留最近 1 份），
 * 然后清空当前日志重新开始。返回是否发生了轮转。
 */
function rotateIfNeeded() {
  ensureStorageDetected();
  if (!storageAvailable) return false;
  try {
    const content = localStorage.getItem(LOG_KEY) || "";
    if (utf8Bytes(content) > MAX_LOG_SIZE) {
      localStorage.setItem(OLD_LOG_KEY, content); // 当前内容改名 .old
      localStorage.removeItem(LOG_KEY); // 重新开始记录
      return true;
    }
  } catch {
    /* 读取失败则跳过轮转 */
  }
  return false;
}

/** 统一导出对象（接口见计划文档 6.6） */
export const LoggerModule = {
  info,
  warn,
  error,
  getLogs,
  clearLogs,
  rotateIfNeeded,
};

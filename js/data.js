/**
 * data.js —— 数据层（DoToday v0.1.0）
 *
 * 浏览器 IndexedDB 存储：
 *   - db 名 "dotoday"
 *   - objectStore "main"：单 key 保存完整数据对象 {version, records, tags}，主键 key="data"
 *   - objectStore "backup"：备份存储，主键 name
 *
 * 接口定义见计划文档 6.2 节。
 *
 * 非浏览器环境（typeof indexedDB === 'undefined'）下：
 *   模块可正常 import（顶层不执行任何浏览器 API），
 *   但所有依赖 IndexedDB 的方法调用会抛出清晰错误。
 */

// 常量统一来自 config.js（禁止硬编码）
import { APP_VERSION, DB, DEFAULT_TAG_COLORS, resolveColor, LIMITS } from "./config.js";

// ============ 常量 ============

const DB_NAME = DB.NAME;
const DB_VERSION = DB.VERSION;
const STORE_MAIN = DB.STORE_MAIN;
const STORE_BACKUP = DB.STORE_BACKUP;
const MAIN_KEY = DB.MAIN_KEY; // main store 固定主键
const MAX_BACKUPS = LIMITS.BACKUP_KEEP; // 保留最近备份份数

/** 默认数据：首次初始化时写入 */
const DEFAULT_DATA = { version: APP_VERSION, records: [], tags: [] };

/**
 * 标签色板：config.js DEFAULT_TAG_COLORS（7 基础色：铅笔红 + 6 低饱和灰阶）。
 * 冲突时由 resolveColor 自动生成变体（HSL 明度阶梯），不要求用户选档。
 */
const DEFAULT_PALETTE = DEFAULT_TAG_COLORS;

/**
 * 自动配色：未使用的 7 基础色优先；全部用尽后按基础色顺序生成自动变体（resolveColor 同逻辑）。
 * @param {string[]} usedColors 已使用的颜色集合
 */
function pickTagColor(usedColors) {
  const used = new Set(usedColors || []);
  // 1. 未使用的 7 基础色优先
  const free = DEFAULT_PALETTE.find((c) => !used.has(c));
  if (free) return free;
  // 2. 基础色全用尽：逐个基础色取第一个未用变体
  for (const base of DEFAULT_PALETTE) {
    const v = resolveColor(base, [...used]);
    if (v !== base) return v;
  }
  // 3. 极端：全部变体用尽，整体轮转（允许重复）
  return DEFAULT_PALETTE[(usedColors || []).length % DEFAULT_PALETTE.length];
}

// ============ 模块内部状态 ============

/** IndexedDB 数据库连接（懒加载） */
let db = null;
/** 内存中的主数据（load/save 与它交互） */
let data = null;

// ============ 工具函数 ============

/** 非浏览器环境守卫：所有依赖 IndexedDB 的方法先调用 */
function ensureBrowser() {
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "[DataModule] 当前环境不支持 IndexedDB（非浏览器），无法执行数据操作。请在浏览器中运行 DoToday。"
    );
  }
}

/** 深拷贝（避免外部引用篡改内部数据） */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 等待毫秒 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** IDBRequest → Promise 封装 */
function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB 请求失败"));
  });
}

/** 打开（或复用）IndexedDB 连接，创建缺失的 objectStore */
async function openDB() {
  if (db) return db;
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = (event) => {
    const database = event.target.result;
    // main store：主键 "key"，数据对象固定以 key="data" 存储
    if (!database.objectStoreNames.contains(STORE_MAIN)) {
      database.createObjectStore(STORE_MAIN, { keyPath: "key" });
    }
    // backup store：主键 "name"（备份文件名）
    if (!database.objectStoreNames.contains(STORE_BACKUP)) {
      database.createObjectStore(STORE_BACKUP, { keyPath: "name" });
    }
  };
  db = await reqPromise(request);
  return db;
}

/** 获取指定 store 的对象引用（调用方需保证 db 已打开） */
function getStore(name, mode) {
  return db.transaction(name, mode).objectStore(name);
}

/** 格式化备份文件名时间戳部分：YYYYMMDD_HHMMSS */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function backupStamp(d) {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

// ============ 数据读写 ============

/**
 * load() → 从 IndexedDB 加载数据到内存
 * 数据对象不存在时初始化为默认数据（不写盘，由 init/save 落盘）。
 */
async function load() {
  ensureBrowser();
  if (!db) db = await openDB();
  const stored = await reqPromise(getStore(STORE_MAIN, "readonly").get(MAIN_KEY));
  if (stored && stored.records) {
    // 兜底校验结构完整性，避免脏数据导致崩溃
    data = {
      version: stored.version || APP_VERSION,
      records: Array.isArray(stored.records) ? stored.records : [],
      tags: Array.isArray(stored.tags) ? stored.tags : [],
    };
  } else {
    data = clone(DEFAULT_DATA);
  }
  return data;
}

/**
 * save() → 写回 IndexedDB
 * 失败重试 3 次（每次间隔 300ms），3 次仍失败抛出错误。
 */
async function save() {
  ensureBrowser();
  if (!db) db = await openDB();
  if (!data) data = clone(DEFAULT_DATA);

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await reqPromise(
        getStore(STORE_MAIN, "readwrite").put({ key: MAIN_KEY, ...data })
      );
      return true;
    } catch (err) {
      lastError = err;
      if (attempt < 3) await sleep(300); // 重试前等待
    }
  }
  throw new Error(
    `[DataModule] 数据写入失败（已重试3次）: ${(lastError && lastError.message) || lastError}`
  );
}

// ============ 记录 CRUD ============

/** getAllRecords() → 所有记录（副本） */
function getAllRecords() {
  ensureBrowser();
  return (data && data.records ? data.records : []).slice();
}

/** getRecordsByDate(date) → 指定日期的记录 */
function getRecordsByDate(date) {
  ensureBrowser();
  return (data && data.records ? data.records : []).filter(
    (r) => r.date === date
  );
}

/** getRecordsByRange(start, end) → 日期范围 [start, end] 内的记录（含边界，字符串比较即时间序） */
function getRecordsByRange(start, end) {
  ensureBrowser();
  return (data && data.records ? data.records : []).filter((r) => {
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    return true;
  });
}

/**
 * addRecord(record) → 添加记录
 * 自动补 id=Date.now()（同毫秒碰撞时自增规避）、createdAt、updatedAt；date 必填。
 */
async function addRecord(record) {
  ensureBrowser();
  if (!record || typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    throw new Error("[DataModule] addRecord: date 字段必填且格式须为 YYYY-MM-DD");
  }
  const now = Date.now();
  let id = now;
  // 同毫秒多条记录时自增，保证 id 唯一
  while ((data.records || []).some((r) => r.id === id)) id++;
  const newRecord = {
    id,
    date: record.date,
    time: record.time !== undefined ? record.time : null,
    rating: record.rating !== undefined ? record.rating : null,
    note: record.note !== undefined ? record.note : "",
    tags: Array.isArray(record.tags) ? record.tags.slice() : [],
    createdAt: now,
    updatedAt: now,
  };
  data.records.push(newRecord);
  await save();
  return newRecord;
}

/** updateRecord(id, data) → 按 id 更新记录（更新 updatedAt），返回更新后的记录 */
async function updateRecord(id, patch) {
  ensureBrowser();
  const record = (data.records || []).find((r) => r.id === id);
  if (!record) throw new Error(`[DataModule] updateRecord: 记录不存在 id=${id}`);
  if (patch.date !== undefined) record.date = patch.date;
  if (patch.time !== undefined) record.time = patch.time;
  if (patch.rating !== undefined) record.rating = patch.rating;
  if (patch.note !== undefined) record.note = patch.note;
  if (patch.tags !== undefined) {
    record.tags = Array.isArray(patch.tags) ? patch.tags.slice() : [];
  }
  record.updatedAt = Date.now();
  await save();
  return record;
}

/** deleteRecord(id) → 删除单条记录，成功返回 true，不存在返回 false */
async function deleteRecord(id) {
  ensureBrowser();
  const idx = (data.records || []).findIndex((r) => r.id === id);
  if (idx === -1) return false;
  data.records.splice(idx, 1);
  await save();
  return true;
}

/** batchDelete(ids) → 批量删除，返回实际删除条数 */
async function batchDelete(ids) {
  ensureBrowser();
  const idSet = new Set(ids || []);
  const before = (data.records || []).length;
  data.records = (data.records || []).filter((r) => !idSet.has(r.id));
  const removed = before - data.records.length;
  if (removed > 0) await save();
  return removed;
}

// ============ 搜索与筛选 ============

/** searchRecords(query) → 按备注 note 模糊匹配（大小写不敏感）；空查询返回 [] */
function searchRecords(query) {
  ensureBrowser();
  if (typeof query !== "string" || query.trim() === "") return [];
  const q = query.trim().toLowerCase();
  return (data.records || []).filter(
    (r) => typeof r.note === "string" && r.note.toLowerCase().includes(q)
  );
}

/**
 * filterRecords(filters) → 多条件组合筛选，全部条件同时满足
 * filters: { start, end, rating, tags }
 *   - start/end：日期范围（含边界）
 *   - rating：评分精确匹配（非空时）
 *   - tags：记录须包含指定全部标签（数组）
 */
function filterRecords(filters = {}) {
  ensureBrowser();
  const { start, end, rating, tags } = filters;
  return (data.records || []).filter((r) => {
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    if (rating !== undefined && rating !== null && r.rating !== rating) return false;
    if (Array.isArray(tags) && tags.length > 0) {
      const rTags = r.tags || [];
      if (!tags.every((t) => rTags.includes(t))) return false;
    }
    return true;
  });
}

// ============ 标签管理 ============

/** getTags() → 全局标签列表（副本，按创建时间升序） */
function getTags() {
  ensureBrowser();
  return (data && data.tags ? data.tags : []).slice();
}

/**
 * addTag(name, color) → 添加标签
 * 未指定 color 时从默认色板自动分配（优先取未使用色，全部占用则轮转）。
 */
async function addTag(name, color) {
  ensureBrowser();
  const tagName = String(name || "").trim();
  if (!tagName) throw new Error("[DataModule] addTag: 标签名不能为空");
  if ((data.tags || []).some((t) => t.name === tagName)) {
    throw new Error(`[DataModule] addTag: 标签已存在: ${tagName}`);
  }
  let finalColor = color;
  if (!finalColor) {
    const used = new Set((data.tags || []).map((t) => t.color));
    finalColor = pickTagColor([...used]); // 7 基础色优先，冲突自动变体
  }
  const tag = { name: tagName, color: finalColor, createdAt: Date.now() };
  data.tags.push(tag);
  await save();
  return tag;
}

/**
 * renameTag(old, new) → 重命名标签，同步更新所有记录的 tags
 * 返回受影响（被重命名引用的）记录数。
 */
async function renameTag(oldName, newName) {
  ensureBrowser();
  const tag = (data.tags || []).find((t) => t.name === oldName);
  if (!tag) throw new Error(`[DataModule] renameTag: 标签不存在: ${oldName}`);
  const trimmed = String(newName || "").trim();
  if (!trimmed) throw new Error("[DataModule] renameTag: 新标签名不能为空");
  if (trimmed !== oldName && (data.tags || []).some((t) => t.name === trimmed)) {
    throw new Error(`[DataModule] renameTag: 标签已存在: ${trimmed}`);
  }
  tag.name = trimmed;
  // 同步更新所有记录中的标签引用
  let affected = 0;
  for (const r of data.records || []) {
    const idx = (r.tags || []).indexOf(oldName);
    if (idx !== -1) {
      r.tags[idx] = trimmed;
      affected++;
    }
  }
  await save();
  return affected;
}

/**
 * deleteTag(name) → 全局删除标签并同步更新所有记录
 * 返回受影响（被移除该标签的）记录数；标签不存在返回 0。
 */
async function deleteTag(name) {
  ensureBrowser();
  const before = (data.tags || []).length;
  data.tags = (data.tags || []).filter((t) => t.name !== name);
  if (data.tags.length === before) return 0; // 标签不存在
  let affected = 0;
  for (const r of data.records || []) {
    if (Array.isArray(r.tags) && r.tags.includes(name)) {
      r.tags = r.tags.filter((t) => t !== name);
      affected++;
    }
  }
  await save();
  return affected;
}

/**
 * changeTagColor(name, color) → 更新标签颜色
 * 仅更新标签列表的 color 字段（记录 tags 只存名称，自动联动）；
 * 返回更新后的标签；标签不存在或颜色非法抛错。
 */
async function changeTagColor(name, color) {
  ensureBrowser();
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error("[DataModule] changeTagColor: 颜色格式非法");
  }
  const tag = (data.tags || []).find((t) => t.name === name);
  if (!tag) throw new Error(`[DataModule] changeTagColor: 标签不存在: ${name}`);
  tag.color = color;
  await save();
  return tag;
}

// ============ 备份管理 ============

/**
 * createBackup(force) → 创建备份
 * name = "dotoday_backup_YYYYMMDD_HHMMSS"；
 * force=false 时当日（同 YYYYMMDD 前缀）已有备份则跳过；
 * 备份完成后自动调用 cleanOldBackups()。
 * @returns {string|null} 备份名；当日已存在被跳过时返回 null
 */
async function createBackup(force = false) {
  ensureBrowser();
  if (!db) db = await openDB();
  const name = `dotoday_backup_${backupStamp(new Date())}`;
  if (!force) {
    // 当日去重：同日前缀 "dotoday_backup_YYYYMMDD_" 已有备份则跳过
    const prefix = name.slice(0, name.lastIndexOf("_") + 1);
    const existing = await listBackups();
    if (existing.some((b) => b.name.startsWith(prefix))) {
      return null;
    }
  }
  const snapshot = clone(data || DEFAULT_DATA);
  await reqPromise(
    getStore(STORE_BACKUP, "readwrite").put({
      name,
      data: snapshot,
      createdAt: Date.now(),
    })
  );
  await cleanOldBackups();
  return name;
}

/** listBackups() → 备份列表（按创建时间倒序），元素 {name, createdAt} */
async function listBackups() {
  ensureBrowser();
  if (!db) db = await openDB();
  const all = await reqPromise(getStore(STORE_BACKUP, "readonly").getAll());
  all.sort((a, b) => b.createdAt - a.createdAt);
  return all.map((b) => ({ name: b.name, createdAt: b.createdAt }));
}

/** restoreBackup(name) → 读取备份覆盖主数据，返回恢复后的数据 */
async function restoreBackup(name) {
  ensureBrowser();
  if (!db) db = await openDB();
  const backup = await reqPromise(getStore(STORE_BACKUP, "readonly").get(name));
  if (!backup) throw new Error(`[DataModule] restoreBackup: 备份不存在: ${name}`);
  data = clone(backup.data);
  await save();
  return data;
}

/** cleanOldBackups() → 清理旧备份，仅保留最近 10 份，返回删除份数 */
async function cleanOldBackups() {
  ensureBrowser();
  if (!db) db = await openDB();
  const all = await listBackups(); // 已按时间倒序
  if (all.length <= MAX_BACKUPS) return 0;
  const toRemove = all.slice(MAX_BACKUPS).map((b) => b.name);
  const store = getStore(STORE_BACKUP, "readwrite");
  await Promise.all(toRemove.map((n) => reqPromise(store.delete(n))));
  return toRemove.length;
}

// ============ 数据合并（v0.5.0 同步用，本期实现） ============

/**
 * mergeData(local, remote) → 合并两份数据（纯函数，不依赖 IndexedDB）
 *   - 记录：按 id 去重，同一 id 取 updatedAt 较新者胜
 *   - 标签：取并集（按名称去重，保留先创建者）
 * @returns {{version:string, records:Array, tags:Array}}
 */
function mergeData(local, remote) {
  const lr = local && Array.isArray(local.records) ? local.records : [];
  const rr = remote && Array.isArray(remote.records) ? remote.records : [];
  const lt = local && Array.isArray(local.tags) ? local.tags : [];
  const rt = remote && Array.isArray(remote.tags) ? remote.tags : [];

  // 记录合并：按 id 去重，updatedAt 较新者胜
  const recordMap = new Map();
  for (const r of lr) recordMap.set(r.id, clone(r));
  for (const r of rr) {
    const exist = recordMap.get(r.id);
    if (!exist) {
      recordMap.set(r.id, clone(r));
    } else if ((r.updatedAt || 0) > (exist.updatedAt || 0)) {
      recordMap.set(r.id, clone(r));
    }
  }

  // 标签合并：按名称取并集，保留先创建者（颜色一致）
  const tagMap = new Map();
  for (const t of lt) tagMap.set(t.name, clone(t));
  for (const t of rt) {
    if (!tagMap.has(t.name)) tagMap.set(t.name, clone(t));
  }
  const tags = [...tagMap.values()].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
  );

  return {
    version: (local && local.version) || (remote && remote.version) || APP_VERSION,
    records: [...recordMap.values()],
    tags,
  };
}

// ============ 初始化 ============

/**
 * init() → 初始化数据层
 * 1. 打开 IndexedDB（创建缺失的 store）
 * 2. 加载数据，不存在则初始化默认数据并写盘
 * 3. 调用每日备份 createBackup(false)（当日已有则跳过）
 */
async function init() {
  ensureBrowser();
  if (!db) db = await openDB();
  await load();
  await save(); // 首次使用时确保默认数据落盘
  await createBackup(false);
  return data;
}

/** 统一导出对象（接口见计划文档 6.2） */
export const DataModule = {
  init,
  getAllRecords,
  getRecordsByDate,
  getRecordsByRange,
  addRecord,
  updateRecord,
  deleteRecord,
  batchDelete,
  searchRecords,
  filterRecords,
  getTags,
  addTag,
  renameTag,
  deleteTag,
  changeTagColor,
  save,
  load,
  createBackup,
  listBackups,
  restoreBackup,
  cleanOldBackups,
  mergeData,
};

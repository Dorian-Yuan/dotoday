/**
 * export.test.js —— ExportModule 导出模块单元测试（node:test）
 *
 * 运行：node --test test/export.test.js
 * 覆盖：筛选（时间范围/评分/标签任一/组合）、脱敏、JSON/CSV/TXT 三种格式
 *       （含转义、顿号连接、脱敏列）、空数据边界。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION } from "../js/config.js";
import { ExportModule } from "../js/export.js";

/** 测试记录（含空值、特殊字符、多标签） */
const RECORDS = [
  { id: 1, date: "2024-05-28", time: "22:30", rating: 4, note: "跑步", tags: ["运动"] },
  { id: 2, date: "2024-05-29", time: null, rating: null, note: "读书", tags: ["学习"] },
  {
    id: 3,
    date: "2024-06-01",
    time: "08:00",
    rating: 5,
    note: '备注,含逗号 和"引号"',
    tags: ["运动", "学习"],
  },
  { id: 4, date: "2024-06-15", time: "12:00", rating: 3, note: "", tags: [] },
];

// ---------- applyFilters ----------

test("applyFilters：空 filters 返回全部（副本，不改原数组）", () => {
  const all = ExportModule.applyFilters(RECORDS);
  assert.equal(all.length, 4);
  assert.deepEqual(all, RECORDS);
  assert.notEqual(all, RECORDS); // 副本
  assert.equal(ExportModule.applyFilters(RECORDS, null).length, 4);
  assert.equal(ExportModule.applyFilters(RECORDS, {}).length, 4);
});

test("applyFilters：时间范围含边界", () => {
  const result = ExportModule.applyFilters(RECORDS, {
    start: "2024-05-28",
    end: "2024-05-29",
  });
  assert.deepEqual(result.map((r) => r.id), [1, 2]); // 两端日期均含
});

test("applyFilters：评分筛选（数字精确匹配，null 不筛）", () => {
  assert.deepEqual(ExportModule.applyFilters(RECORDS, { rating: 4 }).map((r) => r.id), [1]);
  assert.deepEqual(ExportModule.applyFilters(RECORDS, { rating: 5 }).map((r) => r.id), [3]);
  assert.equal(ExportModule.applyFilters(RECORDS, { rating: 9 }).length, 0);
  // rating: null → 不筛
  assert.equal(ExportModule.applyFilters(RECORDS, { rating: null }).length, 4);
});

test("applyFilters：标签任一匹配", () => {
  const result = ExportModule.applyFilters(RECORDS, { tags: ["学习"] });
  assert.deepEqual(result.map((r) => r.id), [2, 3]); // 记录 2、3 都含"学习"

  const result2 = ExportModule.applyFilters(RECORDS, { tags: ["运动"] });
  assert.deepEqual(result2.map((r) => r.id), [1, 3]);

  // 空标签数组不筛
  assert.equal(ExportModule.applyFilters(RECORDS, { tags: [] }).length, 4);
});

test("applyFilters：组合筛选（范围+评分+标签同时满足）", () => {
  const result = ExportModule.applyFilters(RECORDS, {
    start: "2024-05-28",
    end: "2024-06-01",
    rating: 5,
    tags: ["运动"],
  });
  assert.deepEqual(result.map((r) => r.id), [3]);
});

// ---------- applyDesensitize ----------

test("applyDesensitize：只保留 date 与 rating", () => {
  const result = ExportModule.applyDesensitize(RECORDS);
  assert.equal(result.length, 4);
  assert.deepEqual(result[0], { date: "2024-05-28", rating: 4 });
  assert.deepEqual(result[1], { date: "2024-05-29", rating: null });
  // 每条仅含 date/rating 两个键
  for (const r of result) {
    assert.deepEqual(Object.keys(r).sort(), ["date", "rating"]);
  }
});

// ---------- toJSON ----------

test("toJSON：完整结构 {version, exportedAt, records}，缩进 2", () => {
  const json = ExportModule.toJSON(RECORDS);
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, APP_VERSION);
  assert.ok(typeof parsed.exportedAt === "string");
  assert.ok(!Number.isNaN(Date.parse(parsed.exportedAt))); // 合法时间戳
  assert.equal(parsed.records.length, 4);
  assert.deepEqual(parsed.records[0], RECORDS[0]);
  // 缩进 2：字符串含换行与两空格缩进
  assert.ok(json.includes('\n  "version"'));
});

test("toJSON：脱敏后仅 {records}，无 version/exportedAt", () => {
  const json = ExportModule.toJSON(RECORDS, { desensitize: true });
  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed), ["records"]);
  assert.deepEqual(parsed.records, ExportModule.applyDesensitize(RECORDS));
});

test("toJSON：空数据", () => {
  assert.deepEqual(JSON.parse(ExportModule.toJSON([])), {
    version: APP_VERSION,
    exportedAt: JSON.parse(ExportModule.toJSON([])).exportedAt,
    records: [],
  });
  // 等价简化断言
  const parsed = JSON.parse(ExportModule.toJSON([]));
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.version, APP_VERSION);
});

// ---------- toCSV ----------

test("toCSV：表头与行内容、tags 顿号连接、空值空字段", () => {
  const csv = ExportModule.toCSV(RECORDS);
  const lines = csv.split("\n");
  assert.equal(lines[0], "date,time,rating,note,tags");
  assert.equal(lines[1], "2024-05-28,22:30,4,跑步,运动");
  assert.equal(lines[2], "2024-05-29,,,读书,学习"); // time/rating 空值 → 空字段
  assert.equal(lines[4], "2024-06-15,12:00,3,,"); // note/tags 空 → 末尾空字段
  // tags 顿号连接
  assert.ok(lines[3].includes("运动、学习"));
});

test("toCSV：含逗号/引号的字段按 CSV 规则转义", () => {
  const csv = ExportModule.toCSV(RECORDS);
  const line3 = csv.split("\n")[3];
  // 备注含逗号 → 双引号包裹；内部引号 → 翻倍
  assert.equal(
    line3,
    '2024-06-01,08:00,5,"备注,含逗号 和""引号""",运动、学习'
  );
});

test("toCSV：脱敏仅两列 date,rating", () => {
  const csv = ExportModule.toCSV(RECORDS, { desensitize: true });
  const lines = csv.split("\n");
  assert.equal(lines[0], "date,rating");
  assert.equal(lines[1], "2024-05-28,4");
  assert.equal(lines[2], "2024-05-29,"); // rating null → 空字段
});

test("toCSV：空数据仅表头", () => {
  assert.equal(ExportModule.toCSV([]), "date,time,rating,note,tags");
  assert.equal(ExportModule.toCSV([], { desensitize: true }), "date,rating");
});

// ---------- toTXT ----------

test("toTXT：每行一条记录，空值用占位「无」", () => {
  const txt = ExportModule.toTXT(RECORDS);
  const lines = txt.split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "2024-05-28 22:30 4 跑步 运动");
  assert.equal(lines[1], "2024-05-29 无 无 读书 学习"); // time/rating 空 → 无
  assert.equal(lines[2], "2024-06-01 08:00 5 备注,含逗号 和\"引号\" 运动、学习");
  assert.equal(lines[3], "2024-06-15 12:00 3 无 无"); // note/tags 空 → 无
});

test("toTXT：脱敏仅日期与评分", () => {
  const txt = ExportModule.toTXT(RECORDS, { desensitize: true });
  const lines = txt.split("\n");
  assert.equal(lines[0], "2024-05-28 4");
  assert.equal(lines[1], "2024-05-29 无"); // rating null → 无
});

test("toTXT：空数据返回空串", () => {
  assert.equal(ExportModule.toTXT([]), "");
});

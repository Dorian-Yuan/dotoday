/**
 * parse-import.test.js —— ImportParser 导入解析模块单元测试（node:test）
 *
 * 运行：node --test test/parse-import.test.js
 * 覆盖：各日期格式、次数（全角/半角/默认）、备注（单行/多行/含数字）、
 *       年份上下文推断、坏行标记、expandRecords、normalizeText、真实场景。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ImportParser } from "../js/pure/parse-import.js";

// ---------- normalizeText ----------

test("normalizeText：全角数字/括号/点/短横/斜杠/空格转半角，中文保留", () => {
  assert.equal(ImportParser.normalizeText("２０２４年１月２日（３）"), "2024年1月2日(3)");
  assert.equal(ImportParser.normalizeText("2024．1．1"), "2024.1.1");
  assert.equal(ImportParser.normalizeText("2024－1－1"), "2024-1-1");
  assert.equal(ImportParser.normalizeText("2024／1／1"), "2024/1/1");
  assert.equal(ImportParser.normalizeText("2024　1.1"), "2024 1.1"); // 全角空格
  assert.equal(ImportParser.normalizeText("2月2日"), "2月2日"); // 中文保留
  assert.equal(ImportParser.normalizeText(null), "");
  assert.equal(ImportParser.normalizeText(""), "");
});

// ---------- 日期格式 ----------

test("parseText：标准年月日 2024-1-1 / 2024-01-01", () => {
  const a = ImportParser.parseText("2024-1-1", 2026);
  assert.equal(a.length, 1);
  assert.equal(a[0].date, "2024-01-01");
  assert.equal(a[0].count, 1);
  assert.equal(a[0].ok, true);

  const b = ImportParser.parseText("2024-01-01", 2026);
  assert.equal(b[0].date, "2024-01-01");
});

test("parseText：2024 1.1（年 空格 月.日）与 2024 1-1", () => {
  const a = ImportParser.parseText("2024 1.1 元旦", 2026);
  assert.equal(a[0].date, "2024-01-01");
  assert.equal(a[0].note, "元旦");

  const b = ImportParser.parseText("2024 1-1", 2026);
  assert.equal(b[0].date, "2024-01-01");
});

test("parseText：2024/1/1 与 2024.1.1", () => {
  assert.equal(ImportParser.parseText("2024/1/1", 2026)[0].date, "2024-01-01");
  assert.equal(ImportParser.parseText("2024.1.1", 2026)[0].date, "2024-01-01");
});

test("parseText：中文月日 2月2日 / 2月2号（省略年份用 refYear）", () => {
  const a = ImportParser.parseText("2月2日", 2026);
  assert.equal(a[0].date, "2026-02-02");
  const b = ImportParser.parseText("2月2号", 2026);
  assert.equal(b[0].date, "2026-02-02");
});

test("parseText：1.1 省略年份用 refYear（默认当前年份）", () => {
  const items = ImportParser.parseText("1.1", 2026);
  assert.equal(items[0].date, "2026-01-01");
});

test("parseText：全角输入也能解析（先 normalize）", () => {
  const items = ImportParser.parseText("２月２日（２）跑步", 2026);
  assert.equal(items[0].date, "2026-02-02");
  assert.equal(items[0].count, 2);
  assert.equal(items[0].note, "跑步");
});

// ---------- 次数 ----------

test("parseText：次数 (3) / 全角（2）/ 无括号默认 1", () => {
  const a = ImportParser.parseText("2024 1.1(3) 跑步", 2024);
  assert.equal(a[0].count, 3);
  assert.equal(a[0].note, "跑步"); // 次数括号从备注中移除

  const b = ImportParser.parseText("2月2日（2）", 2024);
  assert.equal(b[0].count, 2);

  const c = ImportParser.parseText("2024-05-28", 2024);
  assert.equal(c[0].count, 1);
});

test("parseText：非数字括号（如备注开头（重要））不当作次数", () => {
  const items = ImportParser.parseText("2024-05-28（重要）完成项目", 2024);
  assert.equal(items[0].count, 1);
  assert.equal(items[0].note, "(重要)完成项目"); // 全角括号已 normalize 为半角
});

// ---------- 备注 ----------

test("parseText：单行备注（含中文与数字）", () => {
  const items = ImportParser.parseText("2024-05-28 跑了5公里，体重72.5kg", 2024);
  assert.equal(items.length, 1); // "72.5" 月 72 非法，不误判为日期
  assert.equal(items[0].note, "跑了5公里，体重72.5kg");
});

test("parseText：多行备注（到下一个日期为止，可跨行）", () => {
  const text = "2024-05-28 第一条\n这是跨行备注第二行\n2024-05-29 第二条";
  const items = ImportParser.parseText(text, 2024);
  assert.equal(items.length, 2);
  assert.equal(items[0].date, "2024-05-28");
  assert.equal(items[0].note, "第一条\n这是跨行备注第二行");
  assert.equal(items[1].date, "2024-05-29");
  assert.equal(items[1].note, "第二条");
});

// ---------- 年份推断 ----------

test("parseText：上下文年份推断（前一条 2024 → 后一条省略年份用 2024）", () => {
  const text = "2024-12-31 年末\n1.1 新年\n2月2日 春节";
  const items = ImportParser.parseText(text, 2026); // refYear 2026 被上下文覆盖
  assert.equal(items.length, 3);
  assert.equal(items[0].date, "2024-12-31");
  assert.equal(items[1].date, "2024-01-01"); // 用上一条的 2024
  assert.equal(items[2].date, "2024-02-02"); // 继续用 2024
});

// ---------- 坏行 ----------

test("parseText：纯文字无日期 → 整段坏行 ok=false，raw 保留原文", () => {
  const items = ImportParser.parseText("这是一行没有日期的说明文字", 2026);
  assert.equal(items.length, 1);
  assert.equal(items[0].ok, false);
  assert.equal(items[0].raw, "这是一行没有日期的说明文字");
  assert.equal(items[0].date, null);
});

test("parseText：首个日期之前的前导文字 → 坏行，后续正常解析", () => {
  const items = ImportParser.parseText("(随手记)\n2024-05-28 记录", 2024);
  assert.equal(items.length, 2);
  assert.equal(items[0].ok, false);
  assert.equal(items[0].raw, "(随手记)"); // 全角括号已 normalize
  assert.equal(items[1].ok, true);
  assert.equal(items[1].date, "2024-05-28");
  assert.equal(items[1].note, "记录");
});

// ---------- expandRecords ----------

test("expandRecords：count=3 展开为 3 条 {date, note}（不含 id/时间戳）", () => {
  const items = [
    { date: "2024-05-28", count: 3, note: "跑步" },
    { date: "2024-05-29", count: 1, note: "读书" },
  ];
  assert.deepEqual(ImportParser.expandRecords(items), [
    { date: "2024-05-28", note: "跑步" },
    { date: "2024-05-28", note: "跑步" },
    { date: "2024-05-28", note: "跑步" },
    { date: "2024-05-29", note: "读书" },
  ]);
});

test("expandRecords：无效项（无 date）跳过，count 缺失按 1", () => {
  const items = [
    { date: null, count: 2, note: "坏行" },
    { date: "2024-05-28", note: "无count" },
  ];
  assert.deepEqual(ImportParser.expandRecords(items), [
    { date: "2024-05-28", note: "无count" },
  ]);
});

// ---------- validateItems ----------

test("validateItems：非法日期/非法次数标记 ok=false", () => {
  const items = [
    { date: "2024-02-30", count: 1, note: "不存在的日期" },
    { date: "2024-05-28", count: 0, note: "次数非法" },
    { date: "2024-05-28", count: 1, note: "正常" },
    { date: "bad-date", count: 1, note: "格式错误" },
    { date: "2024-05-28", count: "3", note: "次数非数字" },
  ];
  const result = ImportParser.validateItems(items);
  assert.equal(result.length, 5);
  assert.equal(result[0].ok, false); // 2月30日 不存在（parseDate 往返不一致）
  assert.equal(result[1].ok, false); // count 0
  assert.equal(result[2].ok, true);
  assert.equal(result[3].ok, false); // 格式错误
  assert.equal(result[4].ok, false); // count 为字符串
  // 原字段保留
  assert.equal(result[2].date, "2024-05-28");
  assert.equal(result[2].count, 1);
});

// ---------- 真实场景 ----------

test("parseText：真实场景混合文本", () => {
  const text = `2024 1.1(2) 元旦跑步
2024-01-02 上班第一天
1.3 忘了带钥匙(爬窗)
(以下是补充)
2月2日 春节`;
  const items = ImportParser.parseText(text, 2026);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], {
    date: "2024-01-01",
    count: 2,
    note: "元旦跑步",
    ok: true,
    raw: null,
  });
  assert.deepEqual(items[1], {
    date: "2024-01-02",
    count: 1,
    note: "上班第一天",
    ok: true,
    raw: null,
  });
  // 1.3 年份用上下文 2024；(爬窗) 非次数保留在备注；跨行备注到下个日期
  assert.deepEqual(items[2], {
    date: "2024-01-03",
    count: 1,
    note: "忘了带钥匙(爬窗)\n(以下是补充)",
    ok: true,
    raw: null,
  });
  // 2月2日 继续沿用上下文年份 2024
  assert.deepEqual(items[3], {
    date: "2024-02-02",
    count: 1,
    note: "春节",
    ok: true,
    raw: null,
  });
});

test("parseText + expandRecords：真实场景次数展开", () => {
  const items = ImportParser.parseText("2024 1.1(3) 跑步\n2月2日 读书", 2026);
  assert.equal(items[0].count, 3);
  const expanded = ImportParser.expandRecords(items);
  assert.equal(expanded.length, 4); // 3 + 1
  assert.deepEqual(expanded[0], { date: "2024-01-01", note: "跑步" });
  // "2月2日" 省略年份：上下文推断优先于 refYear（上一条为 2024）
  assert.deepEqual(expanded[3], { date: "2024-02-02", note: "读书" });
});

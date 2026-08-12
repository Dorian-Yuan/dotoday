/**
 * sync-crypto.test.js —— SyncCrypto 加密模块单元测试（node:test）
 *
 * 运行：node --test test/sync-crypto.test.js
 * 覆盖：加解密往返（中文/嵌套）、密钥派生一致性、错误密钥/篡改盐解密失败、
 *       备份文件名格式、planCleanup 清理策略、加密结果结构（base64 非明文）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncCrypto } from "../js/pure/sync-crypto.js";

/** 模拟 DoToday 完整数据快照（含中文与嵌套结构） */
const SAMPLE_DATA = {
  version: "0.3.0",
  records: [
    {
      id: 1716860400000,
      date: "2024-05-28",
      time: "22:30",
      rating: 4,
      note: "中文备注：跑步 5km，感觉不错",
      tags: ["运动", "健康"],
      createdAt: 1716860400000,
      updatedAt: 1716860400000,
    },
    {
      id: 1716946800000,
      date: "2024-05-29",
      time: null,
      rating: null,
      note: "嵌套对象测试",
      tags: [],
      createdAt: 1716946800000,
      updatedAt: 1716946800000,
    },
  ],
  tags: [
    { name: "运动", color: "#9c8f84", createdAt: 1716860400000 },
    { name: "健康", color: "#8fa3a8", createdAt: 1716860400000 },
  ],
};

// ---------- 加解密往返 ----------

test("加解密往返：encrypt → decrypt 得到相同对象（含中文/嵌套）", async () => {
  const enc = await SyncCrypto.encryptSnapshot(SAMPLE_DATA, "my-secret-key");
  const dec = await SyncCrypto.decryptSnapshot(enc, "my-secret-key");
  assert.deepEqual(dec, SAMPLE_DATA);
});

test("加解密往返：简单对象与空对象", async () => {
  const enc = await SyncCrypto.encryptSnapshot({ note: "测试" }, "k");
  assert.deepEqual(await SyncCrypto.decryptSnapshot(enc, "k"), { note: "测试" });

  const enc2 = await SyncCrypto.encryptSnapshot({}, "k");
  assert.deepEqual(await SyncCrypto.decryptSnapshot(enc2, "k"), {});
});

// ---------- 密钥派生 ----------

test("deriveKey：相同 secret + salt 派生一致密钥（可相互加解密）", async () => {
  const enc = await SyncCrypto.encryptSnapshot({ a: 1 }, "key-1");
  // 两次独立派生（salt 传 base64 字符串）
  const key1 = await SyncCrypto.deriveKey("key-1", enc.salt);
  const key2 = await SyncCrypto.deriveKey("key-1", enc.salt);
  // CryptoKey 不可导出比较，验证功能等价：key1 加密 → key2 解密
  const subtle = globalThis.crypto.subtle;
  const iv = new Uint8Array(12);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key1,
    new TextEncoder().encode("hello")
  );
  const pt = await subtle.decrypt({ name: "AES-GCM", iv }, key2, ct);
  assert.equal(new TextDecoder().decode(pt), "hello");
});

test("密钥派生一致性：相同 secret 可解密；不同 salt 解密失败", async () => {
  const enc = await SyncCrypto.encryptSnapshot({ note: "测试" }, "secret-a");
  // 相同 secret → deriveKey 重新派生一致 → 解密成功
  assert.deepEqual(await SyncCrypto.decryptSnapshot(enc, "secret-a"), {
    note: "测试",
  });
  // 换用另一个加密结果的盐（篡改 salt）→ AES-GCM 认证失败 → 抛错
  const enc2 = await SyncCrypto.encryptSnapshot({}, "secret-a");
  const tampered = { ...enc, salt: enc2.salt };
  await assert.rejects(
    () => SyncCrypto.decryptSnapshot(tampered, "secret-a"),
    /解密失败/
  );
});

// ---------- 错误密钥 ----------

test("错误私钥解密失败（抛清晰错误）", async () => {
  const enc = await SyncCrypto.encryptSnapshot(SAMPLE_DATA, "right-secret");
  await assert.rejects(
    () => SyncCrypto.decryptSnapshot(enc, "wrong-secret"),
    /解密失败/
  );
});

test("payload 结构缺失抛清晰错误", async () => {
  await assert.rejects(
    () => SyncCrypto.decryptSnapshot({ salt: "x", iv: "y" }, "k"),
    /payload 格式不正确/
  );
  await assert.rejects(() => SyncCrypto.decryptSnapshot(null, "k"), /payload 格式不正确/);
});

// ---------- buildBackupName ----------

test("buildBackupName：backup_YYYYMMDD_HHMMSS.json.enc 格式", () => {
  assert.equal(
    SyncCrypto.buildBackupName(new Date(2026, 7, 11, 14, 30, 0)),
    "backup_20260811_143000.json.enc"
  );
  assert.equal(
    SyncCrypto.buildBackupName(new Date(2026, 0, 5, 9, 5, 7)),
    "backup_20260105_090507.json.enc"
  );
});

// ---------- planCleanup ----------

/** 构造备份文件名辅助（2026-08-{day}） */
function backupName(day) {
  return `backup_202608${String(day).padStart(2, "0")}_000000.json.enc`;
}

test("planCleanup：maxKeep 内不删除", () => {
  const names = [];
  for (let i = 1; i <= 20; i++) names.push(backupName(i));
  assert.deepEqual(SyncCrypto.planCleanup(names), []);
  assert.deepEqual(SyncCrypto.planCleanup(names, 20), []);
});

test("planCleanup：超过 maxKeep 删除最旧（超出部分）", () => {
  const names = [];
  for (let i = 1; i <= 25; i++) names.push(backupName(i));
  const toDelete = SyncCrypto.planCleanup(names, 20);
  assert.equal(toDelete.length, 5);
  // 删除的是最旧的 5 份
  assert.deepEqual(toDelete, [
    backupName(1),
    backupName(2),
    backupName(3),
    backupName(4),
    backupName(5),
  ]);
});

test("planCleanup：非 backup 名不参与统计与删除", () => {
  const names = ["current.json.enc", "notes.txt", backupName(1)];
  assert.deepEqual(SyncCrypto.planCleanup(names, 20), []);

  // 混入非 backup 名：只按 backup_*.json.enc 计数
  const names2 = ["current.json.enc", "README.md"];
  for (let i = 1; i <= 21; i++) names2.push(backupName(i));
  const toDelete = SyncCrypto.planCleanup(names2, 20);
  assert.deepEqual(toDelete, [backupName(1)]);
  assert.ok(!toDelete.includes("current.json.enc"));
});

test("planCleanup：乱序输入按时间戳排序，删除最旧", () => {
  const names = [
    backupName(20),
    backupName(3),
    backupName(10),
    backupName(1),
    backupName(15),
  ];
  const toDelete = SyncCrypto.planCleanup(names, 3);
  assert.deepEqual(toDelete, [backupName(1), backupName(3)]);
});

// ---------- 加密结果结构 ----------

test("加密结果结构：含 salt/iv/data 且 data 为 base64 非明文", async () => {
  const enc = await SyncCrypto.encryptSnapshot(
    { note: "秘密内容 top-secret" },
    "s"
  );
  // 三个字段齐全且为非空字符串
  assert.ok(typeof enc.salt === "string" && enc.salt.length > 0);
  assert.ok(typeof enc.iv === "string" && enc.iv.length > 0);
  assert.ok(typeof enc.data === "string" && enc.data.length > 0);
  // data 不含明文（中文与英文均不可见）
  assert.ok(!enc.data.includes("秘密内容"));
  assert.ok(!enc.data.includes("top-secret"));
  // data / salt / iv 均为合法 base64 字符集
  assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(enc.data));
  assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(enc.salt));
  assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(enc.iv));
  // salt = 16 字节 → 24 字符（含 == 补位）；iv = 12 字节 → 16 字符
  assert.equal(enc.salt.length, 24);
  assert.equal(enc.iv.length, 16);
});

test("同一数据两次加密产生不同密文（随机 salt/iv）", async () => {
  const a = await SyncCrypto.encryptSnapshot({ note: "相同内容" }, "k");
  const b = await SyncCrypto.encryptSnapshot({ note: "相同内容" }, "k");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  // 两份都能用同一私钥解密
  assert.deepEqual(await SyncCrypto.decryptSnapshot(a, "k"), { note: "相同内容" });
  assert.deepEqual(await SyncCrypto.decryptSnapshot(b, "k"), { note: "相同内容" });
});

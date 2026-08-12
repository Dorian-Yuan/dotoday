/**
 * sync-crypto.js —— GitHub 加密同步纯逻辑加密模块（DoToday v0.5.0 预实现）
 *
 * 纯逻辑模块：仅依赖 Web Crypto API（globalThis.crypto.subtle，Node 19+ 与浏览器均有），
 * 不涉及 fetch / GitHub API，可在 Node 下直接运行单元测试（node --test）。
 *
 * 接口设计见计划文档 6.4 节：
 *   deriveKey / encryptSnapshot / decryptSnapshot / buildBackupName / planCleanup
 *
 * 加密流程（计划文档 2.3 GitHub 同步）：
 *   私钥（secret）→ PBKDF2（SHA-256，310000 次迭代）派生 AES-256 密钥；
 *   加密时使用随机盐（16 字节，随文件存储，同一私钥可解密所有快照）；
 *   AES-GCM 加密完整数据快照，每次加密生成随机 IV（12 字节）；
 *   加密内容 { salt, iv, data } 均为 base64 字符串。
 *
 * base64 编解码采用纯 Uint8Array 手动实现（不依赖 btoa/atob/Buffer），
 * 浏览器与 Node 行为完全一致，可安全处理含中文的二进制数据。
 */

// ============ 常量 ============

/** PBKDF2 迭代次数（计划文档：约 31 万次） */
const PBKDF2_ITERATIONS = 310000;
/** 随机盐字节数（PBKDF2 盐，16 字节） */
const SALT_BYTES = 16;
/** AES-GCM 推荐 IV 字节数（12 字节） */
const IV_BYTES = 12;
/** base64 字符表 */
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// ============ 底层工具（浏览器 / Node 通用，无第三方依赖） ============

/**
 * 获取 Web Crypto subtle 对象。
 * 在函数内获取（模块顶层不执行任何 API，保证 import 不崩）。
 */
function getSubtle() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error("[SyncCrypto] 当前环境不支持 Web Crypto API（crypto.subtle 不可用）");
  }
  return cryptoObj.subtle;
}

/** 生成 n 字节加密安全随机数（salt / IV） */
function getRandomBytes(n) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj) {
    throw new Error("[SyncCrypto] 当前环境不支持 Web Crypto API（crypto 不可用）");
  }
  const bytes = new Uint8Array(n);
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

/** UTF-8 字符串 → Uint8Array（TextEncoder，浏览器 / Node 通用） */
function encodeUtf8(str) {
  return new TextEncoder().encode(str);
}

/** Uint8Array → UTF-8 字符串 */
function decodeUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

/**
 * Uint8Array → base64 字符串（手动实现，每 3 字节 → 4 字符，末组补 "="）。
 * 不依赖 btoa（Node 差异）与 Buffer（浏览器无），两端行为一致。
 */
function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 63] : "=";
  }
  return out;
}

/**
 * base64 字符串 → Uint8Array。
 * 容忍 padding 与无关字符（先清洗出 base64 字符集）。
 */
function base64ToBytes(b64) {
  const clean = String(b64).replace(/[^A-Za-z0-9+/]/g, "");
  const len = clean.length;
  const bytes = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_CHARS.indexOf(clean[i]);
    const c1 = B64_CHARS.indexOf(clean[i + 1]);
    const c2 = i + 2 < len ? B64_CHARS.indexOf(clean[i + 2]) : 0;
    const c3 = i + 3 < len ? B64_CHARS.indexOf(clean[i + 3]) : 0;
    bytes[p++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < len) bytes[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (i + 3 < len) bytes[p++] = ((c2 & 3) << 6) | c3;
  }
  return bytes;
}

/** salt 参数归一化：Uint8Array 直接使用，base64 字符串解码后使用 */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof input === "string") return base64ToBytes(input);
  throw new Error("[SyncCrypto] salt 参数须为 Uint8Array 或 base64 字符串");
}

// ============ 核心接口（plan 6.4） ============

/**
 * deriveKey(secret, salt) → Promise<CryptoKey>
 * PBKDF2（SHA-256，310000 次迭代）从私钥派生 AES-GCM 256 位密钥。
 * 密钥不可导出；相同 secret + salt 始终派生一致密钥。
 *
 * @param {string} secret 用户私钥（任意字符串）
 * @param {Uint8Array|string} salt 随机盐（Uint8Array 或 base64 字符串）
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(secret, salt) {
  const subtle = getSubtle();
  const saltBytes = toBytes(salt);
  // 1. 导入私钥材料（raw 格式）
  const keyMaterial = await subtle.importKey(
    "raw",
    encodeUtf8(String(secret)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  // 2. PBKDF2 派生 AES-GCM 256 位密钥（高迭代次数抵御暴力破解）
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // 不可导出
    ["encrypt", "decrypt"]
  );
}

/**
 * encryptSnapshot(data, secret) → Promise<{ salt, iv, data }>
 * 加密完整数据快照：JSON.stringify → 随机 salt（16 字节）+ 随机 iv（12 字节）
 * → deriveKey → AES-GCM 加密。返回的 salt/iv/data 均为 base64 字符串。
 *
 * @param {any} data 任意可 JSON 序列化对象（records 数据）
 * @param {string} secret 用户私钥
 * @returns {Promise<{salt:string, iv:string, data:string}>}
 */
async function encryptSnapshot(data, secret) {
  const subtle = getSubtle();
  // 1. 序列化数据快照
  const json = JSON.stringify(data);
  // 2. 每次加密生成随机 salt 与 iv（salt 随文件存储，供解密时派生同一密钥）
  const salt = getRandomBytes(SALT_BYTES);
  const iv = getRandomBytes(IV_BYTES);
  // 3. 派生密钥并 AES-GCM 加密
  const key = await deriveKey(secret, salt);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodeUtf8(json)
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * decryptSnapshot(payload, secret) → Promise<原始对象>
 * 解密加密快照并 JSON.parse 还原；解密失败（私钥错误 / 数据损坏）抛清晰错误。
 *
 * @param {{salt:string, iv:string, data:string}} payload 加密内容（base64）
 * @param {string} secret 用户私钥
 * @returns {Promise<any>}
 */
async function decryptSnapshot(payload, secret) {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.salt !== "string" ||
    typeof payload.iv !== "string" ||
    typeof payload.data !== "string"
  ) {
    throw new Error("[SyncCrypto] decryptSnapshot: payload 格式不正确（缺少 salt/iv/data）");
  }
  const subtle = getSubtle();
  try {
    // 用快照自带的盐派生密钥（同一私钥可解密所有快照）
    const key = await deriveKey(secret, payload.salt);
    const plaintext = await subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.data)
    );
    // AES-GCM 认证通过 → 明文可信，还原为原始对象
    return JSON.parse(decodeUtf8(new Uint8Array(plaintext)));
  } catch (err) {
    // AES-GCM 认证失败（错误私钥/被篡改）或 JSON 解析失败统一提示
    throw new Error(
      `[SyncCrypto] decryptSnapshot: 解密失败（私钥错误或数据已损坏）: ${err && err.message}`
    );
  }
}

/**
 * buildBackupName(date) → 加密备份文件名
 * "backup_YYYYMMDD_HHMMSS.json.enc"（时间戳取自本地时区）。
 *
 * @param {Date} date 备份时间
 * @returns {string}
 */
function buildBackupName(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad2 = (n) => String(n).padStart(2, "0");
  return (
    `backup_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}.json.enc`
  );
}

/**
 * planCleanup(remoteNames, maxKeep = 20) → 需删除的远端备份文件名数组
 * 规则：remoteNames 中匹配 "backup_*.json.enc" 的按文件名内时间戳
 * （YYYYMMDD_HHMMSS）升序排序，超过 maxKeep 份时删除最旧的（超出部分）；
 * 非 backup 名（如 current.json.enc）不参与统计也不返回。
 *
 * @param {string[]} remoteNames 远端目录文件名列表
 * @param {number} [maxKeep] 保留份数上限（默认 20）
 * @returns {string[]}
 */
function planCleanup(remoteNames, maxKeep = 20) {
  const BACKUP_NAME = /^backup_(\d{8})_(\d{6})\.json\.enc$/;
  const backups = [];
  for (const name of remoteNames || []) {
    if (typeof name !== "string") continue;
    const m = BACKUP_NAME.exec(name);
    if (!m) continue; // 非 backup 名不参与
    backups.push({ name, stamp: m[1] + m[2] }); // stamp: YYYYMMDDHHMMSS（定长数字串，字典序=时间序）
  }
  backups.sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0));
  if (backups.length <= maxKeep) return [];
  // 删除最旧的（超出上限的部分）
  return backups.slice(0, backups.length - maxKeep).map((b) => b.name);
}

/** 统一导出对象（接口见计划文档 6.4） */
export const SyncCrypto = {
  deriveKey,
  encryptSnapshot,
  decryptSnapshot,
  buildBackupName,
  planCleanup,
};

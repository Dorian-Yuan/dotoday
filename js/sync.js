/**
 * sync.js —— GitHub 加密同步编排（DoToday v0.8.0）
 *
 * 模型：本地始终是权威数据源。
 *   上传（日常）：加密当前数据 → PUT current.json.enc（覆盖）+ backup_时间戳.json.enc → 超 20 份删最旧
 *   恢复（灾难）：列出远端 → 下载解密 → 预览 → 确认 → 覆盖本地（不做合并）
 *
 * 依赖 SyncCrypto（js/pure/sync-crypto.js，动态加载防御）与 DataModule（本地数据）。
 * GitHub REST API：/repos/{owner}/{repo}/contents/dotoday-sync/{path}
 */

import { DataModule } from "./data.js";
import { APP_VERSION } from "./config.js";

const SYNC_DIR = "dotoday-sync";
const API = "https://api.github.com";
const MAX_BACKUPS = 20;

/** 解析 owner/repo（支持 "owner/repo" 或单独填 owner + repo 由调用方拼接） */
function splitRepo(repo) {
  const parts = String(repo || "").trim().split("/");
  if (parts.length >= 2 && parts[0] && parts[1]) return { owner: parts[0], repo: parts.slice(1).join("/") };
  throw new Error("仓库格式应为 owner/repo");
}

/** 统一请求封装：错误（401/403/404/网络）转清晰中文 */
async function ghFetch(token, url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    throw new Error("网络错误：无法连接 GitHub，请检查网络后重试");
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("GitHub 鉴权失败：Token 无效或无权限（需 repo 权限）");
  }
  if (resp.status === 404) {
    throw new Error("未找到：仓库不存在，或目录尚无同步文件");
  }
  if (!resp.ok) {
    throw new Error(`GitHub API 错误（${resp.status}）：${(await resp.text()).slice(0, 120) || "未知原因"}`);
  }
  return resp;
}

/** PUT 内容（新建或更新；带 sha 为更新） */
async function putContents(token, owner, repo, path, content, sha) {
  const body = { message: "DoToday sync", content };
  if (sha) body.sha = sha;
  const resp = await ghFetch(token, `${API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return resp.json();
}

/** GET 目录列表 → [{name, sha, size, type}] */
async function listContents(token, owner, repo) {
  const resp = await ghFetch(token, `${API}/repos/${owner}/${repo}/contents/${SYNC_DIR}`);
  const list = await resp.json();
  if (!Array.isArray(list)) return [];
  return list.filter((f) => f.type === "file").map((f) => ({ name: f.name, sha: f.sha, size: f.size }));
}

/** GET 文件内容 → 原始 JSON（含 base64 content） */
async function getFile(token, owner, repo, name) {
  const resp = await ghFetch(token, `${API}/repos/${owner}/${repo}/contents/${SYNC_DIR}/${encodeURIComponent(name)}`);
  return resp.json();
}

/** DELETE 文件 */
async function deleteFile(token, owner, repo, name, sha) {
  const resp = await ghFetch(token, `${API}/repos/${owner}/${repo}/contents/${SYNC_DIR}/${encodeURIComponent(name)}`, {
    method: "DELETE",
    body: JSON.stringify({ message: "DoToday sync cleanup", sha }),
  });
  return resp.json();
}

/** 动态加载 SyncCrypto（未就绪返回 null） */
async function loadCrypto() {
  try {
    const mod = await import("./pure/sync-crypto.js");
    return mod.SyncCrypto || null;
  } catch (e) {
    return null;
  }
}

/**
 * 上传备份（日常）：
 * 加密当前数据 → PUT current.json.enc（覆盖）+ backup_时间戳.json.enc → 清理超 20 份旧备份。
 * @returns {Promise<{uploaded: string[], backups: number, cleaned: string[]}>}
 */
export async function uploadSync(token, repo, secret) {
  const { owner, repo: repoName } = splitRepo(repo);
  const cryptoMod = await loadCrypto();
  if (!cryptoMod) throw new Error("加密模块未就绪，请稍后重试");
  const data = DataModule.getAllRecords();
  const payload = {
    version: APP_VERSION,
    savedAt: Date.now(),
    records: data,
    tags: DataModule.getTags(),
  };
  const encrypted = await cryptoMod.encryptSnapshot(payload, secret);
  const fileContent = btoa(unescape(encodeURIComponent(JSON.stringify(encrypted))));
  const uploaded = [];
  // 1. current.json.enc：有旧文件则带 sha 更新（覆盖）
  const existing = await listRemoteSafe(token, repo);
  const current = existing.find((f) => f.name === "current.json.enc");
  await putContents(token, owner, repoName, `${SYNC_DIR}/current.json.enc`, fileContent, current ? current.sha : undefined);
  uploaded.push("current.json.enc");
  // 2. backup_时间戳.json.enc
  const backupName = cryptoMod.buildBackupName(new Date());
  await putContents(token, owner, repoName, `${SYNC_DIR}/${backupName}`, fileContent, undefined);
  uploaded.push(backupName);
  // 3. 清理超 20 份（保留最新 20 份备份）
  const after = await listRemoteSafe(token, repo);
  const cleaned = cryptoMod.planCleanup(after.map((f) => f.name), MAX_BACKUPS);
  for (const name of cleaned) {
    const f = after.find((x) => x.name === name);
    if (f) await deleteFile(token, owner, repoName, name, f.sha);
  }
  return { uploaded, backups: after.length, cleaned };
}

/** 失败时不抛出的目录列表（上传第一步探测用） */
async function listRemoteSafe(token, repo) {
  try {
    return await listRemote(token, repo);
  } catch (e) {
    return []; // 目录尚不存在 → 视为空
  }
}

/** 列出远端 → [{name, sha, size}]（current + 备份，名称排序） */
export async function listRemote(token, repo) {
  const { owner, repo: repoName } = splitRepo(repo);
  const list = await listContents(token, owner, repoName);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** 拉取并解密指定远端文件 → 数据对象 {version, savedAt, records, tags} */
export async function fetchRemote(token, repo, name, secret) {
  const { owner, repo: repoName } = splitRepo(repo);
  const cryptoMod = await loadCrypto();
  if (!cryptoMod) throw new Error("加密模块未就绪，请稍后重试");
  const file = await getFile(token, owner, repoName, name);
  if (!file || !file.content) throw new Error("远端文件内容为空");
  const jsonText = decodeURIComponent(escape(atob(file.content)));
  const payload = JSON.parse(jsonText);
  return cryptoMod.decryptSnapshot(payload, secret);
}

export { splitRepo };

/**
 * sw.js —— Service Worker 离线缓存（DoToday v0.11.1）
 *
 * 策略：
 *   - install：预缓存核心静态资源（个别失败不阻塞安装）
 *   - fetch：cache-first，缓存未命中回退网络并顺手写入缓存（同源 GET）
 *   - activate：清理旧版本缓存 + 通知页面"新版本已就绪"
 *
 * ⚠️ 版本控制（关键）：浏览器只在 sw.js 文件本身字节变化时才会更新 Service Worker。
 *   因此 CACHE_VERSION 必须在这里【硬编码】，每次发布递增——只改 config.js 的
 *   APP_VERSION 不会触发 SW 更新，旧缓存将永远返回旧资源（cache-first）。
 */

/** ⚠️ 发布时必须更新此常量（与 config.js APP_VERSION 保持同步） */
const CACHE_VERSION = "v0.11.1";
const CACHE_NAME = "dotoday-" + CACHE_VERSION;

/** 核心资源清单（与 index.html / js 引用保持一致，发布时核对） */
const CORE_ASSETS = [
  "./",
  "index.html",
  "css/style.css",
  "manifest.json",
  "js/config.js",
  "js/app.js",
  "js/pure/date-utils.js",
  "js/pure/stats.js",
  "js/pure/parse-import.js",
  "js/pure/sync-crypto.js",
  "js/data.js",
  "js/logger.js",
  "js/icon-config.js",
  "js/export.js",
  "js/sync.js",
  "js/ui/common.js",
  "js/ui/state.js",
  "js/ui/tabs.js",
  "js/ui/toast.js",
  "js/ui/calendar.js",
  "js/ui/list.js",
  "js/ui/form.js",
  "js/ui/date-picker.js",
  "js/ui/date-range-picker.js",
  "js/ui/time-wheel.js",
  "js/ui/stats-page.js",
  "js/ui/settings-page.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

/** install：预缓存核心资源；单个资源失败不阻塞整体安装 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)))
      )
      .then(() => self.skipWaiting())
  );
});

/** activate：清理旧版本缓存，立即接管页面，并通知页面"新版本已就绪" */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(() =>
        self.clients
          .matchAll({ type: "window" })
          .then((clients) => clients.forEach((c) => c.postMessage({ type: "SW_UPDATE_READY" })))
      )
  );
});

/** fetch：cache-first，未命中回退网络并缓存；离线导航回退 index.html */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // 仅缓存同源且成功的 GET 响应
          if (response && response.ok) {
            const url = new URL(request.url);
            if (url.origin === self.location.origin) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
          }
          return response;
        })
        .catch(() => {
          // 离线且未命中缓存：导航请求回退到应用入口
          if (request.mode === "navigate") {
            return caches.match("./index.html");
          }
          throw new Error("offline");
        });
    })
  );
});

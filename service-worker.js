/* 威敏斯客户采集系统 · Service Worker
 * 目标：装到手机主屏后完全离线可用（会场 WiFi 不可靠）。
 * 策略：安装时预缓存全部静态资源；请求走 cache-first，miss 时回源并写入缓存。
 */
"use strict";

var CACHE = "wemins-survey-v1.1.0";
var ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "engine.js",
  "rules.json",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return cache.addAll(ASSETS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;

      return fetch(request)
        .then(function (response) {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(request, copy);
          });
          return response;
        })
        .catch(function () {
          if (request.mode === "navigate") {
            return caches.match("index.html");
          }
          return new Response("离线且未缓存", { status: 504, statusText: "Offline" });
        });
    })
  );
});

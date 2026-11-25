/* Нужен, чтобы приложение можно было установить на телефон как иконку. Ничего не кэширует: данные всегда свежие. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});

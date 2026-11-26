/* Фоновый обработчик приложения: нужен для установки на телефон и для push-уведомлений. Данные не кэширует. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});

// Пришло push-уведомление: показываем его (браузеры требуют показывать каждое).
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SpaceKit', {
    body: d.body || 'Новое уведомление',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

// Нажали на уведомление: открываем приложение на нужной заявке (или переключаемся на уже открытое окно).
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) { c.navigate(url).catch(function () {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});

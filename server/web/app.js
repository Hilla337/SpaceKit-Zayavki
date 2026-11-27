/* SpaceKit · Заявки — интерфейс. Один файл, без сборки, работает с API этого же сервера. */
'use strict';

// ---------- справочники ----------
var ST = { new: 'Новая', work: 'В обработке', confirm: 'На подтверждении', assembly: 'На сборке', partial: 'Частично отгружена', shipped: 'Отгружена', cancelled: 'Отменена' };
var CO_ST = { pending: 'ждёт подтверждения', approved: 'подтверждена', blocked: 'заблокирована' };
var ROLE = { customer: 'Заказчик', manager: 'Менеджер', picker: 'Сборщик', admin: 'Админ' };
var UNITS = ['шт', 'м²', 'м', 'уп', 'меш', 'кг', 'л', 'рул', 'лист', 'пар', 'компл'];
var LIFT = ['грузовой', 'пассажирский', 'нет'];
var OBJ_F = [
  ['jk', 'Название ЖК', 0], ['street', 'Улица', 1], ['house', 'Дом', 1], ['entrance', 'Подъезд', 0], ['floor', 'Этаж', 1], ['apt', 'Квартира', 1],
  ['height', 'Ограничение по высоте', 0], ['lift', 'Лифт', 1], ['resp', 'Ответственное лицо', 1], ['respPhone', 'Телефон ответственного', 1],
  ['district', 'Район', 0], ['parking', 'Паркинг', 1], ['pass', 'Пропуск', 1], ['dominfo', 'Дополнительная информация', 0],
];
var ERR = {
  bad_phone: 'Проверьте номер телефона', too_many_requests: 'Слишком много попыток. Попробуйте через 15 минут', invalid_code: 'Неверный или устаревший код',
  invalid_credentials: 'Неверный телефон или пароль. Если не задавали пароль или забыли его, нажмите «Забыли пароль?»', locked: 'Слишком много неверных паролей. Вход на этот номер закрыт на 15 минут',
  phone_taken: 'Этот номер уже зарегистрирован. Войдите или нажмите «Забыли пароль?»', no_phone: 'У человека не указан телефон',
  too_many_attempts: 'Слишком много попыток. Запросите новый код', blocked: 'Доступ закрыт', send_failed: 'Не удалось отправить код',
  forbidden: 'Нет прав на это действие', not_found: 'Не найдено', unauthorized: 'Войдите заново', comment_required: 'Нужен комментарий',
  invalid_transition: 'Сейчас это действие недоступно', unpriced_items: 'Не у всех позиций есть товар и цена', not_in_work: 'Заявка не в работе',
  not_matched: 'Сначала выберите товар', sku_not_found: 'Товар не найден', use_shipments: 'Отгрузка делается отдельной кнопкой', nothing_to_ship: 'Нечего отгружать',
  bad_items: 'Часть позиций уже отгружена', object_incomplete: 'Заполните обязательные поля объекта', bad_lift: 'Выберите лифт', object_required: 'Укажите объект',
  object_not_found: 'Объект не найден', already_assigned: 'Клиента уже взял другой менеджер', no_counterparty: 'У компании не выбран контрагент в МойСклад',
  item_not_in_catalog: 'Есть позиции без товара из МойСклад', moysklad_failed: 'МойСклад ответил ошибкой', moysklad_disabled: 'МойСклад не подключён',
  counterparty_not_found: 'Контрагент не найден', counterparty_taken: 'Этот контрагент уже связан с другой компанией', order_created: 'Заказ уже создан в МойСклад, меняйте там',
  empty: 'Пустое сообщение', bad_line: 'Строка без «;», нужно «менеджер;клиент»', bad_hints: 'Ошибка в списке',
};

// ---------- иконки: свой минималистичный набор (линии 1.8, цвет — текущий цвет текста) ----------
var ICONS = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  external: '<path d="M7 17L17 7M9 7h8v8"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  clip: '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a2 2 0 0 1-2.8-2.8l7.9-7.9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="3"/>',
  reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checks: '<path d="M2 12.5l4.5 4.5L16 7.5"/><path d="M11.5 16.5l.5.5 9.5-9.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
};
function ic(name, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>'; }

// ---------- состояние ----------
var S = { token: load('token'), me: null, cache: {}, notes: [], notesOpen: false, draft: null, catalogFor: null, chatTimer: null, msOn: null };

function load(k) { try { return localStorage.getItem('sk_' + k); } catch (e) { return null; } }
function store(k, v) { try { if (v === null) localStorage.removeItem('sk_' + k); else localStorage.setItem('sk_' + k, v); } catch (e) { /* приватный режим */ } }

// ---------- помощники ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(id) { return document.getElementById(id); }
function money(n) { return n == null ? '-' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽'; }
function qtyFmt(n) { return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 }); }
function when(d) {
  if (!d) return '';
  var x = new Date(d), now = new Date();
  var t = x.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return x.toDateString() === now.toDateString() ? t : x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + t;
}
function pill(st) { return '<span class="pill p-' + st + '">' + esc(ST[st] || st) + '</span>'; }
function addr(o) { if (!o) return ''; return [o.jk, o.street && (o.street + (o.house ? ', ' + o.house : '')), o.apt && ('кв. ' + o.apt)].filter(Boolean).join(' · '); }
var toastT;
function toast(msg, bad) { var t = $('toast'); t.textContent = msg; t.className = 'toast on' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3500); }
function ask(title, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h1 style="font-size:19px;margin:0 0 6px">' + esc(title) + '</h1>' + (o.text ? '<p class="s" style="margin:0 0 12px">' + esc(o.text) + '</p>' : '') +
      (o.input !== undefined ? '<textarea class="inp" id="askIn" rows="3" placeholder="' + esc(o.input) + '"></textarea>' : '') +
      '<div class="btns" style="justify-content:flex-end"><button class="btn" data-ask="no">' + esc(o.cancel || 'Отмена') + '</button><button class="btn ' + (o.danger ? 'bad' : 'pri') + '" data-ask="yes">' + esc(o.ok || 'OK') + '</button></div></div>';
    function done(v) { bg.remove(); document.removeEventListener('keydown', key); resolve(v); }
    function key(e) { if (e.key === 'Escape') done(o.input !== undefined ? null : false); }
    bg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ask]');
      if (e.target === bg || (b && b.getAttribute('data-ask') === 'no')) return done(o.input !== undefined ? null : false);
      if (b) { if (o.input === undefined) return done(true); var v = $('askIn').value.trim(); if (!v) return $('askIn').focus(); done(v); }
    });
    document.addEventListener('keydown', key);
    document.body.appendChild(bg);
    var f = $('askIn') || bg.querySelector('[data-ask=yes]'); if (f) f.focus();
  });
}
function changePass() {
  var bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal"><h1 style="font-size:19px;margin:0 0 10px">Сменить пароль</h1>' +
    '<div class="f"><label>Текущий пароль</label><input id="cpOld" type="password" autocomplete="current-password"></div>' +
    '<div class="f"><label>Новый пароль <span class="xs">не короче 6 символов</span></label><input id="cpNew" type="password" autocomplete="new-password"></div>' +
    '<div class="f"><label>Новый пароль ещё раз</label><input id="cpNew2" type="password" autocomplete="new-password"></div>' +
    '<div class="btns" style="justify-content:flex-end"><button class="btn" id="cpNo">Отмена</button><button class="btn pri" id="cpYes">Сохранить</button></div></div>';
  document.body.appendChild(bg); $('cpOld').focus();
  bg.addEventListener('click', function (e) {
    if (e.target === bg || e.target.id === 'cpNo') return bg.remove();
    if (e.target.id !== 'cpYes') return;
    var n = $('cpNew').value;
    if (n.length < 6) return toast('Пароль не короче 6 символов', true);
    if (n !== $('cpNew2').value) return toast('Пароли не совпадают', true);
    api('POST', '/me/password', { oldPassword: $('cpOld').value, newPassword: n }).then(function () { bg.remove(); toast('Пароль изменён. На других устройствах нужно войти заново'); }).catch(function (er) { fail(er.code === 'invalid_credentials' ? new Error('Текущий пароль неверный') : er); });
  });
}
// Код сброса пароля: менеджер сам отправляет его клиенту (WhatsApp, звонок), это бесплатно.
function resetCode(userId, name) {
  return ask('Выдать код сброса пароля?', { text: name + ' сможет задать новый пароль на экране «Забыли пароль?». Прежний код, если был, перестанет действовать', ok: 'Выдать код' }).then(function (yes) {
    if (!yes) return;
    return api('POST', '/users/' + userId + '/reset-code').then(function (x) {
      var code = x.code.slice(0, 3) + ' ' + x.code.slice(3);
      var text = 'Код для входа в приложение SpaceKit: ' + x.code + '. Откройте «Забыли пароль?», введите телефон ' + x.phone + ', код и новый пароль. Код действует сутки';
      var bg = document.createElement('div'); bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal"><h1 style="font-size:19px;margin:0 0 6px">Код для ' + esc(x.name) + '</h1><div class="code" style="margin:10px 0;font-weight:700">' + esc(code) + '</div>' +
        '<p class="s">Отправьте человеку этот текст в WhatsApp или продиктуйте по телефону. Код действует сутки, сработает один раз</p><textarea class="inp" id="rcText" rows="3" readonly>' + esc(text) + '</textarea>' +
        '<div class="btns" style="justify-content:flex-end"><button class="btn" id="rcCopy">Скопировать текст</button><button class="btn pri" id="rcOk">Готово</button></div></div>';
      document.body.appendChild(bg);
      bg.addEventListener('click', function (e) {
        if (e.target === bg || e.target.id === 'rcOk') return bg.remove();
        if (e.target.id === 'rcCopy') {
          var t = $('rcText');
          (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Скопировано'); }).catch(function () { t.focus(); t.select(); toast('Выделил текст, скопируйте его'); });
        }
      });
    }).catch(fail);
  });
}
function staffAdd() {
  var bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal"><h1 style="font-size:19px;margin:0 0 10px">Новый менеджер</h1>' +
    '<div class="f"><label>Роль</label><select id="saRole"><option value="manager">Менеджер</option><option value="admin">Админ</option><option value="picker">Сборщик</option></select></div>' +
    '<div class="f"><label>Имя и фамилия</label><input id="saName" autocomplete="off"></div>' +
    '<div class="f"><label>Телефон</label><input id="saPhone" type="tel" placeholder="+7 999 123-45-67"></div>' +
    '<p class="xs">Пароль менеджер задаст сам: после добавления нажмите «Код для пароля» и отправьте ему код</p>' +
    '<div class="btns" style="justify-content:flex-end"><button class="btn" id="saNo">Отмена</button><button class="btn pri" id="saYes">Добавить</button></div></div>';
  document.body.appendChild(bg); $('saName').focus();
  bg.addEventListener('click', function (e) {
    if (e.target === bg || e.target.id === 'saNo') return bg.remove();
    if (e.target.id !== 'saYes') return;
    var b = { role: $('saRole').value, name: $('saName').value.trim(), phone: $('saPhone').value.trim() };
    if (!b.name || !b.phone) return toast('Заполните имя и телефон', true);
    api('POST', '/staff', b).then(function () { bg.remove(); toast('Менеджер добавлен'); viewCompanies(); }).catch(fail);
  });
}
// Клиенты менеджера: выбрать менеджера и вставить его клиентов по одному в строке.
// Строки вида «Менеджер;клиент» тоже понимаем — так можно вставить весь список сразу.
function hintsLoad() {
  var mgrs = S.managers || [];
  var bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal" style="max-width:520px"><h1 style="font-size:19px;margin:0 0 6px">Клиенты менеджера</h1>' +
    '<p class="s" style="margin:0 0 12px">Клиенты с точно таким названием сразу попадут к выбранному менеджеру. Остальных он получит, когда клиент зарегистрируется под этим названием</p>' +
    '<div class="f"><label>Менеджер</label><select id="hlMgr">' + mgrs.map(function (m) { return '<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>'; }).join('') + '</select></div>' +
    '<div class="f"><label>Клиенты, по одному в строке</label><textarea id="hlText" class="inp" rows="8" placeholder="Например:&#10;Профит рум&#10;Гамота&#10;Кильганов"></textarea></div>' +
    '<div class="btns" style="justify-content:flex-end"><button class="btn" id="hlNo">Отмена</button><button class="btn pri" id="hlYes">Сохранить</button></div></div>';
  document.body.appendChild(bg); $('hlText').focus();
  bg.addEventListener('click', function (e) {
    if (e.target === bg || e.target.id === 'hlNo') return bg.remove();
    if (e.target.id !== 'hlYes') return;
    var mgr = $('hlMgr').value, names = mgrs.map(function (m) { return m.name.toLowerCase(); });
    var lines = $('hlText').value.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== '#'; }).map(function (l) {
      var i = l.search(/[;\t]/);
      if (i > 0 && names.indexOf(l.slice(0, i).trim().toLowerCase()) >= 0) return l.slice(0, i).trim() + ';' + l.slice(i + 1).trim();
      return mgr + ';' + l;
    });
    if (!lines.length) return toast('Впишите хотя бы одного клиента: серый текст в поле только пример', true);
    api('POST', '/hints', { text: lines.join('\n') }).then(function (r) {
      bg.remove();
      var msg = 'Сохранено клиентов: ' + r.saved + '. Сразу закреплено за менеджерами: ' + r.assigned.length + '.';
      if (r.suggestions.length) msg += ' Похожие названия для проверки: ' + r.suggestions.slice(0, 6).map(function (x) { return '«' + x.name + '» ← ' + x.hint + ' (' + x.managerName + ')'; }).join('; ') + '.';
      return ask('Готово', { text: msg, ok: 'Хорошо', cancel: 'Закрыть' }).then(function () { viewCompanies(); });
    }).catch(function (er) { fail(er.data && er.data.message ? new Error(er.data.message) : er); });
  });
}
function coPeople(companyId) {
  var box = $('people' + companyId); if (!box) return;
  if (box.innerHTML) { box.innerHTML = ''; return; }
  api('GET', '/companies/' + companyId + '/users').then(function (l) {
    box.innerHTML = '<div class="ms" style="margin-top:8px">' + (l.length ? l.map(function (u) {
      return '<div class="row" style="padding:4px 0"><span class="sp">' + esc(u.name) + ' <span class="xs">' + esc(u.phone || 'без телефона') + (u.status === 'pending' ? ' · ждёт подтверждения' : '') + '</span></span><button class="btn sm" data-act="resetCode" data-id="' + u.id + '" data-name="' + esc(u.name) + '">' + ic('key') + 'Код сброса пароля</button></div>';
    }).join('') : '<div class="xs">Пока никто не зарегистрирован</div>') + '</div>';
  }).catch(fail);
}
// ---------- push-уведомления на это устройство ----------
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function pushSupported() { return !window.SK_DEMO && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function b64ToBytes(b64) { var p = '='.repeat((4 - b64.length % 4) % 4), raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
function pushSub() { return navigator.serviceWorker.ready.then(function (r) { return r.pushManager.getSubscription(); }); }
// Состояние для настроек: 'on', 'off', 'denied', 'ios-home' (на iPhone нужно сначала добавить на экран «Домой»), 'unsupported'.
function pushState() {
  if (isIOS() && !isStandalone() && !window.SK_DEMO) return Promise.resolve('ios-home');
  if (!pushSupported()) return Promise.resolve('unsupported');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  return pushSub().then(function (s) { return s && Notification.permission === 'granted' ? 'on' : 'off'; }).catch(function () { return 'off'; });
}
function enablePush() {
  return Notification.requestPermission().then(function (perm) {
    if (perm !== 'granted') throw new Error('Уведомления запрещены в браузере. Разрешите их в настройках сайта');
    return Promise.all([navigator.serviceWorker.ready, api('GET', '/push/key')]);
  }).then(function (x) {
    return x[0].pushManager.getSubscription().then(function (old) { return old || x[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(x[1].publicKey) }); });
  }).then(function (sub) {
    var j = sub.toJSON();
    return api('POST', '/push/subscribe', { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } });
  }).catch(function (e) {
    // Ошибки браузера приходят по-английски — переводим в понятное.
    if (e && (e.name === 'NotAllowedError' || /permission|denied/i.test(e.message || ''))) throw new Error('Браузер не дал включить уведомления. Проверьте, что они разрешены для этого сайта, и попробуйте ещё раз');
    if (e && (e.name === 'AbortError' || /push service|registration/i.test(e.message || ''))) throw new Error('Не удалось связаться со службой уведомлений браузера. Попробуйте ещё раз чуть позже');
    throw e;
  });
}
function disablePush() {
  return pushSub().then(function (sub) {
    if (!sub) return;
    var ep = sub.endpoint;
    return sub.unsubscribe().catch(function () {}).then(function () { return S.token ? api('POST', '/push/unsubscribe', { endpoint: ep }).catch(function () {}) : null; });
  });
}
function pushBlock(state) {
  var t = {
    on: ['Уведомления включены', 'Новые заявки, сообщения и смена статуса придут, даже когда приложение закрыто', '<button class="btn sm" data-act="pushOff">Выключить</button>'],
    off: ['Уведомления на этом устройстве', 'Новые заявки, сообщения и смена статуса сразу на телефон или компьютер, даже когда приложение закрыто', '<button class="btn sm pri" data-act="pushOn">' + ic('bell') + 'Включить</button>'],
    denied: ['Уведомления запрещены', 'Браузер запретил уведомления для этого сайта. Разрешите их в настройках сайта (значок замка в адресной строке), затем обновите страницу', ''],
    'ios-home': ['Уведомления на iPhone', 'Apple присылает уведомления только приложениям на экране «Домой». Нажмите «Поделиться» внизу Safari → «На экран „Домой“», откройте приложение с иконки и включите уведомления здесь', ''],
    unsupported: ['Уведомления недоступны', window.SK_DEMO ? 'В демо уведомления не работают. В приложении включаются здесь одной кнопкой' : 'Этот браузер не поддерживает уведомления. Откройте приложение в Chrome или Safari', ''],
  }[state];
  return '<div class="ms" style="margin-top:14px"><div class="row" style="align-items:flex-start;gap:10px">' + ic('bell') + '<div class="sp"><div class="b">' + t[0] + '</div><div class="xs">' + t[1] + '</div>' + (t[2] ? '<div class="btns" style="margin-top:8px">' + t[2] + '</div>' : '') + '</div></div></div>';
}
function isStaff() { return S.me && (S.me.role === 'manager' || S.me.role === 'admin'); }

// ---------- API ----------
function api(method, url, body) {
  var h = { };
  if (S.token) h.Authorization = 'Bearer ' + S.token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  return fetch(url, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
    if (r.status === 204) return null;
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.status === 401 && url.indexOf('/auth/') !== 0) { logoutLocal(); throw new Error(ERR.unauthorized); }
      if (!r.ok) {
        var e = new Error((ERR[j.error] || j.message || 'Ошибка ' + r.status) + (j.error === 'moysklad_failed' && j.message ? ': ' + j.message : '') + (j.error === 'object_incomplete' && j.fields ? ' (' + j.fields.map(fieldName).join(', ') + ')' : ''));
        e.code = j.error; e.data = j; e.status = r.status; throw e;
      }
      return j;
    });
  });
}
function fieldName(k) { for (var i = 0; i < OBJ_F.length; i++) if (OBJ_F[i][0] === k) return OBJ_F[i][1]; return k; }
function fail(e) { toast(e.message || String(e), true); }

// ---------- навигация ----------
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
window.addEventListener('hashchange', route);
new MutationObserver(function () {
  var f = $('app').firstElementChild;
  if (!S.anim || !f || f.classList.contains('loading')) return;
  S.anim = false; f.classList.add('view');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}).observe(document.getElementById('app'), { childList: true });

function route() {
  stopChat();
  S.anim = true;
  if (!S.token) return viewLogin();
  if (!S.me) return boot();
  renderTop();
  var h = location.hash.replace(/^#/, '') || '/';
  var m;
  if (S.me.status !== 'approved') return viewPending();
  if ((m = h.match(/^\/r\/(\d+)$/))) return viewRequest(Number(m[1]));
  if (h === '/new' && S.me.role === 'customer') return viewNew();
  if (h === '/companies' && isStaff()) return viewCompanies();
  if (h === '/settings') return viewSettings();
  return viewList();
}

function boot() {
  api('GET', '/me').then(function (me) { S.me = me; route(); pollNotes(); }).catch(function (e) { if (S.token) fail(e); else route(); });
}
function logoutLocal() { S.token = null; S.me = null; store('token', null); renderTop(); }
function logout() { (pushSupported() ? disablePush().catch(function () {}) : Promise.resolve()).then(function () { return api('POST', '/auth/logout'); }).catch(function () {}).then(function () { logoutLocal(); go('#/'); }); }

// ---------- верхняя панель ----------
function renderTop() {
  var me = S.me, h = me ? '<div class="logo" data-go="#/"><img src="/logo.png" alt="spacekit"></div>' : '';
  if (me && me.status === 'approved') {
    var cur = location.hash || '#/';
    var nav = [['#/', 'Заявки']];
    if (me.role === 'customer') nav.push(['#/new', 'Новая заявка']);
    if (isStaff()) nav.push(['#/companies', 'Клиенты']);
    h += '<div class="nav">' + nav.map(function (n) { return '<button data-go="' + n[0] + '" class="' + (cur === n[0] ? 'on' : '') + '">' + n[1] + '</button>'; }).join('') + '</div>';
  }
  if (me) {
    var unread = S.notes.filter(function (n) { return !n.read; }).length;
    h += '<div class="who"><span class="nm">' + esc(me.name) + ' · ' + esc(ROLE[me.role] || me.role) + '</span>' +
      '<div class="bw"><button class="ib" data-act="notes" title="Уведомления" aria-label="Уведомления">' + ic('bell') + (unread ? '<span class="n2">' + unread + '</span>' : '') + '</button>' + (S.notesOpen ? notesHtml() : '') + '</div>' +
      '<button class="ib" data-go="#/settings" title="Настройки" aria-label="Настройки">' + ic('settings') + '</button></div>';
  }
  $('top').innerHTML = h;
  document.querySelector('.top').style.display = me ? '' : 'none';
}
function notesHtml() {
  var l = S.notes.slice(0, 50);
  return '<div class="card notes">' + (l.length ? '<div class="row" style="padding:4px 6px 8px"><b class="sp">Уведомления</b><button class="btn sm" data-act="readAll">Прочитать все</button></div>' +
    l.map(function (n) { return '<div class="nt' + (n.read ? ' rd' : '') + '" data-act="openNote" data-id="' + n.id + '" data-req="' + (n.requestId || '') + '"><div class="dot"></div><div class="sp">' + esc(n.text) + '<div class="xs">' + when(n.createdAt) + '</div></div></div>'; }).join('')
    : '<div class="empty">Уведомлений нет</div>') + '</div>';
}
var notesTimer;
function pollNotes() {
  clearTimeout(notesTimer);
  if (!S.token) return;
  api('GET', '/notifications').then(function (l) {
    var before = S.notes.filter(function (n) { return !n.read; }).length;
    S.notes = l; renderTop();
    var after = l.filter(function (n) { return !n.read; }).length;
    if (after > before && before >= 0 && S._notesLoaded) toast(l[0].text);
    S._notesLoaded = true;
  }).catch(function () {}).then(function () { notesTimer = setTimeout(pollNotes, 20000); });
}

// ---------- вход ----------
// Вход по телефону и паролю. Экраны: вход, регистрация, сброс пароля по коду от менеджера.
function viewLogin(step, info) {
  renderTop();
  step = step || 'login'; info = info || {};
  var phoneField = '<div class="f"><label>Телефон</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 999 123-45-67" value="' + esc(info.phone || (S.login && S.login.phone) || '') + '"></div>';
  var h = '<div class="wrap"><img class="login-logo" src="/logo.png" alt="spacekit, комплектация пространств"><div class="card">';
  if (step === 'login') {
    h += '<h1 style="margin-top:0">Вход</h1>' + phoneField +
      '<div class="f"><label>Пароль</label><input id="pass" type="password" autocomplete="current-password"></div>' +
      '<button class="btn pri full" data-act="doLogin">Войти</button>' +
      '<div class="btns" style="justify-content:space-between"><button class="btn sm" data-act="toRegister">Регистрация</button><button class="btn sm" data-act="toReset">Забыли пароль?</button></div>';
    // Демо-страница: вход за любую роль одной кнопкой.
    if (window.SK_DEMO) h += '<div class="note" style="margin:14px 0 0"><b>Демо:</b> Войдите за любую роль, данные тестовые и живут только в этом браузере.<div class="btns" style="margin-top:10px">' + window.SK_DEMO.roles.map(function (r) { return '<button class="btn sm" data-act="demoLogin" data-phone="' + r[1] + '">' + esc(r[0]) + '</button>'; }).join('') + '</div></div>';
  } else if (step === 'register') {
    h += '<h1 style="margin-top:0">Регистрация</h1><div class="note">После регистрации менеджер подтвердит вашу компанию, и можно будет создавать заявки</div>' + phoneField +
      '<div class="f"><label>Ваше имя <i>*</i></label><input id="pname" autocomplete="name"></div>' +
      '<div class="f"><label>Компания <i>*</i></label><input id="pcompany" autocomplete="organization"></div>' +
      '<div class="f"><label>Пароль <i>*</i> <span class="xs">не короче 6 символов</span></label><input id="pass" type="password" autocomplete="new-password"></div>' +
      '<div class="f"><label>Пароль ещё раз <i>*</i></label><input id="pass2" type="password" autocomplete="new-password"></div>' +
      '<button class="btn pri full" data-act="doRegister">Зарегистрироваться</button><div class="btns"><button class="btn sm" data-act="toLogin">' + ic('back') + 'У меня уже есть пароль</button></div>';
  } else {
    h += '<h1 style="margin-top:0">Новый пароль</h1><div class="note">Попросите своего менеджера прислать код сброса (менеджерам код выдаёт администратор). Код из 6 цифр действует сутки</div>' + phoneField +
      '<div class="f"><label>Код от менеджера</label><input id="rcode" class="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="······"></div>' +
      '<div class="f"><label>Новый пароль <span class="xs">не короче 6 символов</span></label><input id="pass" type="password" autocomplete="new-password"></div>' +
      '<div class="f"><label>Новый пароль ещё раз</label><input id="pass2" type="password" autocomplete="new-password"></div>' +
      '<button class="btn pri full" data-act="doReset">Сохранить и войти</button><div class="btns"><button class="btn sm" data-act="toLogin">' + ic('back') + 'Ко входу</button></div>';
  }
  $('app').innerHTML = h + '</div></div>';
  S.login = { step: step, phone: info.phone || (S.login && S.login.phone) || '' };
  var f = $('phone'); if (f && f.value && $(step === 'register' ? 'pname' : step === 'reset' ? 'rcode' : 'pass')) f = $(step === 'register' ? 'pname' : step === 'reset' ? 'rcode' : 'pass');
  if (f) f.focus();
}
function loggedIn(r) { S.token = r.token; store('token', r.token); S.me = null; S.notes = []; S.notesOpen = false; S._notesLoaded = false; S.listTab = null; S.managers = null; S.staff = null; go('#/'); boot(); }
function phoneVal() { var p = $('phone').value.trim(); S.login.phone = p; return p; }
function samePass() { if ($('pass').value.length < 6) { toast('Пароль не короче 6 символов', true); return false; } if ($('pass').value !== $('pass2').value) { toast('Пароли не совпадают', true); return false; } return true; }
function doLogin() { api('POST', '/auth/login', { phone: phoneVal(), password: $('pass').value }).then(loggedIn).catch(fail); }
function doRegister() {
  var b = { phone: phoneVal(), name: $('pname').value.trim(), company: $('pcompany').value.trim(), password: $('pass').value };
  if (!b.name || !b.company) return toast('Заполните имя и компанию', true);
  if (!samePass()) return;
  api('POST', '/auth/register', b).then(loggedIn).catch(fail);
}
function doReset() {
  var code = $('rcode').value.replace(/\D/g, '');
  if (code.length !== 6) return toast('Код из 6 цифр', true);
  if (!samePass()) return;
  api('POST', '/auth/reset', { phone: phoneVal(), code: code, password: $('pass').value }).then(function (r) { toast('Пароль сохранён'); loggedIn(r); }).catch(fail);
}

function viewPending() {
  $('app').innerHTML = '<div class="wrap"><h1>Здравствуйте, ' + esc(S.me.name) + '</h1><div class="card"><p>Ваша компания ждёт подтверждения менеджером. Как только её подтвердят, придёт SMS и здесь можно будет создавать заявки</p>' +
    '<div class="btns"><button class="btn" data-act="reloadMe">Проверить ещё раз</button><button class="btn" data-act="logout">Выйти</button></div></div></div>';
}

function fillPushBox() { var b = $('pushBox'); if (b) pushState().then(function (st) { var b2 = $('pushBox'); if (b2) b2.innerHTML = pushBlock(st); }); }
function viewSettings() {
  $('app').innerHTML = '<div class="wrap"><h1>Настройки</h1><div class="card"><div class="b">' + esc(S.me.name) + '</div><div class="s">' + esc(ROLE[S.me.role]) + '</div><div id="pushBox"></div>' +
    (S.me.role === 'customer' && S.me.smsAvailable ? '<label class="chk' + (S.me.smsEnabled ? ' on' : '') + '" data-act="toggleSms" style="margin-top:12px"><div class="box">' + (S.me.smsEnabled ? ic('check') : '') + '</div><div>SMS о заявках<div class="xs">Подтверждение, отгрузка, отмена. Уведомления в приложении остаются всегда</div></div></label>' : '') +
    '<div class="btns"><button class="btn" data-act="changePass">' + ic('key') + 'Сменить пароль</button><button class="btn bad" data-act="logout">' + ic('logout') + 'Выйти</button></div></div></div>';
  fillPushBox();
}

// ---------- список заявок ----------
function viewList() {
  var role = S.me.role, tab = S.listTab || (role === 'customer' ? 'all' : role === 'picker' ? 'all' : 'active');
  $('app').innerHTML = '<div class="wrap wide loading"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  api('GET', '/requests').then(function (rows) {
    var groups = role === 'customer' || role === 'picker'
      ? [['all', 'Все', null]]
      : [['active', 'В работе', ['new', 'work', 'confirm']], ['new', 'Новые', ['new']], ['work', 'В обработке', ['work']], ['confirm', 'На подтверждении', ['confirm']], ['floor', 'Сборка', ['assembly', 'partial']], ['done', 'Закрытые', ['shipped', 'cancelled']], ['all', 'Все', null]];
    var g = groups.filter(function (x) { return x[0] === tab; })[0] || groups[0];
    var list = rows.filter(function (r) { return !g[2] || g[2].indexOf(r.status) >= 0; });
    var h = '<div class="wrap wide"><div class="row"><h1 class="sp">' + (role === 'picker' ? 'Сборка и отгрузка' : 'Заявки') + '</h1>' + (role === 'customer' ? '<button class="btn pri" data-go="#/new">' + ic('plus') + 'Новая заявка</button>' : '') + '</div>';
    if (groups.length > 1) h += '<div class="tabs">' + groups.map(function (x) { var c = rows.filter(function (r) { return !x[2] || x[2].indexOf(r.status) >= 0; }).length; return '<button data-act="listTab" data-tab="' + x[0] + '" class="' + (x[0] === g[0] ? 'on' : '') + '">' + x[1] + ' <span class="xs">' + c + '</span></button>'; }).join('') + '</div>';
    h += '<div class="list">' + (list.length ? list.map(function (r) {
      return '<div class="card" data-go="#/r/' + r.id + '"><div class="row"><b>№' + r.id + '</b>' + pill(r.status) + '<span class="sp"></span><span class="xs">' + when(r.updatedAt) + '</span></div>' +
        '<div class="s">' + (role !== 'customer' ? esc(r.companyName) + ' · ' : '') + r.itemsCount + ' поз.' + (role === 'manager' && r.managerId === null ? ' · <span class="tag warn">клиент не распределён</span>' : '') + '</div></div>';
    }).join('') : '<div class="empty">' + (role === 'customer' ? 'Заявок пока нет. Нажмите «Новая заявка»' : 'Здесь пусто') + '</div>') + '</div></div>';
    $('app').innerHTML = h;
    pushNudge();
  }).catch(fail);
}
// Один раз предлагаем включить уведомления (сам запрос разрешения — только по кнопке).
function pushNudge() {
  var later; try { later = localStorage.getItem('sk_push_later'); } catch (e) { later = '1'; }
  if (later || !pushSupported() || Notification.permission === 'denied') return;
  pushSub().then(function (sub) {
    var w = document.querySelector('#app .wrap'); if (sub || !w || $('pushNudge')) return;
    var d = document.createElement('div'); d.id = 'pushNudge'; d.className = 'note row'; d.style.flexWrap = 'wrap';
    d.innerHTML = ic('bell') + '<span class="sp">' + (S.me.role === 'customer' ? 'Включите уведомления, чтобы сразу узнавать об ответе менеджера и отгрузке' : 'Включите уведомления, чтобы сразу узнавать о новых заявках и сообщениях') + '</span><button class="btn sm pri" data-act="pushOn">Включить</button><button class="btn sm" data-act="pushLater">Не сейчас</button>';
    w.insertBefore(d, w.children[1] || null);
  }).catch(function () {});
}

// ---------- новая заявка (заказчик) ----------
function newDraft() { return { objectId: null, obj: { lift: '' }, text: '', items: [] }; }
function viewNew() {
  if (!S.draft) S.draft = newDraft();
  api('GET', '/objects').then(function (objs) { S.objects = objs; renderNew(); }).catch(fail);
}
function renderNew() {
  var d = S.draft, objs = S.objects || [];
  var h = '<div class="wrap"><h1>Новая заявка</h1>';
  h += '<h2>Товары</h2><div class="card paste"><div class="f">' +
    '<textarea id="itemsText" rows="5" placeholder="Скопируйте корзину Петровича и вставьте сюда или сохраните смету и загрузите файл .xls">' + esc(d.text) + '</textarea></div>' +
    '<div class="row" style="flex-wrap:wrap"><button class="btn sm" data-act="parseItems">Добавить из текста</button>' +
    '<button class="btn sm" data-act="pickSheet">' + ic('clip') + ' Загрузить файл Excel</button></div></div>';
  if (d.items.length) {
    h += '<div style="margin-top:8px">' + d.items.map(function (it, i) {
      return '<div class="pos"><div class="row"><input class="inp sp" data-item="' + i + '" data-k="name" value="' + esc(it.name) + '">' +
        '<button class="btn sm bad" data-act="delItem" data-i="' + i + '" title="Убрать" aria-label="Убрать">' + ic('x') + '</button></div>' +
        '<div class="row" style="margin-top:6px"><input class="inp" style="width:110px" type="number" min="0" step="any" data-item="' + i + '" data-k="qty" value="' + esc(it.qty) + '">' +
        '<select class="inp" style="width:90px" data-item="' + i + '" data-k="unit">' + UNITS.map(function (u) { return '<option' + (it.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select>' +
        (it.store ? '<span class="tag acc">' + esc(it.store) + (it.code ? ' · ' + esc(it.code) : '') + '</span>' : '') + '</div></div>';
    }).join('') + '</div><button class="btn sm" data-act="addItem">' + ic('plus') + 'Позиция</button>';
  } else {
    h += '<div class="btns"><button class="btn sm" data-act="addItem">' + ic('plus') + 'Добавить позицию вручную</button></div>';
  }
  h += '<h2>Объект</h2>';
  if (objs.length) {
    h += '<div class="card" style="margin-bottom:8px">' + objs.map(function (o) {
      return '<label class="row" style="padding:6px 0;cursor:pointer"><input type="radio" name="obj" data-act="pickObj" value="' + o.id + '"' + (d.objectId === o.id ? ' checked' : '') + '><span class="sp">' + esc(addr(o)) + '</span></label>';
    }).join('') + '<label class="row" style="padding:6px 0;cursor:pointer"><input type="radio" name="obj" data-act="pickObj" value=""' + (d.objectId === null ? ' checked' : '') + '><span class="sp">Новый объект</span></label></div>';
  }
  if (d.objectId === null) {
    h += '<div class="card"><div class="grid">' + OBJ_F.map(function (f) {
      var k = f[0], v = d.obj[k] || '', lab = '<label>' + f[1] + (f[2] ? ' <i>*</i>' : '') + '</label>';
      if (k === 'lift') return '<div class="f">' + lab + '<select data-obj="lift"><option value="">не выбрано</option>' + LIFT.map(function (l) { return '<option' + (v === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div>';
      if (k === 'dominfo') return '<div class="f span2">' + lab + '<textarea rows="2" data-obj="dominfo">' + esc(v) + '</textarea></div>';
      return '<div class="f">' + lab + '<input data-obj="' + k + '" value="' + esc(v) + '"' + (k === 'parking' ? ' placeholder="есть / нет"' : k === 'pass' ? ' placeholder="нужен / не нужен"' : '') + '></div>';
    }).join('') + '</div></div>';
  }
  h += '<div class="btns"><button class="btn pri full" data-act="submitNew">Отправить заявку</button></div></div>';
  $('app').innerHTML = h;
}

// разбор строки «название — 10 шт» или ссылки
var UNIT_RX = /^(шт|штук|м2|м²|кв\.?м|п\.?м|м|уп|упак|меш|мешк|кг|л|литр|рул|лист)/i;
function normUnit(u) {
  u = (u || '').toLowerCase().replace(/\s+/g, '');
  if (/^(м2|м²|кв\.?м)/.test(u)) return 'м²';
  if (/^(п\.?м|м)$/.test(u)) return 'м';
  if (/^уп/.test(u)) return 'уп'; if (/^меш/.test(u)) return 'меш'; if (/^кг/.test(u)) return 'кг';
  if (/^(л|литр)/.test(u)) return 'л'; if (/^рул/.test(u)) return 'рул'; if (/^лист/.test(u)) return 'лист';
  return 'шт';
}
function parseLink(u) {
  var m;
  if (/petrovich\.ru/i.test(u)) {
    // Корзину и смету по ссылке прочитать нельзя (сайт запрещает автоматический доступ) — помечаем, чтобы предупредить заказчика.
    if (/\/estimate\b|\/smeta\b/i.test(u)) return { store: 'Петрович', code: '', cart: true, kind: 'Смета' };
    if (/\/(cart|basket|korzina)\b|[?&](share|cart)=/i.test(u)) return { store: 'Петрович', code: '', cart: true, kind: 'Корзина' };
    // Код товара: /product/155351, /catalog/…/155351/ или ?code=155351 — последний числовой кусок из 5–8 цифр.
    m = u.match(/\/product\/(\d{4,9})/) || u.match(/[?&](?:code|product|id)=(\d{4,9})/) || u.split(/[?#]/)[0].match(/\/(\d{5,8})\/?$/);
    return { store: 'Петрович', code: m ? m[1] : '' };
  }
  if (/leroymerlin\.ru/i.test(u)) { m = u.match(/-(\d{6,})\/?(?:[?#].*)?$/) || u.match(/\/(\d{6,})\/?(?:[?#].*)?$/); return { store: 'Леруа Мерлен', code: m ? m[1] : '' }; }
  if (/vseinstrumenti\.ru/i.test(u)) { m = u.match(/-(\d{5,})\/?(?:[?#].*)?$/) || u.match(/\/(\d{5,})\/?(?:[?#].*)?$/); return { store: 'ВсеИнструменты', code: m ? m[1] : '' }; }
  return { store: 'Другой', code: '' };
}
// ---- скопированная корзина или смета Петровича ----
// Заказчик выделяет список товаров на странице корзины и вставляет. В тексте у каждого товара есть «Код:», название,
// цена за единицу («2 415 ₽», «за пар.») и сумма — количество = сумма / цена. Работает и с текстом со ссылками [название](url).
function isPetrovichCart(text) { return /^\s*Код:/m.test(text) && /₽/.test(text); }
var CART_JUNK = /^(доступно|под заказ|нет в наличии|в наличии|осталось|рекомендуем|удалить|аналоги|\+|установка|монтаж|укладка|сборка|доставка|выбрать|в избранное)/i;
var CART_END = /^(вес заказа|товары\s*\(|итого|оформить заказ|сумма заказа|скидка|промокод|предложить улучшение|способ получения|доставка и самовывоз)/i;
var MONEY_RX = /^([\d\s  ]+(?:[.,]\d+)?)\s*₽$/;
function money2num(s) { return Number(s.replace(/[\s  ]/g, '').replace(',', '.')); }
function cartUnit(u) {
  u = u.toLowerCase();
  if (/^пар/.test(u)) return 'пар'; if (/^упак|^уп/.test(u)) return 'уп'; if (/^компл/.test(u)) return 'компл';
  if (/^(кв\.?\s*м|м2|м²)/.test(u)) return 'м²'; if (/^(п\.?\s*м|пог)/.test(u)) return 'м'; if (/^м$/.test(u)) return 'м';
  if (/^меш/.test(u)) return 'меш'; if (/^кг/.test(u)) return 'кг'; if (/^(л|литр)/.test(u)) return 'л'; if (/^рул/.test(u)) return 'рул'; if (/^лист/.test(u)) return 'лист';
  return 'шт';
}
function parsePetrovichCart(text) {
  var lines = text.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean), out = [], cur = null;
  function flush() {
    if (!cur || !cur.code) return;
    var qty = 1;
    if (cur.prices.length >= 2 && cur.prices[0] > 0) { qty = cur.prices[cur.prices.length - 1] / cur.prices[0]; qty = Math.abs(qty - Math.round(qty)) < 0.01 ? Math.round(qty) : Math.round(qty * 1000) / 1000; }
    out.push({ name: cur.name || 'Товар Петрович, код ' + cur.code, qty: qty > 0 ? qty : 1, unit: cur.unit || 'шт', url: 'https://petrovich.ru/product/' + cur.code + '/', store: 'Петрович', code: cur.code,
      note: cur.prices.length ? 'Петрович: ' + cur.prices[0].toLocaleString('ru-RU') + ' ₽' + (cur.unitText ? ' ' + cur.unitText : '') : '' });
  }
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i], m = l.match(/^Код:\s*(\d{4,9})?\s*$/);
    // Итоги корзины и подвал страницы — конец списка товаров (иначе сумма заказа испортит количество последней позиции).
    if (CART_END.test(l)) { flush(); cur = null; continue; }
    if (m) { flush(); cur = { code: m[1] || '', name: '', prices: [], unit: '', unitText: '' }; continue; }
    if (!cur) continue;
    if (!cur.code && /^\d{4,9}$/.test(l)) { cur.code = l; continue; }
    var link = l.match(/^\[(.+)\]\((https?:\/\/[^)]*)\)$/); if (link) l = link[1];
    var pm = l.match(MONEY_RX); if (pm) { cur.prices.push(money2num(pm[1])); continue; }
    var um = l.match(/^за\s+(.+?)\.?$/i); if (um) { cur.unit = cartUnit(um[1]); cur.unitText = l; continue; }
    if (/^[\d\s.,]+\s*(кг|г|т)$/i.test(l) || CART_JUNK.test(l)) continue;
    if (!cur.name && /[a-zа-яё]/i.test(l) && l.length > 3) cur.name = l.slice(0, 300);
  }
  flush();
  return out;
}

function parseLine(l) {
  l = l.trim().replace(/^\d+[.)]\s+/, '').replace(/^[-•*–]\s*/, '');
  if (!l) return null;
  var url = (l.match(/https?:\/\/\S+/) || [])[0], p = url ? parseLink(url) : { store: '', code: '' }, rest = url ? l.replace(url, '').trim() : l;
  var m = rest.match(/^(.*?)[\s,;:—–\-x×*]*(\d+(?:[.,]\d+)?)\s*([а-яё²2.\s]{0,10})$/i), name = rest, qty = 1, unit = 'шт';
  if (m && (m[3].trim() === '' || UNIT_RX.test(m[3].trim()))) { name = m[1].replace(/[\s,;:—–\-]+$/, '').trim(); qty = parseFloat(m[2].replace(',', '.')); unit = normUnit(m[3]); }
  if (!name && p.cart) name = p.kind + ' Петровича по ссылке, список уточнит менеджер';
  if (!name && p.code) name = 'Товар ' + p.store + ', код ' + p.code;
  // Ссылку без названия не теряем: менеджер откроет её и подберёт товар сам.
  if (!name && url) name = 'Товар по ссылке' + (p.store && p.store !== 'Другой' ? ' (' + p.store + ')' : '');
  if (!name) return null;
  return { name: name, qty: qty || 1, unit: unit, url: url || '', store: p.store, code: p.code, cart: !!p.cart };
}

// Разбор вставленного текста в позиции: скопированная корзина/смета Петровича или список по строкам.
// Вызывается сразу при вставке, по кнопке и перед отправкой (silent — без сообщений).
function parseDraftText(text, silent) {
  text = text || '';
  var rows = text.split(/\n+/).filter(function (l) { return l.trim(); });
  if (!rows.length) { if (!silent) toast('Вставьте корзину или список товаров', true); return 0; }
  var items, cartLink = false, cart = false;
  if (isPetrovichCart(text) && (items = parsePetrovichCart(text)).length) cart = true;
  else {
    var parsed = rows.map(parseLine).filter(Boolean);
    cartLink = parsed.some(function (x) { return x.cart; });
    items = parsed.map(function (x) { var y = Object.assign({}, x); delete y.cart; if (x.cart) y.note = 'Ссылка на корзину или смету Петровича: ' + x.url; return y; });
  }
  if (!items.length) { if (!silent) toast('Не нашёл товаров в тексте', true); return 0; }
  S.draft.items = S.draft.items.concat(items); S.draft.text = '';
  if (silent) return items.length;
  renderNew();
  var box = document.querySelector('.pos'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (cartLink) ask('Корзину или смету по ссылке прочитать нельзя', { text: 'Сайт Петровича не разрешает приложениям открывать корзины и сметы. Откройте корзину, выделите всё (Cmd+A или Ctrl+A), скопируйте и вставьте сюда, товары появятся сами. Или сохраните смету, скачайте .xls и загрузите файл. Ссылку мы сохранили: менеджер сможет открыть её', ok: 'Понятно', cancel: 'Закрыть' });
  else toast((cart ? 'Корзина Петровича: ' : 'Добавлено позиций: ') + items.length + '. Проверьте количество');
  return items.length;
}

// Файл сметы Петровича (.xls из «Сметы» → «Скачать») или своя таблица (.xlsx, .csv) → позиции заявки.
var SHEET_RX = /\.(xls|xlsx|csv)$/i;
function sheetItem(r, petrovich) {
  var petro = petrovich && /^\d{4,9}$/.test(r.code), unit = r.unit ? cartUnit(r.unit) : 'шт';
  var it = { name: r.name.slice(0, 300), qty: r.qty, unit: UNITS.indexOf(unit) >= 0 ? unit : 'шт' };
  if (petro) {
    it.store = 'Петрович'; it.code = r.code; it.url = 'https://petrovich.ru/product/' + r.code + '/';
    if (r.price) it.note = 'Петрович: ' + r.price.toLocaleString('ru-RU') + ' ₽' + (r.unit ? ' за ' + r.unit : '');
  } else {
    var note = [];
    if (r.code) note.push('Артикул: ' + r.code);
    if (r.unit && cartUnit(r.unit) !== r.unit && UNITS.indexOf(r.unit) < 0) note.push('Ед. в файле: ' + r.unit);
    if (r.price) note.push('Цена в файле: ' + r.price.toLocaleString('ru-RU') + ' ₽');
    if (note.length) it.note = note.join('; ');
  }
  return it;
}
function importSheet(file) {
  if (!file || !S.draft) return;
  if (!SHEET_RX.test(file.name)) return toast('Нужен файл Excel (.xls, .xlsx) или .csv', true);
  if (file.size > 5 * 1024 * 1024) return toast('Файл больше 5 МБ, это не похоже на смету', true);
  file.arrayBuffer().then(function (ab) { return window.SKSheet.readTable(ab); }).then(function (rows) {
    var cols = window.SKSheet.findColumns(rows);
    // Таблица без заголовков — разбираем её строки как обычный список.
    if (!cols) return parseDraftText(rows.map(function (r) { return r.filter(function (c) { return c !== ''; }).join(' '); }).join('\n'));
    var items = window.SKSheet.tableRows(rows, cols).map(function (r) { return sheetItem(r, cols.petrovich); });
    if (!items.length) return toast('В файле не нашёл товаров с количеством', true);
    S.draft.text = ($('itemsText') || {}).value || S.draft.text;
    S.draft.items = S.draft.items.concat(items);
    renderNew();
    var box = document.querySelector('.pos'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast((cols.petrovich ? 'Смета Петровича: ' : 'Из файла: ') + items.length + ' поз. Проверьте количество');
  }).catch(function () { toast('Не получилось прочитать файл. Скачайте смету заново или скопируйте корзину и вставьте текстом', true); });
}
(function () { var f = document.createElement('input'); f.type = 'file'; f.id = 'sheetIn'; f.accept = '.xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'; f.hidden = true; document.body.appendChild(f); })();

function submitNew() {
  // Текст, который остался в поле и не был разобран, тоже идёт в заявку.
  var left = $('itemsText') ? $('itemsText').value : '';
  if (left.trim()) parseDraftText(left, true);
  var d = S.draft;
  var items = d.items.filter(function (i) { return i.name.trim(); }).map(function (i) {
    var x = { name: i.name.trim().slice(0, 300), qty: Number(i.qty) > 0 ? Number(i.qty) : 1, unit: i.unit };
    if (i.url) x.url = i.url.slice(0, 1000);
    if (i.store) x.store = i.store;
    if (i.code) x.code = i.code;
    if (i.note) x.note = String(i.note).slice(0, 500);
    return x;
  });
  if (!items.length) return toast('Добавьте хотя бы одну позицию', true);
  var body = { items: items };
  if (d.objectId) body.objectId = d.objectId;
  else {
    var o = {};
    OBJ_F.forEach(function (f) { var v = (d.obj[f[0]] || '').trim(); if (v) o[f[0]] = v; });
    body.object = o;
  }
  api('POST', '/requests', body).then(function (r) { S.draft = null; toast('Заявка №' + r.id + ' отправлена менеджеру'); go('#/r/' + r.id); }).catch(fail);
}

// ---------- карточка заявки ----------
function viewRequest(id) {
  api('GET', '/requests/' + id).then(function (r) { S.req = r; S.sel = {}; S.chat = null; S.chatDraft = ''; if (S.rec) stopRec(false); renderRequest(); loadChat(true); }).catch(function (e) { $('app').innerHTML = '<div class="wrap"><div class="empty">' + esc(e.message) + '</div></div>'; });
}
function reloadReq() { return api('GET', '/requests/' + S.req.id).then(function (r) { S.req = r; renderRequest(); }); }

function renderRequest() {
  var r = S.req, me = S.me, role = me.role, staff = isStaff();
  var own = role === 'admin' || (role === 'manager' && r.managerId === me.id);
  var h = '<div class="wrap wide"><div class="row" style="margin-bottom:6px"><button class="btn sm" data-go="#/">' + ic('back') + 'Заявки</button></div>' +
    '<div class="row"><h1 class="sp">Заявка №' + r.id + ' ' + pill(r.status) + '</h1></div>' +
    '<div class="s" style="margin:-10px 0 14px">' + esc(r.companyName) + ' · создана ' + when(r.createdAt) + (r.vatInvoice ? ' · <span class="tag">счёт с НДС</span>' : '') + (r.msOrder ? ' · заказ МойСклад <b>' + esc(r.msOrder) + '</b>' : '') + '</div>';

  if (role === 'manager' && r.managerId === null) h += '<div class="note warn">Клиента пока никто не ведёт. Возьмите его, чтобы работать с заявкой. <button class="btn sm" data-act="claim" data-id="' + r.companyId + '">Взять клиента</button></div>';
  if (r.changeComment && r.status === 'new') h += '<div class="note warn">Заказчик просит изменить: ' + esc(r.changeComment) + '</div>';
  if (role === 'customer' && r.status === 'confirm') h += '<div class="note">Проверьте товары и цены и подтвердите заявку, после этого её начнут собирать</div>';

  h += '<div class="two"><div>';
  // позиции
  var editing = own && r.status === 'work';
  var shipping = (own || role === 'picker') && (r.status === 'assembly' || r.status === 'partial');
  h += '<h2>Товары</h2>';
  if (editing) {
    h += r.items.map(function (it) { return itemEditor(it); }).join('');
  } else if (shipping) {
    h += r.items.map(function (it) {
      var on = !!S.sel[it.id];
      return '<div class="chk' + (it.shipped ? ' done' : on ? ' on' : '') + '"' + (it.shipped ? '' : ' data-act="selItem" data-id="' + it.id + '"') + '><div class="box">' + (it.shipped || on ? ic('check') : '') + '</div><div class="sp"><div>' + esc(it.skuName || it.name) + '</div><div class="xs">' + (it.skuName && it.skuName !== it.name ? 'в заявке: ' + esc(it.name) + ' · ' : '') + qtyFmt(it.qty) + ' ' + esc(it.unit || '') + (it.shipped ? ' · отгружено' : '') + '</div></div></div>';
    }).join('');
  } else {
    var prices = r.items.length && r.items[0].price !== undefined;
    h += '<div class="card"><table><tr><th>Товар</th><th class="num">Кол-во</th>' + (prices ? '<th class="num">Цена</th><th class="num">Сумма</th>' : '') + '</tr>' +
      r.items.map(function (it) {
        return '<tr><td>' + esc(it.skuName || it.name) + (it.skuName && it.skuName !== it.name ? '<div class="xs">в заявке: ' + esc(it.name) + '</div>' : '') + (it.url ? ' <a class="ext" href="' + esc(it.url) + '" target="_blank" rel="noopener" title="Открыть товар">' + ic('external') + '</a>' : '') + (staff && it.matchState === 'none' ? ' <span class="tag warn">не подобран</span>' : '') + (it.shipped ? ' <span class="tag ok">отгружено</span>' : '') + (it.note ? '<div class="xs">' + esc(it.note) + '</div>' : '') + '</td>' +
          '<td class="num">' + qtyFmt(it.qty) + ' ' + esc(it.unit || '') + '</td>' + (prices ? '<td class="num">' + money(it.price) + '</td><td class="num">' + money(it.total) + '</td>' : '') + '</tr>';
      }).join('') + '</table>' + (r.total !== undefined ? '<div class="tot"><span>Итого</span><span>' + money(r.total) + '</span></div>' : '<div class="xs" style="margin-top:8px">Цены появятся, когда менеджер отправит заявку на подтверждение</div>') + '</div>';
  }

  // действия
  var a = [];
  if (role === 'customer') {
    if (r.status === 'confirm') { a.push(btn('pri', 'Подтвердить', 'status', 'assembly')); a.push(btn('', 'Попросить изменить', 'askChange')); }
    if (['new', 'work', 'confirm'].indexOf(r.status) >= 0) a.push(btn('bad', 'Отменить заявку', 'cancel'));
  }
  if (own) {
    if (r.status === 'new') a.push(btn('pri', 'Взять в работу', 'status', 'work'));
    if (r.status === 'work') a.push(btn('pri', 'Отправить на подтверждение', 'status', 'confirm'));
    if (r.status === 'confirm') a.push(btn('', 'Подтвердить по телефону', 'status', 'assembly'));
    if (['new', 'work', 'confirm'].indexOf(r.status) >= 0) a.push('<label class="row xs" style="margin-left:4px;cursor:pointer"><input type="checkbox" data-act="vat"' + (r.vatInvoice ? ' checked' : '') + '> счёт с НДС</label>');
    if (['new', 'work', 'confirm', 'assembly'].indexOf(r.status) >= 0) a.push(btn('bad', 'Отменить', 'cancel'));
  }
  if (shipping) {
    var n = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).length;
    a.unshift(btn('acc', 'Отгрузить всё оставшееся', 'ship', 'all'));
    if (n) a.unshift(btn('pri', 'Отгрузить выбранные (' + n + ')', 'ship', 'sel'));
  }
  if (a.length) h += '<div class="btns">' + a.join('') + '</div>';

  // отгрузки и история
  if (r.shipments && r.shipments.length) h += '<h2>Отгрузки</h2><div class="card">' + r.shipments.map(function (s) { return '<div class="row"><b>' + esc(s.number) + '</b><span class="sp s">' + s.itemIds.length + ' поз.</span><span class="xs">' + when(s.at) + '</span></div>'; }).join('') + '</div>';
  if (r.object) h += '<h2>Объект</h2><div class="card">' + OBJ_F.filter(function (f) { return r.object[f[0]]; }).map(function (f) { return '<div class="row s"><span style="min-width:170px">' + f[1] + '</span><span class="sp" style="color:var(--ink)">' + esc(r.object[f[0]]) + '</span></div>'; }).join('') + '</div>';
  if (r.history && r.history.length) h += '<h2>История</h2><div class="hist">' + r.history.map(function (x) { return '<div><b>' + when(x.at) + '</b><span>' + esc(x.text) + '</span></div>'; }).join('') + '</div>';
  h += '</div><div>';
  if (role !== 'picker') h += '<h2>Переписка</h2><div class="card chatbox" id="chatbox"><div class="chat" id="chat"></div><div class="composer" id="composer"></div></div>';
  h += '</div></div></div>';
  var draftText = $('msg') ? $('msg').value : (S.chatDraft || '');
  $('app').innerHTML = h;
  S.chatDraft = draftText;
  if (S.chat && $('chat')) { S.chatSig = null; renderComposer(); renderChat(); }
}
function btn(kind, label, act, arg) { return '<button class="btn ' + kind + '" data-act="' + act + '"' + (arg ? ' data-arg="' + arg + '"' : '') + '>' + label + '</button>'; }

function itemEditor(it) {
  var ok = it.matchState !== 'none';
  return '<div class="pos' + (ok && it.price ? '' : ' bad') + '"><div class="row"><div class="sp"><b>' + esc(it.name) + '</b> <span class="xs">' + qtyFmt(it.qty) + ' ' + esc(it.unit || '') + '</span>' +
    (it.url ? ' <a class="ext" href="' + esc(it.url) + '" target="_blank" rel="noopener" title="Открыть товар">' + ic('external') + '</a>' : '') + (it.store ? ' <span class="tag acc">' + esc(it.store) + (it.storeCode ? ' · ' + esc(it.storeCode) : '') + '</span>' : '') + '</div></div>' +
    '<div class="row" style="margin-top:8px"><div class="pick sp"><input class="inp" data-cat="' + it.id + '" placeholder="' + (ok ? 'Сменить товар из каталога…' : 'Найти товар в каталоге МойСклад…') + '" autocomplete="off"><div id="dd' + it.id + '"></div></div>' +
    '<input class="inp" style="width:120px" type="number" min="0" step="0.01" data-price="' + it.id + '" placeholder="Цена" value="' + (it.price == null ? '' : it.price) + '"' + (ok ? '' : ' disabled') + '></div>' +
    (it.note ? '<div class="xs" style="margin-top:4px">' + esc(it.note) + '</div>' : '') + '<div class="xs" style="margin-top:4px">' + (ok ? ic('check', 'sm') + ' ' + esc(it.skuName || 'подобран товар из каталога') + (it.price ? ' · сумма ' + money(it.total) : ' · поставьте цену') : 'не подобран') + '</div></div>';
}

// остаток на складе (из МойСклад, обновляется раз в 15 минут)
function stockTag(st) { if (st === null || st === undefined) return ''; return st > 0 ? ' <span class="tag ok">в наличии ' + qtyFmt(st) + '</span>' : ' <span class="tag warn">нет на складе</span>'; }
// поиск по каталогу с задержкой
var catT;
function catalogSearch(input) {
  var id = input.getAttribute('data-cat'), q = input.value.trim();
  clearTimeout(catT);
  if (q.length < 2) { $('dd' + id).innerHTML = ''; return; }
  catT = setTimeout(function () {
    api('GET', '/catalog?q=' + encodeURIComponent(q)).then(function (l) {
      var box = $('dd' + id); if (!box) return;
      box.innerHTML = l.length ? '<div class="dd">' + l.map(function (c) { return '<div data-act="pickSku" data-item="' + id + '" data-sku="' + c.id + '">' + esc(c.name) + ' <span class="xs">' + money(c.price) + (c.storeCode ? ' · ' + esc(c.storeCode) : '') + '</span>' + stockTag(c.stock) + '</div>'; }).join('') + '</div>' : '<div class="dd"><div class="xs">Ничего не нашлось</div></div>';
    }).catch(fail);
  }, 250);
}

// ---------- переписка в стиле мессенджера ----------
var REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👌'];
var EMOJI = '😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😅 😉 🙂 🙃 😴 😢 😭 😡 🤯 😱 🥳 🤝 👍 👎 👌 ✌️ 🙏 👏 💪 🤞 👋 ✅ ❌ ❗ ❓ ⚠️ 🔥 ❤️ 💯 ⭐ 🎉 📦 🚚 🏗️ 🧱 🪵 🔨 🪛 🔧 📏 🧰 🪣 🖌️ 🏠 🏢 🚪 🪟 🛁 🚽 💡 🔌 📷 📎 📄 🕐 📅 💰 🧾'.split(' ');
var MAX_FILE = 25 * 1024 * 1024;
S.blobs = {};
// Одно постоянное поле выбора файлов: если пересоздавать его вместе с полем ввода, выбранный файл может потеряться.
(function () { var f = document.createElement('input'); f.type = 'file'; f.id = 'fileIn'; f.multiple = true; f.hidden = true; document.body.appendChild(f); })();

function chatEnabled() { return S.me && S.me.role !== 'picker' && S.req && $('chat'); }
function loadChat(first) {
  if (S.me.role === 'picker' || !S.req) return;
  var id = S.req.id;
  if (first) { S.chat = []; S.chatSig = null; S.reply = null; S.edit = null; S.emojiOpen = false; S.lastSeen = 0; renderComposer(); }
  api('GET', '/requests/' + id + '/messages').then(function (l) {
    if (!S.req || S.req.id !== id) return;
    S.chat = l; renderChat();
  }).catch(function () {}).then(function () { stopChat(); if (S.req && S.req.id === id) S.chatTimer = setTimeout(function () { loadChat(false); }, 4000); });
}
function stopChat() { clearTimeout(S.chatTimer); }

function dayLabel(d) {
  var x = new Date(d), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (x.toDateString() === now.toDateString()) return 'Сегодня';
  if (x.toDateString() === y.toDateString()) return 'Вчера';
  return x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function hhmm(d) { return new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function fsize(n) { return n < 1024 ? n + ' Б' : n < 1048576 ? (n / 1024).toFixed(0) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ'; }
function linkify(t) { return esc(t).replace(/https?:\/\/[^\s<]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'; }); }
function kindLabel(k) { return k === 'photo' ? 'Фото' : k === 'video' ? 'Видео' : k === 'voice' ? 'Голосовое сообщение' : k === 'file' ? 'Файл' : ''; }
function snippet(m) { return m.deleted ? 'Сообщение удалено' : (m.text || kindLabel(m.kind || (m.attachment && m.attachment.kind))); }
function durFmt(ms) { var s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function bars(id) { var h = '', x = id * 9301 + 49297; for (var i = 0; i < 28; i++) { x = (x * 9301 + 49297) % 233280; h += '<i style="height:' + (20 + (x / 233280) * 80).toFixed(0) + '%"></i>'; } return h; }

function msgHtml(m, prev, isNew) {
  var cont = prev && !prev.deleted && prev.authorId === m.authorId && (new Date(m.createdAt) - new Date(prev.createdAt)) < 180000 && dayLabel(prev.createdAt) === dayLabel(m.createdAt);
  var cls = 'msg' + (m.mine ? ' me' : '') + (cont ? ' cont' : '') + (m.deleted ? ' del' : '') + (isNew ? ' new' : '');
  var h = '<div class="' + cls + '" data-mid="' + m.id + '">';
  if (!m.mine && !cont) h += '<div class="w">' + esc(m.authorName) + '</div>';
  if (m.deleted) return h + ic('trash', 'sm') + ' Сообщение удалено<span class="meta">' + hhmm(m.createdAt) + '</span></div>';
  if (m.replyTo) h += '<div class="rp" data-goto="' + m.replyTo.id + '"><b>' + esc(m.replyTo.authorName || '') + '</b><span>' + esc(m.replyTo.deleted ? 'Сообщение удалено' : (m.replyTo.text || kindLabel(m.replyTo.kind))) + '</span></div>';
  var a = m.attachment;
  if (a) {
    if (a.kind === 'photo') h += '<img class="ph" data-att="' + a.id + '" alt="фото">';
    else if (a.kind === 'video') h += '<video class="vd" data-att="' + a.id + '" controls playsinline preload="metadata"></video>';
    else if (a.kind === 'voice') h += '<div class="voice" data-voice="' + a.id + '"><button class="pl" data-play="' + a.id + '" aria-label="Слушать">' + ic('play') + '</button><div class="bars" data-seek="' + a.id + '">' + bars(a.id) + '</div><span class="dur" id="vd' + a.id + '">' + durFmt(a.durationMs) + '</span></div>';
    else h += '<div class="file" data-dl="' + a.id + '" data-name="' + esc(a.name) + '"><div class="fi">' + ic('file') + '</div><div><div class="fn">' + esc(a.name) + '</div><div class="xs">' + fsize(a.size) + ' · скачать</div></div></div>';
  }
  if (m.text) h += '<span class="t">' + linkify(m.text) + '</span>';
  h += '<span class="meta">' + (m.editedAt ? 'изм. ' : '') + hhmm(m.createdAt) + (m.mine ? (m.read ? '<span class="rd" title="Прочитано">' + ic('checks') + '</span>' : '<span class="ur" title="Отправлено">' + ic('check') + '</span>') : '') + '</span>';
  if (m.reactions && m.reactions.length) h += '<div class="rx">' + m.reactions.map(function (r) { return '<button class="' + (r.mine ? 'mine' : '') + '" data-react="' + m.id + '" data-emoji="' + r.emoji + '">' + r.emoji + (r.count > 1 ? ' ' + r.count : '') + '</button>'; }).join('') + '</div>';
  return h + '</div>';
}

function renderChat() {
  var box = $('chat'); if (!box) return;
  var sig = JSON.stringify(S.chat);
  if (sig === S.chatSig) return;
  S.chatSig = sig;
  var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80 || !S.lastSeen;
  var lastDay = '', h = '', prev = null, seen = S.lastSeen || 0;
  S.chat.forEach(function (m) {
    var d = dayLabel(m.createdAt);
    if (d !== lastDay) { h += '<div class="day">' + d + '</div>'; lastDay = d; prev = null; }
    h += msgHtml(m, prev, seen && m.id > seen);
    prev = m;
  });
  var mineNew = S.chat.some(function (m) { return m.id > seen && m.mine; });
  box.innerHTML = h || '<div class="empty">Сообщений пока нет. Напишите менеджеру, ответ придёт сюда</div>';
  if (S.chat.length) S.lastSeen = S.chat[S.chat.length - 1].id;
  loadMedia(box);
  if (nearBottom || mineNew) box.scrollTop = box.scrollHeight;
}

// Вложения отдаются только с токеном, поэтому грузим их сами и показываем через blob-ссылку.
function blobUrl(id) {
  if (S.blobs[id]) return Promise.resolve(S.blobs[id]);
  return fetch('/attachments/' + id, { headers: { Authorization: 'Bearer ' + S.token } }).then(function (r) {
    if (!r.ok) throw new Error('Файл недоступен');
    return r.blob();
  }).then(function (b) { S.blobs[id] = URL.createObjectURL(b); return S.blobs[id]; });
}
function loadMedia(box) {
  box.querySelectorAll('[data-att]').forEach(function (el) {
    var id = el.getAttribute('data-att');
    blobUrl(id).then(function (u) {
      if (el.tagName === 'IMG') el.onload = function () { var b = $('chat'); if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 400) b.scrollTop = b.scrollHeight; };
      el.src = u;
    }).catch(function () { el.replaceWith(document.createTextNode('Файл недоступен')); });
  });
}

// ---- поле ввода ----
function renderComposer() {
  var c = $('composer'); if (!c) return;
  var h = '';
  if (S.reply) h += '<div class="ctxline">' + ic('reply') + '<div class="sp"><b>' + esc(S.reply.authorName) + '</b><span>' + esc(snippet(S.reply)) + '</span></div><button class="cb" data-chat="cancelCtx" title="Отменить">' + ic('x') + '</button></div>';
  if (S.edit) h += '<div class="ctxline">' + ic('edit') + '<div class="sp"><b>Редактирование</b><span>' + esc(snippet(S.edit)) + '</span></div><button class="cb" data-chat="cancelCtx" title="Отменить">' + ic('x') + '</button></div>';
  if (S.uploading) h += '<div class="uploading"><span class="spin"></span>' + esc(S.uploading) + '</div>';
  if (S.emojiOpen) h += '<div class="emoji">' + EMOJI.map(function (e) { return '<button data-emoji-ins="' + e + '">' + e + '</button>'; }).join('') + '</div>';
  if (S.rec) {
    h += '<div class="bar"><button class="cb" data-chat="recCancel" title="Отменить запись">' + ic('trash') + '</button><div class="recbar"><span class="dot"></span><span id="recT">0:00</span><span class="xs" style="font-weight:400">запись голосового…</span></div><button class="cb send" data-chat="recSend" title="Отправить">' + ic('send') + '</button></div>';
  } else {
    var text = S.chatDraft || '';
    h += '<div class="bar"><button class="cb" data-chat="attach" title="Фото, видео или файл" aria-label="Прикрепить">' + ic('clip') + '</button>' +
      '<textarea id="msg" rows="1" placeholder="' + (S.edit ? 'Новый текст…' : 'Сообщение') + '">' + esc(text) + '</textarea>' +
      '<button class="cb" data-chat="emoji" title="Эмодзи" aria-label="Эмодзи">' + ic('smile') + '</button>' + mainBtn(text) + '</div>';
  }
  c.innerHTML = h;
  var t = $('msg'); if (t) autosize(t);
}
function mainBtn(text) {
  return text.trim() || S.edit ? '<button class="cb send" id="cbMain" data-chat="send" title="Отправить" aria-label="Отправить">' + ic('send') + '</button>' : '<button class="cb" id="cbMain" data-chat="rec" title="Записать голосовое" aria-label="Записать голосовое">' + ic('mic') + '</button>';
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }

function sendText() {
  var t = $('msg'), text = t ? t.value.trim() : '';
  if (S.edit) {
    var m = S.edit;
    if (!text && !m.attachment) return toast('Пустое сообщение', true);
    return api('PATCH', '/requests/' + S.req.id + '/messages/' + m.id, { text: text }).then(function (x) {
      replaceMsg(x); S.edit = null; S.chatDraft = ''; renderComposer(); toast('Сообщение изменено');
    }).catch(fail);
  }
  if (!text) return;
  var body = { text: text };
  if (S.reply) body.replyToId = S.reply.id;
  S.chatDraft = ''; t.value = ''; autosize(t); swapMain('');
  return api('POST', '/requests/' + S.req.id + '/messages', body).then(function (m) {
    S.reply = null; S.chat.push(m); renderComposer(); renderChat(); var b = $('chat'); if (b) b.scrollTop = b.scrollHeight;
  }).catch(function (e) { S.chatDraft = text; renderComposer(); fail(e); });
}
function replaceMsg(x) { S.chat = S.chat.map(function (m) { return m.id === x.id ? x : m; }); renderChat(); }
function swapMain(text) { var b = $('cbMain'); if (b) b.outerHTML = mainBtn(text); }

// ---- файлы: кнопка, вставка из буфера, перетаскивание ----
function sendFiles(files, opts) {
  opts = opts || {};
  files = Array.prototype.slice.call(files || []);
  if (!files.length) return Promise.resolve();
  var big = files.filter(function (f) { return f.size > MAX_FILE; });
  if (big.length) { toast('Файл больше 25 МБ: ' + big[0].name, true); files = files.filter(function (f) { return f.size <= MAX_FILE; }); }
  var caption = opts.caption !== undefined ? opts.caption : ($('msg') ? $('msg').value.trim() : '');
  var replyId = S.reply ? S.reply.id : null;
  var chain = Promise.resolve();
  files.forEach(function (f, i) {
    chain = chain.then(function () {
      S.uploading = 'Отправка ' + (f.name || 'файла') + (files.length > 1 ? ' (' + (i + 1) + ' из ' + files.length + ')' : '') + '…'; renderComposer();
      var q = '?name=' + encodeURIComponent(f.name || 'файл') + (opts.kind ? '&kind=' + opts.kind : '') + (opts.duration ? '&duration=' + Math.round(opts.duration) : '');
      return fetch('/requests/' + S.req.id + '/attachments' + q, { method: 'POST', headers: { Authorization: 'Bearer ' + S.token, 'Content-Type': 'application/octet-stream', 'X-File-Type': f.type || 'application/octet-stream' }, body: f })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(r.status === 413 ? 'Файл слишком большой' : (ERR[j.error] || 'Не удалось загрузить файл')); return j; }); })
        .then(function (a) {
          var body = { attachmentId: a.id };
          if (i === 0 && caption) body.text = caption;
          if (i === 0 && replyId) body.replyToId = replyId;
          return api('POST', '/requests/' + S.req.id + '/messages', body);
        })
        .then(function (m) { S.chat.push(m); renderChat(); var b = $('chat'); if (b) b.scrollTop = b.scrollHeight; });
    });
  });
  return chain.then(function () {
    if (caption && opts.caption === undefined) S.chatDraft = '';
    S.reply = null; S.uploading = null; renderComposer();
  }).catch(function (e) { S.uploading = null; renderComposer(); fail(e); });
}

// ---- голосовые ----
function startRec() {
  if (window.SK_DEMO) return toast('В демо запись голоса недоступна: страница не получает микрофон. В приложении работает, послушайте голосовое в переписке');
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Браузер не умеет записывать звук', true);
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0] || '';
    var rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    S.rec = { rec: rec, stream: stream, chunks: chunks, start: Date.now(), send: false };
    rec.onstop = function () {
      var r = S.rec; S.rec = null; clearInterval(r.timer);
      stream.getTracks().forEach(function (t) { t.stop(); });
      renderComposer();
      if (!r.send) return;
      var dur = Date.now() - r.start;
      if (dur < 600) return toast('Слишком коротко, удерживайте запись дольше', true);
      var mime = (rec.mimeType || 'audio/webm').split(';')[0];
      var file = new File(chunks, 'голосовое.' + (mime.indexOf('mp4') >= 0 ? 'm4a' : mime.indexOf('ogg') >= 0 ? 'ogg' : 'webm'), { type: rec.mimeType || 'audio/webm' });
      sendFiles([file], { kind: 'voice', duration: dur, caption: '' });
    };
    rec.start(250);
    S.rec.timer = setInterval(function () { var e = $('recT'); if (e && S.rec) e.textContent = durFmt(Date.now() - S.rec.start); }, 250);
    renderComposer();
  }).catch(function () { toast('Нет доступа к микрофону. Разрешите его в настройках браузера', true); });
}
function stopRec(send) { if (!S.rec) return; S.rec.send = send; S.rec.rec.stop(); }

// проигрыватель голосовых: один звук за раз, прогресс по полоскам
var player = { audio: null, id: null };
function playVoice(id) {
  if (player.id === id && player.audio) { if (player.audio.paused) player.audio.play(); else player.audio.pause(); return; }
  if (player.audio) player.audio.pause();
  blobUrl(id).then(function (u) {
    var a = new Audio(u); player = { audio: a, id: id };
    var btnEl = function () { return document.querySelector('[data-play="' + id + '"]'); };
    a.onplay = function () { var b = btnEl(); if (b) { b.innerHTML = ic('pause'); b.classList.add('on'); } };
    a.onpause = a.onended = function () { var b = btnEl(); if (b) { b.innerHTML = ic('play'); b.classList.remove('on'); } };
    a.ontimeupdate = function () {
      var wrap = document.querySelector('[data-seek="' + id + '"]'); if (!wrap || !a.duration || !isFinite(a.duration)) return;
      var bs = wrap.children, k = Math.round(bs.length * a.currentTime / a.duration);
      for (var i = 0; i < bs.length; i++) bs[i].className = i < k ? 'on' : '';
      var d = $('vd' + id); if (d) d.textContent = durFmt(a.currentTime * 1000);
    };
    a.play().catch(function () { toast('Не удалось воспроизвести', true); });
  }).catch(fail);
}

// ---- меню сообщения: реакции, ответить, копировать, изменить, удалить ----
function openCtx(m, x, y) {
  closeCtx();
  if (m.deleted) return;
  var canEdit = m.mine, canDel = m.mine || S.me.role === 'admin';
  var el = document.createElement('div'); el.className = 'ctx'; el.id = 'ctx';
  el.innerHTML = '<div class="em">' + REACTIONS.map(function (e) { return '<button data-ctx-react="' + e + '">' + e + '</button>'; }).join('') + '</div>' +
    '<div class="it" data-ctx="reply">' + ic('reply') + 'Ответить</div>' + (m.text ? '<div class="it" data-ctx="copy">' + ic('copy') + 'Копировать текст</div>' : '') +
    (canEdit ? '<div class="it" data-ctx="edit">' + ic('edit') + 'Изменить</div>' : '') + (canDel ? '<div class="it bad" data-ctx="delete">' + ic('trash') + 'Удалить</div>' : '');
  document.body.appendChild(el);
  var w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  S.ctxMsg = m;
}
function closeCtx() { var c = $('ctx'); if (c) c.remove(); }
function msgById(id) { return S.chat.filter(function (m) { return m.id === Number(id); })[0]; }
function react(mid, emoji) {
  return api('POST', '/requests/' + S.req.id + '/messages/' + mid + '/reaction', { emoji: emoji }).then(replaceMsg).catch(fail);
}
function lightbox(src) { var d = document.createElement('div'); d.className = 'lb'; d.innerHTML = '<img src="' + src + '" alt="">'; d.onclick = function () { d.remove(); }; document.body.appendChild(d); }

document.addEventListener('click', function (ev) {
  var t = ev.target;
  if (!t.closest('#ctx') && $('ctx')) { closeCtx(); if (!t.closest('[data-chat]')) return; }
  var c = t.closest('[data-chat]');
  if (c) {
    var a = c.getAttribute('data-chat');
    if (a === 'send') return sendText();
    if (a === 'attach') return $('fileIn') && $('fileIn').click();
    if (a === 'emoji') { S.chatDraft = $('msg') ? $('msg').value : S.chatDraft; S.emojiOpen = !S.emojiOpen; renderComposer(); return $('msg') && $('msg').focus(); }
    if (a === 'rec') return startRec();
    if (a === 'recCancel') return stopRec(false);
    if (a === 'recSend') return stopRec(true);
    if (a === 'cancelCtx') { if (S.edit) S.chatDraft = ''; S.reply = null; S.edit = null; return renderComposer(); }
  }
  var ei = t.closest('[data-emoji-ins]');
  if (ei) {
    var ta = $('msg'), e = ei.getAttribute('data-emoji-ins');
    if (ta) { var p = ta.selectionStart || ta.value.length; ta.value = ta.value.slice(0, p) + e + ta.value.slice(ta.selectionEnd || p); ta.focus(); ta.selectionStart = ta.selectionEnd = p + e.length; S.chatDraft = ta.value; swapMain(ta.value); autosize(ta); }
    return;
  }
  var cr = t.closest('[data-ctx-react]');
  if (cr) { var m0 = S.ctxMsg; closeCtx(); var mine = (m0.reactions || []).filter(function (r) { return r.mine; })[0]; return react(m0.id, mine && mine.emoji === cr.getAttribute('data-ctx-react') ? null : cr.getAttribute('data-ctx-react')); }
  var cx = t.closest('[data-ctx]');
  if (cx) {
    var m = S.ctxMsg, act = cx.getAttribute('data-ctx'); closeCtx();
    if (act === 'reply') { S.reply = m; S.edit = null; S.chatDraft = $('msg') ? $('msg').value : ''; renderComposer(); return $('msg') && $('msg').focus(); }
    if (act === 'copy') { (navigator.clipboard ? navigator.clipboard.writeText(m.text) : Promise.reject()).then(function () { toast('Текст скопирован'); }).catch(function () { toast('Не удалось скопировать', true); }); return; }
    if (act === 'edit') { S.edit = m; S.reply = null; S.chatDraft = m.text; renderComposer(); var ta2 = $('msg'); if (ta2) { ta2.focus(); ta2.selectionStart = ta2.value.length; } return; }
    if (act === 'delete') {
      return ask('Удалить сообщение?', { text: 'Оно исчезнет у всех участников переписки', ok: 'Удалить', danger: true }).then(function (yes) {
        if (!yes) return;
        return api('DELETE', '/requests/' + S.req.id + '/messages/' + m.id).then(function () { m = Object.assign({}, m, { deleted: true, text: '', attachment: null, reactions: [], replyTo: null }); replaceMsg(m); }).catch(fail);
      });
    }
  }
  var rx = t.closest('[data-react]');
  if (rx) { var mm = msgById(rx.getAttribute('data-react')), em = rx.getAttribute('data-emoji'); return react(mm.id, rx.classList.contains('mine') ? null : em); }
  var pl = t.closest('[data-play]'); if (pl) return playVoice(pl.getAttribute('data-play'));
  var sk = t.closest('[data-seek]');
  if (sk) { var vid = sk.getAttribute('data-seek'); if (player.id !== vid) return playVoice(vid); var r = sk.getBoundingClientRect(); if (player.audio && player.audio.duration) player.audio.currentTime = player.audio.duration * (ev.clientX - r.left) / r.width; return; }
  var ph = t.closest('img.ph'); if (ph && ph.src) return lightbox(ph.src);
  var dl = t.closest('[data-dl]');
  if (dl && window.SK_DEMO) return toast('В демо файлы не скачиваются. В приложении файл сохранится на устройство');
  if (dl) return blobUrl(dl.getAttribute('data-dl')).then(function (u) { var l = document.createElement('a'); l.href = u; l.download = dl.getAttribute('data-name'); document.body.appendChild(l); l.click(); l.remove(); }).catch(fail);
  var gt = t.closest('[data-goto]');
  if (gt) { var el = document.querySelector('[data-mid="' + gt.getAttribute('data-goto') + '"]'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1200); } }
});

document.addEventListener('contextmenu', function (ev) {
  var m = ev.target.closest('.msg[data-mid]');
  if (!m || ev.target.closest('a,video')) return;
  ev.preventDefault();
  openCtx(msgById(m.getAttribute('data-mid')), ev.clientX, ev.clientY);
});
// долгое нажатие на телефоне открывает то же меню
var lpT;
document.addEventListener('touchstart', function (ev) {
  var m = ev.target.closest('.msg[data-mid]'); if (!m || ev.target.closest('a,video,button')) return;
  var tch = ev.touches[0];
  lpT = setTimeout(function () { if (navigator.vibrate) navigator.vibrate(15); openCtx(msgById(m.getAttribute('data-mid')), tch.clientX, tch.clientY); }, 450);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(function (e) { document.addEventListener(e, function () { clearTimeout(lpT); }, { passive: true }); });
// двойной щелчок — быстрая реакция 👍, как в мессенджерах
document.addEventListener('dblclick', function (ev) {
  var m = ev.target.closest('.msg[data-mid]'); if (!m || m.classList.contains('del') || ev.target.closest('a,video,button,.voice,.file')) return;
  var msg = msgById(m.getAttribute('data-mid')); var mine = (msg.reactions || []).filter(function (r) { return r.mine; })[0];
  react(msg.id, mine && mine.emoji === '👍' ? null : '👍');
});

// Вставили корзину или список в поле товаров — разбираем сразу, без кнопки.
document.addEventListener('paste', function (ev) {
  if (ev.target.id !== 'itemsText' || !S.draft) return;
  setTimeout(function () { var t = $('itemsText'); if (t && t.value.trim()) parseDraftText(t.value); }, 0);
});

document.addEventListener('input', function (ev) {
  if (ev.target.id !== 'msg') return;
  S.chatDraft = ev.target.value; autosize(ev.target);
  var b = $('cbMain'), want = ev.target.value.trim() || S.edit ? 'send' : 'rec';
  if (b && b.getAttribute('data-chat') !== want) swapMain(ev.target.value);
});
document.addEventListener('keydown', function (ev) {
  if (ev.target.id === 'msg' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendText(); }
  if (ev.key === 'Escape') { closeCtx(); if (S.reply || S.edit) { S.reply = null; S.edit = null; renderComposer(); } }
  // стрелка вверх в пустом поле — изменить своё последнее сообщение
  if (ev.target.id === 'msg' && ev.key === 'ArrowUp' && !ev.target.value) {
    var last = S.chat.filter(function (m) { return m.mine && !m.deleted; }).pop();
    if (last) { ev.preventDefault(); S.edit = last; S.chatDraft = last.text; renderComposer(); $('msg').focus(); }
  }
});
document.addEventListener('change', function (ev) {
  if (ev.target.id === 'fileIn') { sendFiles(ev.target.files); ev.target.value = ''; }
  if (ev.target.id === 'sheetIn') { importSheet(ev.target.files[0]); ev.target.value = ''; }
});
document.addEventListener('paste', function (ev) {
  if (!chatEnabled() || !ev.clipboardData || !ev.clipboardData.files.length) return;
  ev.preventDefault(); sendFiles(ev.clipboardData.files);
});
['dragenter', 'dragover'].forEach(function (n) {
  document.addEventListener(n, function (ev) {
    var box = ev.target.closest && ev.target.closest('#chatbox, .card.paste'); if (!box) return;
    ev.preventDefault(); if (!box.querySelector('.drop')) { var d = document.createElement('div'); d.className = 'drop'; d.textContent = box.id === 'chatbox' ? 'Отпустите, чтобы отправить' : 'Отпустите, чтобы загрузить смету'; box.style.position = 'relative'; box.appendChild(d); }
  });
});
document.addEventListener('dragleave', function (ev) { document.querySelectorAll('#chatbox, .card.paste').forEach(function (box) { if (!ev.relatedTarget || !box.contains(ev.relatedTarget)) { var d = box.querySelector('.drop'); if (d) d.remove(); } }); });
document.addEventListener('drop', function (ev) {
  var box = ev.target.closest && ev.target.closest('#chatbox, .card.paste'); if (!box) return;
  ev.preventDefault(); var d = box.querySelector('.drop'); if (d) d.remove();
  if (!ev.dataTransfer || !ev.dataTransfer.files.length) return;
  if (box.id === 'chatbox') sendFiles(ev.dataTransfer.files); else importSheet(ev.dataTransfer.files[0]);
});

// ---------- клиенты (менеджер, админ) ----------
function viewCompanies() {
  $('app').innerHTML = '<div class="wrap wide loading"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  var mg = S.me.role === 'admin' ? Promise.all([api('GET', '/staff/managers'), api('GET', '/staff')]).then(function (x) { S.managers = x[0]; S.staff = x[1]; }) : Promise.resolve();
  Promise.all([api('GET', '/companies'), mg]).then(function (x) { S.companies = x[0]; renderCompanies(); }).catch(fail);
}
function renderCompanies() {
  var me = S.me, f = S.coFilter || 'all';
  var l = S.companies.filter(function (c) { return f === 'all' || (f === 'mine' && c.managerId === me.id) || (f === 'free' && c.managerId === null) || (f === 'pending' && c.status === 'pending'); });
  var h = '<div class="wrap wide"><h1>Клиенты</h1><div class="tabs">' + [['all', 'Все'], ['mine', 'Мои'], ['free', 'Не распределены'], ['pending', 'Ждут подтверждения']].map(function (t) { return '<button data-act="coFilter" data-f="' + t[0] + '" class="' + (t[0] === f ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="list">';
  h += l.length ? l.map(function (c) {
    var own = me.role === 'admin' || c.managerId === me.id;
    var acts = [];
    if (c.managerId === null && me.role === 'manager') acts.push('<button class="btn sm" data-act="claim" data-id="' + c.id + '">Взять клиента</button>');
    if (own && c.status === 'pending') acts.push('<button class="btn sm pri" data-act="approve" data-id="' + c.id + '">Подтвердить компанию</button>');
    if (own) acts.push('<button class="btn sm" data-act="coPeople" data-id="' + c.id + '">' + ic('users') + 'Люди и пароли</button>');
    if (own) acts.push('<label class="row xs" style="cursor:pointer"><input type="checkbox" data-act="coVat" data-id="' + c.id + '"' + (c.vatInvoice ? ' checked' : '') + '> счёт с НДС</label>');
    if (me.role === 'admin' && S.managers) acts.push('<label class="row xs">Ведёт: <select class="inp" style="width:auto;padding:5px 8px" data-act="reassign" data-id="' + c.id + '"><option value="">никто</option>' + S.managers.map(function (m) { return '<option value="' + m.id + '"' + (m.id === c.managerId ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select></label>');
    return '<div class="card" style="cursor:default"><div class="row"><b class="sp">' + esc(c.name) + '</b><span class="pill p-' + c.status + '">' + esc(CO_ST[c.status]) + '</span></div>' +
      '<div class="s">' + (c.managerName ? 'Ведёт: ' + esc(c.managerName) : '<span class="tag warn">не распределён</span>') + ' · МойСклад: ' + (c.msCounterpartyId ? '<span class="tag ok">контрагент связан</span>' : '<span class="tag warn">контрагент не выбран</span>') + '</div>' +
      (own ? '<div class="pick" style="margin-top:8px"><input class="inp" data-cp="' + c.id + '" placeholder="' + (c.msCounterpartyId ? 'Сменить контрагента МойСклад…' : 'Найти контрагента в МойСклад…') + '" autocomplete="off"><div id="cp' + c.id + '"></div></div>' : '') +
      (acts.length ? '<div class="btns" style="margin-top:8px;align-items:center">' + acts.join('') + '</div>' : '') + '<div id="people' + c.id + '"></div></div>';
  }).join('') : '<div class="empty">Здесь пусто</div>';
  if (me.role === 'admin' && S.staff) {
    h += '</div><h2>Менеджеры</h2><div class="card">' + S.staff.map(function (u) {
      return '<div class="row" style="padding:5px 0;flex-wrap:wrap"><span class="sp">' + esc(u.name) + ' <span class="xs">' + esc(ROLE[u.role] || u.role) + ' · ' + (u.phone ? esc(u.phone) : '<span class="tag warn">нет телефона</span>') + (u.phone && !u.hasPassword ? ' · <span class="tag warn">пароль не задан</span>' : '') + '</span></span>' +
        (u.id !== me.id ? '<button class="btn sm" data-act="staffPhone" data-id="' + u.id + '" data-name="' + esc(u.name) + '">' + ic('phone') + (u.phone ? 'Телефон' : 'Задать телефон') + '</button>' : '') +
        (u.phone && u.id !== me.id ? '<button class="btn sm" data-act="resetCode" data-id="' + u.id + '" data-name="' + esc(u.name) + '">' + ic('key') + 'Код для пароля</button>' : '') + '</div>';
    }).join('') + '<div class="btns"><button class="btn sm pri" data-act="staffAdd">' + ic('plus') + 'Менеджер</button><button class="btn sm" data-act="hintsLoad">' + ic('list') + 'Клиенты менеджеров</button></div></div><div>';
  }
  $('app').innerHTML = h + '</div></div>';
}
var cpT;
function cpSearch(input) {
  var id = input.getAttribute('data-cp'), q = input.value.trim();
  clearTimeout(cpT);
  if (q.length < 2) { $('cp' + id).innerHTML = ''; return; }
  cpT = setTimeout(function () {
    api('GET', '/ms/counterparties?q=' + encodeURIComponent(q)).then(function (l) {
      var box = $('cp' + id); if (!box) return;
      box.innerHTML = '<div class="dd">' + (l.length ? l.map(function (c) { return '<div data-act="pickCp" data-co="' + id + '" data-cp="' + c.id + '">' + esc(c.name) + '</div>'; }).join('') : '<div class="xs">Ничего не нашлось</div>') + '</div>';
    }).catch(fail);
  }, 300);
}

// ---------- события ----------
document.addEventListener('click', function (ev) {
  var g = ev.target.closest('[data-go]');
  if (g) { ev.preventDefault(); S.notesOpen = false; go(g.getAttribute('data-go')); return; }
  var el = ev.target.closest('[data-act]');
  if (!el) { if (S.notesOpen && !ev.target.closest('.notes')) { S.notesOpen = false; renderTop(); } return; }
  var act = el.getAttribute('data-act'), id = Number(el.getAttribute('data-id')), arg = el.getAttribute('data-arg');
  var r = S.req;
  switch (act) {
    case 'doLogin': return doLogin();
    case 'doRegister': return doRegister();
    case 'doReset': return doReset();
    case 'toLogin': return viewLogin('login');
    case 'toRegister': return viewLogin('register');
    case 'toReset': return viewLogin('reset');
    case 'demoLogin': return window.SK_DEMO.login(el.getAttribute('data-phone'));
    case 'logout': return logout();
    case 'changePass': return changePass();
    case 'pushOn': el.disabled = true; return enablePush().then(function () { toast('Уведомления включены'); if (location.hash === '#/settings') viewSettings(); else viewList(); }).catch(function (e) { el.disabled = false; fail(e); });
    case 'pushOff': return disablePush().then(function () { toast('Уведомления на этом устройстве выключены'); viewSettings(); }).catch(fail);
    case 'pushLater': try { localStorage.setItem('sk_push_later', '1'); } catch (e) { /* ничего */ } var pn = $('pushNudge'); if (pn) pn.remove(); return;
    case 'staffPhone': return ask('Телефон: ' + el.getAttribute('data-name'), { input: '+7 999 123-45-67', ok: 'Сохранить' }).then(function (v) { if (v) return api('PATCH', '/staff/' + id, { phone: v }).then(function () { toast('Телефон сохранён. Теперь выдайте код для пароля'); viewCompanies(); }).catch(fail); });
    case 'staffAdd': return staffAdd();
    case 'hintsLoad': return hintsLoad();
    case 'coPeople': return coPeople(id);
    case 'resetCode': return resetCode(id, el.getAttribute('data-name'));
    case 'reloadMe': S.me = null; return boot();
    case 'notes': S.notesOpen = !S.notesOpen; return renderTop();
    case 'readAll': return api('POST', '/notifications/read-all').then(pollNotes).catch(fail);
    case 'openNote': {
      var req = el.getAttribute('data-req');
      api('POST', '/notifications/' + id + '/read').catch(function () {}).then(pollNotes);
      S.notesOpen = false; renderTop();
      if (req) go('#/r/' + req);
      return;
    }
    case 'toggleSms': return api('PATCH', '/me', { smsEnabled: !S.me.smsEnabled }).then(function (x) { S.me.smsEnabled = x.smsEnabled; viewSettings(); }).catch(fail);
    case 'listTab': S.listTab = el.getAttribute('data-tab'); return viewList();
    case 'pickObj': S.draft.objectId = el.value ? Number(el.value) : null; return renderNew();
    case 'parseItems': return parseDraftText($('itemsText').value);
    case 'pickSheet': return $('sheetIn').click();
    case 'addItem': S.draft.text = ($('itemsText') || {}).value || S.draft.text; S.draft.items.push({ name: '', qty: 1, unit: 'шт' }); return renderNew();
    case 'delItem': S.draft.items.splice(Number(el.getAttribute('data-i')), 1); return renderNew();
    case 'submitNew': return submitNew();
    case 'status': return api('POST', '/requests/' + r.id + '/status', { to: arg }).then(function () { toast(arg === 'assembly' ? 'Заявка подтверждена и передана на сборку' : arg === 'confirm' ? 'Отправлено заказчику на подтверждение' : 'Готово'); return reloadReq(); }).catch(fail);
    case 'askChange': {
      return ask('Что изменить в заявке?', { input: 'Например: убрать грунтовку, добавить 5 мешков Ротбанда', ok: 'Отправить менеджеру' }).then(function (c) {
        if (!c) return;
        return api('POST', '/requests/' + r.id + '/status', { to: 'new', comment: c }).then(function () { toast('Просьба отправлена менеджеру'); return reloadReq(); }).catch(fail);
      });
    }
    case 'cancel': return ask('Отменить заявку №' + r.id + '?', { text: 'Отменённую заявку вернуть нельзя', ok: 'Отменить заявку', cancel: 'Не отменять', danger: true }).then(function (yes) { if (yes) return api('POST', '/requests/' + r.id + '/status', { to: 'cancelled' }).then(function () { toast('Заявка отменена'); return reloadReq(); }).catch(fail); });
    case 'claim': return api('POST', '/companies/' + id + '/claim').then(function () { toast('Клиент теперь ваш'); return S.req && location.hash.indexOf('#/r/') === 0 ? reloadReq() : viewCompanies(); }).catch(fail);
    case 'approve': return api('POST', '/companies/' + id + '/approve').then(function () { toast('Компания подтверждена, заказчик получит уведомление'); viewCompanies(); }).catch(fail);
    case 'pickSku': return api('PATCH', '/requests/' + r.id + '/items/' + el.getAttribute('data-item'), { skuId: Number(el.getAttribute('data-sku')) }).then(reloadReq).catch(fail);
    case 'selItem': S.sel[id] = !S.sel[id]; return renderRequest();
    case 'ship': {
      var ids = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).map(Number);
      var body = arg === 'sel' ? { itemIds: ids } : undefined;
      el.disabled = true;
      return api('POST', '/requests/' + r.id + '/ship', body).then(function (x) { toast('Отгрузка ' + x.shipment + (x.remaining ? ', осталось позиций: ' + x.remaining : ', заявка отгружена полностью')); S.sel = {};
        // Сборщик видит только заявки на сборке: после полной отгрузки возвращаемся к списку.
        if (!x.remaining && S.me.role === 'picker') return go('#/');
        return reloadReq(); }).catch(function (e) { el.disabled = false; fail(e); });
    }
    case 'coFilter': S.coFilter = el.getAttribute('data-f'); return renderCompanies();
    case 'pickCp': {
      var co = el.getAttribute('data-co');
      return api('POST', '/companies/' + co + '/ms-counterparty', { msId: el.getAttribute('data-cp') }).then(function (x) { toast('Связано с «' + x.counterparty.name + '»'); viewCompanies(); }).catch(fail);
    }
  }
});

document.addEventListener('change', function (ev) {
  var el = ev.target;
  if (el.hasAttribute('data-obj')) { S.draft.obj[el.getAttribute('data-obj')] = el.value; return; }
  if (el.hasAttribute('data-item') && el.hasAttribute('data-k')) { var it = S.draft.items[Number(el.getAttribute('data-item'))]; it[el.getAttribute('data-k')] = el.value; return; }
  if (el.hasAttribute('data-price')) {
    var v = el.value.trim(); if (v === '') return;
    return api('PATCH', '/requests/' + S.req.id + '/items/' + el.getAttribute('data-price'), { price: Number(v) }).then(reloadReq).catch(fail);
  }
  var act = el.getAttribute('data-act');
  if (act === 'vat') return api('PATCH', '/requests/' + S.req.id, { vatInvoice: el.checked }).then(reloadReq).catch(function (e) { el.checked = !el.checked; fail(e); });
  if (act === 'reassign') { if (!el.value) return; return api('POST', '/companies/' + el.getAttribute('data-id') + '/reassign', { managerId: Number(el.value) }).then(function () { toast('Клиент передан менеджеру'); viewCompanies(); }).catch(fail); }
  if (act === 'coVat') return api('PATCH', '/companies/' + el.getAttribute('data-id'), { vatInvoice: el.checked }).then(function () { toast(el.checked ? 'Новые заявки клиента будут со счётом с НДС' : 'Счёт с НДС выключен'); }).catch(function (e) { el.checked = !el.checked; fail(e); });
});

document.addEventListener('input', function (ev) {
  var el = ev.target;
  if (el.hasAttribute('data-cat')) return catalogSearch(el);
  if (el.hasAttribute('data-cp')) return cpSearch(el);
  if (el.hasAttribute('data-obj')) { S.draft.obj[el.getAttribute('data-obj')] = el.value; return; }
  if (el.hasAttribute('data-item') && el.hasAttribute('data-k')) { S.draft.items[Number(el.getAttribute('data-item'))][el.getAttribute('data-k')] = el.value; return; }
  if (el.id === 'itemsText' && S.draft) S.draft.text = el.value;
});

document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter') return;
  var id = ev.target.id;
  if ((id === 'pass' || id === 'pass2' || id === 'phone') && S.login && !S.me) { ev.preventDefault(); if (S.login.step === 'login') doLogin(); else if (S.login.step === 'register') doRegister(); else doReset(); }
});

route();

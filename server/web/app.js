/* SpaceKit · Заявки — интерфейс. Один файл, без сборки, работает с API этого же сервера. */
'use strict';

// ---------- справочники ----------
var ST = { new: 'Новая', work: 'В обработке', confirm: 'На подтверждении', assembly: 'На сборке', partial: 'Частично отгружена', shipped: 'Отгружена', cancelled: 'Отменена' };
var CO_ST = { pending: 'ждёт подтверждения', approved: 'подтверждена', blocked: 'заблокирована' };
var ROLE = { customer: 'Заказчик', manager: 'Менеджер', picker: 'Сборщик', admin: 'Админ' };
var UNITS = ['шт', 'м²', 'м', 'уп', 'меш', 'кг', 'л', 'рул', 'лист'];
var LIFT = ['грузовой', 'пассажирский', 'нет'];
var OBJ_F = [
  ['jk', 'Название ЖК', 0], ['street', 'Улица', 1], ['house', 'Дом', 1], ['entrance', 'Подъезд', 0], ['floor', 'Этаж', 1], ['apt', 'Квартира', 1],
  ['height', 'Ограничение по высоте', 0], ['lift', 'Лифт', 1], ['resp', 'Ответственное лицо', 1], ['respPhone', 'Телефон ответственного', 1],
  ['district', 'Район', 0], ['parking', 'Паркинг', 1], ['pass', 'Пропуск', 1], ['dominfo', 'Дополнительная информация', 0],
];
var ERR = {
  bad_phone: 'Проверьте номер телефона', too_many_requests: 'Слишком много запросов кода. Попробуйте позже', invalid_code: 'Неверный или устаревший код',
  too_many_attempts: 'Слишком много попыток. Запросите новый код', blocked: 'Доступ закрыт', send_failed: 'Не удалось отправить код',
  forbidden: 'Нет прав на это действие', not_found: 'Не найдено', unauthorized: 'Войдите заново', comment_required: 'Нужен комментарий',
  invalid_transition: 'Сейчас это действие недоступно', unpriced_items: 'Не у всех позиций есть товар и цена', not_in_work: 'Заявка не в работе',
  not_matched: 'Сначала выберите товар', sku_not_found: 'Товар не найден', use_shipments: 'Отгрузка — отдельной кнопкой', nothing_to_ship: 'Нечего отгружать',
  bad_items: 'Часть позиций уже отгружена', object_incomplete: 'Заполните обязательные поля объекта', bad_lift: 'Выберите лифт', object_required: 'Укажите объект',
  object_not_found: 'Объект не найден', already_assigned: 'Клиента уже взял другой менеджер', no_counterparty: 'У компании не выбран контрагент в МойСклад',
  item_not_in_catalog: 'Есть позиции без товара из МойСклад', moysklad_failed: 'МойСклад ответил ошибкой', moysklad_disabled: 'МойСклад не подключён',
  counterparty_not_found: 'Контрагент не найден', counterparty_taken: 'Этот контрагент уже связан с другой компанией', order_created: 'Заказ уже создан в МойСклад, меняйте там',
  empty: 'Пустое сообщение',
};

// ---------- состояние ----------
var S = { token: load('token'), me: null, cache: {}, notes: [], notesOpen: false, draft: null, catalogFor: null, chatTimer: null, msOn: null };

function load(k) { try { return localStorage.getItem('sk_' + k); } catch (e) { return null; } }
function store(k, v) { try { if (v === null) localStorage.removeItem('sk_' + k); else localStorage.setItem('sk_' + k, v); } catch (e) { /* приватный режим */ } }

// ---------- помощники ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(id) { return document.getElementById(id); }
function money(n) { return n == null ? '—' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽'; }
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

function route() {
  stopChat();
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
function logout() { api('POST', '/auth/logout').catch(function () {}).then(function () { logoutLocal(); go('#/'); }); }

// ---------- верхняя панель ----------
function renderTop() {
  var me = S.me, h = '<div class="logo" data-go="#/">SpaceKit <span>· Заявки</span></div>';
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
      '<div class="bw"><button data-act="notes">🔔' + (unread ? '<span class="n2">' + unread + '</span>' : '') + '</button>' + (S.notesOpen ? notesHtml() : '') + '</div>' +
      '<button data-go="#/settings" title="Настройки">⚙</button></div>';
  }
  $('top').innerHTML = h;
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
    if (after > before && before >= 0 && S._notesLoaded) toast('🔔 ' + l[0].text);
    S._notesLoaded = true;
  }).catch(function () {}).then(function () { notesTimer = setTimeout(pollNotes, 20000); });
}

// ---------- вход ----------
function viewLogin(step, info) {
  renderTop();
  step = step || 'phone'; info = info || {};
  var h = '<div class="wrap"><h1>Вход</h1><div class="card">';
  if (step === 'phone') {
    h += '<div class="f"><label>Телефон</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 999 123-45-67" value="' + esc(info.phone || '') + '"></div>' +
      '<button class="btn pri full" data-act="reqCode">Получить код</button><p class="xs">Код из 4 цифр придёт звонком или SMS.</p>';
  } else {
    h += '<p class="s">Код отправлен на ' + esc(info.phone) + '</p><div class="f"><input id="code" class="code" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="····" value="' + esc(info.code || '') + '"></div>';
    if (step === 'profile') {
      h += '<div class="note">Вы входите впервые. Представьтесь — менеджер подтвердит вашу компанию.</div>' +
        '<div class="f"><label>Ваше имя <i>*</i></label><input id="pname" autocomplete="name"></div>' +
        '<div class="f"><label>Компания <i>*</i></label><input id="pcompany" autocomplete="organization"></div>';
    }
    h += '<button class="btn pri full" data-act="verify">Войти</button><div class="btns"><button class="btn sm" data-act="loginBack">Другой номер</button></div>';
  }
  $('app').innerHTML = h + '</div></div>';
  S.login = { step: step, phone: info.phone || '' };
  var f = $(step === 'phone' ? 'phone' : step === 'profile' ? 'pname' : 'code'); if (f) f.focus();
}
function reqCode() {
  var phone = $('phone').value.trim();
  api('POST', '/auth/request-code', { phone: phone }).then(function () { viewLogin('code', { phone: phone }); }).catch(fail);
}
function verify() {
  var b = { phone: S.login.phone, code: $('code').value.trim() };
  if (S.login.step === 'profile') { b.name = $('pname').value.trim(); b.company = $('pcompany').value.trim(); if (!b.name || !b.company) return toast('Заполните имя и компанию', true); }
  api('POST', '/auth/verify', b).then(function (r) {
    S.token = r.token; store('token', r.token); S.me = null; S._notesLoaded = false; go('#/'); boot();
  }).catch(function (e) {
    if (e.code === 'profile_required') return viewLogin('profile', { phone: S.login.phone, code: b.code });
    fail(e);
  });
}

function viewPending() {
  $('app').innerHTML = '<div class="wrap"><h1>Здравствуйте, ' + esc(S.me.name) + '</h1><div class="card"><p>Ваша компания ждёт подтверждения менеджером. Как только её подтвердят, придёт SMS и здесь можно будет создавать заявки.</p>' +
    '<div class="btns"><button class="btn" data-act="reloadMe">Проверить ещё раз</button><button class="btn" data-act="logout">Выйти</button></div></div></div>';
}

function viewSettings() {
  $('app').innerHTML = '<div class="wrap"><h1>Настройки</h1><div class="card"><div class="b">' + esc(S.me.name) + '</div><div class="s">' + esc(ROLE[S.me.role]) + '</div>' +
    (S.me.role === 'customer' ? '<label class="chk' + (S.me.smsEnabled ? ' on' : '') + '" data-act="toggleSms" style="margin-top:12px"><div class="box">' + (S.me.smsEnabled ? '✓' : '') + '</div><div>SMS о заявках<div class="xs">Подтверждение, отгрузка, отмена. Уведомления в приложении остаются всегда.</div></div></label>' : '') +
    '<div class="btns"><button class="btn bad" data-act="logout">Выйти</button></div></div></div>';
}

// ---------- список заявок ----------
function viewList() {
  var role = S.me.role, tab = S.listTab || (role === 'customer' ? 'all' : role === 'picker' ? 'all' : 'active');
  $('app').innerHTML = '<div class="wrap wide"><div class="empty">Загрузка…</div></div>';
  api('GET', '/requests').then(function (rows) {
    var groups = role === 'customer' || role === 'picker'
      ? [['all', 'Все', null]]
      : [['active', 'В работе', ['new', 'work', 'confirm']], ['new', 'Новые', ['new']], ['work', 'В обработке', ['work']], ['confirm', 'На подтверждении', ['confirm']], ['floor', 'Сборка', ['assembly', 'partial']], ['done', 'Закрытые', ['shipped', 'cancelled']], ['all', 'Все', null]];
    var g = groups.filter(function (x) { return x[0] === tab; })[0] || groups[0];
    var list = rows.filter(function (r) { return !g[2] || g[2].indexOf(r.status) >= 0; });
    var h = '<div class="wrap wide"><div class="row"><h1 class="sp">' + (role === 'picker' ? 'Сборка и отгрузка' : 'Заявки') + '</h1>' + (role === 'customer' ? '<button class="btn pri" data-go="#/new">+ Новая заявка</button>' : '') + '</div>';
    if (groups.length > 1) h += '<div class="tabs">' + groups.map(function (x) { var c = rows.filter(function (r) { return !x[2] || x[2].indexOf(r.status) >= 0; }).length; return '<button data-act="listTab" data-tab="' + x[0] + '" class="' + (x[0] === g[0] ? 'on' : '') + '">' + x[1] + ' <span class="xs">' + c + '</span></button>'; }).join('') + '</div>';
    h += '<div class="list">' + (list.length ? list.map(function (r) {
      return '<div class="card" data-go="#/r/' + r.id + '"><div class="row"><b>№' + r.id + '</b>' + pill(r.status) + '<span class="sp"></span><span class="xs">' + when(r.updatedAt) + '</span></div>' +
        '<div class="s">' + (role !== 'customer' ? esc(r.companyName) + ' · ' : '') + r.itemsCount + ' поз.' + (role === 'manager' && r.managerId === null ? ' · <span class="tag warn">клиент не распределён</span>' : '') + '</div></div>';
    }).join('') : '<div class="empty">' + (role === 'customer' ? 'Заявок пока нет. Нажмите «Новая заявка».' : 'Здесь пусто') + '</div>') + '</div></div>';
    $('app').innerHTML = h;
  }).catch(fail);
}

// ---------- новая заявка (заказчик) ----------
function newDraft() { return { objectId: null, obj: { lift: '' }, text: '', items: [] }; }
function viewNew() {
  if (!S.draft) S.draft = newDraft();
  api('GET', '/objects').then(function (objs) { S.objects = objs; renderNew(); }).catch(fail);
}
function renderNew() {
  var d = S.draft, objs = S.objects || [];
  var h = '<div class="wrap"><h1>Новая заявка</h1><h2>Объект</h2>';
  if (objs.length) {
    h += '<div class="card" style="margin-bottom:8px">' + objs.map(function (o) {
      return '<label class="row" style="padding:6px 0;cursor:pointer"><input type="radio" name="obj" data-act="pickObj" value="' + o.id + '"' + (d.objectId === o.id ? ' checked' : '') + '><span class="sp">' + esc(addr(o)) + '</span></label>';
    }).join('') + '<label class="row" style="padding:6px 0;cursor:pointer"><input type="radio" name="obj" data-act="pickObj" value=""' + (d.objectId === null ? ' checked' : '') + '><span class="sp">Новый объект</span></label></div>';
  }
  if (d.objectId === null) {
    h += '<div class="card"><div class="grid">' + OBJ_F.map(function (f) {
      var k = f[0], v = d.obj[k] || '', lab = '<label>' + f[1] + (f[2] ? ' <i>*</i>' : '') + '</label>';
      if (k === 'lift') return '<div class="f">' + lab + '<select data-obj="lift"><option value="">—</option>' + LIFT.map(function (l) { return '<option' + (v === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div>';
      if (k === 'dominfo') return '<div class="f span2">' + lab + '<textarea rows="2" data-obj="dominfo">' + esc(v) + '</textarea></div>';
      return '<div class="f">' + lab + '<input data-obj="' + k + '" value="' + esc(v) + '"' + (k === 'parking' ? ' placeholder="есть / нет"' : k === 'pass' ? ' placeholder="нужен / не нужен"' : '') + '></div>';
    }).join('') + '</div></div>';
  }
  h += '<h2>Товары</h2><div class="card"><div class="f"><label>Вставьте список или ссылки на товары, по одной позиции в строке</label>' +
    '<textarea id="itemsText" rows="6" placeholder="Ротбанд 30 кг — 10 меш&#10;https://petrovich.ru/product/155351/ 2&#10;Профиль ПП 60×27 3 м 40 шт">' + esc(d.text) + '</textarea></div>' +
    '<button class="btn sm" data-act="parseItems">Разобрать список</button></div>';
  if (d.items.length) {
    h += '<div style="margin-top:8px">' + d.items.map(function (it, i) {
      return '<div class="pos"><div class="row"><input class="inp sp" data-item="' + i + '" data-k="name" value="' + esc(it.name) + '">' +
        '<button class="btn sm bad" data-act="delItem" data-i="' + i + '" title="Убрать">✕</button></div>' +
        '<div class="row" style="margin-top:6px"><input class="inp" style="width:110px" type="number" min="0" step="any" data-item="' + i + '" data-k="qty" value="' + esc(it.qty) + '">' +
        '<select class="inp" style="width:90px" data-item="' + i + '" data-k="unit">' + UNITS.map(function (u) { return '<option' + (it.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select>' +
        (it.store ? '<span class="tag acc">' + esc(it.store) + (it.code ? ' · ' + esc(it.code) : '') + '</span>' : '') + '</div></div>';
    }).join('') + '</div><button class="btn sm" data-act="addItem">+ Позиция</button>';
  } else {
    h += '<div class="btns"><button class="btn sm" data-act="addItem">+ Добавить позицию вручную</button></div>';
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
  if (/petrovich\.ru/i.test(u)) { m = u.match(/\/product\/(\d+)/); return { store: 'Петрович', code: m ? m[1] : '' }; }
  if (/leroymerlin\.ru/i.test(u)) { m = u.match(/-(\d{6,})\/?(?:[?#].*)?$/) || u.match(/\/(\d{6,})\/?(?:[?#].*)?$/); return { store: 'Леруа Мерлен', code: m ? m[1] : '' }; }
  if (/vseinstrumenti\.ru/i.test(u)) { m = u.match(/-(\d{5,})\/?(?:[?#].*)?$/) || u.match(/\/(\d{5,})\/?(?:[?#].*)?$/); return { store: 'ВсеИнструменты', code: m ? m[1] : '' }; }
  return { store: 'Другой', code: '' };
}
function parseLine(l) {
  l = l.trim().replace(/^\d+[.)]\s+/, '').replace(/^[-•*–]\s*/, '');
  if (!l) return null;
  var url = (l.match(/https?:\/\/\S+/) || [])[0], p = url ? parseLink(url) : { store: '', code: '' }, rest = url ? l.replace(url, '').trim() : l;
  var m = rest.match(/^(.*?)[\s,;:—–\-x×*]*(\d+(?:[.,]\d+)?)\s*([а-яё²2.\s]{0,10})$/i), name = rest, qty = 1, unit = 'шт';
  if (m && (m[3].trim() === '' || UNIT_RX.test(m[3].trim()))) { name = m[1].replace(/[\s,;:—–\-]+$/, '').trim(); qty = parseFloat(m[2].replace(',', '.')); unit = normUnit(m[3]); }
  if (!name && p.code) name = 'Товар ' + p.store + ', код ' + p.code;
  if (!name) return null;
  return { name: name, qty: qty || 1, unit: unit, url: url || '', store: p.store, code: p.code };
}

function submitNew() {
  var d = S.draft;
  var items = d.items.filter(function (i) { return i.name.trim(); }).map(function (i) {
    var x = { name: i.name.trim().slice(0, 300), qty: Number(i.qty) > 0 ? Number(i.qty) : 1, unit: i.unit };
    if (i.url) x.url = i.url.slice(0, 1000);
    if (i.store) x.store = i.store;
    if (i.code) x.code = i.code;
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
  api('GET', '/requests/' + id).then(function (r) { S.req = r; S.sel = {}; renderRequest(); loadChat(true); }).catch(function (e) { $('app').innerHTML = '<div class="wrap"><div class="empty">' + esc(e.message) + '</div></div>'; });
}
function reloadReq() { return api('GET', '/requests/' + S.req.id).then(function (r) { S.req = r; renderRequest(); }); }

function renderRequest() {
  var r = S.req, me = S.me, role = me.role, staff = isStaff();
  var own = role === 'admin' || (role === 'manager' && r.managerId === me.id);
  var h = '<div class="wrap wide"><div class="row" style="margin-bottom:6px"><button class="btn sm" data-go="#/">← Заявки</button></div>' +
    '<div class="row"><h1 class="sp">Заявка №' + r.id + ' ' + pill(r.status) + '</h1></div>' +
    '<div class="s" style="margin:-10px 0 14px">' + esc(r.companyName) + ' · создана ' + when(r.createdAt) + (r.vatInvoice ? ' · <span class="tag">счёт с НДС</span>' : '') + (r.msOrder ? ' · заказ МойСклад <b>' + esc(r.msOrder) + '</b>' : '') + '</div>';

  if (role === 'manager' && r.managerId === null) h += '<div class="note warn">Клиента пока никто не ведёт. Возьмите его, чтобы работать с заявкой. <button class="btn sm" data-act="claim" data-id="' + r.companyId + '">Взять клиента</button></div>';
  if (r.changeComment && r.status === 'new') h += '<div class="note warn">Заказчик просит изменить: ' + esc(r.changeComment) + '</div>';
  if (role === 'customer' && r.status === 'confirm') h += '<div class="note">Проверьте товары и цены и подтвердите заявку — после этого её начнут собирать.</div>';

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
      return '<div class="chk' + (it.shipped ? ' done' : on ? ' on' : '') + '"' + (it.shipped ? '' : ' data-act="selItem" data-id="' + it.id + '"') + '><div class="box">' + (it.shipped || on ? '✓' : '') + '</div><div class="sp"><div>' + esc(it.skuName || it.name) + '</div><div class="xs">' + (it.skuName && it.skuName !== it.name ? 'в заявке: ' + esc(it.name) + ' · ' : '') + qtyFmt(it.qty) + ' ' + esc(it.unit || '') + (it.shipped ? ' · отгружено' : '') + '</div></div></div>';
    }).join('');
  } else {
    var prices = r.items.length && r.items[0].price !== undefined;
    h += '<div class="card"><table><tr><th>Товар</th><th class="num">Кол-во</th>' + (prices ? '<th class="num">Цена</th><th class="num">Сумма</th>' : '') + '</tr>' +
      r.items.map(function (it) {
        return '<tr><td>' + esc(it.skuName || it.name) + (it.skuName && it.skuName !== it.name ? '<div class="xs">в заявке: ' + esc(it.name) + '</div>' : '') + (it.url ? ' <a href="' + esc(it.url) + '" target="_blank" rel="noopener">↗</a>' : '') + (staff && it.matchState === 'none' ? ' <span class="tag warn">не подобран</span>' : '') + (it.shipped ? ' <span class="tag ok">отгружено</span>' : '') + (it.note ? '<div class="xs">' + esc(it.note) + '</div>' : '') + '</td>' +
          '<td class="num">' + qtyFmt(it.qty) + ' ' + esc(it.unit || '') + '</td>' + (prices ? '<td class="num">' + money(it.price) + '</td><td class="num">' + money(it.total) + '</td>' : '') + '</tr>';
      }).join('') + '</table>' + (r.total !== undefined ? '<div class="tot"><span>Итого</span><span>' + money(r.total) + '</span></div>' : '<div class="xs" style="margin-top:8px">Цены появятся, когда менеджер отправит заявку на подтверждение.</div>') + '</div>';
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
  if (role !== 'picker') h += '<h2>Переписка</h2><div class="card"><div class="chat" id="chat"></div><div class="row"><textarea id="msg" class="inp sp" rows="1" placeholder="Сообщение…"></textarea><button class="btn pri" data-act="send">→</button></div></div>';
  h += '</div></div></div>';
  $('app').innerHTML = h;
  if (S.chat) renderChat();
}
function btn(kind, label, act, arg) { return '<button class="btn ' + kind + '" data-act="' + act + '"' + (arg ? ' data-arg="' + arg + '"' : '') + '>' + label + '</button>'; }

function itemEditor(it) {
  var ok = it.matchState !== 'none';
  return '<div class="pos' + (ok && it.price ? '' : ' bad') + '"><div class="row"><div class="sp"><b>' + esc(it.name) + '</b> <span class="xs">' + qtyFmt(it.qty) + ' ' + esc(it.unit || '') + '</span>' +
    (it.url ? ' <a href="' + esc(it.url) + '" target="_blank" rel="noopener">↗</a>' : '') + (it.store ? ' <span class="tag acc">' + esc(it.store) + (it.storeCode ? ' · ' + esc(it.storeCode) : '') + '</span>' : '') + '</div></div>' +
    '<div class="row" style="margin-top:8px"><div class="pick sp"><input class="inp" data-cat="' + it.id + '" placeholder="' + (ok ? 'Сменить товар из каталога…' : 'Найти товар в каталоге МойСклад…') + '" autocomplete="off"><div id="dd' + it.id + '"></div></div>' +
    '<input class="inp" style="width:120px" type="number" min="0" step="0.01" data-price="' + it.id + '" placeholder="Цена" value="' + (it.price == null ? '' : it.price) + '"' + (ok ? '' : ' disabled') + '></div>' +
    '<div class="xs" style="margin-top:4px">' + (ok ? '✓ ' + esc(it.skuName || 'подобран товар из каталога') + (it.price ? ' · сумма ' + money(it.total) : ' · поставьте цену') : 'не подобран') + '</div></div>';
}

// поиск по каталогу с задержкой
var catT;
function catalogSearch(input) {
  var id = input.getAttribute('data-cat'), q = input.value.trim();
  clearTimeout(catT);
  if (q.length < 2) { $('dd' + id).innerHTML = ''; return; }
  catT = setTimeout(function () {
    api('GET', '/catalog?q=' + encodeURIComponent(q)).then(function (l) {
      var box = $('dd' + id); if (!box) return;
      box.innerHTML = l.length ? '<div class="dd">' + l.map(function (c) { return '<div data-act="pickSku" data-item="' + id + '" data-sku="' + c.id + '">' + esc(c.name) + ' <span class="xs">' + money(c.price) + (c.storeCode ? ' · ' + esc(c.storeCode) : '') + '</span></div>'; }).join('') + '</div>' : '<div class="dd"><div class="xs">Ничего не нашлось</div></div>';
    }).catch(fail);
  }, 250);
}

// ---------- переписка ----------
function loadChat(first) {
  if (S.me.role === 'picker' || !S.req) return;
  var id = S.req.id;
  if (first) S.chat = [];
  var after = S.chat.length ? S.chat[S.chat.length - 1].id : 0;
  api('GET', '/requests/' + id + '/messages?after=' + after).then(function (l) {
    if (!S.req || S.req.id !== id) return;
    if (l.length || first) { S.chat = S.chat.concat(l); renderChat(); }
  }).catch(function () {}).then(function () { stopChat(); S.chatTimer = setTimeout(function () { loadChat(false); }, 8000); });
}
function stopChat() { clearTimeout(S.chatTimer); }
function renderChat() {
  var box = $('chat'); if (!box) return;
  box.innerHTML = S.chat.length ? S.chat.map(function (m) { return '<div class="msg' + (m.mine ? ' me' : '') + '"><div class="w">' + esc(m.authorName) + ' · ' + when(m.createdAt) + '</div>' + esc(m.text) + '</div>'; }).join('') : '<div class="xs">Сообщений пока нет</div>';
  box.scrollTop = box.scrollHeight;
}
function sendMsg() {
  var t = $('msg'), text = t.value.trim(); if (!text) return;
  api('POST', '/requests/' + S.req.id + '/messages', { text: text }).then(function (m) { t.value = ''; S.chat.push(m); renderChat(); }).catch(fail);
}

// ---------- клиенты (менеджер, админ) ----------
function viewCompanies() {
  $('app').innerHTML = '<div class="wrap wide"><div class="empty">Загрузка…</div></div>';
  api('GET', '/companies').then(function (l) { S.companies = l; renderCompanies(); }).catch(fail);
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
    if (own) acts.push('<label class="row xs" style="cursor:pointer"><input type="checkbox" data-act="coVat" data-id="' + c.id + '"' + (c.vatInvoice ? ' checked' : '') + '> счёт с НДС</label>');
    return '<div class="card" style="cursor:default"><div class="row"><b class="sp">' + esc(c.name) + '</b><span class="pill p-' + c.status + '">' + esc(CO_ST[c.status]) + '</span></div>' +
      '<div class="s">' + (c.managerName ? 'Ведёт: ' + esc(c.managerName) : '<span class="tag warn">не распределён</span>') + ' · МойСклад: ' + (c.msCounterpartyId ? '<span class="tag ok">контрагент связан</span>' : '<span class="tag warn">контрагент не выбран</span>') + '</div>' +
      (own ? '<div class="pick" style="margin-top:8px"><input class="inp" data-cp="' + c.id + '" placeholder="' + (c.msCounterpartyId ? 'Сменить контрагента МойСклад…' : 'Найти контрагента в МойСклад…') + '" autocomplete="off"><div id="cp' + c.id + '"></div></div>' : '') +
      (acts.length ? '<div class="btns" style="margin-top:8px;align-items:center">' + acts.join('') + '</div>' : '') + '</div>';
  }).join('') : '<div class="empty">Здесь пусто</div>';
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
    case 'reqCode': return reqCode();
    case 'verify': return verify();
    case 'loginBack': return viewLogin('phone', { phone: S.login.phone });
    case 'logout': return logout();
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
    case 'parseItems': {
      var text = $('itemsText').value; S.draft.text = text;
      var parsed = text.split(/\n+/).map(parseLine).filter(Boolean);
      if (!parsed.length) return toast('Не нашёл позиций в тексте', true);
      S.draft.items = S.draft.items.concat(parsed); S.draft.text = ''; renderNew(); return toast('Добавлено позиций: ' + parsed.length);
    }
    case 'addItem': S.draft.text = ($('itemsText') || {}).value || S.draft.text; S.draft.items.push({ name: '', qty: 1, unit: 'шт' }); return renderNew();
    case 'delItem': S.draft.items.splice(Number(el.getAttribute('data-i')), 1); return renderNew();
    case 'submitNew': return submitNew();
    case 'status': return api('POST', '/requests/' + r.id + '/status', { to: arg }).then(function () { toast(arg === 'assembly' ? 'Заявка подтверждена и передана на сборку' : arg === 'confirm' ? 'Отправлено заказчику на подтверждение' : 'Готово'); return reloadReq(); }).catch(fail);
    case 'askChange': {
      var c = prompt('Что изменить в заявке?'); if (!c || !c.trim()) return;
      return api('POST', '/requests/' + r.id + '/status', { to: 'new', comment: c.trim() }).then(function () { toast('Просьба отправлена менеджеру'); return reloadReq(); }).catch(fail);
    }
    case 'cancel': if (!confirm('Отменить заявку №' + r.id + '?')) return; return api('POST', '/requests/' + r.id + '/status', { to: 'cancelled' }).then(reloadReq).catch(fail);
    case 'claim': return api('POST', '/companies/' + id + '/claim').then(function () { toast('Клиент теперь ваш'); return S.req && location.hash.indexOf('#/r/') === 0 ? reloadReq() : viewCompanies(); }).catch(fail);
    case 'approve': return api('POST', '/companies/' + id + '/approve').then(function () { toast('Компания подтверждена, заказчику ушло SMS'); viewCompanies(); }).catch(fail);
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
    case 'send': return sendMsg();
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
  if (act === 'coVat') return api('PATCH', '/companies/' + el.getAttribute('data-id'), { vatInvoice: el.checked }).then(function () { toast(el.checked ? 'Новые заявки клиента — со счётом с НДС' : 'Счёт с НДС выключен'); }).catch(function (e) { el.checked = !el.checked; fail(e); });
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
  if (id === 'phone') { ev.preventDefault(); reqCode(); }
  else if (id === 'code' || id === 'pcompany') { ev.preventDefault(); verify(); }
  else if (id === 'msg' && !ev.shiftKey) { ev.preventDefault(); sendMsg(); }
});

route();

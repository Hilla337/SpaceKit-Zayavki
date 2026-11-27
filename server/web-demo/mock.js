/*
 * Демо без сервера: подменяет fetch и отвечает так же, как настоящий API (server/src/routes-*.ts),
 * по тем же правилам: кто что видит, статусы, цены, отгрузки, переписка. Данные — в памяти браузера
 * (и в localStorage, кроме вложений). Собирается в одну страницу скриптом build-demo.mjs.
 */
(function () {
  'use strict';
  var KEY = 'sk_demo_db_v2';
  var DEMO_PASSWORD = '123456';
  var ROLES = [['Заказчик (Профит Рум)', '+79991110001'], ['Менеджер Филипп Инилеев', '+79990000001'], ['Менеджер Татьяна Чех', '+79990000002'], ['Админ Илья', '+79990000009'], ['Новый заказчик', '+79150001122']];
  window.SK_DEMO = { roles: ROLES };

  var REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👌'];
  var TRANS = [
    ['new', 'work', ['manager', 'admin']], ['work', 'confirm', ['manager', 'admin']],
    ['confirm', 'assembly', ['customer', 'manager', 'admin']], ['confirm', 'new', ['customer']],
    ['new', 'cancelled', ['customer', 'manager', 'admin']], ['work', 'cancelled', ['customer', 'manager', 'admin']], ['confirm', 'cancelled', ['customer', 'manager', 'admin']],
    ['assembly', 'cancelled', ['manager', 'admin']],
  ];
  var PRICE_ST = ['confirm', 'assembly', 'partial', 'shipped'];
  var LABEL = { work: 'взял(а) заявку в работу', confirm: 'отправил(а) заявку заказчику на подтверждение', assembly: 'передал(а) заявку на сборку', new: 'вернул(а) заявку менеджеру на изменение', cancelled: 'отменил(а) заявку' };
  var blobs = {}; // вложения: только в памяти

  function now(minAgo) { return new Date(Date.now() - (minAgo || 0) * 60000).toISOString(); }
  function seed() {
    var d = {
      seq: { user: 20, company: 10, object: 10, request: 1050, item: 100, ship: 2410, msg: 100, att: 10, note: 100, hist: 100 },
      users: [
        { id: 1, name: 'Филипп Инилеев', role: 'manager', phone: '+79990000001', status: 'approved', companyId: null, sms: true },
        { id: 2, name: 'Татьяна Чех', role: 'manager', phone: '+79990000002', status: 'approved', companyId: null, sms: true },
        { id: 3, name: 'Максим Стребков', role: 'manager', phone: '+79990000003', status: 'approved', companyId: null, sms: true },
        { id: 4, name: 'Дмитрий Барбарасов', role: 'manager', phone: '+79990000004', status: 'approved', companyId: null, sms: true },
        { id: 5, name: 'Илья', role: 'admin', phone: '+79990000009', status: 'approved', companyId: null, sms: true },
        { id: 10, name: 'Эрнест', role: 'customer', phone: '+79991110001', status: 'approved', companyId: 1, sms: true },
        { id: 11, name: 'Артём', role: 'customer', phone: '+79991110002', status: 'approved', companyId: 2, sms: true },
        { id: 12, name: 'Олег', role: 'customer', phone: '+79991110003', status: 'pending', companyId: 5, sms: true },
      ],
      companies: [
        { id: 1, name: 'Профит Рум', status: 'approved', managerId: 1, ms: 'demo-cp-1', vat: false },
        { id: 2, name: 'Левар', status: 'approved', managerId: 2, ms: 'demo-cp-2', vat: true },
        { id: 3, name: 'SOMARI', status: 'approved', managerId: 3, ms: 'demo-cp-3', vat: false },
        { id: 4, name: 'BASE TEAM', status: 'approved', managerId: 4, ms: null, vat: false },
        { id: 5, name: 'Новострой-М', status: 'pending', managerId: null, ms: null, vat: false },
      ],
      catalog: [
        [1, 'Петрович', '155351', 'Краска моющаяся Marshall Export 7 база BW белая 9 л', 4297],
        [2, 'Петрович', '100101', 'Штукатурка гипсовая Knauf Ротбанд 30 кг', 620],
        [3, 'Петрович', '1030828', 'Диск шлифовальный Sunmight Ceramic d225 мм P40', 1586],
        [4, 'Петрович', '1084356', 'Крюк для вязки арматуры Stayer автоматический', 1650],
        [5, 'Петрович', '106530', 'Провод ШВВП 2х0,75 Партнер Электро', 31],
        [6, 'Петрович', '633066', 'Дюбель-хомут для круглого кабеля Navigator 5-10 мм', 65],
        [7, '', null, 'Профиль потолочный ПП 60×27 3 м', 245],
        [8, '', null, 'Профиль направляющий ПН 27×28 3 м', 189],
        [9, '', null, 'Гипсокартон влагостойкий Knauf 12,5 мм 2500×1200', 690],
        [10, '', null, 'Грунтовка глубокого проникновения Ceresit CT 17 10 л', 980],
        [11, '', null, 'Клей плиточный Ceresit CM 11 25 кг', 520],
        [12, '', null, 'Шпаклёвка финишная Vetonit LR+ 20 кг', 1150],
        [13, '', null, 'Саморезы по металлу 3,5×25, 1000 шт', 640],
        [14, '', null, 'Гибкая подводка для воды STAYER 1/2″ 0,5 м', 138],
        [15, '', null, 'Гибкая подводка для воды STAYER 1/2″ 1 м', 160],
        [16, '', null, 'Ниппель никелированный STOUT 3/4″', 185],
        [17, '', null, 'Пена монтажная профессиональная 750 мл', 590],
        [18, '', null, 'Лента малярная 48 мм × 50 м', 210],
      ].map(function (c) { return { id: c[0], store: c[1], code: c[2], name: c[3], price: c[4] }; }),
      objects: [
        { id: 1, companyId: 1, jk: 'Прайм Парк', street: 'Ленинградский проспект', house: '37/6', floor: '33', apt: '133Б', lift: 'грузовой', resp: 'Артур', respPhone: '+7 968 996-03-33', parking: 'есть', pass: 'не нужен' },
        { id: 2, companyId: 1, jk: 'Событие', street: 'Василия Ланового', house: '6 к3', floor: '40', apt: '508', lift: 'пассажирский', resp: 'Артур', respPhone: '+7 967 016-00-65', parking: 'нет', pass: 'нужен', dominfo: 'Заезд со стороны паркинга, пропуск заказывать за день' },
        { id: 3, companyId: 2, street: 'Мичуринский проспект', house: '29', floor: '16', apt: '121', lift: 'грузовой', resp: 'Артём', respPhone: '+7 916 000-12-34', parking: 'есть', pass: 'не нужен' },
      ],
      requests: [], items: [], ships: [], messages: [], atts: [], reacts: [], reads: [], notes: [], hist: [], codes: {}, sessions: {},
    };
    // Готовые заявки в разных статусах, чтобы было что показать.
    function req(id, companyId, by, objectId, status, minAgo, items, extra) {
      d.requests.push(Object.assign({ id: id, companyId: companyId, createdBy: by, objectId: objectId, status: status, createdAt: now(minAgo), updatedAt: now(minAgo - 5), change: null, vat: false, msOrder: null }, extra || {}));
      items.forEach(function (it) { d.items.push(Object.assign({ id: ++d.seq.item, requestId: id, store: null, code: null, url: null, unit: 'шт', skuId: null, price: null, shipped: false }, it)); });
      d.hist.push({ id: ++d.seq.hist, requestId: id, text: (by === 10 ? 'Эрнест' : 'Артём') + ' создал(а) заявку', at: now(minAgo) });
    }
    req(1047, 1, 10, 1, 'new', 35, [
      { name: 'Товар Петрович, код 155351', qty: 3, store: 'Петрович', code: '155351', url: 'https://petrovich.ru/product/155351/', skuId: 1, price: 4297 },
      { name: 'Ротбанд 30 кг', qty: 12, unit: 'меш' }, { name: 'Профиль ПП 60×27 3 м', qty: 40 },
    ]);
    req(1046, 1, 10, 2, 'confirm', 600, [
      { name: 'Гипсокартон влагостойкий', qty: 24, skuId: 9, price: 690 }, { name: 'Профиль ПН 27×28', qty: 30, skuId: 8, price: 189 },
      { name: 'Саморезы 3,5×25', qty: 2, unit: 'уп', skuId: 13, price: 640 },
    ]);
    d.hist.push({ id: ++d.seq.hist, requestId: 1046, text: 'Филипп Инилеев взял(а) заявку в работу', at: now(560) }, { id: ++d.seq.hist, requestId: 1046, text: 'Филипп Инилеев отправил(а) заявку заказчику на подтверждение', at: now(400) });
    req(1045, 1, 10, 1, 'partial', 2900, [
      { name: 'Шпаклёвка финишная', qty: 10, unit: 'меш', skuId: 12, price: 1150, shipped: true }, { name: 'Грунтовка 10 л', qty: 4, skuId: 10, price: 980, shipped: true },
      { name: 'Лента малярная', qty: 6, skuId: 18, price: 210 },
    ], { msOrder: '02388' });
    d.ships.push({ id: 1, requestId: 1045, number: '01975', itemIds: [d.seq.item - 2, d.seq.item - 1], at: now(1500) });
    req(1044, 2, 11, 3, 'work', 200, [{ name: 'Клей плиточный CM 11', qty: 15, unit: 'меш', skuId: 11, price: 520 }, { name: 'Затирка серая', qty: 3, unit: 'кг' }], { vat: true });
    req(1043, 1, 10, 2, 'shipped', 9000, [{ name: 'Пена монтажная', qty: 6, skuId: 17, price: 590, shipped: true }], { msOrder: '02371' });
    // Переписка по заявке 1046
    function msg(id, requestId, authorId, text, minAgo, extra) { d.messages.push(Object.assign({ id: id, requestId: requestId, authorId: authorId, text: text, createdAt: now(minAgo), editedAt: null, deletedAt: null, replyTo: null, att: null }, extra || {})); }
    msg(1, 1046, 10, 'Добрый день! Посмотрите, пожалуйста, можно ли заменить гипсокартон на Волма — он дешевле?', 520);
    msg(2, 1046, 1, 'Здравствуйте! Волма есть, но для санузла лучше влагостойкий Knauf. Оставил его, по цене вышло почти так же 👍', 500, { replyTo: 1 });
    msg(3, 1046, 1, '', 498, { att: 1 });
    msg(4, 1046, 10, 'Понял, спасибо! Подтвержу вечером', 470);
    d.reacts.push({ messageId: 2, userId: 10, emoji: '🙏' });
    d.reads.push({ requestId: 1046, userId: 10, last: 3 }, { requestId: 1046, userId: 1, last: 4 });
    msg(5, 1047, 10, 'Привезите, пожалуйста, до 12:00, в подъезде грузовой лифт', 30);
    d.atts.push({ id: 1, requestId: 1046, uploader: 1, kind: 'voice', mime: 'audio/wav', name: 'голосовое.wav', size: 0, durationMs: 2600, gen: 'voice' });
    d.notes.push({ id: 1, userId: 1, requestId: 1047, text: 'Новая заявка №1047', createdAt: now(35), read: false }, { id: 2, userId: 1, requestId: 1047, text: 'Новое сообщение по заявке №1047', createdAt: now(30), read: false }, { id: 3, userId: 10, requestId: 1046, text: 'Заявка №1046 ждёт вашего подтверждения', createdAt: now(400), read: false });
    return d;
  }
  var D;
  try { D = JSON.parse(localStorage.getItem(KEY)); } catch (e) { D = null; }
  if (!D || !D.seq) D = seed();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* хранилище недоступно — работаем в памяти */ } }
  window.SK_DEMO.reset = function () { try { localStorage.removeItem(KEY); localStorage.removeItem('sk_token'); } catch (e) { /* ничего */ } location.hash = ''; location.reload(); };

  // голосовое для показа: короткая мелодия, собранная прямо в браузере (WAV)
  function genVoice() {
    var rate = 16000, len = Math.floor(rate * 2.6), buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len * 2, true);
    var notes = [392, 440, 494, 523, 494, 440];
    for (var i = 0; i < len; i++) { var t = i / rate, n = notes[Math.floor(t / 0.43) % notes.length], env = Math.min(1, (t % 0.43) * 30) * Math.max(0, 1 - (t % 0.43) / 0.43); v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * n * t) * env * 9000, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ---------- правила доступа (как server/src/access.ts) ----------
  var byId = function (list, id) { return list.filter(function (x) { return x.id === id; })[0]; };
  function company(id) { return byId(D.companies, id); }
  function user(id) { return byId(D.users, id); }
  function canViewCompany(u, c) {
    if (u.status !== 'approved') return false;
    if (u.role === 'admin') return true;
    if (u.role === 'manager') return c.managerId === u.id || c.managerId === null;
    if (u.role === 'customer') return u.companyId === c.id && c.status === 'approved';
    return false;
  }
  function canViewRequest(u, r) { return canViewCompany(u, company(r.companyId)); }
  function owner(u, r) { var c = company(r.companyId); return u.status === 'approved' && (u.role === 'admin' || (u.role === 'manager' && c.managerId === u.id)); }
  function staffOf(cid) { var c = company(cid); return c.managerId ? [c.managerId] : D.users.filter(function (x) { return x.role === 'manager'; }).map(function (x) { return x.id; }); }
  function customersOf(cid) { return D.users.filter(function (x) { return x.role === 'customer' && x.companyId === cid && x.status === 'approved'; }).map(function (x) { return x.id; }); }
  function notify(ids, requestId, text, once) {
    ids.forEach(function (id) {
      if (once && D.notes.some(function (n) { return n.userId === id && n.requestId === requestId && n.text === text && !n.read; })) return;
      D.notes.push({ id: ++D.seq.note, userId: id, requestId: requestId, text: text, createdAt: now(), read: false });
    });
  }
  function hist(r, u, text) { D.hist.push({ id: ++D.seq.hist, requestId: r.id, text: u.name + ' ' + text, at: now() }); }

  // ---------- представление (как в API) ----------
  function presentItem(i, staff, prices) {
    var sku = i.skuId ? byId(D.catalog, i.skuId) : null;
    var x = { id: i.id, name: i.name, skuName: sku ? sku.name : null, qty: i.qty, unit: i.unit, note: i.note || null, url: i.url, store: i.store };
    if (prices) { x.price = i.price; x.total = i.price === null ? null : Math.round(i.price * i.qty * 100) / 100; }
    if (staff) { x.storeCode = i.code; x.matchState = i.skuId ? 'found' : 'none'; x.skuId = i.skuId; x.picked = false; x.shipped = i.shipped; }
    return x;
  }
  function presentRequest(u, r) {
    var c = company(r.companyId), staff = u.role !== 'customer', prices = staff || PRICE_ST.indexOf(r.status) >= 0;
    var items = D.items.filter(function (i) { return i.requestId === r.id; });
    var o = r.objectId ? byId(D.objects, r.objectId) : null;
    var out = {
      id: r.id, status: r.status, companyId: c.id, companyName: c.name, managerId: c.managerId, changeComment: r.change, vatInvoice: r.vat,
      createdAt: r.createdAt, updatedAt: r.updatedAt, object: o, items: items.map(function (i) { return presentItem(i, staff, prices); }),
      shipments: D.ships.filter(function (s) { return s.requestId === r.id; }).map(function (s) { return { number: s.number, at: s.at, itemIds: s.itemIds }; }),
      history: D.hist.filter(function (h) { return h.requestId === r.id; }).map(function (h) { return { text: h.text, at: h.at }; }),
    };
    if (staff) out.msOrder = r.msOrder;
    if (prices) out.total = Math.round(items.reduce(function (s, i) { return s + (i.price || 0) * i.qty; }, 0) * 100) / 100;
    return out;
  }
  function presentMsg(m, uid) {
    var a = m.att ? byId(D.atts, m.att) : null, rp = m.replyTo ? byId(D.messages, m.replyTo) : null, del = !!m.deletedAt;
    var rx = {};
    D.reacts.filter(function (x) { return x.messageId === m.id; }).forEach(function (x) { var e = rx[x.emoji] || (rx[x.emoji] = { emoji: x.emoji, count: 0, mine: false }); e.count++; if (x.userId === uid) e.mine = true; });
    var reads = D.reads.filter(function (x) { return x.requestId === m.requestId && x.userId !== m.authorId && x.last >= m.id; });
    var au = user(m.authorId), ra = rp ? byId(D.atts, rp.att) : null;
    return {
      id: m.id, authorId: m.authorId, authorName: au.name, authorRole: au.role, text: del ? '' : m.text, createdAt: m.createdAt, editedAt: del ? null : m.editedAt,
      deleted: del, mine: m.authorId === uid, read: m.authorId === uid && reads.length > 0,
      replyTo: !del && rp ? { id: rp.id, authorName: user(rp.authorId).name, text: rp.deletedAt ? '' : rp.text, kind: rp.deletedAt || !ra ? null : ra.kind, deleted: !!rp.deletedAt } : null,
      attachment: !del && a ? { id: a.id, kind: a.kind, mime: a.mime, name: a.name, size: a.size, durationMs: a.durationMs } : null,
      reactions: del ? [] : Object.keys(rx).map(function (k) { return rx[k]; }),
    };
  }

  // ---------- маршруты ----------
  function E(status, error, extra) { var e = new Error(error); e.status = status; e.body = Object.assign({ error: error }, extra || {}); return e; }
  function me(token) { var id = D.sessions[token]; var u = id && user(id); if (!u || u.status === 'blocked') throw E(401, 'unauthorized'); return u; }
  function normPhone(raw) { var d = String(raw || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); else if (d.length === 10) d = '7' + d; return '+' + d; }
  function session(u) { var token = 'demo-' + Math.random().toString(36).slice(2); D.sessions[token] = u.id; return { token: token, user: { id: u.id, name: u.name, role: u.role, status: u.status, companyId: u.companyId } }; }
  // Быстрый вход в демо: за существующего человека — сразу, за нового — экран регистрации с подставленным номером.
  window.SK_DEMO.login = function (phone) {
    var u = D.users.filter(function (x) { return x.phone === phone; })[0];
    if (!u) { if (window.logoutLocal) logoutLocal(); S.login = { step: 'register', phone: phone }; return viewLogin('register', { phone: phone }); }
    var r = session(u); save(); loggedIn(r);
  };
  function chatReq(u, id) { var r = byId(D.requests, Number(id)); if (!r || !canViewRequest(u, r) || u.role === 'picker') throw E(404, 'not_found'); return r; }

  var routes = [
    ['POST', /^\/auth\/login$/, function (q) {
      var u = D.users.filter(function (x) { return x.phone === normPhone(q.body.phone); })[0];
      if (!u || (u.pw || DEMO_PASSWORD) !== q.body.password) throw E(401, 'invalid_credentials');
      return session(u);
    }, true],
    ['POST', /^\/auth\/register$/, function (q) {
      var phone = normPhone(q.body.phone); if (phone.length < 12) throw E(400, 'bad_phone');
      if ((q.body.password || '').length < 6) throw E(400, 'bad_password');
      if (D.users.some(function (x) { return x.phone === phone; })) throw E(409, 'phone_taken');
      var c = { id: ++D.seq.company, name: q.body.company.trim(), status: 'pending', managerId: null, ms: null, vat: false };
      D.companies.push(c);
      var u = { id: ++D.seq.user, name: q.body.name.trim(), role: 'customer', phone: phone, status: 'pending', companyId: c.id, sms: true, pw: q.body.password };
      D.users.push(u);
      return session(u);
    }, true],
    ['POST', /^\/auth\/reset$/, function (q) {
      var phone = normPhone(q.body.phone), u = D.users.filter(function (x) { return x.phone === phone; })[0];
      if (!u || D.codes[phone] !== q.body.code) throw E(401, 'invalid_code');
      delete D.codes[phone]; u.pw = q.body.password; return session(u);
    }, true],
    ['POST', /^\/users\/(\d+)\/reset-code$/, function (q, u, m) {
      var t = user(Number(m[1])), c = t && t.companyId ? company(t.companyId) : null;
      if (!t || !(u.role === 'admin' || (u.role === 'manager' && t.role === 'customer' && c && c.managerId === u.id))) throw E(404, 'not_found');
      var code = String(Math.floor(100000 + Math.random() * 900000)); D.codes[t.phone] = code;
      return { code: code, phone: t.phone, name: t.name, expiresAt: now(-1440) };
    }],
    ['POST', /^\/me\/password$/, function (q, u) { if ((u.pw || DEMO_PASSWORD) !== q.body.oldPassword) throw E(401, 'invalid_credentials'); u.pw = q.body.newPassword; return { ok: true }; }],
    ['GET', /^\/companies\/(\d+)\/users$/, function (q, u, m) {
      var c = company(Number(m[1])); if (!c || !canViewCompany(u, c)) throw E(404, 'not_found'); if (!(u.role === 'admin' || c.managerId === u.id)) throw E(403, 'forbidden');
      return D.users.filter(function (x) { return x.companyId === c.id; }).map(function (x) { return { id: x.id, name: x.name, phone: x.phone, status: x.status }; });
    }],
    ['GET', /^\/staff$/, function (q, u) { if (u.role !== 'admin') throw E(403, 'forbidden'); return D.users.filter(function (x) { return x.role !== 'customer'; }).map(function (x) { return { id: x.id, name: x.name, phone: x.phone, role: x.role, hasPassword: true }; }); }],
    ['GET', /^\/me$/, function (q, u) { return { id: u.id, name: u.name, role: u.role, status: u.status, companyId: u.companyId, unreadNotifications: D.notes.filter(function (n) { return n.userId === u.id && !n.read; }).length, smsEnabled: u.sms, smsAvailable: false }; }],
    ['PATCH', /^\/me$/, function (q, u) { u.sms = !!q.body.smsEnabled; return { smsEnabled: u.sms }; }],
    ['POST', /^\/auth\/logout$/, function (q) { delete D.sessions[q.token]; return null; }],
    ['GET', /^\/notifications$/, function (q, u) { return D.notes.filter(function (n) { return n.userId === u.id; }).sort(function (a, b) { return b.id - a.id; }).slice(0, 100).map(function (n) { return { id: n.id, requestId: n.requestId, text: n.text, createdAt: n.createdAt, read: n.read }; }); }],
    ['POST', /^\/notifications\/read-all$/, function (q, u) { var k = 0; D.notes.forEach(function (n) { if (n.userId === u.id && !n.read) { n.read = true; k++; } }); return { marked: k }; }],
    ['POST', /^\/notifications\/(\d+)\/read$/, function (q, u, m) { var n = byId(D.notes, Number(m[1])); if (!n || n.userId !== u.id) throw E(404, 'not_found'); n.read = true; return { ok: true }; }],
    ['GET', /^\/objects$/, function (q, u) { if (u.role !== 'customer') throw E(403, 'forbidden'); return D.objects.filter(function (o) { return o.companyId === u.companyId; }).slice().reverse(); }],
    ['GET', /^\/catalog$/, function (q, u) {
      if (u.role !== 'manager' && u.role !== 'admin') throw E(403, 'forbidden');
      var t = (q.query.get('q') || '').toLowerCase();
      return D.catalog.filter(function (c) { return c.name.toLowerCase().indexOf(t) >= 0; }).slice(0, 30).map(function (c) { return { id: c.id, store: c.store, storeCode: c.code, name: c.name, price: c.price, stock: c.id % 4 === 0 ? 0 : (c.id * 7) % 40 + 2 }; });
    }],
    ['GET', /^\/requests$/, function (q, u) {
      if (u.status !== 'approved') throw E(403, 'forbidden');
      return D.requests.filter(function (r) { return canViewRequest(u, r); }).sort(function (a, b) { return b.updatedAt < a.updatedAt ? -1 : 1; }).map(function (r) {
        var c = company(r.companyId);
        return { id: r.id, status: r.status, companyId: c.id, companyName: c.name, managerId: c.managerId, itemsCount: D.items.filter(function (i) { return i.requestId === r.id; }).length, createdAt: r.createdAt, updatedAt: r.updatedAt };
      });
    }],
    ['POST', /^\/requests$/, function (q, u) {
      if (u.role !== 'customer' || u.status !== 'approved') throw E(403, 'forbidden');
      var b = q.body, objId = b.objectId || null;
      if (!objId) {
        var o = b.object || {}, need = ['street', 'house', 'floor', 'apt', 'lift', 'resp', 'respPhone', 'parking', 'pass'];
        var miss = need.filter(function (k) { return !(o[k] || '').trim(); });
        if (miss.length) throw E(422, 'object_incomplete', { fields: miss });
        if (['грузовой', 'пассажирский', 'нет'].indexOf(o.lift) < 0) throw E(422, 'bad_lift');
        objId = ++D.seq.object; D.objects.push(Object.assign({ id: objId, companyId: u.companyId }, o));
      }
      var c = company(u.companyId), r = { id: ++D.seq.request, companyId: u.companyId, createdBy: u.id, objectId: objId, status: 'new', createdAt: now(), updatedAt: now(), change: null, vat: c.vat, msOrder: null };
      D.requests.push(r);
      b.items.forEach(function (it) {
        var sku = it.store && it.code ? D.catalog.filter(function (x) { return x.store === it.store && x.code === it.code; })[0] : null;
        D.items.push({ id: ++D.seq.item, requestId: r.id, name: it.name, qty: it.qty, unit: it.unit || 'шт', url: it.url || null, store: it.store || null, code: it.code || null, note: it.note || null, skuId: sku ? sku.id : null, price: sku ? sku.price : null, shipped: false });
      });
      hist(r, u, 'создал(а) заявку'); notify(staffOf(r.companyId), r.id, 'Новая заявка №' + r.id);
      return { id: r.id };
    }],
    ['GET', /^\/requests\/(\d+)$/, function (q, u, m) { var r = byId(D.requests, Number(m[1])); if (!r || !canViewRequest(u, r)) throw E(404, 'not_found'); return presentRequest(u, r); }],
    ['PATCH', /^\/requests\/(\d+)$/, function (q, u, m) {
      var r = byId(D.requests, Number(m[1])); if (!r || !canViewRequest(u, r)) throw E(404, 'not_found');
      if (!owner(u, r)) throw E(403, 'forbidden');
      if (['new', 'work', 'confirm'].indexOf(r.status) < 0) throw E(409, 'order_created');
      if (r.vat !== q.body.vatInvoice) { r.vat = q.body.vatInvoice; hist(r, u, (r.vat ? 'включил(а)' : 'выключил(а)') + ' счёт с НДС'); }
      return { ok: true, vatInvoice: r.vat };
    }],
    ['POST', /^\/requests\/(\d+)\/status$/, function (q, u, m) {
      var r = byId(D.requests, Number(m[1])); if (!r || !canViewRequest(u, r)) throw E(404, 'not_found');
      var to = q.body.to, comment = (q.body.comment || '').trim();
      var t = TRANS.filter(function (x) { return x[0] === r.status && x[1] === to; })[0];
      if (!t) throw E(409, 'invalid_transition');
      if (t[2].indexOf(u.role) < 0 || (u.role === 'manager' && company(r.companyId).managerId !== u.id)) throw E(403, 'forbidden');
      if (to === 'new' && !comment) throw E(422, 'comment_required');
      var items = D.items.filter(function (i) { return i.requestId === r.id; });
      if (to === 'confirm' && items.some(function (i) { return !i.skuId || !i.price; })) throw E(409, 'unpriced_items');
      if (to === 'confirm' && !company(r.companyId).ms) throw E(409, 'no_counterparty');
      if (to === 'assembly') r.msOrder = '0' + (++D.seq.ship); // в настоящем приложении — заказ в МойСклад
      r.status = to; r.updatedAt = now(); r.change = to === 'new' ? comment : to === 'work' ? null : r.change;
      hist(r, u, LABEL[to] + (comment ? ': ' + comment : ''));
      var cust = customersOf(r.companyId).filter(function (x) { return x !== u.id; }), staff = staffOf(r.companyId).filter(function (x) { return x !== u.id; });
      if (to === 'confirm') notify(cust, r.id, 'Заявка №' + r.id + ' ждёт вашего подтверждения');
      if (to === 'assembly') notify(u.role === 'customer' ? staff : cust, r.id, u.role === 'customer' ? 'Заказчик подтвердил заявку №' + r.id + ', она передана на сборку' : 'Заявка №' + r.id + ' подтверждена и передана на сборку');
      if (to === 'new') notify(staff, r.id, 'Заказчик просит изменить заявку №' + r.id + ': ' + comment);
      if (to === 'cancelled') notify(u.role === 'customer' ? staff : cust, r.id, 'Заявка №' + r.id + ' отменена');
      return { ok: true };
    }],
    ['PATCH', /^\/requests\/(\d+)\/items\/(\d+)$/, function (q, u, m) {
      var r = byId(D.requests, Number(m[1])); if (!r || !canViewRequest(u, r)) throw E(404, 'not_found');
      if (!owner(u, r)) throw E(403, 'forbidden');
      if (r.status !== 'work') throw E(409, 'not_in_work');
      var it = D.items.filter(function (i) { return i.id === Number(m[2]) && i.requestId === r.id; })[0]; if (!it) throw E(404, 'not_found');
      if (q.body.skuId !== undefined) { var c = byId(D.catalog, q.body.skuId); if (!c) throw E(422, 'sku_not_found'); it.skuId = c.id; it.price = c.price; }
      if (q.body.price !== undefined) { if (!it.skuId) throw E(409, 'not_matched'); it.price = q.body.price; }
      r.updatedAt = now(); return { ok: true };
    }],
    ['POST', /^\/requests\/(\d+)\/ship$/, function (q, u, m) {
      var r = byId(D.requests, Number(m[1])); if (!r || !canViewRequest(u, r)) throw E(404, 'not_found');
      if (!owner(u, r)) throw E(403, 'forbidden');
      if (r.status !== 'assembly' && r.status !== 'partial') throw E(409, 'invalid_transition');
      var left = D.items.filter(function (i) { return i.requestId === r.id && !i.shipped; });
      var ids = q.body && q.body.itemIds ? q.body.itemIds : left.map(function (i) { return i.id; });
      if (!ids.length) throw E(409, 'nothing_to_ship');
      left.forEach(function (i) { if (ids.indexOf(i.id) >= 0) i.shipped = true; });
      var remaining = left.length - ids.length, number = '0' + (++D.seq.ship);
      D.ships.push({ id: D.ships.length + 1, requestId: r.id, number: number, itemIds: ids, at: now() });
      r.status = remaining ? 'partial' : 'shipped'; r.updatedAt = now();
      hist(r, u, 'отгрузил(а) ' + ids.length + ' поз. (' + number + ')' + (remaining ? ', осталось ' + remaining : ''));
      notify(customersOf(r.companyId), r.id, remaining ? 'По заявке №' + r.id + ' отгружена часть заказа' : 'Заявка №' + r.id + ' отгружена');
      return { shipment: number, status: r.status, shipped: ids.length, remaining: remaining };
    }],
    ['GET', /^\/companies$/, function (q, u) {
      if (u.role !== 'manager' && u.role !== 'admin') throw E(403, 'forbidden');
      return D.companies.filter(function (c) { return u.role === 'admin' || c.managerId === u.id || c.managerId === null; }).slice().reverse().map(function (c) {
        var mg = c.managerId ? user(c.managerId) : null;
        return { id: c.id, name: c.name, status: c.status, managerId: c.managerId, managerName: mg ? mg.name : null, showPricesEarly: false, msCounterpartyId: c.ms, vatInvoice: c.vat };
      });
    }],
    ['POST', /^\/companies\/(\d+)\/claim$/, function (q, u, m) { var c = company(Number(m[1])); if (!c || !canViewCompany(u, c)) throw E(404, 'not_found'); if (c.managerId) throw E(409, 'already_assigned'); if (u.role !== 'manager') throw E(403, 'forbidden'); c.managerId = u.id; return { ok: true }; }],
    ['POST', /^\/companies\/(\d+)\/approve$/, function (q, u, m) {
      var c = company(Number(m[1])); if (!c || !canViewCompany(u, c)) throw E(404, 'not_found');
      if (!(u.role === 'admin' || c.managerId === u.id)) throw E(403, 'forbidden');
      c.status = 'approved'; var ids = [];
      D.users.forEach(function (x) { if (x.companyId === c.id && x.status === 'pending') { x.status = 'approved'; ids.push(x.id); } });
      notify(ids, null, 'Ваша компания подтверждена, можно создавать заявки'); return { ok: true };
    }],
    ['PATCH', /^\/companies\/(\d+)$/, function (q, u, m) { var c = company(Number(m[1])); if (!c || !canViewCompany(u, c)) throw E(404, 'not_found'); if (!(u.role === 'admin' || c.managerId === u.id)) throw E(403, 'forbidden'); c.vat = !!q.body.vatInvoice; return { ok: true, vatInvoice: c.vat }; }],
    ['GET', /^\/ms\/counterparties$/, function (q, u) {
      if (u.role !== 'manager' && u.role !== 'admin') throw E(403, 'forbidden');
      var t = (q.query.get('q') || '').trim(); if (t.length < 2) return [];
      return [{ id: 'demo-ms-' + t.length + '1', name: 'ООО «' + t + '»' }, { id: 'demo-ms-' + t.length + '2', name: 'ИП ' + t }];
    }],
    ['POST', /^\/companies\/(\d+)\/ms-counterparty$/, function (q, u, m) {
      var c = company(Number(m[1])); if (!c || !canViewCompany(u, c)) throw E(404, 'not_found'); if (!(u.role === 'admin' || c.managerId === u.id)) throw E(403, 'forbidden');
      c.ms = q.body.msId; return { ok: true, counterparty: { id: q.body.msId, name: 'контрагент из МойСклад' } };
    }],
    ['GET', /^\/staff\/managers$/, function (q, u) { if (u.role !== 'admin') throw E(403, 'forbidden'); return D.users.filter(function (x) { return x.role === 'manager'; }).map(function (x) { return { id: x.id, name: x.name }; }); }],
    ['POST', /^\/companies\/(\d+)\/reassign$/, function (q, u, m) { if (u.role !== 'admin') throw E(403, 'forbidden'); var c = company(Number(m[1])); if (!c) throw E(404, 'not_found'); c.managerId = q.body.managerId; return { ok: true }; }],
    // переписка
    ['GET', /^\/requests\/(\d+)\/messages$/, function (q, u, m) {
      var r = chatReq(u, m[1]), list = D.messages.filter(function (x) { return x.requestId === r.id; });
      var last = list.length ? list[list.length - 1].id : 0, rd = D.reads.filter(function (x) { return x.requestId === r.id && x.userId === u.id; })[0];
      if (last) { if (rd) rd.last = Math.max(rd.last, last); else D.reads.push({ requestId: r.id, userId: u.id, last: last }); }
      return list.map(function (x) { return presentMsg(x, u.id); });
    }],
    ['POST', /^\/requests\/(\d+)\/messages$/, function (q, u, m) {
      var r = chatReq(u, m[1]), text = (q.body.text || '').trim();
      if (!text && !q.body.attachmentId) throw E(422, 'empty');
      var msg = { id: ++D.seq.msg, requestId: r.id, authorId: u.id, text: text, createdAt: now(), editedAt: null, deletedAt: null, replyTo: q.body.replyToId || null, att: q.body.attachmentId || null };
      D.messages.push(msg);
      var rd = D.reads.filter(function (x) { return x.requestId === r.id && x.userId === u.id; })[0]; if (rd) rd.last = msg.id; else D.reads.push({ requestId: r.id, userId: u.id, last: msg.id });
      notify((u.role === 'customer' ? staffOf(r.companyId) : customersOf(r.companyId)).filter(function (x) { return x !== u.id; }), r.id, 'Новое сообщение по заявке №' + r.id, true);
      return presentMsg(msg, u.id);
    }],
    ['PATCH', /^\/requests\/(\d+)\/messages\/(\d+)$/, function (q, u, m) {
      chatReq(u, m[1]); var x = byId(D.messages, Number(m[2])); if (!x || x.deletedAt) throw E(404, 'not_found'); if (x.authorId !== u.id) throw E(403, 'forbidden');
      x.text = (q.body.text || '').trim(); x.editedAt = now(); return presentMsg(x, u.id);
    }],
    ['DELETE', /^\/requests\/(\d+)\/messages\/(\d+)$/, function (q, u, m) {
      chatReq(u, m[1]); var x = byId(D.messages, Number(m[2])); if (!x || x.deletedAt) throw E(404, 'not_found'); if (x.authorId !== u.id && u.role !== 'admin') throw E(403, 'forbidden');
      x.deletedAt = now(); x.text = ''; if (x.att) { delete blobs[x.att]; x.att = null; } D.reacts = D.reacts.filter(function (y) { return y.messageId !== x.id; }); return { ok: true };
    }],
    ['POST', /^\/requests\/(\d+)\/messages\/(\d+)\/reaction$/, function (q, u, m) {
      chatReq(u, m[1]); var x = byId(D.messages, Number(m[2])); if (!x || x.deletedAt) throw E(404, 'not_found');
      if (q.body.emoji !== null && REACTIONS.indexOf(q.body.emoji) < 0) throw E(400, 'bad_emoji');
      D.reacts = D.reacts.filter(function (y) { return !(y.messageId === x.id && y.userId === u.id); });
      if (q.body.emoji) D.reacts.push({ messageId: x.id, userId: u.id, emoji: q.body.emoji });
      return presentMsg(x, u.id);
    }],
  ];

  function handleUpload(path, init, u) {
    var m = path.match(/^\/requests\/(\d+)\/attachments$/), r = chatReq(u, m[1]);
    var q = new URLSearchParams(init.url.split('?')[1] || ''), headers = init.headers || {};
    var mime = String(headers['X-File-Type'] || headers['x-file-type'] || 'application/octet-stream').toLowerCase();
    var blob = init.body;
    if (blob.size > 25 * 1024 * 1024) throw E(413, 'too_large');
    var kind = q.get('kind') === 'voice' && mime.indexOf('audio/') === 0 ? 'voice' : mime.indexOf('image/') === 0 ? 'photo' : mime.indexOf('video/') === 0 ? 'video' : 'file';
    var a = { id: ++D.seq.att, requestId: r.id, uploader: u.id, kind: kind, mime: mime, name: q.get('name') || 'файл', size: blob.size, durationMs: Number(q.get('duration')) || null };
    D.atts.push(a); blobs[a.id] = blob;
    return { id: a.id, kind: kind, mime: mime, name: a.name, size: blob.size };
  }
  function attachment(id, u) {
    var a = byId(D.atts, id); if (!a) throw E(404, 'not_found'); chatReq(u, a.requestId);
    if (!blobs[id] && a.gen === 'voice') blobs[id] = genVoice();
    if (!blobs[id]) throw E(404, 'not_found'); // после перезагрузки страницы вложения не сохраняются
    return blobs[id];
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : input.url;
    if (!/^\//.test(url)) return realFetch(input, init);
    var method = (init.method || 'GET').toUpperCase(), path = url.split('?')[0], query = new URLSearchParams(url.split('?')[1] || '');
    var token = ((init.headers && (init.headers.Authorization || init.headers.authorization)) || '').replace(/^Bearer /, '');
    return new Promise(function (resolve) { setTimeout(resolve, 90 + Math.random() * 120); }).then(function () {
      try {
        if (method === 'POST' && /\/attachments$/.test(path)) { var up = handleUpload(path, Object.assign({ url: url }, init), me(token)); save(); return Response.json(up, { status: 201 }); }
        var am = path.match(/^\/attachments\/(\d+)$/);
        if (am) return new Response(attachment(Number(am[1]), me(token)));
        for (var i = 0; i < routes.length; i++) {
          var rt = routes[i], mm = method === rt[0] && path.match(rt[1]);
          if (!mm) continue;
          var body = init.body ? JSON.parse(init.body) : {};
          var u = rt[3] ? null : me(token);
          var out = rt[2]({ body: body || {}, query: query, token: token }, u, mm);
          if (method !== 'GET') save();
          if (out === null) return new Response(null, { status: 204 });
          return Response.json(out, { status: method === 'POST' && (/\/requests$/.test(path) || /\/messages$/.test(path)) ? 201 : 200 });
        }
        throw E(404, 'not_found');
      } catch (e) {
        if (!e.status) { console.error(e); return Response.json({ error: 'internal' }, { status: 500 }); }
        return Response.json(e.body, { status: e.status });
      }
    });
  };
})();

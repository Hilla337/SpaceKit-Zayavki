import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { loginAs, nextIp, register, TEST_PASSWORD } from './auth-helper.js';
import { createTestDb } from './db-helper.js';

let now = new Date('2026-12-01T10:00:00Z');
let db: Db;
let app: FastifyInstance;

const PH = { phil: '+79990000001', tanya: '+79990000002', admin: '+79990000009', picker: '+79990000008', ann: '+79991110001', bob: '+79991110002' };

const objectOk = { street: 'Нижние Мнёвники', house: '7', floor: '3', apt: '1058', lift: 'грузовой', resp: 'Артур', respPhone: '+7 968 996-03-33', parking: 'есть', pass: 'нужен' };

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, pepper: 'test', clock: () => now, trustProxy: 1 });
  // Менеджеры 1 (Филипп) и 2 (Татьяна) уже есть из миграции; даём им телефоны, добавляем админа и сборщика.
  await db.query(`UPDATE users SET phone = $1 WHERE name = 'Филипп Инилеев'`, [PH.phil]);
  await db.query(`UPDATE users SET phone = $1 WHERE name = 'Татьяна Чех'`, [PH.tanya]);
  await db.query(`INSERT INTO users (phone, name, role, status) VALUES ($1, 'Админ', 'admin', 'approved'), ($2, 'Сборщик', 'picker', 'approved')`, [PH.admin, PH.picker]);
  await db.query(`INSERT INTO catalog (ms_id, store, store_code, name, price) VALUES ('ms1', 'Петрович', '100101', 'Ротбанд 30 кг', 450), ('ms2', '', NULL, 'Грунтовка 10 л', 700)`);
});
after(async () => { await app.close(); await db.close(); });

const login = (phone: string): Promise<string> => loginAs(app, db, phone);
const tryLogin = (phone: string, password: string, ip = nextIp()) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password }, headers: { 'x-forwarded-for': ip } });
const reset = (phone: string, code: string, password: string) =>
  app.inject({ method: 'POST', url: '/auth/reset', payload: { phone, code, password }, headers: { 'x-forwarded-for': nextIp() } });
const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });

let phil: string, tanya: string, admin: string, picker: string, ann: string, bob: string;
let annCompany: number, bobCompany: number;

test('регистрация по телефону и паролю создаёт отдельную компанию в ожидании; второй раз тот же номер не зарегистрировать', async () => {
  phil = await login(PH.phil);
  tanya = await login(PH.tanya);
  admin = await login(PH.admin);
  picker = await login(PH.picker);

  assert.equal((await register(app, PH.ann, 'Анна', 'Ремонт плюс', '123')).statusCode, 400, 'короткий пароль');
  const ok = await register(app, '8 (999) 111-00-01', 'Анна', 'Ремонт плюс');
  assert.equal(ok.statusCode, 201, ok.body);
  ann = ok.json().token;
  assert.equal(ok.json().user.status, 'pending');
  assert.equal((await register(app, PH.ann, 'Не Анна', 'Другая')).json().error, 'phone_taken');
  // Пароль хранится только хэшем.
  const h = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE phone = $1', [PH.ann])).rows[0]!.password_hash;
  assert.match(h, /^scrypt\$/);
  assert.ok(!h.includes(TEST_PASSWORD));

  // Тоже «Ремонт плюс», но другой человек: получает свою отдельную компанию, а не чужую.
  const b = await register(app, PH.bob, 'Борис', 'Ремонт плюс');
  bob = b.json().token;
  annCompany = (await call(ann, 'GET', '/me')).json().companyId;
  bobCompany = (await call(bob, 'GET', '/me')).json().companyId;
  assert.notEqual(annCompany, bobCompany);
});

test('вход: верный пароль пускает, неверный и чужой номер отвечают одинаково; у сотрудника без пароля входа нет', async () => {
  assert.equal((await tryLogin(PH.ann, TEST_PASSWORD)).statusCode, 200);
  const wrong = await tryLogin(PH.ann, 'не тот');
  const nobody = await tryLogin('+79990001234', 'не тот');
  assert.deepEqual([wrong.statusCode, wrong.json().error], [401, 'invalid_credentials']);
  assert.deepEqual([nobody.statusCode, nobody.json().error], [401, 'invalid_credentials']);
  await db.query(`INSERT INTO users (phone, name, role, status) VALUES ('+79990007777', 'Новый менеджер', 'manager', 'approved')`);
  assert.equal((await tryLogin('+79990007777', '')).statusCode, 401, 'пароль не задан — войти нельзя');
});

test('после 10 неверных паролей номер закрыт на 15 минут, потом снова можно', async () => {
  const phone = '+79995550000';
  assert.equal((await register(app, phone, 'X', 'Y')).statusCode, 201);
  for (let i = 0; i < 10; i++) assert.equal((await tryLogin(phone, 'неверный')).statusCode, 401);
  const locked = await tryLogin(phone, TEST_PASSWORD);
  assert.deepEqual([locked.statusCode, locked.json().error], [429, 'locked'], 'даже верный пароль не помогает');
  now = new Date(now.getTime() + 16 * 60_000);
  assert.equal((await tryLogin(phone, TEST_PASSWORD)).statusCode, 200);
});

test('с одного IP не больше 30 попыток за 15 минут; подделанный заголовок лимит не обходит', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 31; i++) statuses.push((await tryLogin(`+7999888${String(i).padStart(4, '0')}`, 'x', '203.0.113.7')).statusCode);
  assert.deepEqual(statuses, [...Array(30).fill(401), 429]);
  // Клиент дописывает в заголовок чужой адрес, но доверяем только ближайшему прокси, поэтому счёт идёт по настоящему.
  const spoof = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone: PH.ann, password: TEST_PASSWORD }, headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' } });
  assert.equal(spoof.statusCode, 429);
});

test('сброс пароля: код выдаёт менеджер своего клиента или админ; код одноразовый, живёт сутки, 5 попыток', async () => {
  // Компания Анны пока ничья: Филипп её не ведёт и код выдать не может.
  const annId = (await call(ann, 'GET', '/me')).json().id as number;
  assert.equal((await call(phil, 'POST', `/users/${annId}/reset-code`)).statusCode, 404);
  assert.equal((await call(ann, 'POST', `/users/${annId}/reset-code`)).statusCode, 404, 'заказчик сам себе код не выдаёт');
  const issued = await call(admin, 'POST', `/users/${annId}/reset-code`);
  assert.equal(issued.statusCode, 200, issued.body);
  const { code } = issued.json();
  assert.match(code, /^\d{6}$/);

  const wrongCode = code === '000000' ? '111111' : '000000';
  assert.equal((await reset(PH.ann, wrongCode, 'новый-пароль')).statusCode, 401);
  const ok = await reset(PH.ann, code, 'новый-пароль');
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await call(ann, 'GET', '/me')).statusCode, 401, 'старые входы закрыты после смены пароля');
  ann = ok.json().token;
  assert.equal((await reset(PH.ann, code, 'ещё-один')).statusCode, 401, 'код одноразовый');
  assert.equal((await tryLogin(PH.ann, 'новый-пароль')).statusCode, 200);

  // Сотрудник без пароля: админ выдаёт код, сотрудник задаёт пароль сам.
  const mgrId = (await db.query<{ id: number }>(`SELECT id FROM users WHERE phone = '+79990007777'`)).rows[0]!.id;
  const c2 = (await call(admin, 'POST', `/users/${mgrId}/reset-code`)).json().code;
  assert.equal((await call(phil, 'POST', `/users/${mgrId}/reset-code`)).statusCode, 404, 'менеджер не выдаёт коды сотрудникам');
  assert.equal((await reset('+79990007777', c2, 'пароль-менеджера')).statusCode, 200);

  // Попытки и срок жизни.
  const c3 = (await call(admin, 'POST', `/users/${annId}/reset-code`)).json().code as string;
  const bad3 = c3 === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await reset(PH.ann, bad3, 'x-пароль');
  assert.equal((await reset(PH.ann, c3, 'x-пароль')).statusCode, 429, 'после 5 ошибок код сгорел');
  const c4 = (await call(admin, 'POST', `/users/${annId}/reset-code`)).json().code as string;
  now = new Date(now.getTime() + 25 * 3600_000);
  assert.equal((await reset(PH.ann, c4, 'x-пароль')).statusCode, 401, 'через сутки код недействителен');
});

test('смена своего пароля: нужен старый, остальные устройства разлогиниваются', async () => {
  const other = await loginAs(app, db, PH.tanya);
  assert.equal((await call(tanya, 'POST', '/me/password', { oldPassword: 'не тот', newPassword: 'новый-123' })).statusCode, 401);
  assert.equal((await call(tanya, 'POST', '/me/password', { oldPassword: TEST_PASSWORD, newPassword: 'новый-123' })).statusCode, 200);
  assert.equal((await call(tanya, 'GET', '/me')).statusCode, 200, 'текущая сессия осталась');
  assert.equal((await call(other, 'GET', '/me')).statusCode, 401, 'другое устройство разлогинено');
  assert.equal((await tryLogin(PH.tanya, 'новый-123')).statusCode, 200);
});

test('без токена и с чужим токеном доступа нет', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/requests' })).statusCode, 401);
  assert.equal((await call('bogus', 'GET', '/requests')).statusCode, 401);
});

test('неподтверждённый заказчик не может создавать заявки', async () => {
  const r = await call(ann, 'POST', '/requests', { object: objectOk, items: [{ name: 'Ротбанд', qty: 1 }] });
  assert.equal(r.statusCode, 403);
});

test('менеджеры видят нераспределённых клиентов; взять клиента может один, второй получает отказ', async () => {
  const list = (await call(phil, 'GET', '/companies')).json();
  assert.ok(list.some((c: { id: number }) => c.id === annCompany));

  assert.equal((await call(phil, 'POST', `/companies/${annCompany}/claim`)).statusCode, 200);
  assert.equal((await call(tanya, 'POST', `/companies/${annCompany}/claim`)).statusCode, 404); // уже чужой: Татьяна его больше не видит
  assert.equal((await call(tanya, 'POST', `/companies/${bobCompany}/claim`)).statusCode, 200);

  // Татьяна не может подтвердить чужую компанию, Филипп подтверждает свою.
  assert.equal((await call(tanya, 'POST', `/companies/${annCompany}/approve`)).statusCode, 404);
  assert.equal((await call(phil, 'POST', `/companies/${annCompany}/approve`)).statusCode, 200);
  assert.equal((await call(tanya, 'POST', `/companies/${bobCompany}/approve`)).statusCode, 200);
  assert.equal((await call(ann, 'GET', '/me')).json().status, 'approved');
});

let reqId: number;

test('заказчик создаёт заявку; позиция из каталога подбирается сама; менеджер получает уведомление', async () => {
  const r = await call(ann, 'POST', '/requests', {
    object: objectOk,
    items: [
      { name: 'Ротбанд 30 кг', qty: 20, unit: 'меш', store: 'Петрович', code: '100101' },
      { name: 'Грунтовка 10 л', qty: 3 },
    ],
  });
  assert.equal(r.statusCode, 201, r.body);
  reqId = r.json().id;

  const notes = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = 1 AND request_id = $1`, [reqId]);
  assert.equal(notes.rows[0]?.n, 1);
  const tanyaNotes = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = 2 AND request_id = $1`, [reqId]);
  assert.equal(tanyaNotes.rows[0]?.n, 0); // Татьяна клиента не ведёт, ей не пишем
});

test('заявка не создаётся без обязательных полей объекта и с неверным лифтом', async () => {
  const { street: _s, ...noStreet } = objectOk;
  assert.equal((await call(ann, 'POST', '/requests', { object: noStreet, items: [{ name: 'a', qty: 1 }] })).statusCode, 422);
  assert.equal((await call(ann, 'POST', '/requests', { object: { ...objectOk, lift: 'не работает' }, items: [{ name: 'a', qty: 1 }] })).statusCode, 422);
});

test('изоляция: чужой менеджер и чужой заказчик заявку не видят и менять не могут', async () => {
  for (const t of [tanya, bob]) {
    assert.equal((await call(t, 'GET', `/requests/${reqId}`)).statusCode, 404);
    assert.equal((await call(t, 'POST', `/requests/${reqId}/status`, { to: 'work' })).statusCode, 404);
  }
  const tanyaList = (await call(tanya, 'GET', '/requests')).json();
  assert.ok(!tanyaList.some((x: { id: number }) => x.id === reqId));
  assert.equal((await call(picker, 'GET', `/requests/${reqId}`)).statusCode, 404); // сборщик видит только заявки на сборке
});

test('заказчик не видит цен до подтверждения, а на подтверждении видит', async () => {
  assert.equal((await call(phil, 'POST', `/requests/${reqId}/status`, { to: 'work' })).statusCode, 200);

  const staffView = (await call(phil, 'GET', `/requests/${reqId}`)).json();
  assert.equal(staffView.items[0].price, 450); // подобралась сама
  const customerView = (await call(ann, 'GET', `/requests/${reqId}`)).json();
  assert.equal('price' in customerView.items[0], false);
  assert.equal(customerView.total, undefined);
  assert.equal('matchState' in customerView.items[0], false);

  // Грунтовка не подобрана: отправить на подтверждение нельзя.
  const early = await call(phil, 'POST', `/requests/${reqId}/status`, { to: 'confirm' });
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().error, 'unpriced_items');

  const unmatchedId = staffView.items[1].id;
  assert.equal((await call(phil, 'PATCH', `/requests/${reqId}/items/${unmatchedId}`, { price: 700 })).statusCode, 409); // сначала подбор
  assert.equal((await call(phil, 'PATCH', `/requests/${reqId}/items/${unmatchedId}`, { skuId: 2 })).statusCode, 200);
  assert.equal((await call(tanya, 'PATCH', `/requests/${reqId}/items/${unmatchedId}`, { price: 1 })).statusCode, 404);

  assert.equal((await call(phil, 'POST', `/requests/${reqId}/status`, { to: 'confirm' })).statusCode, 200);
  const after = (await call(ann, 'GET', `/requests/${reqId}`)).json();
  assert.equal(after.items[0].price, 450);
  assert.equal(after.total, 450 * 20 + 700 * 3);
});

test('заказчик просит изменить заявку: нужен комментарий, заявка возвращается менеджеру', async () => {
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/status`, { to: 'new' })).statusCode, 422);
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/status`, { to: 'new', comment: 'Профиля нужно 80 шт' })).statusCode, 200);
  const v = (await call(phil, 'GET', `/requests/${reqId}`)).json();
  assert.equal(v.status, 'new');
  assert.equal(v.changeComment, 'Профиля нужно 80 шт');
});

test('заказчик подтверждает только на «На подтверждении», менеджер не может перепрыгнуть статусы', async () => {
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/status`, { to: 'assembly' })).statusCode, 409);
  assert.equal((await call(phil, 'POST', `/requests/${reqId}/status`, { to: 'assembly' })).statusCode, 409);
  assert.equal((await call(phil, 'POST', `/requests/${reqId}/status`, { to: 'work' })).statusCode, 200);
  assert.equal((await call(phil, 'POST', `/requests/${reqId}/status`, { to: 'confirm' })).statusCode, 200);
  assert.equal((await call(bob, 'POST', `/requests/${reqId}/status`, { to: 'assembly' })).statusCode, 404);
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/status`, { to: 'assembly' })).statusCode, 200);
});

test('после подтверждения заявку видит сборщик; отгрузка идёт отдельной операцией, а не сменой статуса', async () => {
  assert.equal((await call(picker, 'GET', `/requests/${reqId}`)).statusCode, 200);
  const r = await call(picker, 'POST', `/requests/${reqId}/status`, { to: 'shipped' });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'use_shipments');
});

test('админ переназначает клиента; заявки переходят новому менеджеру автоматически', async () => {
  assert.equal((await call(phil, 'POST', `/companies/${annCompany}/reassign`, { managerId: 2 })).statusCode, 403);
  assert.equal((await call(admin, 'POST', `/companies/${annCompany}/reassign`, { managerId: 2 })).statusCode, 200);
  assert.equal((await call(admin, 'POST', `/companies/${annCompany}/reassign`, { managerId: 30 })).statusCode, 422);

  assert.equal((await call(tanya, 'GET', `/requests/${reqId}`)).statusCode, 200);
  assert.equal((await call(phil, 'GET', `/requests/${reqId}`)).statusCode, 404);
  const hist = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM company_manager_history WHERE company_id = $1`, [annCompany]);
  assert.equal(hist.rows[0]?.n, 2);
});

test('выход закрывает сессию', async () => {
  assert.equal((await call(bob, 'POST', '/auth/logout')).statusCode, 204);
  assert.equal((await call(bob, 'GET', '/me')).statusCode, 401);
});

test('сессия истекает через 30 дней', async () => {
  now = new Date(now.getTime() + 31 * 24 * 3600_000);
  assert.equal((await call(ann, 'GET', '/me')).statusCode, 401);
});

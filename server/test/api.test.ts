import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import type { CodeSender } from '../src/sender.js';
import { createTestDb } from './db-helper.js';

const codes = new Map<string, string>();
const sender: CodeSender = { async send(phone, code) { codes.set(phone, code); } };

let now = new Date('2026-12-01T10:00:00Z');
let db: Db;
let app: FastifyInstance;

const PH = { phil: '+79990000001', tanya: '+79990000002', admin: '+79990000009', picker: '+79990000008', ann: '+79991110001', bob: '+79991110002' };

const objectOk = { street: 'Нижние Мнёвники', house: '7', floor: '3', apt: '1058', lift: 'грузовой', resp: 'Артур', respPhone: '+7 968 996-03-33', parking: 'есть', pass: 'нужен' };

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, sender, pepper: 'test', clock: () => now, trustProxy: 1 });
  // Менеджеры 1 (Филипп) и 2 (Татьяна) уже есть из миграции; даём им телефоны, добавляем админа и сборщика.
  await db.query(`UPDATE users SET phone = $1 WHERE name = 'Филипп Инилеев'`, [PH.phil]);
  await db.query(`UPDATE users SET phone = $1 WHERE name = 'Татьяна Чех'`, [PH.tanya]);
  await db.query(`INSERT INTO users (phone, name, role, status) VALUES ($1, 'Админ', 'admin', 'approved'), ($2, 'Сборщик', 'picker', 'approved')`, [PH.admin, PH.picker]);
  await db.query(`INSERT INTO catalog (ms_id, store, store_code, name, price) VALUES ('ms1', 'Петрович', '100101', 'Ротбанд 30 кг', 450), ('ms2', '', NULL, 'Грунтовка 10 л', 700)`);
});
after(async () => { await app.close(); await db.close(); });


let ipCounter = 0;
/** Запрос кода; по умолчанию каждый раз с нового IP, чтобы тесты не упирались в лимит по адресу. */
const rc = (phone: string, ip = `10.0.0.${++ipCounter}`) =>
  app.inject({ method: 'POST', url: '/auth/request-code', payload: { phone }, headers: { 'x-forwarded-for': ip } });

async function login(phone: string, profile?: { name: string; company: string }): Promise<string> {
  const sent = await rc(phone);
  assert.equal(sent.statusCode, 200, sent.body);
  const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code: codes.get(phone), ...profile } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().token as string;
}

const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });

let phil: string, tanya: string, admin: string, picker: string, ann: string, bob: string;
let annCompany: number, bobCompany: number;

test('вход по телефону: регистрация нового заказчика создаёт отдельную компанию в ожидании', async () => {
  phil = await login(PH.phil);
  tanya = await login(PH.tanya);
  admin = await login(PH.admin);
  picker = await login(PH.picker);

  // Без имени и компании новому номеру войти нельзя, а код при этом не тратится.
  await rc(PH.ann);
  const noProfile = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone: PH.ann, code: codes.get(PH.ann) } });
  assert.equal(noProfile.statusCode, 422);
  const ok = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone: PH.ann, code: codes.get(PH.ann), name: 'Анна', company: 'Ремонт плюс' } });
  assert.equal(ok.statusCode, 200);
  ann = ok.json().token;
  assert.equal(ok.json().user.status, 'pending');

  // Тоже «Ремонт плюс», но другой человек: получает свою отдельную компанию, а не чужую.
  bob = await login(PH.bob, { name: 'Борис', company: 'Ремонт плюс' });
  const a = (await call(ann, 'GET', '/me')).json();
  const b = (await call(bob, 'GET', '/me')).json();
  assert.notEqual(a.companyId, b.companyId);
  annCompany = a.companyId;
  bobCompany = b.companyId;
});

test('неверные коды: после пяти попыток код блокируется, верный код уже не подойдёт', async () => {
  const phone = '+79995550000';
  await rc(phone);
  const right = codes.get(phone)!;
  const wrong = right === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) {
    const r = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code: wrong, name: 'X', company: 'Y' } });
    assert.equal(r.statusCode, 401);
  }
  const late = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code: right, name: 'X', company: 'Y' } });
  assert.equal(late.statusCode, 429);
});

test('больше трёх кодов на номер за десять минут нельзя', async () => {
  const phone = '+79996660000';
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await rc(phone)).statusCode);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test('с одного IP не больше десяти запросов кода в час; подделанный заголовок лимит не обходит', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await rc(`+7999888${String(i).padStart(4, '0')}`, '203.0.113.7')).statusCode);
  assert.deepEqual(statuses, [...Array(10).fill(200), 429]);

  // Клиент дописывает в заголовок чужой адрес, но доверяем только ближайшему прокси, поэтому счёт идёт по настоящему.
  const spoof = await app.inject({
    method: 'POST',
    url: '/auth/request-code',
    payload: { phone: '+79998889999' },
    headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' },
  });
  assert.equal(spoof.statusCode, 429);
});

test('код живёт пять минут', async () => {
  const phone = '+79997770000';
  await rc(phone);
  const code = codes.get(phone);
  now = new Date(now.getTime() + 6 * 60_000);
  const r = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code, name: 'X', company: 'Y' } });
  assert.equal(r.statusCode, 401);
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

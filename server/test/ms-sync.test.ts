import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { syncStock, type MsDemandInfo, type MsEvents, type MsGateway } from '../src/moysklad.js';
import { handleMsEvent, webhookSecret } from '../src/ms-webhook.js';
import { loginAs } from './auth-helper.js';
import { createTestDb } from './db-helper.js';

const B = 'https://api.moysklad.ru/api/remap/1.2/entity';
let db: Db;
let app: FastifyInstance;
let phil: string, ann: string;
let company: number, annId: number;
const demands = new Map<string, MsDemandInfo>();
const states = new Map<string, string>();
const events: MsEvents = { async getDemand(id) { return demands.get(id) ?? null; }, async getOrderState(id) { return states.get(id) ?? null; } };
const call = (t: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${t}` } });
const ev = (type: string, id: string, action = 'UPDATE') => ({ meta: { type, href: `${B}/${type}/${id}` }, action });

/** Заявка на сборке с заказом в МойСклад и тремя позициями из каталога (prod-1, prod-2, prod-3). */
async function requestWithOrder(orderId: string, status = 'assembly'): Promise<number> {
  const r = (await db.query<{ id: number }>(`INSERT INTO requests (company_id, created_by, status, ms_order_id) VALUES ($1, $2, $3, $4) RETURNING id`, [company, annId, status, orderId])).rows[0]!.id;
  for (const ms of ['prod-1', 'prod-2', 'prod-3']) {
    await db.query(`INSERT INTO request_items (request_id, name, qty, match_state, sku_id, price) SELECT $1, name, 1, 'found', id, price FROM catalog WHERE ms_id = $2`, [r, ms]);
  }
  return r;
}
const status = async (id: number) => (await db.query<{ status: string }>('SELECT status FROM requests WHERE id = $1', [id])).rows[0]!.status;

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, pepper: 'pep', trustProxy: 1, msEvents: events });
  await db.query(`UPDATE users SET phone = '+79990000001' WHERE name = 'Филипп Инилеев'`);
  await db.query(`INSERT INTO catalog (ms_id, name, price) VALUES ('prod-1', 'Ротбанд 30 кг', 620), ('prod-2', 'Грунтовка 10 л', 980), ('prod-3', 'Профиль ПП 60×27', 245), ('prod-4', 'Ротбанд 5 кг', 210)`);
  company = (await db.query<{ id: number }>(`INSERT INTO companies (name, status, manager_id) VALUES ('Клиент', 'approved', 1) RETURNING id`)).rows[0]!.id;
  annId = (await db.query<{ id: number }>(`INSERT INTO users (phone, name, role, status, company_id) VALUES ('+79991110001', 'Анна', 'customer', 'approved', $1) RETURNING id`, [company])).rows[0]!.id;
  phil = await loginAs(app, db, '+79990000001'); ann = await loginAs(app, db, '+79991110001');
});
after(async () => { await app.close(); await db.close(); });

test('остатки: «доступно» по складу, отсутствующих в отчёте — 0; в поиске сначала то, что есть в наличии', async () => {
  const r = await db.tx((q) => syncStock(q, [
    { meta: { href: `${B}/product/prod-4?expand=supplier`, type: 'product' }, quantity: 12, stock: 15 },
    { meta: { href: `${B}/product/prod-2`, type: 'product' }, quantity: 3 },
    { meta: { href: `${B}/variant/v-1`, type: 'variant' }, quantity: 9 },
  ]));
  assert.equal(r.updated, 2);
  const list = (await call(phil, 'GET', '/catalog?q=Ротбанд')).json() as { name: string; stock: number }[];
  assert.deepEqual(list.map((c) => [c.name, c.stock]), [['Ротбанд 5 кг', 12], ['Ротбанд 30 кг', 0]]);
  assert.equal((await call(ann, 'GET', '/catalog?q=Ротбанд')).statusCode, 403, 'заказчику каталог и остатки не показываем');
});

test('вебхук: адрес с секретом, чужой адрес — 404; событие обрабатывается после ответа', async () => {
  const id = await requestWithOrder('ord-hook');
  demands.set('dem-hook', { id: 'dem-hook', name: '01990', applicable: true, orderId: 'ord-hook', positions: [{ productId: 'prod-1', qty: 1 }, { productId: 'prod-2', qty: 1 }, { productId: 'prod-3', qty: 1 }] });
  const bad = await app.inject({ method: 'POST', url: '/ms/webhook/неверный', payload: { events: [ev('demand', 'dem-hook', 'CREATE')] } });
  assert.equal(bad.statusCode, 404);
  const ok = await app.inject({ method: 'POST', url: `/ms/webhook/${webhookSecret('pep')}`, payload: { events: [ev('demand', 'dem-hook', 'CREATE')] } });
  assert.equal(ok.statusCode, 200);
  for (let i = 0; i < 50 && (await status(id)) !== 'shipped'; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(await status(id), 'shipped');
});

test('отгрузка из МойСклад частями: позиции отмечаются, статус меняется, заказчику уведомление; повтор и черновик ничего не меняют', async () => {
  const id = await requestWithOrder('ord-1');
  demands.set('dem-draft', { id: 'dem-draft', name: '01991', applicable: false, orderId: 'ord-1', positions: [{ productId: 'prod-1', qty: 1 }] });
  assert.equal(await handleMsEvent(db, events, ev('demand', 'dem-draft', 'CREATE')), 'not_applicable');

  demands.set('dem-1', { id: 'dem-1', name: '01992', applicable: true, orderId: 'ord-1', positions: [{ productId: 'prod-1', qty: 1 }] });
  assert.equal(await handleMsEvent(db, events, ev('demand', 'dem-1', 'CREATE')), 'partial');
  assert.equal(await handleMsEvent(db, events, ev('demand', 'dem-1', 'UPDATE')), 'duplicate');
  assert.equal(await status(id), 'partial');

  const card = (await call(phil, 'GET', `/requests/${id}`)).json();
  assert.deepEqual(card.shipments.map((s: { number: string }) => s.number), ['01992']);
  assert.equal(card.items.filter((i: { shipped: boolean }) => i.shipped).length, 1);
  assert.ok(card.history.some((h: { text: string }) => /МойСклад оформлена отгрузка 01992/.test(h.text)));
  const notes = (await call(ann, 'GET', '/notifications')).json() as { text: string }[];
  assert.ok(notes.some((n) => n.text === `По заявке №${id} отгружена часть заказа`));

  demands.set('dem-2', { id: 'dem-2', name: '01993', applicable: true, orderId: 'ord-1', positions: [{ productId: 'prod-2', qty: 1 }, { productId: 'prod-3', qty: 1 }] });
  assert.equal(await handleMsEvent(db, events, ev('demand', 'dem-2', 'CREATE')), 'shipped');
  assert.equal(await status(id), 'shipped');

  demands.set('dem-x', { id: 'dem-x', name: '01994', applicable: true, orderId: 'чужой-заказ', positions: [] });
  assert.equal(await handleMsEvent(db, events, ev('demand', 'dem-x', 'CREATE')), 'not_ours');
  demands.set('dem-y', { id: 'dem-y', name: '01995', applicable: true, orderId: 'ord-hook', positions: [{ productId: 'prod-4', qty: 1 }] });
  assert.equal(await handleMsEvent(db, events, ev('demand', 'dem-y', 'CREATE')), 'no_items', 'товара нет в заявке — только запись в истории');
});

test('статус заказа в МойСклад: смена пишется в историю один раз, «Отменен» отменяет заявку', async () => {
  const id = await requestWithOrder('ord-2');
  states.set('ord-2', 'Собран');
  assert.equal(await handleMsEvent(db, events, ev('customerorder', 'ord-2')), 'state');
  assert.equal(await handleMsEvent(db, events, ev('customerorder', 'ord-2')), 'same_state', 'поменяли не статус — история не засоряется');
  states.set('ord-2', 'Отменен');
  assert.equal(await handleMsEvent(db, events, ev('customerorder', 'ord-2')), 'cancelled');
  assert.equal(await status(id), 'cancelled');
  const notes = (await call(ann, 'GET', '/notifications')).json() as { text: string }[];
  assert.ok(notes.some((n) => n.text === `Заявка №${id} отменена`));
});

test('стенд: при MS_DEMANDS=0 отгрузка в приложении не создаёт отгрузку в МойСклад', async () => {
  let demandsCreated = 0;
  const gw: MsGateway = {
    async getCounterparty(id) { return { id, name: 'x' }; }, async searchCounterparties() { return []; },
    async ensureProject() { return 'p'; }, async createOrder(o) { return { id: `ord-${o.key}`, name: '02500' }; },
    async createDemand() { demandsCreated++; return { id: 'd', name: '1' }; },
  };
  const app2 = buildApp({ db, pepper: 'pep', trustProxy: 1, ms: gw, msDemands: false });
  const id = await requestWithOrder('ord-3');
  const t = await loginAs(app2, db, '+79990000001');
  const r = await app2.inject({ method: 'POST', url: `/requests/${id}/ship`, headers: { authorization: `Bearer ${t}` } });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.json().shipment, /^ОТ-/);
  assert.equal(demandsCreated, 0);
  await app2.close();
});

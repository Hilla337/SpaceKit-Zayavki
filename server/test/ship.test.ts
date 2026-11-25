import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import type { CodeSender } from '../src/sender.js';
import { processOutbox, SMS_MAX_ATTEMPTS, type SmsSender } from '../src/sms.js';
import { createTestDb } from './db-helper.js';

const codes = new Map<string, string>();
const sender: CodeSender = { async send(phone, code) { codes.set(phone, code); } };
let now = new Date('2026-12-01T10:00:00Z');
let db: Db;
let app: FastifyInstance;
let ip = 0;

const PH = { phil: '+79990000001', tanya: '+79990000002', picker: '+79990000008', ann: '+79991110001', bob: '+79991110002' };
const objectOk = { street: 'Нижние Мнёвники', house: '7', floor: '3', apt: '1058', lift: 'грузовой', resp: 'Артур', respPhone: '+7 968 996-03-33', parking: 'есть', pass: 'нужен' };

async function login(phone: string): Promise<string> {
  const s = await app.inject({ method: 'POST', url: '/auth/request-code', payload: { phone }, headers: { 'x-forwarded-for': `10.1.0.${++ip}` } });
  assert.equal(s.statusCode, 200, s.body);
  const r = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code: codes.get(phone) } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().token;
}
const call = (t: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${t}` } });

let phil: string, tanya: string, picker: string, ann: string, bob: string;
let annUser: number;

const smsCount = async (where = 'true') => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sms_outbox WHERE ${where}`)).rows[0]!.n;

async function newRequest(items = 3): Promise<number> {
  const r = await call(ann, 'POST', '/requests', { object: objectOk, items: Array.from({ length: items }, (_, i) => ({ name: `Ротбанд ${i}`, qty: 1 })) });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id;
}
/** Доводит заявку до «В сборке»: подбор, цена, подтверждение клиентом. */
async function toAssembly(id: number): Promise<void> {
  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'work' })).statusCode, 200);
  const v = (await call(phil, 'GET', `/requests/${id}`)).json();
  for (const it of v.items) {
    if (it.matchState !== 'matched') assert.equal((await call(phil, 'PATCH', `/requests/${id}/items/${it.id}`, { skuId: 1 })).statusCode, 200);
    assert.equal((await call(phil, 'PATCH', `/requests/${id}/items/${it.id}`, { price: 100 })).statusCode, 200);
  }
  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'confirm' })).statusCode, 200);
  assert.equal((await call(ann, 'POST', `/requests/${id}/status`, { to: 'assembly' })).statusCode, 200);
}

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, sender, pepper: 'test', clock: () => now, trustProxy: 1 });
  await db.query(`UPDATE users SET phone = $1 WHERE name = 'Филипп Инилеев'`, [PH.phil]);
  await db.query(`UPDATE users SET phone = $1 WHERE name = 'Татьяна Чех'`, [PH.tanya]);
  await db.query(`INSERT INTO users (phone, name, role, status) VALUES ($1, 'Сборщик', 'picker', 'approved')`, [PH.picker]);
  await db.query(`INSERT INTO catalog (ms_id, store, store_code, name, price) VALUES ('ms1', 'Петрович', '100101', 'Ротбанд 30 кг', 450)`);
  const mk = async (name: string, phone: string, mgr: number): Promise<number> => {
    const c = await db.query<{ id: number }>(`INSERT INTO companies (name, status, manager_id) VALUES ($1, 'approved', $2) RETURNING id`, [name, mgr]);
    const u = await db.query<{ id: number }>(`INSERT INTO users (phone, name, role, status, company_id) VALUES ($1, $1, 'customer', 'approved', $2) RETURNING id`, [phone, c.rows[0]!.id]);
    return u.rows[0]!.id;
  };
  annUser = await mk('Клиент А', PH.ann, 1);
  await mk('Клиент Б', PH.bob, 2);
  phil = await login(PH.phil); tanya = await login(PH.tanya); picker = await login(PH.picker); ann = await login(PH.ann); bob = await login(PH.bob);
});
after(async () => { await app.close(); await db.close(); });

test('отгрузка одной кнопкой: всё сразу, SMS клиенту, повторно нельзя', async () => {
  const id = await newRequest(3);
  await toAssembly(id);
  const before = await smsCount();

  // права: заказчик и чужой менеджер не отгружают, сборщик — может
  assert.equal((await call(ann, 'POST', `/requests/${id}/ship`)).statusCode, 403);
  assert.equal((await call(tanya, 'POST', `/requests/${id}/ship`)).statusCode, 404);

  const r = await call(phil, 'POST', `/requests/${id}/ship`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'shipped');
  assert.equal(r.json().remaining, 0);
  assert.match(r.json().shipment, /^ОТ-\d{4}$/);

  assert.equal(await smsCount(), before + 1);
  const sms = await db.query<{ text: string; phone: string }>(`SELECT text, phone FROM sms_outbox ORDER BY id DESC LIMIT 1`);
  assert.equal(sms.rows[0]!.phone, PH.ann);
  assert.match(sms.rows[0]!.text, /отгружена/);

  const card = (await call(ann, 'GET', `/requests/${id}`)).json();
  assert.equal(card.status, 'shipped');
  assert.equal(card.shipments.length, 1);

  assert.equal((await call(phil, 'POST', `/requests/${id}/ship`)).statusCode, 409);
});

test('частичная отгрузка: сначала часть, потом остаток; чужие и повторные позиции отклоняются', async () => {
  const id = await newRequest(3);
  await toAssembly(id);
  const ids: number[] = (await call(phil, 'GET', `/requests/${id}`)).json().items.map((x: { id: number }) => x.id);

  assert.equal((await call(phil, 'POST', `/requests/${id}/ship`, { itemIds: [999999] })).statusCode, 422);
  const p = await call(picker, 'POST', `/requests/${id}/ship`, { itemIds: [ids[0]] });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(p.json().status, 'partial');
  assert.equal(p.json().remaining, 2);

  assert.equal((await call(phil, 'POST', `/requests/${id}/ship`, { itemIds: [ids[0]] })).statusCode, 422); // уже отгружена

  const rest = await call(phil, 'POST', `/requests/${id}/ship`);
  assert.equal(rest.statusCode, 200);
  assert.equal(rest.json().status, 'shipped');
  assert.equal((await call(phil, 'GET', `/requests/${id}`)).json().shipments.length, 2);
});

test('отгрузить можно только заявку «в сборке»', async () => {
  const id = await newRequest(1);
  assert.equal((await call(phil, 'POST', `/requests/${id}/ship`)).statusCode, 409);
});

test('SMS: не уходит тем, кто отключил, и снова уходит после включения', async () => {
  assert.deepEqual((await call(ann, 'PATCH', '/me', { smsEnabled: false })).json(), { smsEnabled: false });
  assert.equal((await call(ann, 'GET', '/me')).json().smsEnabled, false);
  const id = await newRequest(1);
  await toAssembly(id);
  const before = await smsCount();
  assert.equal((await call(phil, 'POST', `/requests/${id}/ship`)).statusCode, 200);
  assert.equal(await smsCount(), before); // SMS нет, а уведомление в приложении есть
  const notes = (await call(ann, 'GET', '/notifications?unread=1')).json();
  assert.ok(notes.some((n: { requestId: number }) => n.requestId === id));
  await call(ann, 'PATCH', '/me', { smsEnabled: true });
});

test('чат: участники переписываются, чужие и сборщик не видят, уведомления без SMS', async () => {
  const id = await newRequest(1);
  const before = await smsCount();

  const m1 = await call(ann, 'POST', `/requests/${id}/messages`, { text: '  Привезите до 12  ' });
  assert.equal(m1.statusCode, 201);
  assert.equal(m1.json().text, 'Привезите до 12');
  assert.equal((await call(phil, 'POST', `/requests/${id}/messages`, { text: 'Ок' })).statusCode, 201);
  assert.equal((await call(ann, 'POST', `/requests/${id}/messages`, { text: '   ' })).statusCode, 422);

  const list = (await call(ann, 'GET', `/requests/${id}/messages`)).json();
  assert.equal(list.length, 2);
  assert.equal(list[0].mine, true);
  const after = (await call(phil, 'GET', `/requests/${id}/messages?after=${list[0].id}`)).json();
  assert.equal(after.length, 1);

  for (const t of [tanya, bob, picker]) {
    assert.equal((await call(t, 'GET', `/requests/${id}/messages`)).statusCode, 404);
    assert.equal((await call(t, 'POST', `/requests/${id}/messages`, { text: 'x' })).statusCode, 404);
  }
  assert.equal(await smsCount(), before);
});

test('уведомления: отметка прочитанным только у себя; read-all', async () => {
  const mine = (await call(phil, 'GET', '/notifications')).json();
  assert.ok(mine.length > 0);
  const other = (await call(ann, 'GET', '/notifications')).json();
  assert.equal((await call(phil, 'POST', `/notifications/${other[0].id}/read`)).statusCode, 404);
  assert.equal((await call(phil, 'POST', `/notifications/${mine[0].id}/read`)).statusCode, 200);
  assert.equal((await call(phil, 'POST', '/notifications/read-all')).statusCode, 200);
  assert.equal((await call(phil, 'GET', '/notifications?unread=1')).json().length, 0);
  assert.equal((await call(phil, 'GET', '/me')).json().unreadNotifications, 0);
});

test('очередь SMS: отправка, повтор после сбоя, окончательная ошибка, без двойной отправки', async () => {
  await db.query('DELETE FROM sms_outbox');
  await db.query(`INSERT INTO sms_outbox (user_id, phone, text, next_attempt_at) VALUES ($1, '+79990001', 'a', $2), ($1, '+79990002', 'b', $2)`, [annUser, now]);
  const sentTo: string[] = [];
  const good: SmsSender = { async send(p) { sentTo.push(p); } };
  const r1 = await processOutbox(db, good, now);
  assert.equal(r1.sent, 2);
  assert.equal((await processOutbox(db, good, now)).sent, 0); // повторно не шлём
  assert.deepEqual(sentTo.sort(), ['+79990001', '+79990002']);

  await db.query(`INSERT INTO sms_outbox (user_id, phone, text, next_attempt_at) VALUES ($1, '+79990003', 'c', $2)`, [annUser, now]);
  const bad: SmsSender = { async send() { throw new Error('провайдер недоступен'); } };
  let t = now;
  for (let i = 1; i <= SMS_MAX_ATTEMPTS; i++) {
    const r = await processOutbox(db, bad, t);
    if (i < SMS_MAX_ATTEMPTS) assert.equal(r.retry, 1);
    else assert.equal(r.failed, 1);
    assert.equal((await processOutbox(db, bad, t)).retry, 0); // сразу же второй раз — рано
    t = new Date(t.getTime() + 60 * 60_000);
  }
  const row = await db.query<{ status: string; attempts: number }>(`SELECT status, attempts FROM sms_outbox WHERE phone = '+79990003'`);
  assert.equal(row.rows[0]!.status, 'failed');
  assert.equal(row.rows[0]!.attempts, SMS_MAX_ATTEMPTS);
});

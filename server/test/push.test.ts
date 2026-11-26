import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { processPushes, vapidKeys, WebPushSender, type PushMessage, type PushSender, type PushSub } from '../src/push.js';
import { loginAs } from './auth-helper.js';
import { createTestDb } from './db-helper.js';

let db: Db;
let app: FastifyInstance;
let phil: string, ann: string, annId: number, reqId: number;
const call = (t: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${t}` } });
const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

class FakePush implements PushSender {
  sent: { sub: PushSub; msg: PushMessage }[] = [];
  gone = new Set<string>();
  async send(s: PushSub, msg: PushMessage) {
    if (this.gone.has(s.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    this.sent.push({ sub: s, msg });
  }
}

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, pepper: 't', trustProxy: 1 });
  await db.query(`UPDATE users SET phone = '+79990000001' WHERE name = 'Филипп Инилеев'`);
  const c = (await db.query<{ id: number }>(`INSERT INTO companies (name, status, manager_id) VALUES ('Клиент', 'approved', 1) RETURNING id`)).rows[0]!.id;
  annId = (await db.query<{ id: number }>(`INSERT INTO users (phone, name, role, status, company_id) VALUES ('+79991110001', 'Анна', 'customer', 'approved', $1) RETURNING id`, [c])).rows[0]!.id;
  reqId = (await db.query<{ id: number }>(`INSERT INTO requests (company_id, created_by) VALUES ($1, $2) RETURNING id`, [c, annId])).rows[0]!.id;
  phil = await loginAs(app, db, '+79990000001'); ann = await loginAs(app, db, '+79991110001');
});
after(async () => { await app.close(); await db.close(); });

test('ключи VAPID создаются один раз и дальше не меняются; открытый ключ отдаётся без входа', async () => {
  const k1 = await vapidKeys(db);
  const k2 = await vapidKeys(db);
  assert.equal(k1.publicKey, k2.publicKey);
  const r = await app.inject({ method: 'GET', url: '/push/key' });
  assert.equal(r.json().publicKey, k1.publicKey);
  assert.ok(new WebPushSender(k1, 'https://stand.example'), 'ключи подходят библиотеке');
});

test('подписка: только https-адрес; устройство переходит к тому, кто вошёл на нём последним; отписка', async () => {
  assert.equal((await call(ann, 'POST', '/push/subscribe', { endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } })).statusCode, 400);
  assert.equal((await call(ann, 'POST', '/push/subscribe', sub(1))).statusCode, 200);
  assert.equal((await call(phil, 'POST', '/push/subscribe', sub(1))).statusCode, 200);
  const owner = await db.query<{ user_id: number }>(`SELECT user_id FROM push_subscriptions WHERE endpoint = $1`, [sub(1).endpoint]);
  assert.equal(owner.rows.length, 1);
  assert.notEqual(owner.rows[0]!.user_id, annId, 'подписка перешла к Филиппу');
  await call(phil, 'POST', '/push/unsubscribe', { endpoint: sub(1).endpoint });
  assert.equal((await db.query('SELECT 1 FROM push_subscriptions')).rows.length, 0);
});

test('новое уведомление уходит push-ом на все устройства человека один раз, со ссылкой на заявку', async () => {
  const push = new FakePush();
  await call(ann, 'POST', '/push/subscribe', sub(2));
  await call(ann, 'POST', '/push/subscribe', sub(3));
  // Филипп пишет в чат — у Анны появляется уведомление.
  assert.equal((await call(phil, 'POST', `/requests/${reqId}/messages`, { text: 'Завтра привезём' })).statusCode, 201);
  const r1 = await processPushes(db, push);
  assert.deepEqual([r1.notifications, r1.sent], [1, 2]);
  assert.deepEqual(push.sent[0]!.msg, { title: 'SpaceKit', body: `Новое сообщение по заявке №${reqId}`, url: `/#/r/${reqId}`, tag: `req-${reqId}` });
  assert.equal((await processPushes(db, push)).sent, 0, 'повторно не шлём');
});

test('прочитанные и старые уведомления push-ом не уходят; отписанное устройство удаляется', async () => {
  const push = new FakePush();
  await db.query(`INSERT INTO notifications (user_id, request_id, text, read_at) VALUES ($1, $2, 'уже прочитано', now())`, [annId, reqId]);
  await db.query(`INSERT INTO notifications (user_id, request_id, text, created_at) VALUES ($1, $2, 'давнее', now() - interval '1 hour')`, [annId, reqId]);
  assert.equal((await processPushes(db, push)).sent, 0);

  push.gone.add(sub(2).endpoint);
  await db.query(`INSERT INTO notifications (user_id, request_id, text) VALUES ($1, $2, 'свежее')`, [annId, reqId]);
  const r = await processPushes(db, push);
  assert.deepEqual([r.sent, r.removed], [1, 1]);
  assert.deepEqual((await db.query<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions')).rows.map((x) => x.endpoint), [sub(3).endpoint]);
});

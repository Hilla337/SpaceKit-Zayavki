import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import type { CodeSender } from '../src/sender.js';
import { createTestDb } from './db-helper.js';

const codes = new Map<string, string>();
const sender: CodeSender = { async send(phone, code) { codes.set(phone, code); } };
let db: Db;
let app: FastifyInstance;
let ip = 0;
let phil: string, tanya: string, admin: string, picker: string, ann: string;
let reqId: number;

async function login(phone: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/request-code', payload: { phone }, headers: { 'x-forwarded-for': `10.7.0.${++ip}` } });
  const r = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code: codes.get(phone) } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().token;
}
const call = (t: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${t}` } });
const upload = (t: string, data: Buffer, type: string, query = 'name=photo.jpg') =>
  app.inject({ method: 'POST', url: `/requests/${reqId}/attachments?${query}`, payload: data, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/octet-stream', 'x-file-type': type } });
const list = async (t: string) => (await call(t, 'GET', `/requests/${reqId}/messages`)).json() as any[];

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, sender, pepper: 'test', trustProxy: 1 });
  await db.query(`UPDATE users SET phone = '+79990000001' WHERE name = 'Филипп Инилеев'`);
  await db.query(`UPDATE users SET phone = '+79990000002' WHERE name = 'Татьяна Чех'`);
  await db.query(`INSERT INTO users (phone, name, role, status) VALUES ('+79990000009', 'Админ', 'admin', 'approved'), ('+79990000008', 'Сборщик', 'picker', 'approved')`);
  const c = (await db.query<{ id: number }>(`INSERT INTO companies (name, status, manager_id) VALUES ('Клиент', 'approved', 1) RETURNING id`)).rows[0]!.id;
  const u = (await db.query<{ id: number }>(`INSERT INTO users (phone, name, role, status, company_id) VALUES ('+79991110001', 'Анна', 'customer', 'approved', $1) RETURNING id`, [c])).rows[0]!.id;
  reqId = (await db.query<{ id: number }>(`INSERT INTO requests (company_id, created_by) VALUES ($1, $2) RETURNING id`, [c, u])).rows[0]!.id;
  phil = await login('+79990000001'); tanya = await login('+79990000002'); admin = await login('+79990000009'); picker = await login('+79990000008'); ann = await login('+79991110001');
});
after(async () => { await app.close(); await db.close(); });

test('фото: загрузка, отправка, вторая сторона видит и скачивает; чужим и сборщику не видно', async () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const up = await upload(ann, jpg, 'image/jpeg');
  assert.equal(up.statusCode, 201, up.body);
  assert.equal(up.json().kind, 'photo');
  const sent = await call(ann, 'POST', `/requests/${reqId}/messages`, { text: 'Вот так должно быть', attachmentId: up.json().id });
  assert.equal(sent.statusCode, 201, sent.body);
  assert.equal(sent.json().attachment.kind, 'photo');

  const seen = (await list(phil)).at(-1);
  assert.equal(seen.attachment.name, 'photo.jpg');
  const file = await call(phil, 'GET', `/attachments/${seen.attachment.id}`);
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.deepEqual(file.rawPayload, jpg);

  assert.equal((await call(tanya, 'GET', `/attachments/${seen.attachment.id}`)).statusCode, 404, 'чужой менеджер');
  assert.equal((await call(picker, 'GET', `/attachments/${seen.attachment.id}`)).statusCode, 404, 'сборщик переписку не видит');
  assert.equal((await upload(tanya, jpg, 'image/jpeg')).statusCode, 404);

  // Уже отправленное вложение второй раз не прикрепить; чужое тоже.
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/messages`, { attachmentId: up.json().id })).statusCode, 422);
  const mine = await upload(phil, jpg, 'image/jpeg');
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/messages`, { attachmentId: mine.json().id })).statusCode, 422);
});

test('голосовое, видео и файл определяются по типу; пустое и слишком большое не принимается', async () => {
  const v = await upload(phil, Buffer.from('OggS....'), 'audio/webm;codecs=opus', 'name=voice.webm&kind=voice&duration=3200');
  assert.equal(v.json().kind, 'voice');
  const sent = await call(phil, 'POST', `/requests/${reqId}/messages`, { attachmentId: v.json().id });
  assert.equal(sent.json().attachment.durationMs, 3200);
  assert.equal((await upload(phil, Buffer.from('x'), 'video/mp4', 'name=a.mp4')).json().kind, 'video');
  assert.equal((await upload(phil, Buffer.from('x'), 'application/pdf', 'name=смета.pdf')).json().kind, 'file');
  assert.equal((await upload(phil, Buffer.from('x'), 'audio/mpeg', 'name=song.mp3')).json().kind, 'file', 'аудио без пометки — обычный файл');
  assert.equal((await upload(phil, Buffer.alloc(0), 'image/png')).statusCode, 400);
  assert.equal((await upload(phil, Buffer.alloc(25 * 1024 * 1024 + 1), 'image/png')).statusCode, 413);
  assert.equal((await call(phil, 'POST', `/requests/${reqId}/messages`, { text: '   ' })).statusCode, 422);
});

test('правка и удаление: только своё (админ удаляет любое); удалённое исчезает у второй стороны вместе с вложением', async () => {
  const m = (await call(ann, 'POST', `/requests/${reqId}/messages`, { text: 'Опечтка' })).json();
  assert.equal((await call(phil, 'PATCH', `/requests/${reqId}/messages/${m.id}`, { text: 'нет' })).statusCode, 403);
  const ed = await call(ann, 'PATCH', `/requests/${reqId}/messages/${m.id}`, { text: 'Опечатка' });
  assert.equal(ed.statusCode, 200);
  assert.equal(ed.json().text, 'Опечатка');
  assert.ok(ed.json().editedAt);
  assert.equal((await list(phil)).find((x) => x.id === m.id).text, 'Опечатка');

  const up = await upload(ann, Buffer.from('img'), 'image/png', 'name=a.png');
  const withFile = (await call(ann, 'POST', `/requests/${reqId}/messages`, { attachmentId: up.json().id })).json();
  assert.equal((await call(phil, 'DELETE', `/requests/${reqId}/messages/${withFile.id}`)).statusCode, 403);
  assert.equal((await call(ann, 'DELETE', `/requests/${reqId}/messages/${withFile.id}`)).statusCode, 200);
  const gone = (await list(phil)).find((x) => x.id === withFile.id);
  assert.equal(gone.deleted, true);
  assert.equal(gone.attachment, null);
  assert.equal((await call(phil, 'GET', `/attachments/${up.json().id}`)).statusCode, 404, 'файл удалён из базы');
  assert.equal((await call(ann, 'PATCH', `/requests/${reqId}/messages/${withFile.id}`, { text: 'x' })).statusCode, 404, 'удалённое не править');

  const p = (await call(phil, 'POST', `/requests/${reqId}/messages`, { text: 'грубость' })).json();
  assert.equal((await call(admin, 'DELETE', `/requests/${reqId}/messages/${p.id}`)).statusCode, 200);
});

test('ответ на сообщение и реакции', async () => {
  const q = (await call(ann, 'POST', `/requests/${reqId}/messages`, { text: 'Когда привезёте?' })).json();
  const a = (await call(phil, 'POST', `/requests/${reqId}/messages`, { text: 'Завтра до 12', replyToId: q.id })).json();
  assert.deepEqual([a.replyTo.id, a.replyTo.authorName, a.replyTo.text], [q.id, 'Анна', 'Когда привезёте?']);
  assert.equal((await call(phil, 'POST', `/requests/${reqId}/messages`, { text: 'x', replyToId: 999999 })).statusCode, 422);

  assert.equal((await call(ann, 'POST', `/requests/${reqId}/messages/${a.id}/reaction`, { emoji: '👍' })).json().reactions[0].count, 1);
  const two = (await call(phil, 'POST', `/requests/${reqId}/messages/${a.id}/reaction`, { emoji: '👍' })).json();
  assert.deepEqual(two.reactions, [{ emoji: '👍', count: 2, mine: true }]);
  const changed = (await call(ann, 'POST', `/requests/${reqId}/messages/${a.id}/reaction`, { emoji: '🔥' })).json();
  assert.equal(changed.reactions.length, 2, 'у человека одна реакция: сменилась');
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/messages/${a.id}/reaction`, { emoji: null })).json().reactions.length, 1);
  assert.equal((await call(ann, 'POST', `/requests/${reqId}/messages/${a.id}/reaction`, { emoji: '💩' })).statusCode, 400);
});

test('прочитано: галочки появляются, когда вторая сторона открыла переписку', async () => {
  const m = (await call(ann, 'POST', `/requests/${reqId}/messages`, { text: 'Проверьте, пожалуйста' })).json();
  assert.equal(m.read, false);
  assert.equal((await list(ann)).find((x) => x.id === m.id).read, false, 'сам себе не читатель');
  await list(phil);
  assert.equal((await list(ann)).find((x) => x.id === m.id).read, true);
});

test('список менеджеров для переназначения — только админу', async () => {
  const r = await call(admin, 'GET', '/staff/managers');
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().some((m: { name: string }) => m.name === 'Татьяна Чех'));
  assert.equal((await call(phil, 'GET', '/staff/managers')).statusCode, 403);
});

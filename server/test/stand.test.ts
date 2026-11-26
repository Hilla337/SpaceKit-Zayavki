import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ensureBootstrapAdmin } from '../src/bootstrap.js';
import type { Db } from '../src/db.js';
import { loginAs, nextIp } from './auth-helper.js';
import { createTestDb } from './db-helper.js';

let db: Db;
let app: FastifyInstance;
let admin: string, phil: string;
const call = (t: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${t}` } });
const tryLogin = (phone: string, password: string) => app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password }, headers: { 'x-forwarded-for': nextIp() } });

before(async () => { db = await createTestDb(); app = buildApp({ db, pepper: 't', trustProxy: 1 }); });
after(async () => { await app.close(); await db.close(); });

test('первый админ из окружения: создаётся один раз, сменённый потом пароль не затирается', async () => {
  const env = { BOOTSTRAP_ADMIN_PHONE: '8 999 000 00 09', BOOTSTRAP_ADMIN_PASSWORD: 'стартовый-пароль', BOOTSTRAP_ADMIN_NAME: 'Илья' };
  assert.equal(await ensureBootstrapAdmin(db, {}), 'skipped');
  assert.equal(await ensureBootstrapAdmin(db, { ...env, BOOTSTRAP_ADMIN_PASSWORD: '123' }), 'skipped', 'слишком короткий пароль');
  assert.equal(await ensureBootstrapAdmin(db, env), 'created');
  assert.equal((await tryLogin('+79990000009', 'стартовый-пароль')).statusCode, 200);
  admin = (await tryLogin('+79990000009', 'стартовый-пароль')).json().token;
  assert.equal((await call(admin, 'POST', '/me/password', { oldPassword: 'стартовый-пароль', newPassword: 'мой-новый' })).statusCode, 200);
  assert.equal(await ensureBootstrapAdmin(db, env), 'unchanged', 'перезапуск стенда пароль не сбрасывает');
  assert.equal((await tryLogin('+79990000009', 'мой-новый')).statusCode, 200);
});

test('админ задаёт телефон менеджеру из начальных данных и добавляет сотрудника; менеджеру это нельзя', async () => {
  const staff = (await call(admin, 'GET', '/staff')).json() as { id: number; name: string; phone: string | null }[];
  const filipp = staff.find((s) => s.name === 'Филипп Инилеев')!;
  assert.equal(filipp.phone, null);
  assert.equal((await call(admin, 'PATCH', `/staff/${filipp.id}`, { phone: 'не телефон' })).statusCode, 400);
  assert.equal((await call(admin, 'PATCH', `/staff/${filipp.id}`, { phone: '+7 999 000-00-09' })).statusCode, 409, 'номер занят админом');
  assert.equal((await call(admin, 'PATCH', `/staff/${filipp.id}`, { phone: '+7 999 000-00-01' })).statusCode, 200);
  phil = await loginAs(app, db, '+79990000001');

  const add = await call(admin, 'POST', '/staff', { role: 'picker', name: 'Сборщик Иван', phone: '+7 999 000-00-08' });
  assert.equal(add.statusCode, 201);
  assert.equal((await call(admin, 'POST', '/staff', { role: 'manager', name: 'Дубль', phone: '+7 999 000-00-08' })).statusCode, 409);
  assert.equal((await call(phil, 'POST', '/staff', { role: 'admin', name: 'Я главный', phone: '+7 999 000-00-77' })).statusCode, 403);
  assert.equal((await call(phil, 'PATCH', `/staff/${filipp.id}`, { phone: '+7 999 000-00-55' })).statusCode, 403);
});

test('список «менеджер;клиент» вставкой текста: точные назначаются сразу, ошибка в списке ничего не сохраняет', async () => {
  await db.query(`INSERT INTO companies (name, status) VALUES ('ООО «Профит Рум»', 'pending'), ('Бабаев Иван', 'pending')`);
  const bad = await call(admin, 'POST', '/hints', { text: 'Филипп Инилеев;Профит рум\nНеизвестный Менеджер;Кто-то' });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.json().message, /Неизвестный Менеджер/);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM client_manager_hints')).rows[0]!.n, 0);
  assert.equal((await call(admin, 'POST', '/hints', { text: 'просто строка' })).json().error, 'bad_line');

  const ok = await call(admin, 'POST', '/hints', { text: '# комментарий\nФилипп Инилеев;Профит рум\nФилипп Инилеев;Бабаев\n' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().saved, 2);
  assert.deepEqual(ok.json().assigned.map((a: { name: string }) => a.name), ['ООО «Профит Рум»']);
  assert.ok(ok.json().suggestions.some((s: { name: string }) => s.name === 'Бабаев Иван'), 'приблизительное только предлагается');
  assert.equal((await call(phil, 'POST', '/hints', { text: 'Филипп Инилеев;Х' })).statusCode, 403);
});

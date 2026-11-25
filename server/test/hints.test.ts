import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { applyHints, loadHints, normalizeName, suggestHints } from '../src/hints.js';
import type { CodeSender } from '../src/sender.js';
import { createTestDb } from './db-helper.js';

test('нормализация названий: регистр, ё, кавычки и форма собственности не важны', () => {
  assert.equal(normalizeName('ООО «Профит Рум»'), 'профит рум');
  assert.equal(normalizeName('  профит   РУМ '), 'профит рум');
  assert.equal(normalizeName('ИП Бабаев'), 'бабаев');
  assert.equal(normalizeName('Общество с ограниченной ответственностью "Ёлка"'), 'елка');
  assert.equal(normalizeName('Да!'), 'да');
  assert.equal(normalizeName('Траст ремонт'), 'траст ремонт');
  assert.equal(normalizeName('Траст ремонт ООО'), 'траст ремонт ооо'); // форму убираем только в начале
  assert.equal(normalizeName('ООО'), 'ооо'); // название из одной «формы» не обнуляем
  assert.equal(normalizeName('!!!'), '');
});

const codes = new Map<string, string>();
const sender: CodeSender = { async send(phone, code) { codes.set(phone, code); } };
let db: Db;
let app: FastifyInstance;
let ip = 0;

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, sender, pepper: 't', trustProxy: 1 });
});
after(async () => { await app.close(); await db.close(); });

async function register(phone: string, company: string): Promise<number> {
  const h = { 'x-forwarded-for': `10.1.0.${++ip}` };
  await app.inject({ method: 'POST', url: '/auth/request-code', payload: { phone }, headers: h });
  const r = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code: codes.get(phone), name: 'Тест', company } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().user.companyId as number;
}
const managerOf = async (companyId: number) =>
  (await db.query<{ name: string | null }>('SELECT m.name FROM companies c LEFT JOIN users m ON m.id = c.manager_id WHERE c.id = $1', [companyId])).rows[0]?.name ?? null;

test('регистрация: точное совпадение названия сразу даёт клиенту его менеджера, остальные остаются нераспределёнными', async () => {
  await loadHints(db, [
    ['Филипп Инилеев', 'Профит рум'],
    ['Филипп Инилеев', 'Бабаев'],
    ['Максим Стребков', 'DIZMO'],
  ]);

  const exact = await register('+79991000001', 'ООО «Профит Рум»');
  assert.equal(await managerOf(exact), 'Филипп Инилеев');
  const hist = await db.query<{ changed_by: number | null }>('SELECT changed_by FROM company_manager_history WHERE company_id = $1', [exact]);
  assert.equal(hist.rows.length, 1);
  assert.equal(hist.rows[0]?.changed_by, null); // назначено автоматически, а не человеком

  const loose = await register('+79991000002', 'Бабаев Иван Петрович');
  assert.equal(await managerOf(loose), null); // приблизительное совпадение само не применяется

  const unknown = await register('+79991000003', 'Совсем другая компания');
  assert.equal(await managerOf(unknown), null);

  const sug = await suggestHints(db);
  assert.ok(sug.some((s) => s.companyId === loose && s.managerName === 'Филипп Инилеев'));
  assert.ok(!sug.some((s) => s.companyId === exact));
});

test('apply-hints назначает только точные совпадения и не трогает уже закреплённых', async () => {
  await db.query(`INSERT INTO companies (name) VALUES ('Dizmo'), ('Бабаев Иван Петрович 2')`);
  const done = await applyHints(db);
  assert.deepEqual(done.map((d) => [d.name, d.managerName]), [['Dizmo', 'Максим Стребков']]);

  // Профит рум уже у Филиппа; повторная загрузка с другим менеджером его не перекидывает сама.
  await loadHints(db, [['Татьяна Чех', 'Профит рум']]);
  assert.deepEqual(await applyHints(db), []);
  const row = await db.query<{ name: string }>(`SELECT m.name FROM companies c JOIN users m ON m.id = c.manager_id WHERE c.name = 'ООО «Профит Рум»'`);
  assert.equal(row.rows[0]?.name, 'Филипп Инилеев');
});

test('повторная загрузка обновляет менеджера у известного клиента, а ошибочный список не сохраняется частично', async () => {
  const hint = await db.query<{ name: string }>(`SELECT m.name FROM client_manager_hints h JOIN users m ON m.id = h.manager_id WHERE h.hint_norm = 'профит рум'`);
  assert.equal(hint.rows[0]?.name, 'Татьяна Чех');

  const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM client_manager_hints')).rows[0]?.n;
  await assert.rejects(db.tx((q) => loadHints(q, [['Дмитрий Барбарасов', 'Wellform'], ['Несуществующий', 'Кто-то']])), /найдено 0/);
  const after = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM client_manager_hints')).rows[0]?.n;
  assert.equal(after, before);
});

test('подсказку нельзя привязать к не менеджеру', async () => {
  await db.query(`INSERT INTO users (phone, name, role, status) VALUES ('+79990009999', 'Админ', 'admin', 'approved')`);
  await assert.rejects(loadHints(db, [['Админ', 'Что-то']]), /найдено 0/);
  await assert.rejects(
    db.query(`INSERT INTO client_manager_hints (hint, hint_norm, manager_id) SELECT 'x', 'x', id FROM users WHERE name = 'Админ'`),
    /role manager/,
  );
});

test('приблизительные совпадения: только целыми словами и не по коротким названиям', async () => {
  await loadHints(db, [['Дмитрий Барбарасов', 'Горелышев'], ['Татьяна Чех', 'Траст ремонт']]);
  const [gor, as, full] = (await db.query<{ id: number }>(
    `INSERT INTO companies (name) VALUES ('Гор'), ('ООО "АС+"'), ('ИП Горелышев Александр') RETURNING id`,
  )).rows.map((r) => r.id);
  const sug = await suggestHints(db);
  assert.ok(!sug.some((s) => s.companyId === gor || s.companyId === as));
  assert.ok(sug.some((s) => s.companyId === full && s.managerName === 'Дмитрий Барбарасов'));
  // Кусок слова не считается: «Траст» не похоже на «Трастремонтстрой».
  const [glued] = (await db.query<{ id: number }>(`INSERT INTO companies (name) VALUES ('Трастремонтстрой') RETURNING id`)).rows.map((r) => r.id);
  assert.ok(!(await suggestHints(db)).some((s) => s.companyId === glued));
});

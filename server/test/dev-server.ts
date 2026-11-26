/**
 * Сервер для пробы интерфейса без PostgreSQL и без МойСклад: база в памяти (PGlite), тестовые данные,
 * поддельный МойСклад (заказы и отгрузки только печатаются). У всех тестовых людей пароль 123456.
 *   npm run dev:memory     → http://localhost:8080
 * Телефоны: менеджер Филипп +79990000001, Татьяна +79990000002, сборщик +79990000008, админ +79990000009,
 * заказчик «Профит Рум» +79991110001. Новый номер — кнопка «Регистрация».
 */
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import type { MsGateway } from '../src/moysklad.js';
import { createTestDb } from './db-helper.js';

const db = await createTestDb();
let n = 2400;
const ms: MsGateway = {
  async getCounterparty(id) { return { id, name: `Контрагент ${id.slice(0, 8)}` }; },
  async searchCounterparties(q) { return [{ id: '00000000-0000-4000-8000-000000000001', name: `ООО «${q}»` }, { id: '00000000-0000-4000-8000-000000000002', name: `ИП ${q}` }]; },
  async ensureProject(p) { console.log('[МойСклад] проект', p.name); return `proj-${p.key}`; },
  async createOrder(o) { console.log('[МойСклад] заказ', o.key, o.positions.length, 'поз.'); return { id: `ord-${o.key}`, name: `0${++n}` }; },
  async createDemand(d) { console.log('[МойСклад] отгрузка', d.key, d.positions.length, 'поз.'); return { id: `dem-${d.key}`, name: `0${++n}` }; },
};
const app = buildApp({ db, pepper: 'dev', trustProxy: 0, ms, logger: false });

await db.query(`UPDATE users SET phone = '+79990000001' WHERE name = 'Филипп Инилеев'`);
await db.query(`UPDATE users SET phone = '+79990000002' WHERE name = 'Татьяна Чех'`);
await db.query(`INSERT INTO users (phone, name, role, status) VALUES ('+79990000008', 'Сборщик Иван', 'picker', 'approved'), ('+79990000009', 'Илья', 'admin', 'approved')`);
await db.query(`INSERT INTO catalog (ms_id, store, store_code, name, price) VALUES
  ('p1', 'Петрович', '155351', 'Краска моющаяся Marshall Export 7 база BW белая 9 л', 4297),
  ('p2', 'Петрович', '100101', 'Штукатурка гипсовая Ротбанд 30 кг', 620),
  ('p3', '', NULL, 'Профиль ПП 60×27, 3 м', 245),
  ('p4', '', NULL, 'Грунтовка глубокого проникновения 10 л', 980),
  ('p5', '', NULL, 'Гипсокартон влагостойкий 12,5 мм 2500×1200', 690)`);
const c = (await db.query<{ id: number }>(`INSERT INTO companies (name, status, manager_id, ms_counterparty_id) VALUES ('Профит Рум', 'approved', 1, '00000000-0000-4000-8000-0000000000aa') RETURNING id`)).rows[0]!.id;
await db.query(`INSERT INTO users (phone, name, role, status, company_id) VALUES ('+79991110001', 'Эрнест', 'customer', 'approved', $1)`, [c]);
await db.query(`INSERT INTO companies (name, status) VALUES ('Новый клиент без менеджера', 'pending')`);

await db.query('UPDATE users SET password_hash = $1 WHERE phone IS NOT NULL', [await hashPassword('123456')]);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Интерфейс: http://localhost:${port}  (база в памяти, всё пропадёт после остановки). Пароль у всех: 123456`);

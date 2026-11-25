import { readFile } from 'node:fs/promises';
import { normalizePhone } from './auth.js';
import { config } from './config.js';
import { createPgDb } from './db.js';
import { applyHints, loadHints, normalizeName, suggestHints } from './hints.js';
import { MoySklad, syncCatalog, type MsCounterparty, type MsProduct } from './moysklad.js';

const usage = `Команды:
  staff:set-phone "<Имя>" <телефон>        задать телефон существующему сотруднику (менеджеру, сборщику, админу)
  staff:add <manager|picker|admin> "<Имя>" <телефон>   добавить сотрудника
  clients:load-hints <файл.csv>            загрузить «менеджер;клиент» (по строке, разделитель ;, # — комментарий)
  clients:apply-hints                      назначить менеджеров уже существующим компаниям (только точные совпадения)
  clients:suggest                          показать приблизительные совпадения для проверки (ничего не меняет)
  ms:check                                 проверить токен МойСклад (MS_TOKEN в окружении), только чтение
  ms:counterparties                        показать контрагентов МойСклад и сравнить с подсказками по менеджерам (ничего не меняет)
  ms:sync-catalog                          загрузить товары и цены из МойСклад в каталог (МойСклад только читается)`;

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const db = createPgDb(config.databaseUrl);
  try {
    if (cmd === 'staff:set-phone') {
      const [name, rawPhone] = args;
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (!name || !phone) throw new Error(usage);
      const r = await db.query<{ id: number }>(
        `UPDATE users SET phone = $2 WHERE name = $1 AND role IN ('manager', 'picker', 'admin') RETURNING id`,
        [name, phone],
      );
      if (r.rows.length !== 1) throw new Error(`Найдено сотрудников с именем «${name}»: ${r.rows.length}. Нужен ровно один.`);
      console.log(`Телефон ${phone} задан сотруднику «${name}»`);
    } else if (cmd === 'staff:add') {
      const [role, name, rawPhone] = args;
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (!['manager', 'picker', 'admin'].includes(role ?? '') || !name || !phone) throw new Error(usage);
      await db.query(`INSERT INTO users (phone, name, role, status) VALUES ($1, $2, $3::user_role, 'approved')`, [phone, name, role]);
      console.log(`Добавлен ${role} «${name}» (${phone})`);
    } else if (cmd === 'clients:load-hints') {
      const file = args[0];
      if (!file) throw new Error(usage);
      const pairs: [string, string][] = (await readFile(file, 'utf8'))
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf(';');
          if (i < 1) throw new Error(`Не разобрал строку: «${l}» (нужно «менеджер;клиент»)`);
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string];
        });
      const r = await db.tx((q) => loadHints(q, pairs));
      console.log(`Загружено подсказок: ${r.saved}`);
    } else if (cmd === 'clients:apply-hints') {
      const done = await db.tx((q) => applyHints(q));
      for (const d of done) console.log(`#${d.companyId} «${d.name}» → ${d.managerName}`);
      console.log(`Назначено компаний: ${done.length}`);
    } else if (cmd === 'clients:suggest') {
      const list = await suggestHints(db);
      for (const s of list) console.log(`#${s.companyId} «${s.name}» ← возможно «${s.hint}» (${s.managerName})`);
      if (list.length === 0) console.log('Приблизительных совпадений нет');
    } else if (cmd === 'ms:check') {
      const ms = new MoySklad(process.env.MS_TOKEN ?? '');
      const orgs = await ms.get<{ rows: { name: string }[] }>('/entity/organization?limit=5');
      console.log(`Токен работает. Юрлица: ${orgs.rows.map((o) => o.name).join(', ') || '—'}`);
    } else if (cmd === 'ms:counterparties') {
      const ms = new MoySklad(process.env.MS_TOKEN ?? '');
      const all = (await ms.all<MsCounterparty>('/entity/counterparty')).filter((c) => !c.archived);
      const hints = await db.query<{ client_name: string; manager: string }>(
        `SELECT h.hint AS client_name, u.name AS manager FROM client_manager_hints h JOIN users u ON u.id = h.manager_id`,
      );
      const byNorm = new Map(all.map((c) => [normalizeName(c.name), c.name]));
      console.log(`Контрагентов в МойСклад: ${all.length}`);
      for (const h of hints.rows) {
        const hit = byNorm.get(normalizeName(h.client_name));
        const near = hit ? null : all.filter((c) => normalizeName(c.name).includes(normalizeName(h.client_name))).map((c) => c.name).slice(0, 3);
        console.log(`${h.manager}: «${h.client_name}» → ${hit ? `точно «${hit}»` : near && near.length ? `похоже: ${near.join(' | ')}` : 'НЕ НАЙДЕН'}`);
      }
    } else if (cmd === 'ms:sync-catalog') {
      const ms = new MoySklad(process.env.MS_TOKEN ?? '');
      const products = await ms.all<MsProduct>('/entity/product');
      const r = await db.tx((q) => syncCatalog(q, products));
      console.log(`Каталог обновлён: ${r.upserted} позиций, пропущено архивных: ${r.skipped}`);
    } else {
      throw new Error(usage);
    }
  } finally {
    await db.close();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

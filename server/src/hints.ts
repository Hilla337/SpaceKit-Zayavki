import type { Queryable } from './db.js';

const LEGAL_FORMS = new Set(['ооо', 'ип', 'ао', 'зао', 'пао', 'оао', 'нко', 'общество', 'с', 'ограниченной', 'ответственностью']);

/**
 * Приводит название контрагента к виду для сравнения:
 * «ООО «Профит Рум»» и «профит рум» дают одно и то же. Регистр, ё, кавычки и форма собственности не важны.
 */
export function normalizeName(raw: string): string {
  const words = raw
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  // Форму собственности убираем только в начале названия: «Траст ремонт ООО» оставим как есть.
  while (words.length > 1 && LEGAL_FORMS.has(words[0]!)) words.shift();
  return words.join(' ');
}

export interface HintMatch {
  managerId: number;
  managerName: string;
  hint: string;
}

/** Менеджер по точному совпадению названия компании с подсказкой; иначе null. */
export async function findHintManager(q: Queryable, companyName: string): Promise<HintMatch | null> {
  const norm = normalizeName(companyName);
  if (!norm) return null;
  const r = await q.query<{ manager_id: number; name: string; hint: string }>(
    `SELECT h.manager_id, m.name, h.hint FROM client_manager_hints h JOIN users m ON m.id = h.manager_id
     WHERE h.hint_norm = $1 AND m.status = 'approved'`,
    [norm],
  );
  const row = r.rows[0];
  return row ? { managerId: row.manager_id, managerName: row.name, hint: row.hint } : null;
}

export async function assignCompany(q: Queryable, companyId: number, managerId: number): Promise<void> {
  await q.query('UPDATE companies SET manager_id = $1 WHERE id = $2 AND manager_id IS NULL', [managerId, companyId]);
  await q.query('INSERT INTO company_manager_history (company_id, from_manager_id, to_manager_id, changed_by) VALUES ($1, NULL, $2, NULL)', [companyId, managerId]);
}

/** Загружает подсказки: пары [имя менеджера, клиент]. Повторная загрузка обновляет менеджера у уже известного клиента. */
export async function loadHints(q: Queryable, pairs: [string, string][]): Promise<{ saved: number }> {
  let saved = 0;
  for (const [managerName, client] of pairs) {
    const m = await q.query<{ id: number }>(`SELECT id FROM users WHERE role = 'manager' AND name = $1`, [managerName]);
    if (m.rows.length !== 1) throw new Error(`Менеджер «${managerName}»: найдено ${m.rows.length}, нужен ровно один`);
    const norm = normalizeName(client);
    if (!norm) throw new Error(`Пустое название клиента для менеджера «${managerName}»`);
    await q.query(
      `INSERT INTO client_manager_hints (hint, hint_norm, manager_id) VALUES ($1, $2, $3)
       ON CONFLICT (hint_norm) DO UPDATE SET hint = EXCLUDED.hint, manager_id = EXCLUDED.manager_id`,
      [client.trim(), norm, m.rows[0]!.id],
    );
    saved++;
  }
  return { saved };
}

/** Назначает менеджеров уже существующим нераспределённым компаниям по точному совпадению. */
export async function applyHints(q: Queryable): Promise<{ companyId: number; name: string; managerName: string }[]> {
  const free = await q.query<{ id: number; name: string }>('SELECT id, name FROM companies WHERE manager_id IS NULL ORDER BY id');
  const done: { companyId: number; name: string; managerName: string }[] = [];
  for (const c of free.rows) {
    const hit = await findHintManager(q, c.name);
    if (!hit) continue;
    await assignCompany(q, c.id, hit.managerId);
    done.push({ companyId: c.id, name: c.name, managerName: hit.managerName });
  }
  return done;
}

/**
 * Приблизительные совпадения для проверки человеком. Ничего не меняет.
 * Сравниваем целыми словами; короткие названия (меньше 4 букв) не предлагаем: слишком много случайных совпадений.
 */
export async function suggestHints(q: Queryable): Promise<{ companyId: number; name: string; hint: string; managerName: string }[]> {
  const free = await q.query<{ id: number; name: string }>('SELECT id, name FROM companies WHERE manager_id IS NULL ORDER BY id');
  const hints = await q.query<{ hint: string; hint_norm: string; name: string }>(
    'SELECT h.hint, h.hint_norm, m.name FROM client_manager_hints h JOIN users m ON m.id = h.manager_id',
  );
  const out: { companyId: number; name: string; hint: string; managerName: string }[] = [];
  for (const c of free.rows) {
    const norm = normalizeName(c.name);
    for (const h of hints.rows) {
      if (norm === h.hint_norm) continue;
      // Совпадение целыми словами, и более короткое из названий не короче 4 букв: «Гор» не похоже на «Горелышев», «АС+» не похоже на «Рашид Гасайниев».
      const [short, long] = norm.length <= h.hint_norm.length ? [norm, h.hint_norm] : [h.hint_norm, norm];
      if (short.length < 4 || !` ${long} `.includes(` ${short} `)) continue;
      out.push({ companyId: c.id, name: c.name, hint: h.hint, managerName: h.name });
    }
  }
  return out;
}

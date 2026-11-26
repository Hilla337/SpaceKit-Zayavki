import { hashPassword, normalizePhone } from './auth.js';
import type { Queryable } from './db.js';

/**
 * Первый админ на новом стенде без командной строки: телефон и пароль приходят из окружения
 * (BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME).
 * Создаёт админа, если такого номера нет, и задаёт пароль, только если его ещё нет.
 * Уже заданный пароль не трогает: сменённый в приложении пароль переживёт перезапуск.
 */
export async function ensureBootstrapAdmin(q: Queryable, env: NodeJS.ProcessEnv = process.env): Promise<'created' | 'password_set' | 'unchanged' | 'skipped'> {
  const phone = env.BOOTSTRAP_ADMIN_PHONE ? normalizePhone(env.BOOTSTRAP_ADMIN_PHONE) : null;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  if (!phone || password.length < 6) return 'skipped';
  const name = (env.BOOTSTRAP_ADMIN_NAME ?? 'Администратор').trim() || 'Администратор';
  const u = (await q.query<{ id: number; role: string; password_hash: string | null }>('SELECT id, role, password_hash FROM users WHERE phone = $1', [phone])).rows[0];
  if (!u) {
    await q.query(`INSERT INTO users (phone, name, role, status, password_hash) VALUES ($1, $2, 'admin', 'approved', $3)`, [phone, name, await hashPassword(password)]);
    return 'created';
  }
  if (u.role !== 'customer' && !u.password_hash) {
    await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, await hashPassword(password)]);
    return 'password_set';
  }
  return 'unchanged';
}

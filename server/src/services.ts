import { config } from './config.js';
import type { Queryable } from './db.js';

export async function addHistory(q: Queryable, requestId: number, actorId: number | null, text: string): Promise<void> {
  await q.query('INSERT INTO request_history (request_id, actor_id, text) VALUES ($1, $2, $3)', [requestId, actorId, text]);
}

export async function notifyUsers(q: Queryable, userIds: number[], requestId: number | null, text: string): Promise<void> {
  for (const id of new Set(userIds)) {
    await q.query('INSERT INTO notifications (user_id, request_id, text) VALUES ($1, $2, $3)', [id, requestId, text]);
  }
}

/** Менеджер, который ведёт компанию; если клиента пока никто не ведёт, то все менеджеры. */
export async function staffOfCompany(q: Queryable, companyId: number): Promise<number[]> {
  const own = await q.query<{ id: number }>(
    `SELECT m.id FROM companies c JOIN users m ON m.id = c.manager_id
     WHERE c.id = $1 AND m.status = 'approved'`,
    [companyId],
  );
  if (own.rows.length > 0) return own.rows.map((r) => r.id);
  const all = await q.query<{ id: number }>(`SELECT id FROM users WHERE role = 'manager' AND status = 'approved'`);
  return all.rows.map((r) => r.id);
}

export async function customersOfCompany(q: Queryable, companyId: number): Promise<number[]> {
  const r = await q.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'customer' AND company_id = $1 AND status = 'approved'`,
    [companyId],
  );
  return r.rows.map((x) => x.id);
}

/** Уведомление без повтора: если у человека уже есть непрочитанное такое же по этой заявке, второе не создаём (например, серия сообщений в чате). */
export async function notifyUsersOnce(q: Queryable, userIds: number[], requestId: number, text: string): Promise<void> {
  for (const id of new Set(userIds)) {
    await q.query(
      `INSERT INTO notifications (user_id, request_id, text)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND request_id = $2 AND text = $3 AND read_at IS NULL)`,
      [id, requestId, text],
    );
  }
}

/**
 * Ставит SMS в очередь заказчикам из списка. Получают только подтверждённые заказчики с телефоном,
 * которые не отключили SMS. Сама отправка идёт отдельно (src/sms.ts).
 */
export async function smsToCustomers(q: Queryable, userIds: number[], requestId: number | null, text: string): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const body = config.appUrl ? `SpaceKit: ${text} ${config.appUrl}` : `SpaceKit: ${text}`;
  const placeholders = ids.map((_, i) => `$${i + 3}`).join(', ');
  await q.query(
    `INSERT INTO sms_outbox (user_id, phone, text, request_id)
     SELECT id, phone, $1, $2 FROM users
     WHERE id IN (${placeholders}) AND role = 'customer' AND status = 'approved' AND sms_enabled AND phone IS NOT NULL`,
    [body, requestId, ...ids],
  );
}

/** Уведомление в приложении и SMS заказчикам. */
export async function notifyCustomers(q: Queryable, userIds: number[], requestId: number | null, text: string): Promise<void> {
  await notifyUsers(q, userIds, requestId, text);
  await smsToCustomers(q, userIds, requestId, text);
}

import type { FastifyInstance } from 'fastify';
import { canViewRequest } from './access.js';
import type { AuthedUser, Deps } from './app.js';
import { parseId } from './routes-companies.js';
import { companyInfo, loadRequest, requestInfo, type RequestRow } from './routes-requests.js';
import { customersOfCompany, notifyUsersOnce, staffOfCompany } from './services.js';

/** Чат ведут заказчик, менеджер клиента и админ. Сборщик переписку не видит. */
const canChat = (u: AuthedUser, r: RequestRow): boolean => u.role !== 'picker' && canViewRequest(u, requestInfo(r), companyInfo(r));

export function registerChatRoutes(app: FastifyInstance, deps: Deps, clock: () => Date): void {
  const { db } = deps;

  // ---- чат в заявке ----
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/requests/:id/messages', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    const id = parseId(req.params.id);
    if (!id) return reply.code(404).send({ error: 'not_found' });
    const r = await loadRequest(db, id);
    if (!r || !canChat(u, r)) return reply.code(404).send({ error: 'not_found' });

    const after = Number(req.query.after ?? 0);
    const rows = await db.query<{ id: number; author_id: number; name: string; role: string; text: string; created_at: Date }>(
      `SELECT m.id, m.author_id, a.name, a.role, m.text, m.created_at
       FROM messages m JOIN users a ON a.id = m.author_id
       WHERE m.request_id = $1 AND m.id > $2 ORDER BY m.id LIMIT 200`,
      [id, Number.isSafeInteger(after) && after > 0 ? after : 0],
    );
    return rows.rows.map((m) => ({ id: m.id, authorId: m.author_id, authorName: m.name, authorRole: m.role, text: m.text, createdAt: m.created_at, mine: m.author_id === u.id }));
  });

  app.post<{ Params: { id: string }; Body: { text: string } }>(
    '/requests/:id/messages',
    {
      preHandler: app.authenticate,
      schema: { body: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } } } },
    },
    async (req, reply) => {
      const u = req.user!;
      const id = parseId(req.params.id);
      if (!id) return reply.code(404).send({ error: 'not_found' });
      const text = req.body.text.trim();
      if (!text) return reply.code(422).send({ error: 'empty' });

      const result = await db.tx(async (q) => {
        const r = await loadRequest(q, id);
        if (!r || !canChat(u, r)) return null;
        const ins = await q.query<{ id: number; created_at: Date }>('INSERT INTO messages (request_id, author_id, text) VALUES ($1, $2, $3) RETURNING id, created_at', [id, u.id, text]);

        // Второй стороне — уведомление в приложении (SMS на переписку не шлём, чтобы не надоедать).
        const others =
          u.role === 'customer'
            ? await staffOfCompany(q, r.company_id)
            : await customersOfCompany(q, r.company_id);
        await notifyUsersOnce(q, others.filter((x) => x !== u.id), id, `Новое сообщение по заявке №${id}`);
        return ins.rows[0]!;
      });

      if (!result) return reply.code(404).send({ error: 'not_found' });
      return reply.code(201).send({ id: result.id, authorId: u.id, authorName: u.name, authorRole: u.role, text, createdAt: result.created_at, mine: true });
    },
  );

  // ---- уведомления ----
  app.get<{ Querystring: { unread?: string } }>('/notifications', { preHandler: app.authenticate }, async (req) => {
    const u = req.user!;
    const onlyUnread = req.query.unread === '1' || req.query.unread === 'true';
    const rows = await db.query<{ id: number; request_id: number | null; text: string; created_at: Date; read_at: Date | null }>(
      `SELECT id, request_id, text, created_at, read_at FROM notifications
       WHERE user_id = $1 ${onlyUnread ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT 100`,
      [u.id],
    );
    return rows.rows.map((n) => ({ id: n.id, requestId: n.request_id, text: n.text, createdAt: n.created_at, read: n.read_at !== null }));
  });

  app.post('/notifications/read-all', { preHandler: app.authenticate }, async (req) => {
    const r = await db.query<{ id: number }>('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL RETURNING id', [req.user!.id, clock()]);
    return { marked: r.rows.length };
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/read', { preHandler: app.authenticate }, async (req, reply) => {
    const id = parseId(req.params.id);
    if (!id) return reply.code(404).send({ error: 'not_found' });
    // Чужое уведомление отметить нельзя и не отличить от несуществующего.
    const r = await db.query<{ id: number }>('UPDATE notifications SET read_at = COALESCE(read_at, $3) WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user!.id, clock()]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ---- настройка SMS у себя ----
  app.patch<{ Body: { smsEnabled: boolean } }>(
    '/me',
    {
      preHandler: app.authenticate,
      schema: { body: { type: 'object', required: ['smsEnabled'], additionalProperties: false, properties: { smsEnabled: { type: 'boolean' } } } },
    },
    async (req) => {
      await db.query('UPDATE users SET sms_enabled = $2 WHERE id = $1', [req.user!.id, req.body.smsEnabled]);
      return { smsEnabled: req.body.smsEnabled };
    },
  );
}

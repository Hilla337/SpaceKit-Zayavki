import type { FastifyInstance } from 'fastify';
import { canViewRequest } from './access.js';
import type { AuthedUser, Deps } from './app.js';
import type { Queryable } from './db.js';
import { parseId } from './routes-companies.js';
import { companyInfo, loadRequest, requestInfo, type RequestRow } from './routes-requests.js';
import { vapidKeys } from './push.js';
import { customersOfCompany, notifyUsersOnce, staffOfCompany } from './services.js';

/** Чат ведут заказчик, менеджер клиента и админ. Сборщик переписку не видит. */
const canChat = (u: AuthedUser, r: RequestRow): boolean => u.role !== 'picker' && canViewRequest(u, requestInfo(r), companyInfo(r));

/** Реакции, которые можно поставить (как быстрые реакции в Telegram). */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👌'];
/** Самое большое вложение: видео с телефона обычно укладывается. */
export const MAX_ATTACHMENT = 25 * 1024 * 1024;
const KINDS = ['photo', 'video', 'voice', 'file'] as const;
type Kind = (typeof KINDS)[number];

interface MsgRow {
  id: number;
  author_id: number;
  name: string;
  role: string;
  text: string;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  reply_to_id: number | null;
  attachment_id: number | null;
  a_kind: Kind | null;
  a_mime: string | null;
  a_name: string | null;
  a_size: number | null;
  a_duration: number | null;
  r_author: string | null;
  r_text: string | null;
  r_kind: Kind | null;
  r_deleted: Date | null;
}

const MSG_SELECT = `
  SELECT m.id, m.author_id, a.name, a.role, m.text, m.created_at, m.edited_at, m.deleted_at, m.reply_to_id, m.attachment_id,
         f.kind AS a_kind, f.mime AS a_mime, f.name AS a_name, f.size AS a_size, f.duration_ms AS a_duration,
         ra.name AS r_author, r.text AS r_text, rf.kind AS r_kind, r.deleted_at AS r_deleted
  FROM messages m
  JOIN users a ON a.id = m.author_id
  LEFT JOIN attachments f ON f.id = m.attachment_id
  LEFT JOIN messages r ON r.id = m.reply_to_id
  LEFT JOIN users ra ON ra.id = r.author_id
  LEFT JOIN attachments rf ON rf.id = r.attachment_id`;

/** Сообщения в том виде, как их показывает приложение. Удалённое приходит без текста и вложения, чтобы у второй стороны оно тоже исчезло. */
async function presentMessages(q: Queryable, requestId: number, rows: MsgRow[], userId: number) {
  const ids = rows.map((m) => m.id);
  const reactions = ids.length
    ? (await q.query<{ message_id: number; emoji: string; user_id: number }>('SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id = ANY($1::bigint[])', [ids])).rows
    : [];
  // Прочитано второй стороной: кто-то, кроме автора, дочитал до этого сообщения.
  const reads = (await q.query<{ user_id: number; last_read_id: number }>('SELECT user_id, last_read_id FROM chat_reads WHERE request_id = $1', [requestId])).rows;
  return rows.map((m) => {
    const deleted = m.deleted_at !== null;
    const mine = m.author_id === userId;
    const rx = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of reactions.filter((x) => x.message_id === m.id)) {
      const e = rx.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      e.count++;
      if (r.user_id === userId) e.mine = true;
      rx.set(r.emoji, e);
    }
    return {
      id: m.id,
      authorId: m.author_id,
      authorName: m.name,
      authorRole: m.role,
      text: deleted ? '' : m.text,
      createdAt: m.created_at,
      editedAt: deleted ? null : m.edited_at,
      deleted,
      mine,
      read: mine && reads.some((r) => r.user_id !== m.author_id && r.last_read_id >= m.id),
      replyTo: !deleted && m.reply_to_id ? { id: m.reply_to_id, authorName: m.r_author, text: m.r_deleted ? '' : (m.r_text ?? ''), kind: m.r_deleted ? null : m.r_kind, deleted: m.r_deleted !== null } : null,
      attachment: !deleted && m.attachment_id ? { id: m.attachment_id, kind: m.a_kind, mime: m.a_mime, name: m.a_name, size: m.a_size, durationMs: m.a_duration } : null,
      reactions: deleted ? [] : [...rx.values()],
    };
  });
}

export function registerChatRoutes(app: FastifyInstance, deps: Deps, clock: () => Date): void {
  const { db } = deps;

  async function chatRequest(u: AuthedUser, rawId: string, q: Queryable = db): Promise<RequestRow | null> {
    const id = parseId(rawId);
    if (!id) return null;
    const r = await loadRequest(q, id);
    return r && canChat(u, r) ? r : null;
  }

  // ---- переписка: список. Открытие переписки отмечает её прочитанной. ----
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/requests/:id/messages', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    const r = await chatRequest(u, req.params.id);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const after = Number(req.query.after ?? 0);
    const rows = (
      await db.query<MsgRow>(`${MSG_SELECT} WHERE m.request_id = $1 AND m.id > $2 ORDER BY m.id DESC LIMIT 300`, [r.id, Number.isSafeInteger(after) && after > 0 ? after : 0])
    ).rows.reverse();
    const last = rows.at(-1)?.id;
    if (last) {
      await db.query(
        `INSERT INTO chat_reads (request_id, user_id, last_read_id) VALUES ($1, $2, $3)
         ON CONFLICT (request_id, user_id) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
        [r.id, u.id, last],
      );
    }
    return presentMessages(db, r.id, rows, u.id);
  });

  // ---- новое сообщение: текст, вложение или оба; можно ответом на другое ----
  app.post<{ Params: { id: string }; Body: { text?: string; attachmentId?: number; replyToId?: number } }>(
    '/requests/:id/messages',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', maxLength: 4000 }, attachmentId: { type: 'integer', minimum: 1 }, replyToId: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (req, reply) => {
      const u = req.user!;
      const text = (req.body.text ?? '').trim();
      const { attachmentId, replyToId } = req.body;
      if (!text && !attachmentId) return reply.code(422).send({ error: 'empty' });

      type Out = { ok: true; id: number; requestId: number } | { ok: false; status: number; error: string };
      const out = await db.tx<Out>(async (q) => {
        const r = await chatRequest(u, req.params.id, q);
        if (!r) return { ok: false, status: 404, error: 'not_found' };
        if (attachmentId) {
          // Вложение своё, из этой заявки и ещё не отправлено.
          const a = (
            await q.query<{ kind: string }>(
              'SELECT kind FROM attachments f WHERE id = $1 AND request_id = $2 AND uploader_id = $3 AND NOT EXISTS (SELECT 1 FROM messages WHERE attachment_id = f.id)',
              [attachmentId, r.id, u.id],
            )
          ).rows[0];
          if (!a) return { ok: false, status: 422, error: 'bad_attachment' };
        }
        if (replyToId) {
          const ok = (await q.query('SELECT 1 FROM messages WHERE id = $1 AND request_id = $2', [replyToId, r.id])).rows[0];
          if (!ok) return { ok: false, status: 422, error: 'bad_reply' };
        }
        const ins = await q.query<{ id: number }>(
          'INSERT INTO messages (request_id, author_id, text, attachment_id, reply_to_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [r.id, u.id, text, attachmentId ?? null, replyToId ?? null],
        );
        const id = ins.rows[0]!.id;
        // Своё сообщение — значит, переписка прочитана до него.
        await q.query(
          `INSERT INTO chat_reads (request_id, user_id, last_read_id) VALUES ($1, $2, $3)
           ON CONFLICT (request_id, user_id) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
          [r.id, u.id, id],
        );
        // Второй стороне — уведомление в приложении (SMS на переписку не шлём, чтобы не надоедать).
        const others = u.role === 'customer' ? await staffOfCompany(q, r.company_id) : await customersOfCompany(q, r.company_id);
        await notifyUsersOnce(q, others.filter((x) => x !== u.id), r.id, `Новое сообщение по заявке №${r.id}`);
        return { ok: true, id, requestId: r.id };
      });
      if (!out.ok) return reply.code(out.status).send({ error: out.error });
      const rows = (await db.query<MsgRow>(`${MSG_SELECT} WHERE m.id = $1`, [out.id])).rows;
      const [m] = await presentMessages(db, out.requestId, rows, u.id);
      return reply.code(201).send(m);
    },
  );

  // ---- правка своего сообщения ----
  app.patch<{ Params: { id: string; mid: string }; Body: { text: string } }>(
    '/requests/:id/messages/:mid',
    {
      preHandler: app.authenticate,
      schema: { body: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', maxLength: 4000 } } } },
    },
    async (req, reply) => {
      const u = req.user!;
      const r = await chatRequest(u, req.params.id);
      const mid = parseId(req.params.mid);
      if (!r || !mid) return reply.code(404).send({ error: 'not_found' });
      const m = (await db.query<{ author_id: number; attachment_id: number | null; deleted_at: Date | null }>('SELECT author_id, attachment_id, deleted_at FROM messages WHERE id = $1 AND request_id = $2', [mid, r.id])).rows[0];
      if (!m || m.deleted_at) return reply.code(404).send({ error: 'not_found' });
      if (m.author_id !== u.id) return reply.code(403).send({ error: 'forbidden' });
      const text = req.body.text.trim();
      if (!text && !m.attachment_id) return reply.code(422).send({ error: 'empty' });
      await db.query('UPDATE messages SET text = $2, edited_at = $3 WHERE id = $1', [mid, text, clock()]);
      const [out] = await presentMessages(db, r.id, (await db.query<MsgRow>(`${MSG_SELECT} WHERE m.id = $1`, [mid])).rows, u.id);
      return out;
    },
  );

  // ---- удаление своего сообщения (админ может удалить любое). Вложение удаляется вместе с ним. ----
  app.delete<{ Params: { id: string; mid: string } }>('/requests/:id/messages/:mid', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    const r = await chatRequest(u, req.params.id);
    const mid = parseId(req.params.mid);
    if (!r || !mid) return reply.code(404).send({ error: 'not_found' });
    const res = await db.tx(async (q) => {
      const m = (await q.query<{ author_id: number; attachment_id: number | null; deleted_at: Date | null }>('SELECT author_id, attachment_id, deleted_at FROM messages WHERE id = $1 AND request_id = $2 FOR UPDATE', [mid, r.id])).rows[0];
      if (!m || m.deleted_at) return 404;
      if (m.author_id !== u.id && u.role !== 'admin') return 403;
      await q.query(`UPDATE messages SET deleted_at = $2, text = '', attachment_id = NULL WHERE id = $1`, [mid, clock()]);
      await q.query('DELETE FROM message_reactions WHERE message_id = $1', [mid]);
      if (m.attachment_id) await q.query('DELETE FROM attachments WHERE id = $1', [m.attachment_id]);
      return 200;
    });
    if (res === 404) return reply.code(404).send({ error: 'not_found' });
    if (res === 403) return reply.code(403).send({ error: 'forbidden' });
    return { ok: true };
  });

  // ---- реакция: поставить, сменить или убрать (emoji = null) ----
  app.post<{ Params: { id: string; mid: string }; Body: { emoji: string | null } }>(
    '/requests/:id/messages/:mid/reaction',
    {
      preHandler: app.authenticate,
      schema: { body: { type: 'object', required: ['emoji'], additionalProperties: false, properties: { emoji: { type: ['string', 'null'], enum: [...REACTIONS, null] } } } },
    },
    async (req, reply) => {
      const u = req.user!;
      const r = await chatRequest(u, req.params.id);
      const mid = parseId(req.params.mid);
      if (!r || !mid) return reply.code(404).send({ error: 'not_found' });
      const ok = (await db.query('SELECT 1 FROM messages WHERE id = $1 AND request_id = $2 AND deleted_at IS NULL', [mid, r.id])).rows[0];
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      if (req.body.emoji === null) await db.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [mid, u.id]);
      else {
        await db.query(
          `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`,
          [mid, u.id, req.body.emoji],
        );
      }
      const [out] = await presentMessages(db, r.id, (await db.query<MsgRow>(`${MSG_SELECT} WHERE m.id = $1`, [mid])).rows, u.id);
      return out;
    },
  );

  // ---- вложения: загрузка (тело — сами байты) и выдача ----
  void app.register(async (sub) => {
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_ATTACHMENT }, (_req, body, done) => done(null, body));
    sub.post<{ Params: { id: string }; Querystring: { name?: string; kind?: string; duration?: string }; Body: Buffer }>(
      '/requests/:id/attachments',
      { preHandler: app.authenticate, bodyLimit: MAX_ATTACHMENT },
      async (req, reply) => {
        const u = req.user!;
        const r = await chatRequest(u, req.params.id);
        if (!r) return reply.code(404).send({ error: 'not_found' });
        const data = req.body;
        if (!Buffer.isBuffer(data) || data.length === 0) return reply.code(400).send({ error: 'empty' });
        const mime = String(req.headers['x-file-type'] ?? 'application/octet-stream').slice(0, 100).toLowerCase();
        if (!/^[a-z]+\/[a-z0-9.+-]+(;.*)?$/.test(mime)) return reply.code(400).send({ error: 'bad_type' });
        const name = (req.query.name ?? 'файл').replace(/[\\/\r\n]/g, '_').slice(0, 200) || 'файл';
        const kind: Kind =
          req.query.kind === 'voice' && mime.startsWith('audio/') ? 'voice' : mime.startsWith('image/') ? 'photo' : mime.startsWith('video/') ? 'video' : 'file';
        const duration = Number(req.query.duration);
        const ins = await db.query<{ id: number }>(
          'INSERT INTO attachments (request_id, uploader_id, kind, mime, name, size, duration_ms, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [r.id, u.id, kind, mime, name, data.length, Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null, data],
        );
        return reply.code(201).send({ id: ins.rows[0]!.id, kind, mime, name, size: data.length });
      },
    );
  });

  app.get<{ Params: { aid: string } }>('/attachments/:aid', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    const aid = parseId(req.params.aid);
    if (!aid) return reply.code(404).send({ error: 'not_found' });
    const a = (await db.query<{ request_id: number; mime: string; name: string; data: Uint8Array }>('SELECT request_id, mime, name, data FROM attachments WHERE id = $1', [aid])).rows[0];
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const r = await loadRequest(db, a.request_id);
    if (!r || !canChat(u, r)) return reply.code(404).send({ error: 'not_found' });
    reply
      .header('content-type', a.mime)
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`)
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff');
    return Buffer.from(a.data);
  });

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

  // ---- push-уведомления в браузер ----
  // Открытый ключ сервера нужен браузеру для подписки; он не секретный.
  app.get('/push/key', async () => ({ publicKey: (await vapidKeys(db)).publicKey }));

  app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string } } }>(
    '/push/subscribe',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['endpoint', 'keys'],
          properties: {
            endpoint: { type: 'string', pattern: '^https://', maxLength: 1000 },
            keys: { type: 'object', required: ['p256dh', 'auth'], properties: { p256dh: { type: 'string', maxLength: 200 }, auth: { type: 'string', maxLength: 100 } } },
          },
        },
      },
    },
    async (req) => {
      // Одно устройство — одна подписка; если на нём вошёл другой человек, подписка переходит к нему.
      await db.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [req.user!.id, req.body.endpoint, req.body.keys.p256dh, req.body.keys.auth],
      );
      return { ok: true };
    },
  );

  app.post<{ Body: { endpoint: string } }>(
    '/push/unsubscribe',
    { preHandler: app.authenticate, schema: { body: { type: 'object', required: ['endpoint'], properties: { endpoint: { type: 'string', maxLength: 1000 } } } } },
    async (req) => {
      await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [req.body.endpoint, req.user!.id]);
      return { ok: true };
    },
  );

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


import type { FastifyInstance } from 'fastify';
import type { Deps } from './app.js';
import { assignCompany, findHintManager } from './hints.js';
import {
  CODE_TTL_MS,
  CODES_PER_WINDOW,
  CODES_WINDOW_MS,
  generateCode,
  hashCode,
  hashToken,
  MAX_ATTEMPTS,
  newSessionToken,
  normalizePhone,
  safeEqualHex,
  SESSION_TTL_MS,
} from './auth.js';

interface CodeRow {
  id: number;
  code_hash: string;
  attempts: number;
  expires_at: Date;
}

export function registerAuthRoutes(app: FastifyInstance, deps: Deps, clock: () => Date): void {
  const { db, sender, pepper } = deps;

  // Лимит по IP держим в памяти: это защита от дешёвых накруток звонков.
  // При нескольких экземплярах сервера лимит у каждого свой; основной лимит по номеру хранится в базе.
  const ipHits = new Map<string, number[]>();
  const IP_LIMIT = 10;
  const IP_WINDOW_MS = 3600_000;

  app.post<{ Body: { phone: string } }>(
    '/auth/request-code',
    { schema: { body: { type: 'object', required: ['phone'], additionalProperties: false, properties: { phone: { type: 'string', maxLength: 40 } } } } },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      if (!phone) return reply.code(400).send({ error: 'bad_phone' });

      const now = clock();
      const hits = (ipHits.get(req.ip) ?? []).filter((t) => now.getTime() - t < IP_WINDOW_MS);
      if (hits.length >= IP_LIMIT) return reply.code(429).send({ error: 'too_many_requests' });
      hits.push(now.getTime());
      ipHits.set(req.ip, hits);

      const recent = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM login_codes WHERE phone = $1 AND created_at > $2',
        [phone, new Date(now.getTime() - CODES_WINDOW_MS)],
      );
      if ((recent.rows[0]?.n ?? 0) >= CODES_PER_WINDOW) return reply.code(429).send({ error: 'too_many_requests' });

      const code = generateCode();
      await db.query('INSERT INTO login_codes (phone, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)', [
        phone,
        hashCode(pepper, phone, code),
        new Date(now.getTime() + CODE_TTL_MS),
        now,
      ]);

      try {
        await sender.send(phone, code);
      } catch (err) {
        req.log.error({ err }, 'не удалось отправить код');
        return reply.code(502).send({ error: 'send_failed' });
      }
      // Отвечаем одинаково для известных и неизвестных номеров, чтобы нельзя было перебирать клиентов.
      return { ok: true, expiresInSec: CODE_TTL_MS / 1000 };
    },
  );

  app.post<{ Body: { phone: string; code: string; name?: string; company?: string } }>(
    '/auth/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'code'],
          additionalProperties: false,
          properties: {
            phone: { type: 'string', maxLength: 40 },
            code: { type: 'string', pattern: '^\\d{4}$' },
            name: { type: 'string', maxLength: 120 },
            company: { type: 'string', maxLength: 160 },
          },
        },
      },
    },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      if (!phone) return reply.code(400).send({ error: 'bad_phone' });
      const now = clock();

      type Outcome =
        | { kind: 'invalid' }
        | { kind: 'locked' }
        | { kind: 'profile_required' }
        | { kind: 'blocked' }
        | { kind: 'ok'; token: string; user: { id: number; name: string; role: string; status: string; companyId: number | null } };

      const outcome = await db.tx<Outcome>(async (q) => {
        const found = await q.query<CodeRow>(
          `SELECT id, code_hash, attempts, expires_at FROM login_codes
           WHERE phone = $1 AND used = false AND expires_at > $2
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [phone, now],
        );
        const row = found.rows[0];
        if (!row) return { kind: 'invalid' };
        if (row.attempts >= MAX_ATTEMPTS) return { kind: 'locked' };

        if (!safeEqualHex(row.code_hash, hashCode(pepper, phone, req.body.code))) {
          await q.query('UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
          return { kind: 'invalid' };
        }

        const existing = await q.query<{ id: number; name: string; role: string; status: string; company_id: number | null }>(
          'SELECT id, name, role, status, company_id FROM users WHERE phone = $1',
          [phone],
        );
        let user = existing.rows[0];

        if (user?.status === 'blocked') return { kind: 'blocked' };

        if (!user) {
          const name = req.body.name?.trim();
          const company = req.body.company?.trim();
          // Код при этом не тратим: клиент допишет имя и компанию и отправит тот же код ещё раз.
          if (!name || !company) return { kind: 'profile_required' };

          // Новая компания всегда создаётся отдельной записью и ждёт подтверждения менеджером.
          // По названию к существующей компании человека не привязываем: так нельзя увидеть чужие заявки.
          const c = await q.query<{ id: number }>(`INSERT INTO companies (name, status) VALUES ($1, 'pending') RETURNING id`, [company]);
          const companyId = c.rows[0]!.id;
          // Если название точно совпало с подсказкой, компания сразу попадает к своему менеджеру.
          // Подтверждает её всё равно менеджер: подсказка лишь выбирает, кто.
          const hit = await findHintManager(q, company);
          if (hit) await assignCompany(q, companyId, hit.managerId);
          const u = await q.query<{ id: number; name: string; role: string; status: string; company_id: number | null }>(
            `INSERT INTO users (phone, name, role, company_id, status) VALUES ($1, $2, 'customer', $3, 'pending')
             RETURNING id, name, role, status, company_id`,
            [phone, name, companyId],
          );
          user = u.rows[0]!;
        }

        await q.query('UPDATE login_codes SET used = true WHERE id = $1', [row.id]);

        const token = newSessionToken();
        await q.query('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)', [
          user.id,
          hashToken(token),
          new Date(now.getTime() + SESSION_TTL_MS),
          now,
        ]);
        return { kind: 'ok', token, user: { id: user.id, name: user.name, role: user.role, status: user.status, companyId: user.company_id } };
      });

      switch (outcome.kind) {
        case 'invalid':
          return reply.code(401).send({ error: 'invalid_code' });
        case 'locked':
          return reply.code(429).send({ error: 'too_many_attempts' });
        case 'blocked':
          return reply.code(403).send({ error: 'blocked' });
        case 'profile_required':
          return reply.code(422).send({ error: 'profile_required' });
        case 'ok':
          return { token: outcome.token, user: outcome.user };
      }
    },
  );

  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const u = req.user!;
    const extra = await db.query<{ unread: number; sms_enabled: boolean }>(
      `SELECT (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS unread, sms_enabled FROM users WHERE id = $1`,
      [u.id],
    );
    const e = extra.rows[0];
    return { id: u.id, name: u.name, role: u.role, status: u.status, companyId: u.companyId, unreadNotifications: e?.unread ?? 0, smsEnabled: e?.sms_enabled ?? true };
  });

  app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    const header = req.headers.authorization ?? '';
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(header.slice(7).trim())]);
    return reply.code(204).send();
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthedUser, Deps } from './app.js';
import {
  generateCode,
  hashCode,
  hashPassword,
  hashToken,
  LOCK_MS,
  LOGIN_FAILS,
  MAX_ATTEMPTS,
  newSessionToken,
  normalizePhone,
  PASSWORD_MIN,
  RESET_TTL_MS,
  safeEqualHex,
  SESSION_TTL_MS,
  verifyPassword,
} from './auth.js';
import { config } from './config.js';
import type { Queryable } from './db.js';
import { assignCompany, findHintManager } from './hints.js';
import { parseId } from './routes-companies.js';

interface UserRow {
  id: number;
  name: string;
  role: string;
  status: string;
  company_id: number | null;
  password_hash: string | null;
  failed_logins: number;
  locked_until: Date | null;
}

const PHONE = { type: 'string', maxLength: 40 } as const;
const PASSWORD = { type: 'string', minLength: PASSWORD_MIN, maxLength: 200 } as const;

export function registerAuthRoutes(app: FastifyInstance, deps: Deps, clock: () => Date): void {
  const { db, pepper } = deps;

  // Лимит попыток с одного адреса держим в памяти: защита от перебора паролей по многим номерам.
  // Основная защита — блокировка номера после серии ошибок, она хранится в базе.
  const ipHits = new Map<string, number[]>();
  const IP_LIMIT = 30;
  const IP_WINDOW_MS = 15 * 60_000;
  function ipLimited(req: FastifyRequest): boolean {
    const t = clock().getTime();
    const hits = (ipHits.get(req.ip) ?? []).filter((x) => t - x < IP_WINDOW_MS);
    if (hits.length >= IP_LIMIT) return true;
    hits.push(t);
    ipHits.set(req.ip, hits);
    if (ipHits.size > 10_000) ipHits.clear(); // не даём карте расти бесконечно
    return false;
  }

  async function openSession(q: Queryable, user: Pick<UserRow, 'id' | 'name' | 'role' | 'status' | 'company_id'>) {
    const token = newSessionToken();
    const now = clock();
    await q.query('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)', [user.id, hashToken(token), new Date(now.getTime() + SESSION_TTL_MS), now]);
    return { token, user: { id: user.id, name: user.name, role: user.role, status: user.status, companyId: user.company_id } };
  }
  const bad = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

  // ---- регистрация заказчика: отдельная новая компания в статусе «ожидает» ----
  app.post<{ Body: { phone: string; password: string; name: string; company: string } }>(
    '/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'password', 'name', 'company'],
          additionalProperties: false,
          properties: { phone: PHONE, password: PASSWORD, name: { type: 'string', minLength: 1, maxLength: 120 }, company: { type: 'string', minLength: 1, maxLength: 160 } },
        },
      },
    },
    async (req, reply) => {
      if (ipLimited(req)) return bad(reply, 429, 'too_many_requests');
      const phone = normalizePhone(req.body.phone);
      if (!phone) return bad(reply, 400, 'bad_phone');
      const name = req.body.name.trim();
      const company = req.body.company.trim();
      if (!name || !company) return bad(reply, 422, 'profile_required');
      const hash = await hashPassword(req.body.password);

      const out = await db.tx(async (q) => {
        const exists = await q.query('SELECT 1 FROM users WHERE phone = $1', [phone]);
        if (exists.rows[0]) return null;
        // Новая компания всегда создаётся отдельной записью и ждёт подтверждения менеджером.
        // По названию к существующей компании человека не привязываем: так нельзя увидеть чужие заявки.
        const c = await q.query<{ id: number }>(`INSERT INTO companies (name, status) VALUES ($1, 'pending') RETURNING id`, [company]);
        const companyId = c.rows[0]!.id;
        // Если название точно совпало с подсказкой, компания сразу попадает к своему менеджеру (подтверждает всё равно он).
        const hit = await findHintManager(q, company);
        if (hit) await assignCompany(q, companyId, hit.managerId);
        const u = await q.query<UserRow>(
          `INSERT INTO users (phone, name, role, company_id, status, password_hash) VALUES ($1, $2, 'customer', $3, 'pending', $4)
           RETURNING id, name, role, status, company_id`,
          [phone, name, companyId, hash],
        );
        return openSession(q, u.rows[0]!);
      });
      // Номер уже есть: пусть войдёт или попросит менеджера сбросить пароль.
      if (!out) return bad(reply, 409, 'phone_taken');
      return reply.code(201).send(out);
    },
  );

  // ---- вход ----
  app.post<{ Body: { phone: string; password: string } }>(
    '/auth/login',
    { schema: { body: { type: 'object', required: ['phone', 'password'], additionalProperties: false, properties: { phone: PHONE, password: { type: 'string', maxLength: 200 } } } } },
    async (req, reply) => {
      if (ipLimited(req)) return bad(reply, 429, 'too_many_requests');
      const phone = normalizePhone(req.body.phone);
      if (!phone) return bad(reply, 400, 'bad_phone');
      const now = clock();
      const u = (await db.query<UserRow>('SELECT id, name, role, status, company_id, password_hash, failed_logins, locked_until FROM users WHERE phone = $1', [phone])).rows[0];
      if (u?.locked_until && u.locked_until > now) return bad(reply, 429, 'locked');
      const ok = await verifyPassword(req.body.password, u?.password_hash ?? null);
      if (!u || !ok) {
        if (u) {
          const fails = u.failed_logins + 1;
          await db.query('UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1', [u.id, fails >= LOGIN_FAILS ? 0 : fails, fails >= LOGIN_FAILS ? new Date(now.getTime() + LOCK_MS) : null]);
        }
        // Одинаковый ответ для чужого номера, неверного и не заданного пароля: перебором не узнать, кто есть в базе.
        return bad(reply, 401, 'invalid_credentials');
      }
      if (u.status === 'blocked') return bad(reply, 403, 'blocked');
      if (u.failed_logins || u.locked_until) await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
      return openSession(db, u);
    },
  );

  // ---- новый пароль по коду сброса от менеджера ----
  app.post<{ Body: { phone: string; code: string; password: string } }>(
    '/auth/reset',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'code', 'password'],
          additionalProperties: false,
          properties: { phone: PHONE, code: { type: 'string', pattern: '^\\d{6}$' }, password: PASSWORD },
        },
      },
    },
    async (req, reply) => {
      if (ipLimited(req)) return bad(reply, 429, 'too_many_requests');
      const phone = normalizePhone(req.body.phone);
      if (!phone) return bad(reply, 400, 'bad_phone');
      const now = clock();
      const hash = await hashPassword(req.body.password);
      type Out = { kind: 'invalid' } | { kind: 'locked' } | { kind: 'blocked' } | { kind: 'ok'; session: Awaited<ReturnType<typeof openSession>> };
      const out = await db.tx<Out>(async (q) => {
        const row = (
          await q.query<{ id: number; code_hash: string; attempts: number }>(
            `SELECT id, code_hash, attempts FROM login_codes WHERE phone = $1 AND used = false AND expires_at > $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [phone, now],
          )
        ).rows[0];
        if (!row) return { kind: 'invalid' };
        if (row.attempts >= MAX_ATTEMPTS) return { kind: 'locked' };
        if (!safeEqualHex(row.code_hash, hashCode(pepper, phone, req.body.code))) {
          await q.query('UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
          return { kind: 'invalid' };
        }
        const u = (await q.query<UserRow>('SELECT id, name, role, status, company_id FROM users WHERE phone = $1', [phone])).rows[0];
        if (!u) return { kind: 'invalid' };
        if (u.status === 'blocked') return { kind: 'blocked' };
        await q.query('UPDATE login_codes SET used = true WHERE id = $1', [row.id]);
        await q.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id, hash]);
        // Старые входы на других устройствах закрываем: пароль сменился.
        await q.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
        return { kind: 'ok', session: await openSession(q, u) };
      });
      if (out.kind === 'invalid') return bad(reply, 401, 'invalid_code');
      if (out.kind === 'locked') return bad(reply, 429, 'too_many_attempts');
      if (out.kind === 'blocked') return bad(reply, 403, 'blocked');
      return out.session;
    },
  );

  // ---- код сброса пароля выдаёт менеджер своему заказчику или админ кому угодно ----
  app.post<{ Params: { id: string } }>('/users/:id/reset-code', { preHandler: app.authenticate }, async (req, reply) => {
    const me = req.user!;
    const id = parseId(req.params.id);
    if (!id) return bad(reply, 404, 'not_found');
    const t = (
      await db.query<{ id: number; phone: string | null; name: string; role: string; manager_id: number | null }>(
        `SELECT u.id, u.phone, u.name, u.role, c.manager_id FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
        [id],
      )
    ).rows[0];
    const allowed = me.status === 'approved' && (me.role === 'admin' || (me.role === 'manager' && t?.role === 'customer' && t.manager_id === me.id));
    if (!t || !allowed) return bad(reply, 404, 'not_found');
    if (!t.phone) return bad(reply, 422, 'no_phone');
    const code = generateCode();
    const now = clock();
    const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
    // Прежние неиспользованные коды этого номера гасим: действует только последний.
    await db.query('UPDATE login_codes SET used = true WHERE phone = $1 AND used = false', [t.phone]);
    await db.query('INSERT INTO login_codes (phone, code_hash, expires_at, created_at, issued_by) VALUES ($1, $2, $3, $4, $5)', [t.phone, hashCode(pepper, t.phone, code), expiresAt, now, me.id]);
    return { code, phone: t.phone, name: t.name, expiresAt };
  });

  // ---- профиль, смена пароля, выход ----
  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const u = req.user!;
    const extra = await db.query<{ unread: number; sms_enabled: boolean }>(
      `SELECT (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS unread, sms_enabled FROM users WHERE id = $1`,
      [u.id],
    );
    const e = extra.rows[0];
    return {
      id: u.id, name: u.name, role: u.role, status: u.status, companyId: u.companyId,
      unreadNotifications: e?.unread ?? 0, smsEnabled: e?.sms_enabled ?? true, smsAvailable: config.smsProvider !== 'none',
    };
  });

  app.post<{ Body: { oldPassword: string; newPassword: string } }>(
    '/me/password',
    {
      preHandler: app.authenticate,
      schema: { body: { type: 'object', required: ['oldPassword', 'newPassword'], additionalProperties: false, properties: { oldPassword: { type: 'string', maxLength: 200 }, newPassword: PASSWORD } } },
    },
    async (req, reply) => {
      const u: AuthedUser = req.user!;
      const row = (await db.query<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', [u.id])).rows[0];
      if (!(await verifyPassword(req.body.oldPassword, row?.password_hash ?? null))) return bad(reply, 401, 'invalid_credentials');
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, await hashPassword(req.body.newPassword)]);
      // Остальные устройства разлогиниваем, текущую сессию оставляем.
      const current = hashToken((req.headers.authorization ?? '').slice(7).trim());
      await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [u.id, current]);
      return { ok: true };
    },
  );

  app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    const header = req.headers.authorization ?? '';
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(header.slice(7).trim())]);
    return reply.code(204).send();
  });
}

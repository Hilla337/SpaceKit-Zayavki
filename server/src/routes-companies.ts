import type { FastifyInstance } from 'fastify';
import { canApproveCompany, canClaimCompany, canReassignCompany, canViewCompany } from './access.js';
import type { Deps } from './app.js';
import type { Queryable } from './db.js';
import { notifyCustomers } from './services.js';
import type { AccountStatus, CompanyInfo } from './types.js';

interface CompanyRow {
  id: number;
  name: string;
  status: AccountStatus;
  manager_id: number | null;
  manager_name: string | null;
  show_prices_early: boolean;
}

export function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const toInfo = (c: CompanyRow): CompanyInfo => ({ id: c.id, status: c.status, managerId: c.manager_id });

async function loadCompany(q: Queryable, id: number, lock = false): Promise<CompanyRow | undefined> {
  const r = await q.query<CompanyRow>(
    `SELECT c.id, c.name, c.status, c.manager_id, m.name AS manager_name, c.show_prices_early
     FROM companies c LEFT JOIN users m ON m.id = c.manager_id
     WHERE c.id = $1 ${lock ? 'FOR UPDATE OF c' : ''}`,
    [id],
  );
  return r.rows[0];
}

const present = (c: CompanyRow) => ({
  id: c.id,
  name: c.name,
  status: c.status,
  managerId: c.manager_id,
  managerName: c.manager_name,
  showPricesEarly: c.show_prices_early,
});

export function registerCompanyRoutes(app: FastifyInstance, deps: Deps, _clock: () => Date): void {
  const { db } = deps;

  // Список клиентов: менеджер видит своих и ещё никем не взятых, админ видит всех.
  app.get('/companies', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    if (u.status !== 'approved' || (u.role !== 'manager' && u.role !== 'admin')) return reply.code(403).send({ error: 'forbidden' });

    const r = await db.query<CompanyRow>(
      `SELECT c.id, c.name, c.status, c.manager_id, m.name AS manager_name, c.show_prices_early
       FROM companies c LEFT JOIN users m ON m.id = c.manager_id
       WHERE $1 = 'admin' OR c.manager_id = $2 OR c.manager_id IS NULL
       ORDER BY c.created_at DESC LIMIT 500`,
      [u.role, u.id],
    );
    return r.rows.map(present);
  });

  // Менеджер берёт клиента, которого пока никто не ведёт. Дальше клиент только его.
  app.post<{ Params: { id: string } }>('/companies/:id/claim', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    const id = parseId(req.params.id);
    if (!id) return reply.code(404).send({ error: 'not_found' });

    const result = await db.tx(async (q) => {
      const c = await loadCompany(q, id, true);
      if (!c || !canViewCompany(u, toInfo(c))) return 'not_found' as const;
      if (!canClaimCompany(u, toInfo(c))) return c.manager_id !== null ? ('taken' as const) : ('forbidden' as const);

      await q.query('UPDATE companies SET manager_id = $1 WHERE id = $2', [u.id, id]);
      await q.query('INSERT INTO company_manager_history (company_id, from_manager_id, to_manager_id, changed_by) VALUES ($1, NULL, $2, $2)', [id, u.id]);
      return 'ok' as const;
    });

    if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (result === 'taken') return reply.code(409).send({ error: 'already_assigned' });
    if (result === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    return { ok: true };
  });

  // Подтверждение компании открывает вход её сотрудникам. Менеджер подтверждает только своих клиентов.
  app.post<{ Params: { id: string } }>('/companies/:id/approve', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    const id = parseId(req.params.id);
    if (!id) return reply.code(404).send({ error: 'not_found' });

    const result = await db.tx(async (q) => {
      const c = await loadCompany(q, id, true);
      if (!c || !canViewCompany(u, toInfo(c))) return 'not_found' as const;
      if (!canApproveCompany(u, toInfo(c))) return 'forbidden' as const;

      await q.query(`UPDATE companies SET status = 'approved' WHERE id = $1`, [id]);
      const members = await q.query<{ id: number }>(
        `UPDATE users SET status = 'approved' WHERE company_id = $1 AND role = 'customer' AND status = 'pending' RETURNING id`,
        [id],
      );
      await notifyCustomers(q, members.rows.map((m) => m.id), null, 'Ваша компания подтверждена, можно создавать заявки');
      return 'ok' as const;
    });

    if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (result === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    return { ok: true };
  });

  // Переназначение клиента другому менеджеру. Только админ.
  app.post<{ Params: { id: string }; Body: { managerId: number } }>(
    '/companies/:id/reassign',
    {
      preHandler: app.authenticate,
      schema: { body: { type: 'object', required: ['managerId'], additionalProperties: false, properties: { managerId: { type: 'integer', minimum: 1 } } } },
    },
    async (req, reply) => {
      const u = req.user!;
      if (!canReassignCompany(u)) return reply.code(403).send({ error: 'forbidden' });
      const id = parseId(req.params.id);
      if (!id) return reply.code(404).send({ error: 'not_found' });

      const result = await db.tx(async (q) => {
        const c = await loadCompany(q, id, true);
        if (!c) return 'not_found' as const;
        const target = await q.query<{ id: number }>(`SELECT id FROM users WHERE id = $1 AND role = 'manager' AND status = 'approved'`, [req.body.managerId]);
        if (!target.rows[0]) return 'bad_manager' as const;

        await q.query('UPDATE companies SET manager_id = $1 WHERE id = $2', [req.body.managerId, id]);
        await q.query('INSERT INTO company_manager_history (company_id, from_manager_id, to_manager_id, changed_by) VALUES ($1, $2, $3, $4)', [
          id,
          c.manager_id,
          req.body.managerId,
          u.id,
        ]);
        return 'ok' as const;
      });

      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result === 'bad_manager') return reply.code(422).send({ error: 'bad_manager' });
      return { ok: true };
    },
  );
}

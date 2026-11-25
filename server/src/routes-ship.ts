import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { canViewRequest } from './access.js';
import type { Deps } from './app.js';
import { companyInfo, loadRequest, requestInfo } from './routes-requests.js';
import { parseId } from './routes-companies.js';
import { addHistory, customersOfCompany, notifyCustomers, notifyUsers, staffOfCompany } from './services.js';
import { checkTransition } from './statuses.js';

export function registerShipRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps;

  /**
   * Отгрузка одной кнопкой. Без тела отгружаются все ещё не отгруженные позиции;
   * можно передать itemIds, чтобы отгрузить часть (тогда заявка станет «Частично отгружена»).
   * Номер пока наш (ОТ-0001); когда подключим МойСклад, здесь же создастся отгрузка в нём и номер возьмётся оттуда.
   */
  app.post<{ Params: { id: string }; Body: { itemIds?: number[] } | undefined }>(
    '/requests/:id/ship',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: { itemIds: { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: { type: 'integer', minimum: 1 } } },
        },
      },
    },
    async (req, reply) => {
      const u = req.user!;
      const id = parseId(req.params.id);
      if (!id) return reply.code(404).send({ error: 'not_found' });

      type Out = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> };

      const out = await db.tx<Out>(async (q) => {
        const r = await loadRequest(q, id, true);
        if (!r || !canViewRequest(u, requestInfo(r), companyInfo(r))) return { ok: false, status: 404, body: { error: 'not_found' } };
        if (u.role === 'customer') return { ok: false, status: 403, body: { error: 'forbidden' } };

        const unshipped = (
          await q.query<{ id: number }>('SELECT id FROM request_items WHERE request_id = $1 AND shipped = false ORDER BY id FOR UPDATE', [id])
        ).rows.map((x) => x.id);

        const chosen = req.body?.itemIds ?? unshipped;
        if (req.body?.itemIds) {
          const bad = req.body.itemIds.filter((x) => !unshipped.includes(x));
          if (bad.length > 0) return { ok: false, status: 422, body: { error: 'bad_items', itemIds: bad } };
        }
        if (chosen.length === 0) return { ok: false, status: 409, body: { error: 'nothing_to_ship' } };

        const remaining = unshipped.length - chosen.length;
        const to = remaining === 0 ? 'shipped' : 'partial';
        const check = checkTransition(u, requestInfo(r), companyInfo(r), to);
        if (!check.ok) {
          return { ok: false, status: check.code === 'forbidden' ? 403 : 409, body: { error: check.code, message: check.reason } };
        }

        // Номер из id отгрузки: сначала вставляем со временным, затем переименовываем.
        const ins = await q.query<{ id: number }>('INSERT INTO shipments (request_id, number, created_by) VALUES ($1, $2, $3) RETURNING id', [
          id,
          `tmp-${randomUUID()}`,
          u.id,
        ]);
        const shipmentId = ins.rows[0]!.id;
        const number = `ОТ-${String(shipmentId).padStart(4, '0')}`;
        await q.query('UPDATE shipments SET number = $2 WHERE id = $1', [shipmentId, number]);

        for (const itemId of chosen) {
          await q.query('INSERT INTO shipment_items (shipment_id, item_id) VALUES ($1, $2)', [shipmentId, itemId]);
          await q.query('UPDATE request_items SET shipped = true WHERE id = $1', [itemId]);
        }
        await q.query('UPDATE requests SET status = $2 WHERE id = $1', [id, to]);

        const total = unshipped.length + (await q.query<{ n: number }>('SELECT count(*)::int AS n FROM request_items WHERE request_id = $1 AND shipped = true', [id])).rows[0]!.n - chosen.length;
        await addHistory(q, id, u.id, `${u.name} отгрузил(а) ${chosen.length} поз. (${number})${remaining > 0 ? `, осталось ${remaining}` : ''}`);

        const staff = (await staffOfCompany(q, r.company_id)).filter((x) => x !== u.id);
        const customers = await customersOfCompany(q, r.company_id);
        await notifyUsers(q, staff, id, `Заявка №${id}: отгружено ${chosen.length} поз. (${number})${remaining > 0 ? `, осталось ${remaining}` : ''}`);
        await notifyCustomers(
          q,
          customers,
          id,
          remaining === 0 ? `Заявка №${id} отгружена` : `По заявке №${id} отгружена часть заказа: ${total - remaining} из ${total} позиций`,
        );

        return { ok: true, body: { shipment: number, status: to, shipped: chosen.length, remaining } };
      });

      if (!out.ok) return reply.code(out.status).send(out.body);
      return out.body;
    },
  );
}

import { createHmac } from 'node:crypto';
import type { Db, Queryable } from './db.js';
import type { MsEvents } from './moysklad.js';
import { addHistory, customersOfCompany, notifyCustomers, notifyUsers, staffOfCompany } from './services.js';

/** Секрет в адресе вебхука: МойСклад не подписывает запросы, поэтому чужой не должен знать адрес. */
export function webhookSecret(pepper: string): string {
  return createHmac('sha256', pepper).update('moysklad-webhook').digest('hex').slice(0, 32);
}

export interface MsWebhookEvent {
  meta?: { type?: string; href?: string };
  action?: string;
}

export type EventOutcome =
  | 'shipped' | 'partial' | 'duplicate' | 'not_ours' | 'not_applicable' | 'no_items'
  | 'cancelled' | 'state' | 'same_state' | 'ignored';

const idFromHref = (href: string | undefined): string | null => (href ? (href.split('?')[0]!.split('/').pop() ?? null) : null);

/** Статус заказа в МойСклад, при котором заявку в приложении отменяем. */
const CANCEL_STATES = ['Отменен', 'Отменён'];

interface ReqRow { id: number; company_id: number; status: string; ms_order_state: string | null }

async function requestByOrder(q: Queryable, orderId: string): Promise<ReqRow | undefined> {
  return (await q.query<ReqRow>('SELECT id, company_id, status, ms_order_state FROM requests WHERE ms_order_id = $1 FOR UPDATE', [orderId])).rows[0];
}

/**
 * Одно событие из МойСклад. Всё, что происходит в МойСклад с заказами из приложения, отражается в заявке:
 *  - проведённая отгрузка по заказу — позиции отмечаются отгруженными, статус «Частично отгружена» / «Отгружена», заказчику уведомление;
 *  - статус заказа «Отменен» — заявка отменяется, заказчику уведомление; другие смены статуса пишутся в историю.
 * Повторное событие ничего не задваивает. Чужие заказы и отгрузки (созданные не из приложения) пропускаются.
 */
export async function handleMsEvent(db: Db, ms: MsEvents, ev: MsWebhookEvent): Promise<EventOutcome> {
  const type = ev.meta?.type;
  const id = idFromHref(ev.meta?.href);
  if (!id) return 'ignored';

  if (type === 'demand' && (ev.action === 'CREATE' || ev.action === 'UPDATE')) {
    const d = await ms.getDemand(id);
    if (!d || !d.orderId) return 'not_ours';
    if (!d.applicable) return 'not_applicable'; // черновик отгрузки ещё не проведён
    return db.tx(async (q) => {
      const r = await requestByOrder(q, d.orderId!);
      if (!r) return 'not_ours';
      if ((await q.query('SELECT 1 FROM shipments WHERE ms_shipment_id = $1', [d.id])).rows[0]) return 'duplicate';
      const products = d.positions.map((p) => p.productId);
      const items = (
        await q.query<{ id: number }>(
          `SELECT i.id FROM request_items i JOIN catalog c ON c.id = i.sku_id
           WHERE i.request_id = $1 AND i.shipped = false AND c.ms_id = ANY($2::text[]) ORDER BY i.id`,
          [r.id, products],
        )
      ).rows.map((x) => x.id);
      if (items.length === 0) {
        await addHistory(q, r.id, null, `В МойСклад оформлена отгрузка ${d.name}, но её позиции не совпали с неотгруженными позициями заявки`);
        return 'no_items';
      }
      const ins = await q.query<{ id: number }>('INSERT INTO shipments (request_id, number, ms_shipment_id) VALUES ($1, $2, $3) RETURNING id', [r.id, d.name, d.id]);
      for (const itemId of items) {
        await q.query('INSERT INTO shipment_items (shipment_id, item_id) VALUES ($1, $2)', [ins.rows[0]!.id, itemId]);
        await q.query('UPDATE request_items SET shipped = true WHERE id = $1', [itemId]);
      }
      const left = (await q.query<{ n: number }>('SELECT count(*)::int AS n FROM request_items WHERE request_id = $1 AND shipped = false', [r.id])).rows[0]!.n;
      const to = left === 0 ? 'shipped' : 'partial';
      // Статус меняем, только если заявка уже на сборке; иначе (например, отгрузили раньше подтверждения) — только история.
      if (['assembly', 'partial'].includes(r.status)) await q.query('UPDATE requests SET status = $2 WHERE id = $1', [r.id, to]);
      await addHistory(q, r.id, null, `В МойСклад оформлена отгрузка ${d.name}: ${items.length} поз.${left ? `, осталось ${left}` : ''}`);
      await notifyUsers(q, await staffOfCompany(q, r.company_id), r.id, `Заявка №${r.id}: в МойСклад оформлена отгрузка ${d.name}`);
      await notifyCustomers(q, await customersOfCompany(q, r.company_id), r.id, left === 0 ? `Заявка №${r.id} отгружена` : `По заявке №${r.id} отгружена часть заказа`);
      return to;
    });
  }

  if (type === 'customerorder' && ev.action === 'UPDATE') {
    const state = await ms.getOrderState(id);
    if (!state) return 'ignored';
    return db.tx(async (q) => {
      const r = await requestByOrder(q, id);
      if (!r) return 'not_ours';
      if (r.ms_order_state === state) return 'same_state'; // изменили что-то другое, не статус
      await q.query('UPDATE requests SET ms_order_state = $2 WHERE id = $1', [r.id, state]);
      if (CANCEL_STATES.includes(state) && !['shipped', 'cancelled'].includes(r.status)) {
        await q.query(`UPDATE requests SET status = 'cancelled' WHERE id = $1`, [r.id]);
        await addHistory(q, r.id, null, `Заказ отменён в МойСклад — заявка отменена`);
        await notifyUsers(q, await staffOfCompany(q, r.company_id), r.id, `Заявка №${r.id} отменена в МойСклад`);
        await notifyCustomers(q, await customersOfCompany(q, r.company_id), r.id, `Заявка №${r.id} отменена`);
        return 'cancelled';
      }
      await addHistory(q, r.id, null, `Статус заказа в МойСклад: ${state}`);
      return 'state';
    });
  }
  return 'ignored';
}

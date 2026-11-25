import { createHash } from 'node:crypto';
import type { Queryable } from './db.js';
import { projectName, type MsGateway, type MsPosition, type ObjectFields } from './moysklad.js';

/** Ошибка, которую человек может исправить сам (например, не указан контрагент). */
export class MsPrecondition extends Error {
  constructor(readonly code: 'no_counterparty' | 'item_not_in_catalog', message: string) {
    super(message);
  }
}

/** Ставка НДС в счёте покупателю для клиентов, которые берут счёт с НДС. Заказ и отгрузка идут без изменения НДС: у Spacekit НДС только в счёте. */
export const VAT_INVOICE_RATE = 5;

interface OrderCtx {
  ms_order_id: string | null;
  vat_invoice: boolean;
  ms_counterparty_id: string | null;
  object_id: number | null;
  ms_project_id: string | null;
}

async function loadCtx(q: Queryable, requestId: number): Promise<OrderCtx> {
  const r = await q.query<OrderCtx>(
    `SELECT r.ms_order_id, r.vat_invoice, c.ms_counterparty_id, r.object_id, o.ms_project_id
     FROM requests r JOIN companies c ON c.id = r.company_id LEFT JOIN objects o ON o.id = r.object_id
     WHERE r.id = $1`,
    [requestId],
  );
  return r.rows[0]!;
}

async function loadPositions(q: Queryable, requestId: number, itemIds?: number[]): Promise<MsPosition[]> {
  const rows = (
    await q.query<{ id: number; name: string; qty: string; price: string | null; ms_id: string | null }>(
      `SELECT i.id, i.name, i.qty, i.price, c.ms_id FROM request_items i LEFT JOIN catalog c ON c.id = i.sku_id
       WHERE i.request_id = $1 ORDER BY i.id`,
      [requestId],
    )
  ).rows.filter((x) => !itemIds || itemIds.includes(x.id));
  const bad = rows.filter((x) => !x.ms_id || x.price === null);
  if (bad.length > 0) throw new MsPrecondition('item_not_in_catalog', `Позиции без товара из МойСклад или без цены: ${bad.map((x) => x.name).join(', ')}`);
  return rows.map((x) => ({ productId: x.ms_id!, qty: Number(x.qty), price: Number(x.price) }));
}

/** Проект по объекту заявки: создаётся один раз на объект и дальше переиспользуется. */
async function ensureProject(q: Queryable, ms: MsGateway, ctx: OrderCtx): Promise<string | null> {
  if (ctx.object_id === null) return null;
  if (ctx.ms_project_id) return ctx.ms_project_id;
  const o = (
    await q.query<Record<string, string | null>>(
      `SELECT jk, street, house, entrance, floor, apt, height_limit AS height, lift, resp_name AS resp, resp_phone AS "respPhone",
              district, parking, pass, extra_info AS dominfo FROM objects WHERE id = $1`,
      [ctx.object_id],
    )
  ).rows[0]!;
  const fields = o as ObjectFields;
  const id = await ms.ensureProject({ key: `zayavki-obj-${ctx.object_id}`, name: projectName(fields), fields });
  await q.query('UPDATE objects SET ms_project_id = $2 WHERE id = $1', [ctx.object_id, id]);
  return id;
}

/**
 * Заказ покупателя в МойСклад по заявке (при подтверждении). Если заказ уже создан, ничего не делает.
 * Вызывать внутри транзакции с заблокированной заявкой: при ошибке транзакция откатывается,
 * а повторная попытка найдёт уже созданное в МойСклад по externalCode и не задвоит.
 */
export async function pushOrder(q: Queryable, ms: MsGateway, requestId: number): Promise<{ id: string; name: string } | null> {
  const ctx = await loadCtx(q, requestId);
  if (ctx.ms_order_id) return null;
  if (!ctx.ms_counterparty_id) throw new MsPrecondition('no_counterparty', 'У компании не указан контрагент в МойСклад');
  const positions = await loadPositions(q, requestId);
  const projectId = await ensureProject(q, ms, ctx);
  const order = await ms.createOrder({
    key: `zayavki-req-${requestId}`,
    counterpartyId: ctx.ms_counterparty_id,
    projectId,
    description: `Заявка №${requestId} из приложения заявок SpaceKit${ctx.vat_invoice ? ', счёт с НДС' : ''}`,
    positions,
    vatRate: null, // НДС только в счёте; пометка «счёт с НДС» в описании подсказывает менеджеру
  });
  await q.query('UPDATE requests SET ms_order_id = $2, ms_order_name = $3 WHERE id = $1', [requestId, order.id, order.name]);
  return order;
}

/** Отгрузка в МойСклад на основании заказа по выбранным позициям. Номер отгрузки берётся из МойСклад. */
export async function pushDemand(q: Queryable, ms: MsGateway, requestId: number, itemIds: number[]): Promise<{ id: string; name: string }> {
  await pushOrder(q, ms, requestId); // заявки, подтверждённые до подключения МойСклад, получат заказ здесь
  const ctx = await loadCtx(q, requestId);
  const positions = await loadPositions(q, requestId, itemIds);
  // Каждую позицию можно отгрузить один раз, поэтому заявка + набор позиций однозначно задают отгрузку.
  const digest = createHash('sha256').update([...itemIds].sort((a, b) => a - b).join(',')).digest('hex').slice(0, 16);
  return ms.createDemand({ key: `zayavki-ship-${requestId}-${digest}`, orderId: ctx.ms_order_id!, counterpartyId: ctx.ms_counterparty_id!, projectId: ctx.ms_project_id, positions, vatRate: null });
}

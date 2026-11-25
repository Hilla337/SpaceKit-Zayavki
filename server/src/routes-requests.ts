import type { FastifyInstance } from 'fastify';
import { canViewRequest } from './access.js';
import type { AuthedUser, Deps } from './app.js';
import type { Queryable } from './db.js';
import { parseId } from './routes-companies.js';
import { MsError } from './moysklad.js';
import { MsPrecondition, pushOrder } from './ms-orders.js';
import { addHistory, customersOfCompany, notifyCustomers, notifyUsers, staffOfCompany } from './services.js';
import { checkTransition } from './statuses.js';
import type { AccountStatus, CompanyInfo, RequestInfo, RequestStatus } from './types.js';

const UNITS = ['шт', 'м²', 'м', 'уп', 'меш', 'кг', 'л', 'рул', 'лист'];
const LIFTS = ['грузовой', 'пассажирский', 'нет'];

/** Поля объекта в API совпадают с демо; здесь они сопоставляются со столбцами базы. */
const OBJECT_COLUMNS: Record<string, string> = {
  jk: 'jk',
  street: 'street',
  house: 'house',
  entrance: 'entrance',
  floor: 'floor',
  apt: 'apt',
  height: 'height_limit',
  lift: 'lift',
  resp: 'resp_name',
  respPhone: 'resp_phone',
  district: 'district',
  parking: 'parking',
  pass: 'pass',
  dominfo: 'extra_info',
};
const OBJECT_REQUIRED = ['street', 'house', 'floor', 'apt', 'lift', 'resp', 'respPhone', 'parking', 'pass'];

/** Заказчик видит цены, начиная с «На подтверждении». Для отдельных компаний можно открыть цены раньше. */
const PRICE_STATUSES: RequestStatus[] = ['confirm', 'assembly', 'partial', 'shipped'];

export interface RequestRow {
  id: number;
  company_id: number;
  status: RequestStatus;
  created_by: number;
  object_id: number | null;
  change_comment: string | null;
  ms_order_id: string | null;
  ms_order_name: string | null;
  ms_counterparty_id: string | null;
  vat_invoice: boolean;
  created_at: Date;
  updated_at: Date;
  company_name: string;
  company_status: AccountStatus;
  manager_id: number | null;
  show_prices_early: boolean;
}

interface ItemRow {
  id: number;
  store: string | null;
  url: string | null;
  store_code: string | null;
  name: string;
  qty: string;
  unit: string | null;
  note: string | null;
  match_state: 'none' | 'found' | 'created';
  sku_id: number | null;
  price: string | null;
  picked: boolean;
  shipped: boolean;
  sku_name?: string | null;
}

export const companyInfo = (r: RequestRow): CompanyInfo => ({ id: r.company_id, status: r.company_status, managerId: r.manager_id });
export const requestInfo = (r: RequestRow): RequestInfo => ({ id: r.id, companyId: r.company_id, status: r.status });

function canSeePrices(actor: AuthedUser, r: RequestRow): boolean {
  return actor.role !== 'customer' || r.show_prices_early || PRICE_STATUSES.includes(r.status);
}

function presentItem(i: ItemRow, staff: boolean, prices: boolean) {
  const qty = Number(i.qty);
  const price = i.price === null ? null : Number(i.price);
  // skuName — подобранный товар из каталога: его видят все, включая сборщика (ищет на складе именно его).
  const base = { id: i.id, name: i.name, skuName: i.sku_name ?? null, qty, unit: i.unit, note: i.note, url: i.url, store: i.store };
  const priced = prices ? { price, total: price === null ? null : Math.round(price * qty * 100) / 100 } : {};
  const internal = staff ? { storeCode: i.store_code, matchState: i.match_state, skuId: i.sku_id, picked: i.picked, shipped: i.shipped } : {};
  return { ...base, ...priced, ...internal };
}

export async function loadRequest(q: Queryable, id: number, lock = false): Promise<RequestRow | undefined> {
  const r = await q.query<RequestRow>(
    `SELECT r.id, r.company_id, r.status, r.created_by, r.object_id, r.change_comment, r.ms_order_id, r.ms_order_name, r.vat_invoice, r.created_at, r.updated_at,
            c.name AS company_name, c.ms_counterparty_id, c.status AS company_status, c.manager_id, c.show_prices_early
     FROM requests r JOIN companies c ON c.id = r.company_id
     WHERE r.id = $1 ${lock ? 'FOR UPDATE OF r' : ''}`,
    [id],
  );
  return r.rows[0];
}

const STATUS_LABEL: Partial<Record<RequestStatus, string>> = {
  work: 'взял(а) заявку в работу',
  confirm: 'отправил(а) заявку заказчику на подтверждение',
  assembly: 'передал(а) заявку на сборку',
  new: 'вернул(а) заявку менеджеру на изменение',
  cancelled: 'отменил(а) заявку',
};

export function registerRequestRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps;

  // ---- создание заявки (заказчик) ----
  const objectSchema = {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(Object.keys(OBJECT_COLUMNS).map((k) => [k, { type: 'string', maxLength: 300 }])),
  };

  app.post<{
    Body: {
      object?: Record<string, string>;
      objectId?: number;
      items: { name: string; qty: number; unit?: string; url?: string; store?: string; code?: string; note?: string }[];
    };
  }>(
    '/requests',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          additionalProperties: false,
          properties: {
            object: objectSchema,
            objectId: { type: 'integer', minimum: 1 },
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                required: ['name', 'qty'],
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 300 },
                  qty: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
                  unit: { type: 'string', enum: UNITS },
                  url: { type: 'string', maxLength: 1000 },
                  store: { type: 'string', maxLength: 100 },
                  code: { type: 'string', maxLength: 100 },
                  note: { type: 'string', maxLength: 500 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const u = req.user!;
      if (u.role !== 'customer' || u.status !== 'approved' || u.companyId === null) return reply.code(403).send({ error: 'forbidden' });
      const companyId = u.companyId;
      const { object, objectId, items } = req.body;

      if (objectId === undefined && !object) return reply.code(400).send({ error: 'object_required' });
      if (object) {
        const missing = OBJECT_REQUIRED.filter((k) => !object[k]?.trim());
        if (missing.length > 0) return reply.code(422).send({ error: 'object_incomplete', fields: missing });
        if (!LIFTS.includes(object.lift ?? '')) return reply.code(422).send({ error: 'bad_lift' });
      }

      const result = await db.tx(async (q) => {
        let objId = objectId ?? null;
        if (objId !== null) {
          const own = await q.query('SELECT id FROM objects WHERE id = $1 AND company_id = $2', [objId, companyId]);
          if (!own.rows[0]) return { error: 'object_not_found' as const };
        } else if (object) {
          const keys = Object.keys(object).filter((k) => k in OBJECT_COLUMNS);
          const cols = keys.map((k) => OBJECT_COLUMNS[k]!);
          const placeholders = keys.map((_, i) => `$${i + 2}`);
          const ins = await q.query<{ id: number }>(
            `INSERT INTO objects (company_id, ${cols.join(', ')}) VALUES ($1, ${placeholders.join(', ')}) RETURNING id`,
            [companyId, ...keys.map((k) => object[k]!.trim())],
          );
          objId = ins.rows[0]!.id;
        }

        const rq = await q.query<{ id: number }>(
          `INSERT INTO requests (company_id, created_by, object_id, vat_invoice) SELECT $1, $2, $3, vat_invoice FROM companies WHERE id = $1 RETURNING id`,
          [companyId, u.id, objId],
        );
        const requestId = rq.rows[0]!.id;

        for (const it of items) {
          let match: 'none' | 'found' = 'none';
          let skuId: number | null = null;
          let price: number | null = null;
          if (it.store && it.code) {
            const c = await q.query<{ id: number; price: string }>('SELECT id, price FROM catalog WHERE store = $1 AND store_code = $2', [it.store, it.code]);
            if (c.rows[0]) {
              match = 'found';
              skuId = c.rows[0].id;
              price = Number(c.rows[0].price);
            }
          }
          await q.query(
            `INSERT INTO request_items (request_id, store, url, store_code, name, qty, unit, note, match_state, sku_id, price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [requestId, it.store ?? null, it.url ?? null, it.code ?? null, it.name.trim(), it.qty, it.unit ?? 'шт', it.note ?? null, match, skuId, price],
          );
        }

        await addHistory(q, requestId, u.id, `${u.name} создал(а) заявку`);
        await notifyUsers(q, await staffOfCompany(q, companyId), requestId, `Новая заявка №${requestId}`);
        return { id: requestId };
      });

      if ('error' in result) return reply.code(404).send({ error: result.error });
      return reply.code(201).send({ id: result.id });
    },
  );

  // ---- объекты своей компании (заказчик выбирает объект из прошлых заявок) ----
  app.get('/objects', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    if (u.role !== 'customer' || u.status !== 'approved' || u.companyId === null) return reply.code(403).send({ error: 'forbidden' });
    const r = await db.query<Record<string, string | number | null>>(
      `SELECT id, jk, street, house, entrance, floor, apt, height_limit, lift, resp_name, resp_phone, district, parking, pass, extra_info
       FROM objects WHERE company_id = $1 ORDER BY id DESC LIMIT 50`,
      [u.companyId],
    );
    return r.rows.map((o) => ({
      id: o.id, jk: o.jk, street: o.street, house: o.house, entrance: o.entrance, floor: o.floor, apt: o.apt, height: o.height_limit, lift: o.lift,
      resp: o.resp_name, respPhone: o.resp_phone, district: o.district, parking: o.parking, pass: o.pass, dominfo: o.extra_info,
    }));
  });

  // ---- список заявок: что видно, зависит от роли ----
  app.get<{ Querystring: { status?: string } }>('/requests', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    if (u.status !== 'approved') return reply.code(403).send({ error: 'forbidden' });

    let scope: string;
    const params: unknown[] = [];
    switch (u.role) {
      case 'customer':
        if (u.companyId === null) return reply.code(403).send({ error: 'forbidden' });
        scope = `r.company_id = $1 AND c.status = 'approved'`;
        params.push(u.companyId);
        break;
      case 'manager':
        scope = `(c.manager_id = $1 OR c.manager_id IS NULL)`;
        params.push(u.id);
        break;
      case 'picker':
        scope = `r.status IN ('assembly', 'partial')`;
        break;
      case 'admin':
        scope = 'true';
        break;
      default:
        return reply.code(403).send({ error: 'forbidden' });
    }
    if (req.query.status) {
      params.push(req.query.status);
      scope += ` AND r.status::text = $${params.length}`;
    }

    const rows = await db.query<{
      id: number;
      status: RequestStatus;
      company_id: number;
      company_name: string;
      manager_id: number | null;
      created_at: Date;
      updated_at: Date;
      items_count: number;
    }>(
      `SELECT r.id, r.status, r.company_id, c.name AS company_name, c.manager_id, r.created_at, r.updated_at,
              (SELECT count(*)::int FROM request_items i WHERE i.request_id = r.id) AS items_count
       FROM requests r JOIN companies c ON c.id = r.company_id
       WHERE ${scope}
       ORDER BY r.updated_at DESC, r.id DESC LIMIT 200`,
      params,
    );
    return rows.rows.map((r) => ({
      id: r.id,
      status: r.status,
      companyId: r.company_id,
      companyName: r.company_name,
      managerId: r.manager_id,
      itemsCount: r.items_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

  // ---- карточка заявки ----
  app.get<{ Params: { id: string } }>('/requests/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    const id = parseId(req.params.id);
    if (!id) return reply.code(404).send({ error: 'not_found' });

    const r = await loadRequest(db, id);
    // Чужую заявку не отличаем от несуществующей.
    if (!r || !canViewRequest(u, requestInfo(r), companyInfo(r))) return reply.code(404).send({ error: 'not_found' });

    const staff = u.role !== 'customer';
    const prices = canSeePrices(u, r);
    const items = await db.query<ItemRow>('SELECT i.*, c.name AS sku_name FROM request_items i LEFT JOIN catalog c ON c.id = i.sku_id WHERE i.request_id = $1 ORDER BY i.id', [id]);
    const obj = r.object_id
      ? (await db.query<Record<string, string | null>>('SELECT * FROM objects WHERE id = $1', [r.object_id])).rows[0]
      : undefined;
    const history = await db.query<{ text: string; created_at: Date }>(
      'SELECT text, created_at FROM request_history WHERE request_id = $1 ORDER BY id',
      [id],
    );

    const ships = await db.query<{ id: number; number: string; created_at: Date }>(
      'SELECT id, number, created_at FROM shipments WHERE request_id = $1 ORDER BY id',
      [id],
    );
    const shipItems = await db.query<{ shipment_id: number; item_id: number }>(
      'SELECT si.shipment_id, si.item_id FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id WHERE s.request_id = $1 ORDER BY si.item_id',
      [id],
    );
    const presented = items.rows.map((i) => presentItem(i, staff, prices));
    const total = prices ? items.rows.reduce((s, i) => s + (i.price === null ? 0 : Number(i.price) * Number(i.qty)), 0) : undefined;

    return {
      id: r.id,
      status: r.status,
      companyId: r.company_id,
      companyName: r.company_name,
      managerId: r.manager_id,
      changeComment: r.change_comment,
      vatInvoice: r.vat_invoice,
      ...(staff ? { msOrder: r.ms_order_name } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      object: obj
        ? {
            jk: obj.jk,
            street: obj.street,
            house: obj.house,
            entrance: obj.entrance,
            floor: obj.floor,
            apt: obj.apt,
            height: obj.height_limit,
            lift: obj.lift,
            resp: obj.resp_name,
            respPhone: obj.resp_phone,
            district: obj.district,
            parking: obj.parking,
            pass: obj.pass,
            dominfo: obj.extra_info,
          }
        : null,
      items: presented,
      total: total === undefined ? undefined : Math.round(total * 100) / 100,
      shipments: ships.rows.map((x) => ({
        number: x.number,
        at: x.created_at,
        itemIds: shipItems.rows.filter((si) => si.shipment_id === x.id).map((si) => si.item_id),
      })),
      history: history.rows.map((h) => ({ text: h.text, at: h.created_at })),
    };
  });

  // ---- смена статуса: все правила в statuses.ts ----
  app.post<{ Params: { id: string }; Body: { to: RequestStatus; comment?: string } }>(
    '/requests/:id/status',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['to'],
          additionalProperties: false,
          properties: {
            to: { type: 'string', enum: ['new', 'work', 'confirm', 'assembly', 'partial', 'shipped', 'cancelled'] },
            comment: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const u = req.user!;
      const id = parseId(req.params.id);
      if (!id) return reply.code(404).send({ error: 'not_found' });
      const { to, comment } = req.body;

      type Out =
        | { ok: true }
        | { ok: false; status: number; body: Record<string, unknown> };

      const out = await db.tx<Out>(async (q) => {
        // Блокируем строку заявки, чтобы два одновременных действия не прошли по устаревшему статусу.
        const r = await loadRequest(q, id, true);
        if (!r || !canViewRequest(u, requestInfo(r), companyInfo(r))) return { ok: false, status: 404, body: { error: 'not_found' } };

        // Отгрузки (частичные и полные) пойдут через отдельную операцию с выбором позиций.
        if (to === 'partial' || to === 'shipped') return { ok: false, status: 400, body: { error: 'use_shipments' } };

        const check = checkTransition(u, requestInfo(r), companyInfo(r), to, comment);
        if (!check.ok) {
          const status = check.code === 'forbidden' ? 403 : check.code === 'comment_required' ? 422 : 409;
          return { ok: false, status, body: { error: check.code, message: check.reason } };
        }

        if (r.status === 'work' && to === 'confirm') {
          const bad = await q.query<{ id: number }>(
            `SELECT id FROM request_items WHERE request_id = $1 AND (match_state = 'none' OR price IS NULL OR price <= 0) ORDER BY id`,
            [id],
          );
          if (bad.rows.length > 0) return { ok: false, status: 409, body: { error: 'unpriced_items', itemIds: bad.rows.map((x) => x.id) } };
          // Заказ в МойСклад создаётся на контрагента компании, поэтому без него на подтверждение не отправляем.
          if (deps.ms && !r.ms_counterparty_id) return { ok: false, status: 409, body: { error: 'no_counterparty', message: 'У компании не указан контрагент в МойСклад' } };
        }

        // Подтверждение создаёт заказ покупателя в МойСклад. Не получилось — статус не меняется.
        if (to === 'assembly' && deps.ms) {
          try {
            await pushOrder(q, deps.ms, id);
          } catch (err) {
            if (err instanceof MsPrecondition) return { ok: false, status: 409, body: { error: err.code, message: err.message } };
            if (err instanceof MsError) return { ok: false, status: 502, body: { error: 'moysklad_failed', message: err.message } };
            throw err;
          }
        }

        const note = comment?.trim() || null;
        const newComment = to === 'new' ? note : to === 'work' ? null : r.change_comment;
        await q.query('UPDATE requests SET status = $2, change_comment = $3 WHERE id = $1', [id, to, newComment]);
        await addHistory(q, id, u.id, `${u.name} ${STATUS_LABEL[to] ?? `изменил(а) статус на «${to}»`}${note ? `: ${note}` : ''}`);

        const byCustomer = u.role === 'customer';
        const staff = (await staffOfCompany(q, r.company_id)).filter((x) => x !== u.id);
        const customers = (await customersOfCompany(q, r.company_id)).filter((x) => x !== u.id);
        // SMS уходит заказчику только там, где ему нужно что-то сделать или важно узнать: подтвердить и отмена менеджером.
        if (to === 'confirm') await notifyCustomers(q, customers, id, `Заявка №${id} ждёт вашего подтверждения`);
        else if (to === 'assembly') await notifyUsers(q, byCustomer ? staff : customers, id, byCustomer ? `Заказчик подтвердил заявку №${id}, она передана на сборку` : `Заявка №${id} подтверждена и передана на сборку`);
        else if (to === 'new') await notifyUsers(q, staff, id, `Заказчик просит изменить заявку №${id}: ${note}`);
        else if (to === 'cancelled') {
          if (byCustomer) await notifyUsers(q, staff, id, `Заявка №${id} отменена`);
          else await notifyCustomers(q, customers, id, `Заявка №${id} отменена`);
        }

        return { ok: true };
      });

      if (!out.ok) return reply.code(out.status).send(out.body);
      return { ok: true };
    },
  );

  // ---- счёт с НДС в этой заявке (менеджер клиента или админ, пока заказ в МойСклад не создан) ----
  app.patch<{ Params: { id: string }; Body: { vatInvoice: boolean } }>(
    '/requests/:id',
    {
      preHandler: app.authenticate,
      schema: { body: { type: 'object', required: ['vatInvoice'], additionalProperties: false, properties: { vatInvoice: { type: 'boolean' } } } },
    },
    async (req, reply) => {
      const u = req.user!;
      const id = parseId(req.params.id);
      if (!id) return reply.code(404).send({ error: 'not_found' });
      type Out = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };
      const out = await db.tx<Out>(async (q) => {
        const r = await loadRequest(q, id, true);
        if (!r || !canViewRequest(u, requestInfo(r), companyInfo(r))) return { ok: false, status: 404, body: { error: 'not_found' } };
        const canEdit = u.status === 'approved' && (u.role === 'admin' || (u.role === 'manager' && r.manager_id === u.id));
        if (!canEdit) return { ok: false, status: 403, body: { error: 'forbidden' } };
        // После подтверждения заказ уже в МойСклад с выбранной ставкой; менять там.
        if (!['new', 'work', 'confirm'].includes(r.status) || r.ms_order_id) return { ok: false, status: 409, body: { error: 'order_created' } };
        if (r.vat_invoice !== req.body.vatInvoice) {
          await q.query('UPDATE requests SET vat_invoice = $2 WHERE id = $1', [id, req.body.vatInvoice]);
          await addHistory(q, id, u.id, `${u.name} ${req.body.vatInvoice ? 'включил(а)' : 'выключил(а)'} счёт с НДС`);
        }
        return { ok: true };
      });
      if (!out.ok) return reply.code(out.status).send(out.body);
      return { ok: true, vatInvoice: req.body.vatInvoice };
    },
  );

  // ---- подбор позиции из каталога и цена (менеджер своей заявки в работе) ----
  app.patch<{ Params: { id: string; itemId: string }; Body: { skuId?: number | null; price?: number } }>(
    '/requests/:id/items/:itemId',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { skuId: { type: ['integer', 'null'], minimum: 1 }, price: { type: 'number', minimum: 0, maximum: 100000000 } },
        },
      },
    },
    async (req, reply) => {
      const u = req.user!;
      const id = parseId(req.params.id);
      const itemId = parseId(req.params.itemId);
      if (!id || !itemId) return reply.code(404).send({ error: 'not_found' });
      if (req.body.skuId === undefined && req.body.price === undefined) return reply.code(400).send({ error: 'nothing_to_change' });

      type Out = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };
      const out = await db.tx<Out>(async (q) => {
        const r = await loadRequest(q, id, true);
        if (!r || !canViewRequest(u, requestInfo(r), companyInfo(r))) return { ok: false, status: 404, body: { error: 'not_found' } };

        // Править позиции может тот же, кто имеет право взять заявку «в работу», и только пока она в работе.
        const canEdit = (u.role === 'admin' || (u.role === 'manager' && r.manager_id === u.id)) && u.status === 'approved';
        if (!canEdit) return { ok: false, status: 403, body: { error: 'forbidden' } };
        if (r.status !== 'work') return { ok: false, status: 409, body: { error: 'not_in_work' } };

        const item = (await q.query<ItemRow>('SELECT * FROM request_items WHERE id = $1 AND request_id = $2 FOR UPDATE', [itemId, id])).rows[0];
        if (!item) return { ok: false, status: 404, body: { error: 'not_found' } };

        let match = item.match_state;
        let sku = item.sku_id;
        let price = item.price === null ? null : Number(item.price);

        if (req.body.skuId !== undefined) {
          if (req.body.skuId === null) {
            match = 'none';
            sku = null;
            price = null;
          } else {
            const c = (await q.query<{ id: number; price: string }>('SELECT id, price FROM catalog WHERE id = $1', [req.body.skuId])).rows[0];
            if (!c) return { ok: false, status: 422, body: { error: 'sku_not_found' } };
            match = 'found';
            sku = c.id;
            price = Number(c.price);
          }
        }
        if (req.body.price !== undefined) {
          if (match === 'none') return { ok: false, status: 409, body: { error: 'not_matched' } };
          price = req.body.price;
        }

        await q.query('UPDATE request_items SET match_state = $2, sku_id = $3, price = $4 WHERE id = $1', [itemId, match, sku, price]);
        return { ok: true };
      });

      if (!out.ok) return reply.code(out.status).send(out.body);
      return { ok: true };
    },
  );

  // ---- поиск по каталогу для подбора (менеджер, админ) ----
  app.get<{ Querystring: { q?: string } }>('/catalog', { preHandler: app.authenticate }, async (req, reply) => {
    const u = req.user!;
    if (u.status !== 'approved' || (u.role !== 'manager' && u.role !== 'admin')) return reply.code(403).send({ error: 'forbidden' });
    const term = (req.query.q ?? '').trim().slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`);
    const r = await db.query<{ id: number; store: string; store_code: string | null; name: string; price: string }>(
      `SELECT id, store, store_code, name, price FROM catalog WHERE name ILIKE $1 ORDER BY name LIMIT 30`,
      [`%${term}%`],
    );
    return r.rows.map((c) => ({ id: c.id, store: c.store, storeCode: c.store_code, name: c.name, price: Number(c.price) }));
  });
}

import type { Queryable } from './db.js';

const BASE = 'https://api.moysklad.ru/api/remap/1.2';
type Fetch = typeof fetch;

/** Клиент МойСклад только для чтения. Токен берётся из окружения (MS_TOKEN) и нигде не сохраняется и не логируется. */
export class MoySklad {
  constructor(
    private readonly token: string,
    private readonly f: Fetch = fetch,
    private readonly pauseMs = 300,
  ) {
    if (!token) throw new Error('Не задан MS_TOKEN (токен МойСклад в переменной окружения).');
  }

  async get<T>(pathAndQuery: string): Promise<T> {
    return this.request<T>('GET', pathAndQuery);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', pathAndQuery: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Accept-Encoding': 'gzip' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await this.f(`${BASE}${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, this.pauseMs * attempt * 3));
        continue;
      }
      if (!res.ok) {
        // МойСклад объясняет ошибку в errors[].error; показываем это человеку (токена там нет).
        let detail = '';
        try {
          const j = (await res.json()) as { errors?: { error?: string }[] };
          detail = (j.errors ?? []).map((e) => e.error).filter(Boolean).join('; ');
        } catch { /* тело не JSON */ }
        throw new MsError(`МойСклад ${res.status} на ${pathAndQuery.split('?')[0]}${detail ? `: ${detail}` : ''}`);
      }
      return (await res.json()) as T;
    }
  }

  /** Все строки списка постранично (лимит МойСклад — 1000 на запрос). */
  async all<T>(path: string, extraQuery = ''): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await this.get<{ rows: T[]; meta: { size: number } }>(`${path}?limit=1000&offset=${offset}${extraQuery}`);
      out.push(...page.rows);
      if (offset + 1000 >= page.meta.size || page.rows.length === 0) return out;
      await new Promise((r) => setTimeout(r, this.pauseMs));
    }
  }
}

export interface MsProduct {
  id: string;
  name: string;
  code?: string;
  article?: string;
  archived?: boolean;
  salePrices?: { value: number; priceType?: { name: string } }[];
}
export interface MsCounterparty { id: string; name: string; archived?: boolean }

/** Магазин, по которому заказчик присылает ссылки; так же он называется в позициях заявки (store). */
export const PETROVICH = 'Петрович';

const priceOf = (p: MsProduct, type: string): number | undefined => p.salePrices?.find((x) => x.priceType?.name === type)?.value;

/**
 * Код товара в Петровиче. У Spacekit поле «Код» в МойСклад у товаров из Петровича совпадает с кодом на petrovich.ru
 * (6–7 цифр, есть «Цена Петрович»); у остальных товаров код внутренний (обычно 4 цифры). Проверено на каталоге 25.11.2026.
 */
export function petrovichCode(p: MsProduct): string | null {
  return p.code && /^\d{6,7}$/.test(p.code) && (priceOf(p, 'Цена Петрович') ?? 0) > 0 ? p.code : null;
}

/**
 * Обновляет каталог по товарам МойСклад. Цена — «Цена продажи» (в МойСклад в копейках); архивные пропускаем.
 * Для автоподбора: товар из Петровича получает store = «Петрович» и его код, остальные — уникальный артикул.
 * Только читает МойСклад, пишет в нашу базу.
 */
export async function syncCatalog(q: Queryable, products: MsProduct[]): Promise<{ upserted: number; skipped: number; petrovich: number }> {
  const live = products.filter((p) => !p.archived && p.name);
  // Артикул должен быть уникальным; повторяющиеся не используем, чтобы не подобрать не то.
  const count = new Map<string, number>();
  for (const p of live) if (p.article) count.set(p.article, (count.get(p.article) ?? 0) + 1);
  // Сначала снимаем коды у обновляемых товаров: если код перешёл от одного товара к другому, уникальный индекс не помешает.
  if (live.length > 0) await q.query('UPDATE catalog SET store_code = NULL WHERE ms_id = ANY($1::text[])', [live.map((p) => p.id)]);
  let petrovich = 0;
  for (const p of live) {
    const pc = petrovichCode(p);
    if (pc) petrovich++;
    const [store, code] = pc ? [PETROVICH, pc] : ['', p.article && count.get(p.article) === 1 ? p.article : null];
    const price = (priceOf(p, 'Цена продажи') ?? p.salePrices?.[0]?.value ?? 0) / 100;
    await q.query(
      `INSERT INTO catalog (ms_id, store, store_code, name, price) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ms_id) DO UPDATE SET store = EXCLUDED.store, store_code = EXCLUDED.store_code, name = EXCLUDED.name, price = EXCLUDED.price, updated_at = now()`,
      [p.id, store, code, p.name, price],
    );
  }
  return { upserted: live.length, skipped: products.length - live.length, petrovich };
}

// ---------------- Запись в МойСклад ----------------

/** Ошибка от МойСклад: текст для человека, без токена. */
export class MsError extends Error {}

/** Поля объекта в том виде, как они в API приложения (см. OBJECT_COLUMNS в routes-requests.ts). */
export type ObjectFields = Partial<Record<'jk' | 'street' | 'house' | 'entrance' | 'floor' | 'apt' | 'height' | 'lift' | 'resp' | 'respPhone' | 'district' | 'parking' | 'pass' | 'dominfo', string | null>>;

export interface MsPosition {
  productId: string;
  qty: number;
  /** Цена в рублях. */
  price: number;
}

/**
 * Что приложение делает в МойСклад. Каждый вызов идемпотентен по `key` (externalCode документа):
 * если документ с таким ключом уже есть, новый не создаётся, возвращается существующий.
 */
export interface MsGateway {
  getCounterparty(id: string): Promise<{ id: string; name: string } | null>;
  /** Поиск контрагентов по названию (для выбора в интерфейсе). */
  searchCounterparties(q: string): Promise<{ id: string; name: string }[]>;
  ensureProject(p: { key: string; name: string; fields: ObjectFields }): Promise<string>;
  createOrder(o: { key: string; counterpartyId: string; projectId: string | null; description: string; positions: MsPosition[]; vatRate: number | null }): Promise<{ id: string; name: string }>;
  createDemand(d: { key: string; orderId: string; counterpartyId: string; projectId: string | null; positions: MsPosition[]; vatRate: number | null }): Promise<{ id: string; name: string }>;
}

export interface MsWriterOptions {
  organizationId: string;
  storeId: string;
  /** Статус заказа покупателя после подтверждения, по названию (например «Готов к сборке»). */
  orderState?: string;
}

/** Поля объекта → доп. поля проекта в МойСклад (по названиям, как они заведены у Spacekit). */
const PROJECT_ATTRS: [keyof ObjectFields, string][] = [
  ['jk', 'Название ЖК'], ['street', 'Улица'], ['house', 'Дом'], ['entrance', 'Подъезд'], ['floor', 'Этаж'], ['apt', 'Квартира'],
  ['height', 'Ограничение по высоте'], ['lift', 'Лифт'], ['resp', 'Ответственное лицо'], ['respPhone', 'Телефон ответственного'],
  ['district', 'Район'], ['parking', 'Паркинг'], ['pass', 'Пропуск'], ['dominfo', 'Дом инфо'],
];

/** «есть», «да», «нужен» → true; «нет», «не нужен», пусто → false. */
export function yesNo(v: string): boolean {
  return /^(да|есть|нужен|нужна|нужно|требуется|\+)/i.test(v.trim());
}

/** Название проекта как у Spacekit: «ЖК квартира» или «улица дом, кв квартира». */
export function projectName(f: ObjectFields): string {
  const place = f.jk?.trim() || [f.street, f.house].filter((x) => x?.trim()).join(' ');
  if (!f.apt?.trim()) return place || 'Объект';
  return f.jk?.trim() ? `${place} ${f.apt.trim()}` : `${place}, кв ${f.apt.trim()}`;
}

const meta = (entity: string, id: string) => ({ meta: { href: `${BASE}/entity/${entity}/${id}`, type: entity, mediaType: 'application/json' } });
const positions = (ps: MsPosition[], vatRate: number | null) =>
  ps.map((p) => ({ quantity: p.qty, price: Math.round(p.price * 100), assortment: meta('product', p.productId), ...(vatRate !== null ? { vat: vatRate } : {}) }));
/** Счёт с НДС: НДС включён в цену (как в ручных заказах Spacekit), ставка в каждой строке. Без него — настройки МойСклад по умолчанию. */
const vatFields = (vatRate: number | null) => (vatRate !== null ? { vatEnabled: true, vatIncluded: true } : {});

type AttrMeta = { meta: unknown; name: string; type: string };

/** Настоящая запись в МойСклад через REST API. */
export class MsWriter implements MsGateway {
  private projectAttrs?: Map<string, AttrMeta>;
  private orderStateMeta?: unknown;

  constructor(private readonly ms: MoySklad, private readonly opts: MsWriterOptions) {
    if (!opts.organizationId || !opts.storeId) throw new Error('Для записи в МойСклад нужны MS_ORGANIZATION_ID и MS_STORE_ID.');
  }

  private async byKey(entity: string, key: string): Promise<{ id: string; name: string } | null> {
    const r = await this.ms.get<{ rows: { id: string; name: string }[] }>(`/entity/${entity}?filter=externalCode=${encodeURIComponent(key)}&limit=1`);
    return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name } : null;
  }

  async getCounterparty(id: string): Promise<{ id: string; name: string } | null> {
    try {
      const c = await this.ms.get<{ id: string; name: string }>(`/entity/counterparty/${encodeURIComponent(id)}`);
      return { id: c.id, name: c.name };
    } catch (err) {
      if (err instanceof MsError && /404/.test(err.message)) return null;
      throw err;
    }
  }

  async searchCounterparties(q: string): Promise<{ id: string; name: string }[]> {
    const r = await this.ms.get<{ rows: { id: string; name: string; archived?: boolean }[] }>(`/entity/counterparty?search=${encodeURIComponent(q)}&limit=20`);
    return r.rows.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }));
  }

  async ensureProject(p: { key: string; name: string; fields: ObjectFields }): Promise<string> {
    const found = await this.byKey('project', p.key);
    if (found) return found.id;
    if (!this.projectAttrs) {
      const list = await this.ms.get<{ rows: AttrMeta[] }>('/entity/project/metadata/attributes');
      this.projectAttrs = new Map(list.rows.map((a) => [a.name, a]));
    }
    const attributes = [];
    for (const [field, attrName] of PROJECT_ATTRS) {
      const raw = p.fields[field]?.trim();
      const a = this.projectAttrs.get(attrName);
      if (!raw || !a) continue;
      const value = a.type === 'boolean' ? yesNo(raw) : field === 'lift' ? raw[0]!.toUpperCase() + raw.slice(1) : raw;
      attributes.push({ meta: a.meta, value });
    }
    const created = await this.ms.post<{ id: string }>('/entity/project', { name: p.name, externalCode: p.key, attributes });
    return created.id;
  }

  async createOrder(o: { key: string; counterpartyId: string; projectId: string | null; description: string; positions: MsPosition[]; vatRate: number | null }): Promise<{ id: string; name: string }> {
    const found = await this.byKey('customerorder', o.key);
    if (found) return found;
    if (this.opts.orderState && this.orderStateMeta === undefined) {
      const m = await this.ms.get<{ states?: { name: string; meta: unknown }[] }>('/entity/customerorder/metadata');
      this.orderStateMeta = m.states?.find((s) => s.name === this.opts.orderState)?.meta ?? null;
    }
    const created = await this.ms.post<{ id: string; name: string }>('/entity/customerorder', {
      externalCode: o.key,
      organization: meta('organization', this.opts.organizationId),
      agent: meta('counterparty', o.counterpartyId),
      store: meta('store', this.opts.storeId),
      ...(o.projectId ? { project: meta('project', o.projectId) } : {}),
      ...(this.orderStateMeta ? { state: { meta: this.orderStateMeta } } : {}),
      description: o.description,
      ...vatFields(o.vatRate),
      positions: positions(o.positions, o.vatRate),
    });
    return { id: created.id, name: created.name };
  }

  async createDemand(d: { key: string; orderId: string; counterpartyId: string; projectId: string | null; positions: MsPosition[]; vatRate: number | null }): Promise<{ id: string; name: string }> {
    const found = await this.byKey('demand', d.key);
    if (found) return found;
    const created = await this.ms.post<{ id: string; name: string }>('/entity/demand', {
      externalCode: d.key,
      organization: meta('organization', this.opts.organizationId),
      agent: meta('counterparty', d.counterpartyId),
      store: meta('store', this.opts.storeId),
      customerOrder: meta('customerorder', d.orderId),
      ...(d.projectId ? { project: meta('project', d.projectId) } : {}),
      ...vatFields(d.vatRate),
      positions: positions(d.positions, d.vatRate),
    });
    return { id: created.id, name: created.name };
  }
}

// ---------------- Остатки и обратная связь из МойСклад ----------------

const idFromHref = (href: string | undefined): string | null => (href ? (href.split('?')[0]!.split('/').pop() ?? null) : null);

export interface MsStockRow { meta: { href: string; type: string }; quantity?: number; stock?: number }

/**
 * Остатки в каталог: «доступно» (остаток минус резерв) по складу. МойСклад отдаёт только ненулевые,
 * поэтому сначала всем ставим 0, потом проставляем пришедшие. Одной транзакцией.
 */
export async function syncStock(q: Queryable, rows: MsStockRow[]): Promise<{ updated: number }> {
  const ids: string[] = [];
  const qty: number[] = [];
  for (const r of rows) {
    if (r.meta.type !== 'product') continue;
    const id = idFromHref(r.meta.href);
    if (!id) continue;
    ids.push(id);
    qty.push(Math.max(0, Number(r.quantity ?? r.stock ?? 0)));
  }
  await q.query('UPDATE catalog SET stock = 0, stock_at = now()');
  if (ids.length === 0) return { updated: 0 };
  const r = await q.query<{ n: number }>(
    `WITH u AS (UPDATE catalog c SET stock = v.q, stock_at = now() FROM unnest($1::text[], $2::numeric[]) AS v(id, q) WHERE c.ms_id = v.id RETURNING 1)
     SELECT count(*)::int AS n FROM u`,
    [ids, qty],
  );
  return { updated: r.rows[0]!.n };
}

/** Отгрузка МойСклад в том виде, который нужен приложению. */
export interface MsDemandInfo {
  id: string;
  name: string;
  applicable: boolean;
  orderId: string | null;
  positions: { productId: string; qty: number }[];
}

/** Что приложение читает из МойСклад, когда приходит вебхук. */
export interface MsEvents {
  getDemand(id: string): Promise<MsDemandInfo | null>;
  getOrderState(id: string): Promise<string | null>;
}

/** Чтение для вебхуков и регистрация самих вебхуков. */
export class MsReader implements MsEvents {
  constructor(private readonly ms: MoySklad) {}

  async getDemand(id: string): Promise<MsDemandInfo | null> {
    try {
      const d = await this.ms.get<{
        id: string; name: string; applicable?: boolean; customerOrder?: { meta: { href: string } };
        positions?: { rows?: { quantity: number; assortment: { meta: { href: string; type: string } } }[] };
      }>(`/entity/demand/${encodeURIComponent(id)}?expand=positions`);
      return {
        id: d.id, name: d.name, applicable: d.applicable !== false, orderId: idFromHref(d.customerOrder?.meta.href),
        positions: (d.positions?.rows ?? []).filter((p) => p.assortment.meta.type === 'product').map((p) => ({ productId: idFromHref(p.assortment.meta.href)!, qty: p.quantity })),
      };
    } catch (err) {
      if (err instanceof MsError && /404/.test(err.message)) return null; // отгрузку уже удалили
      throw err;
    }
  }

  async getOrderState(id: string): Promise<string | null> {
    try {
      const o = await this.ms.get<{ state?: { name?: string } }>(`/entity/customerorder/${encodeURIComponent(id)}?expand=state`);
      return o.state?.name ?? null;
    } catch (err) {
      if (err instanceof MsError && /404/.test(err.message)) return null;
      throw err;
    }
  }

  /** Подписывает МойСклад на нужные события по адресу приложения. Уже существующие не дублирует. */
  async ensureWebhooks(url: string): Promise<{ created: number; existing: number }> {
    const want: [string, string][] = [['demand', 'CREATE'], ['demand', 'UPDATE'], ['customerorder', 'UPDATE']];
    const have = (await this.ms.get<{ rows: { url: string; entityType: string; action: string; enabled?: boolean }[] }>('/entity/webhook?limit=100')).rows;
    let created = 0;
    for (const [entityType, action] of want) {
      if (have.some((w) => w.url === url && w.entityType === entityType && w.action === action)) continue;
      await this.ms.post('/entity/webhook', { url, entityType, action });
      created++;
    }
    return { created, existing: want.length - created };
  }
}

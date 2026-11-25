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
  salePrices?: { value: number }[];
}
export interface MsCounterparty { id: string; name: string; archived?: boolean }

/** Обновляет каталог по товарам МойСклад. Цена в МойСклад в копейках; архивные пропускаем. Только читает МойСклад, пишет в нашу базу. */
export async function syncCatalog(q: Queryable, products: MsProduct[]): Promise<{ upserted: number; skipped: number }> {
  const live = products.filter((p) => !p.archived && p.name);
  // Артикул нужен для автоподбора, но он должен быть уникальным; повторяющиеся не используем, чтобы не подобрать не то.
  const count = new Map<string, number>();
  for (const p of live) if (p.article) count.set(p.article, (count.get(p.article) ?? 0) + 1);
  for (const p of live) {
    const code = p.article && count.get(p.article) === 1 ? p.article : null;
    const price = (p.salePrices?.[0]?.value ?? 0) / 100;
    await q.query(
      `INSERT INTO catalog (ms_id, store, store_code, name, price) VALUES ($1, '', $2, $3, $4)
       ON CONFLICT (ms_id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, updated_at = now(),
         store_code = COALESCE(catalog.store_code, EXCLUDED.store_code)`,
      [p.id, code, p.name, price],
    );
  }
  return { upserted: live.length, skipped: products.length - live.length };
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
  ensureProject(p: { key: string; name: string; fields: ObjectFields }): Promise<string>;
  createOrder(o: { key: string; counterpartyId: string; projectId: string | null; description: string; positions: MsPosition[] }): Promise<{ id: string; name: string }>;
  createDemand(d: { key: string; orderId: string; counterpartyId: string; projectId: string | null; positions: MsPosition[] }): Promise<{ id: string; name: string }>;
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
const positions = (ps: MsPosition[]) => ps.map((p) => ({ quantity: p.qty, price: Math.round(p.price * 100), assortment: meta('product', p.productId) }));

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

  async createOrder(o: { key: string; counterpartyId: string; projectId: string | null; description: string; positions: MsPosition[] }): Promise<{ id: string; name: string }> {
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
      positions: positions(o.positions),
    });
    return { id: created.id, name: created.name };
  }

  async createDemand(d: { key: string; orderId: string; counterpartyId: string; projectId: string | null; positions: MsPosition[] }): Promise<{ id: string; name: string }> {
    const found = await this.byKey('demand', d.key);
    if (found) return found;
    const created = await this.ms.post<{ id: string; name: string }>('/entity/demand', {
      externalCode: d.key,
      organization: meta('organization', this.opts.organizationId),
      agent: meta('counterparty', d.counterpartyId),
      store: meta('store', this.opts.storeId),
      customerOrder: meta('customerorder', d.orderId),
      ...(d.projectId ? { project: meta('project', d.projectId) } : {}),
      positions: positions(d.positions),
    });
    return { id: created.id, name: created.name };
  }
}

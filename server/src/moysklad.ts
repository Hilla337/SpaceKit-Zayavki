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
    for (let attempt = 1; ; attempt++) {
      const res = await this.f(`${BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${this.token}`, 'Accept-Encoding': 'gzip' } });
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, this.pauseMs * attempt * 3));
        continue;
      }
      if (!res.ok) throw new Error(`МойСклад ${res.status} на ${pathAndQuery.split('?')[0]}`);
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

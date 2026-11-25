import test from 'node:test';
import assert from 'node:assert/strict';
import { MoySklad, syncCatalog } from '../src/moysklad.js';
import { createTestDb } from './db-helper.js';

test('клиент МойСклад: постраничное чтение, токен только в заголовке, 429 повторяется', async () => {
  const urls: string[] = [];
  let first429 = true;
  const f = (async (url: string, init: RequestInit) => {
    urls.push(url);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer T');
    if (first429) { first429 = false; return new Response('', { status: 429 }); }
    const offset = Number(new URL(url).searchParams.get('offset'));
    return Response.json({ meta: { size: 1500 }, rows: Array.from({ length: offset === 0 ? 1000 : 500 }, (_, i) => ({ id: `${offset + i}` })) });
  }) as unknown as typeof fetch;
  const rows = await new MoySklad('T', f, 1).all('/entity/product');
  assert.equal(rows.length, 1500);
  assert.ok(urls.every((u) => !u.includes('T?') && u.startsWith('https://api.moysklad.ru/')));
  assert.throws(() => new MoySklad(''), /MS_TOKEN/);
});

test('синхронизация каталога: цена из копеек, архив пропускается, повторный артикул не используется для автоподбора', async () => {
  const db = await createTestDb();
  try {
    const r = await db.tx((q) => syncCatalog(q, [
      { id: 'a', name: 'Ротбанд', article: '100101', salePrices: [{ value: 45050 }] },
      { id: 'b', name: 'Дубль 1', article: 'X' }, { id: 'c', name: 'Дубль 2', article: 'X' },
      { id: 'd', name: 'Старый', archived: true },
    ]));
    assert.deepEqual(r, { upserted: 3, skipped: 1 });
    const rows = (await db.query<{ ms_id: string; price: number; store_code: string | null }>(`SELECT ms_id, price, store_code FROM catalog ORDER BY ms_id`)).rows;
    assert.equal(Number(rows[0]!.price), 450.5);
    assert.equal(rows[0]!.store_code, '100101');
    assert.equal(rows[1]!.store_code, null);
    await db.tx((q) => syncCatalog(q, [{ id: 'a', name: 'Ротбанд 30 кг', article: '100101', salePrices: [{ value: 50000 }] }]));
    const upd = await db.query<{ name: string; price: number }>(`SELECT name, price FROM catalog WHERE ms_id = 'a'`);
    assert.equal(Number(upd.rows[0]!.price), 500);
    assert.equal(upd.rows[0]!.name, 'Ротбанд 30 кг');
  } finally { await db.close(); }
});

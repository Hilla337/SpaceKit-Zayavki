import test from 'node:test';
import assert from 'node:assert/strict';
import { MoySklad, petrovichCode, syncCatalog, type MsProduct } from '../src/moysklad.js';
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
    assert.deepEqual(r, { upserted: 3, skipped: 1, petrovich: 0 });
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

const pr = (id: string, code: string, petrovich: number, sale = 30000, extra: Partial<MsProduct> = {}): MsProduct => ({
  id, name: `Товар ${id}`, code, salePrices: [{ value: 99999, priceType: { name: 'Собств сайт' } }, { value: sale, priceType: { name: 'Цена продажи' } }, { value: petrovich, priceType: { name: 'Цена Петрович' } }], ...extra,
});

test('код Петровича: 6–7 цифр и есть «Цена Петрович»; внутренние коды не считаются', () => {
  assert.equal(petrovichCode(pr('a', '155351', 6210)), '155351');
  assert.equal(petrovichCode(pr('a', '1030828', 2050)), '1030828');
  assert.equal(petrovichCode(pr('a', '5060', 100)), null, 'внутренний 4-значный код');
  assert.equal(petrovichCode(pr('a', '243554929', 100)), null, 'слишком длинный');
  assert.equal(petrovichCode(pr('a', '155351', 0)), null, 'без цены Петрович');
});

test('синхронизация: товар Петровича подбирается по коду из ссылки, цена — «Цена продажи», код может перейти к другому товару', async () => {
  const db = await createTestDb();
  try {
    const r = await db.tx((q) => syncCatalog(q, [pr('a', '155351', 6210, 429700), pr('b', '5060', 0, 1000, { article: 'ART-1' })]));
    assert.equal(r.petrovich, 1);
    const rows = (await db.query<{ ms_id: string; store: string; store_code: string | null; price: string }>('SELECT ms_id, store, store_code, price FROM catalog ORDER BY ms_id')).rows;
    assert.deepEqual(rows.map((x) => [x.ms_id, x.store, x.store_code, Number(x.price)]), [['a', 'Петрович', '155351', 4297], ['b', '', 'ART-1', 10]]);

    // Так приходит позиция заявки из ссылки petrovich.ru/product/155351 (см. POST /requests).
    const hit = await db.query<{ ms_id: string }>('SELECT ms_id FROM catalog WHERE store = $1 AND store_code = $2', ['Петрович', '155351']);
    assert.equal(hit.rows[0]?.ms_id, 'a');

    // Код переехал на другой товар: уникальный индекс не мешает, старый товар код теряет.
    await db.tx((q) => syncCatalog(q, [pr('a', '5061', 0), pr('c', '155351', 6210)]));
    const moved = await db.query<{ ms_id: string }>(`SELECT ms_id FROM catalog WHERE store = 'Петрович' AND store_code = '155351'`);
    assert.deepEqual(moved.rows.map((x) => x.ms_id), ['c']);
  } finally { await db.close(); }
});

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { MoySklad, MsError, MsWriter, projectName, yesNo, type MsGateway, type MsPosition } from '../src/moysklad.js';
import type { CodeSender } from '../src/sender.js';
import { createTestDb } from './db-helper.js';

// ---------- клиент МойСклад на поддельном API ----------

test('MsWriter: проект с доп. полями, заказ и отгрузка с нужными ссылками, без дублей по externalCode', async () => {
  const posts: { url: string; body: any }[] = [];
  const existing = new Set<string>();
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ url: u.pathname, body });
      existing.add(body.externalCode);
      return Response.json({ id: `id-${posts.length}`, name: `0000${posts.length}` });
    }
    if (u.pathname.endsWith('/project/metadata/attributes')) {
      return Response.json({ rows: [
        { name: 'Улица', type: 'string', meta: { href: 'a/street' } }, { name: 'Лифт', type: 'string', meta: { href: 'a/lift' } },
        { name: 'Паркинг', type: 'boolean', meta: { href: 'a/parking' } }, { name: 'Пропуск', type: 'boolean', meta: { href: 'a/pass' } },
      ] });
    }
    if (u.pathname.endsWith('/customerorder/metadata')) return Response.json({ states: [{ name: 'Готов к сборке', meta: { href: 's/ready' } }] });
    const key = (u.searchParams.get('filter') ?? '').replace('externalCode=', '');
    return Response.json({ rows: existing.has(key) ? [{ id: 'old', name: 'старый' }] : [] });
  }) as unknown as typeof fetch;

  const w = new MsWriter(new MoySklad('T', f, 1), { organizationId: 'org', storeId: 'st', orderState: 'Готов к сборке' });
  const pos: MsPosition[] = [{ productId: 'p1', qty: 2.5, price: 450.55 }];

  const pid = await w.ensureProject({ key: 'zayavki-obj-1', name: 'X', fields: { street: 'Ленина', lift: 'грузовой', parking: 'есть', pass: 'не нужен', floor: '3' } });
  assert.equal(pid, 'id-1');
  assert.deepEqual(posts[0]!.body.attributes, [
    { meta: { href: 'a/street' }, value: 'Ленина' }, { meta: { href: 'a/lift' }, value: 'Грузовой' },
    { meta: { href: 'a/parking' }, value: true }, { meta: { href: 'a/pass' }, value: false },
  ]);
  assert.equal(await w.ensureProject({ key: 'zayavki-obj-1', name: 'X', fields: {} }), 'old', 'повторно не создаётся');

  await w.createOrder({ key: 'zayavki-req-7', counterpartyId: 'cp', projectId: 'pr', description: 'd', positions: pos, vatRate: null });
  const o = posts[1]!;
  assert.equal(o.url, '/api/remap/1.2/entity/customerorder');
  assert.match(o.body.organization.meta.href, /\/entity\/organization\/org$/);
  assert.match(o.body.agent.meta.href, /\/entity\/counterparty\/cp$/);
  assert.match(o.body.store.meta.href, /\/entity\/store\/st$/);
  assert.match(o.body.project.meta.href, /\/entity\/project\/pr$/);
  assert.deepEqual(o.body.state, { meta: { href: 's/ready' } });
  assert.equal(o.body.positions[0].price, 45055, 'цена в копейках');
  assert.equal(o.body.positions[0].quantity, 2.5);

  await w.createDemand({ key: 'zayavki-ship-7-x', orderId: 'ord', counterpartyId: 'cp', projectId: null, positions: pos, vatRate: null });
  assert.match(posts[2]!.body.customerOrder.meta.href, /\/entity\/customerorder\/ord$/);
  assert.equal(posts[2]!.body.project, undefined);
  assert.equal(posts[2]!.body.vatEnabled, undefined, 'без счёта с НДС — настройки МойСклад по умолчанию');
  assert.equal(posts[2]!.body.positions[0].vat, undefined);
  assert.deepEqual(await w.createDemand({ key: 'zayavki-ship-7-x', orderId: 'ord', counterpartyId: 'cp', projectId: null, positions: pos, vatRate: null }), { id: 'old', name: 'старый' });
  assert.equal(posts.length, 3);
});

test('MsWriter: ошибка МойСклад доходит до человека текстом', async () => {
  const f = (async () => Response.json({ errors: [{ error: 'Нельзя отгрузить товар, которого нет на складе' }] }, { status: 412 })) as unknown as typeof fetch;
  const w = new MsWriter(new MoySklad('T', f, 1), { organizationId: 'org', storeId: 'st' });
  await assert.rejects(w.createDemand({ key: 'k', orderId: 'o', counterpartyId: 'c', projectId: null, positions: [], vatRate: null }), (e: unknown) => e instanceof MsError && /412.*нет на складе/.test(e.message));
});

test('MsWriter: счёт с НДС — НДС 5% внутри цены в заказе и отгрузке', async () => {
  const bodies: any[] = [];
  const f = (async (url: string, init: RequestInit) => {
    if (init.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return Response.json({ id: 'x', name: '1' }); }
    return Response.json({ rows: [], states: [] });
  }) as unknown as typeof fetch;
  const w = new MsWriter(new MoySklad('T', f, 1), { organizationId: 'org', storeId: 'st' });
  const pos: MsPosition[] = [{ productId: 'p1', qty: 1, price: 100 }, { productId: 'p2', qty: 2, price: 50 }];
  await w.createOrder({ key: 'k1', counterpartyId: 'c', projectId: null, description: 'd', positions: pos, vatRate: 5 });
  await w.createDemand({ key: 'k2', orderId: 'o', counterpartyId: 'c', projectId: null, positions: pos, vatRate: 5 });
  for (const b of bodies) {
    assert.equal(b.vatEnabled, true);
    assert.equal(b.vatIncluded, true, 'НДС внутри цены, цена клиента не меняется');
    assert.deepEqual(b.positions.map((x: { vat: number; price: number }) => [x.vat, x.price]), [[5, 10000], [5, 5000]]);
  }
});

test('названия проектов и да/нет как в МойСклад', () => {
  assert.equal(projectName({ jk: 'Прайм Парк', apt: '133Б' }), 'Прайм Парк 133Б');
  assert.equal(projectName({ street: 'Мичуринский проспект', house: '29', apt: '121' }), 'Мичуринский проспект 29, кв 121');
  assert.equal(projectName({ street: 'Новогорск' }), 'Новогорск');
  assert.deepEqual(['есть', 'Да', 'нужен', 'нет', 'не нужен', ''].map(yesNo), [true, true, true, false, false, false]);
});

// ---------- путь заявки с поддельным МойСклад ----------

class FakeMs implements MsGateway {
  orders: { key: string; counterpartyId: string; projectId: string | null; positions: MsPosition[]; vatRate: number | null }[] = [];
  demands: { key: string; orderId: string; positions: MsPosition[]; vatRate: number | null }[] = [];
  projects: string[] = [];
  failNext = false;
  private n = 0;
  private fail(): void {
    if (this.failNext) { this.failNext = false; throw new MsError('МойСклад 500 на /entity/x: сбой'); }
  }
  async getCounterparty(id: string) { return id.startsWith('00000000') ? null : { id, name: 'ООО Клиент А' }; }
  async ensureProject(p: { key: string }) {
    if (!this.projects.includes(p.key)) this.projects.push(p.key);
    return `proj-${p.key}`;
  }
  async createOrder(o: FakeMs['orders'][number] & { description: string }) {
    this.fail();
    const found = this.orders.findIndex((x) => x.key === o.key);
    if (found < 0) this.orders.push(o);
    return { id: `ord-${o.key}`, name: `0${2400 + (found < 0 ? this.orders.length : found + 1)}` };
  }
  async createDemand(d: FakeMs['demands'][number]) {
    this.fail();
    if (!this.demands.some((x) => x.key === d.key)) this.demands.push(d);
    return { id: `dem-${++this.n}`, name: `0${1980 + this.demands.length}` };
  }
}

const codes = new Map<string, string>();
const sender: CodeSender = { async send(phone, code) { codes.set(phone, code); } };
const ms = new FakeMs();
let db: Db;
let app: FastifyInstance;
let ip = 0;
let phil: string, tanya: string, picker: string, ann: string;
let company: number;
const CP = 'a1b2c3d4-0000-11f1-0a80-000000000001';
const objectOk = { jk: 'Прайм Парк', street: 'Ленинградский пр.', house: '37', floor: '33', apt: '133Б', lift: 'грузовой', resp: 'Артур', respPhone: '+7 968 996-03-33', parking: 'есть', pass: 'нет' };

async function login(phone: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/request-code', payload: { phone }, headers: { 'x-forwarded-for': `10.9.0.${++ip}` } });
  const r = await app.inject({ method: 'POST', url: '/auth/verify', payload: { phone, code: codes.get(phone) } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().token;
}
const call = (t: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${t}` } });

async function toConfirm(body: Record<string, unknown> = { object: objectOk }): Promise<number> {
  const r = await call(ann, 'POST', '/requests', { ...body, items: [{ name: 'Ротбанд', qty: 2 }, { name: 'Грунт', qty: 1.5 }, { name: 'Профиль', qty: 10 }] });
  assert.equal(r.statusCode, 201, r.body);
  const id = r.json().id as number;
  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'work' })).statusCode, 200);
  const items = (await call(phil, 'GET', `/requests/${id}`)).json().items as { id: number }[];
  for (const it of items) assert.equal((await call(phil, 'PATCH', `/requests/${id}/items/${it.id}`, { skuId: 1, price: 450.5 })).statusCode, 200);
  return id;
}

before(async () => {
  db = await createTestDb();
  app = buildApp({ db, sender, pepper: 'test', trustProxy: 1, ms });
  await db.query(`UPDATE users SET phone = '+79990000001' WHERE name = 'Филипп Инилеев'`);
  await db.query(`UPDATE users SET phone = '+79990000002' WHERE name = 'Татьяна Чех'`);
  await db.query(`INSERT INTO users (phone, name, role, status) VALUES ('+79990000008', 'Сборщик', 'picker', 'approved')`);
  await db.query(`INSERT INTO catalog (ms_id, name, price) VALUES ('prod-1', 'Ротбанд 30 кг', 450)`);
  company = (await db.query<{ id: number }>(`INSERT INTO companies (name, status, manager_id) VALUES ('Клиент А', 'approved', 1) RETURNING id`)).rows[0]!.id;
  await db.query(`INSERT INTO users (phone, name, role, status, company_id) VALUES ('+79991110001', 'Анна', 'customer', 'approved', $1)`, [company]);
  phil = await login('+79990000001'); tanya = await login('+79990000002'); picker = await login('+79990000008'); ann = await login('+79991110001');
});
after(async () => { await app.close(); await db.close(); });

test('без контрагента на подтверждение не отправить; контрагента связывает только менеджер клиента', async () => {
  const id = await toConfirm();
  const r = await call(phil, 'POST', `/requests/${id}/status`, { to: 'confirm' });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, 'no_counterparty');

  assert.equal((await call(tanya, 'POST', `/companies/${company}/ms-counterparty`, { msId: CP })).statusCode, 404, 'чужой менеджер не видит');
  assert.equal((await call(ann, 'POST', `/companies/${company}/ms-counterparty`, { msId: CP })).statusCode, 403, 'заказчик видит свою компанию, но связывать не может');
  assert.equal((await call(phil, 'POST', `/companies/${company}/ms-counterparty`, { msId: 'не-uuid' })).statusCode, 400);
  assert.equal((await call(phil, 'POST', `/companies/${company}/ms-counterparty`, { msId: '00000000-0000-0000-0000-000000000000' })).statusCode, 422);
  const ok = await call(phil, 'POST', `/companies/${company}/ms-counterparty`, { msId: CP });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().counterparty.name, 'ООО Клиент А');
  const other = (await db.query<{ id: number }>(`INSERT INTO companies (name, status, manager_id) VALUES ('Клиент Б', 'approved', 1) RETURNING id`)).rows[0]!.id;
  assert.equal((await call(phil, 'POST', `/companies/${other}/ms-counterparty`, { msId: CP })).statusCode, 409, 'один контрагент — одна компания');

  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'confirm' })).statusCode, 200);
});

test('подтверждение создаёт заказ в МойСклад; сбой МойСклад не меняет статус, повтор не задваивает', async () => {
  const id = await toConfirm();
  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'confirm' })).statusCode, 200);

  ms.failNext = true;
  const bad = await call(ann, 'POST', `/requests/${id}/status`, { to: 'assembly' });
  assert.equal(bad.statusCode, 502);
  assert.match(bad.json().message, /сбой/);
  assert.equal((await call(phil, 'GET', `/requests/${id}`)).json().status, 'confirm');

  const before = ms.orders.length;
  assert.equal((await call(ann, 'POST', `/requests/${id}/status`, { to: 'assembly' })).statusCode, 200);
  assert.equal(ms.orders.length, before + 1);
  const order = ms.orders.at(-1)!;
  assert.equal(order.key, `zayavki-req-${id}`);
  assert.equal(order.counterpartyId, CP);
  assert.equal(order.projectId, `proj-zayavki-obj-${(await db.query<{ object_id: number }>('SELECT object_id FROM requests WHERE id = $1', [id])).rows[0]!.object_id}`);
  assert.deepEqual(order.positions.map((p) => [p.productId, p.qty, p.price]), [['prod-1', 2, 450.5], ['prod-1', 1.5, 450.5], ['prod-1', 10, 450.5]]);

  const card = (await call(phil, 'GET', `/requests/${id}`)).json();
  assert.ok(card.msOrder, 'менеджер видит номер заказа');
  assert.equal((await call(ann, 'GET', `/requests/${id}`)).json().msOrder, undefined, 'заказчику номер заказа не показываем');
});

test('повторная заявка на тот же объект использует тот же проект', async () => {
  const objectId = (await db.query<{ object_id: number }>('SELECT object_id FROM requests ORDER BY id DESC LIMIT 1')).rows[0]!.object_id;
  const projectsBefore = ms.projects.length;
  const id = await toConfirm({ objectId });
  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'confirm' })).statusCode, 200);
  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'assembly' })).statusCode, 200, 'менеджер подтверждает по телефону');
  assert.equal(ms.projects.length, projectsBefore);
  assert.equal(ms.orders.at(-1)!.projectId, `proj-zayavki-obj-${objectId}`);
});

test('отгрузка одной кнопкой создаёт отгрузку в МойСклад на основании заказа, номер оттуда; частично и остаток', async () => {
  const id = (await db.query<{ id: number }>(`SELECT id FROM requests WHERE status = 'assembly' ORDER BY id LIMIT 1`)).rows[0]!.id;
  const items = (await call(phil, 'GET', `/requests/${id}`)).json().items as { id: number }[];

  ms.failNext = true;
  const bad = await call(picker, 'POST', `/requests/${id}/ship`, { itemIds: [items[0]!.id] });
  assert.equal(bad.statusCode, 502);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM shipments WHERE request_id = $1', [id])).rows[0]!.n, 0);
  assert.equal((await call(phil, 'GET', `/requests/${id}`)).json().items.filter((i: { shipped: boolean }) => i.shipped).length, 0, 'ничего не отгружено');

  const before = ms.demands.length;
  const part = await call(picker, 'POST', `/requests/${id}/ship`, { itemIds: [items[0]!.id] });
  assert.equal(part.statusCode, 200, part.body);
  assert.equal(part.json().status, 'partial');
  assert.match(part.json().shipment, /^0\d{4}$/, 'номер отгрузки из МойСклад');
  const d1 = ms.demands.at(-1)!;
  assert.equal(d1.orderId, `ord-zayavki-req-${id}`);
  assert.deepEqual(d1.positions.map((p) => p.qty), [2]);
  assert.equal(ms.demands.length, before + 1, 'сбойная попытка не оставила лишней отгрузки');

  const rest = await call(phil, 'POST', `/requests/${id}/ship`);
  assert.equal(rest.statusCode, 200, rest.body);
  assert.equal(rest.json().status, 'shipped');
  assert.deepEqual(ms.demands.at(-1)!.positions.map((p) => p.qty), [1.5, 10]);
  assert.notEqual(ms.demands.at(-1)!.key, d1.key);

  const card = (await call(phil, 'GET', `/requests/${id}`)).json();
  assert.deepEqual(card.shipments.map((s: { number: string }) => s.number), [part.json().shipment, rest.json().shipment]);
});

test('счёт с НДС: флаг у компании, заявка его наследует, менеджер может поменять до заказа; в МойСклад уходит 5%', async () => {
  assert.equal((await call(ann, 'PATCH', `/companies/${company}`, { vatInvoice: true })).statusCode, 403, 'заказчик не может');
  assert.equal((await call(tanya, 'PATCH', `/companies/${company}`, { vatInvoice: true })).statusCode, 404, 'чужой менеджер не видит');
  assert.equal((await call(phil, 'PATCH', `/companies/${company}`, { vatInvoice: true })).statusCode, 200);

  const id = await toConfirm();
  assert.equal((await call(ann, 'GET', `/requests/${id}`)).json().vatInvoice, true, 'новая заявка берёт флаг от компании');
  assert.equal((await call(ann, 'PATCH', `/requests/${id}`, { vatInvoice: false })).statusCode, 403);
  // Разово без НДС, потом снова с НДС: в истории оба переключения.
  assert.equal((await call(phil, 'PATCH', `/requests/${id}`, { vatInvoice: false })).statusCode, 200);
  assert.equal((await call(phil, 'PATCH', `/requests/${id}`, { vatInvoice: true })).statusCode, 200);
  assert.equal((await call(phil, 'GET', `/requests/${id}`)).json().history.filter((h: { text: string }) => /счёт с НДС/.test(h.text)).length, 2);

  assert.equal((await call(phil, 'POST', `/requests/${id}/status`, { to: 'confirm' })).statusCode, 200);
  assert.equal((await call(ann, 'POST', `/requests/${id}/status`, { to: 'assembly' })).statusCode, 200);
  assert.equal(ms.orders.at(-1)!.key, `zayavki-req-${id}`);
  assert.equal(ms.orders.at(-1)!.vatRate, 5);
  assert.equal((await call(phil, 'PATCH', `/requests/${id}`, { vatInvoice: false })).statusCode, 409, 'после заказа в МойСклад ставку меняют там');

  assert.equal((await call(picker, 'POST', `/requests/${id}/ship`)).statusCode, 200);
  assert.equal(ms.demands.at(-1)!.vatRate, 5, 'отгрузка с той же ставкой');

  // Компания без флага: заказ без НДС, как раньше.
  assert.equal((await call(phil, 'PATCH', `/companies/${company}`, { vatInvoice: false })).statusCode, 200);
  const id2 = await toConfirm();
  assert.equal((await call(phil, 'POST', `/requests/${id2}/status`, { to: 'confirm' })).statusCode, 200);
  assert.equal((await call(phil, 'POST', `/requests/${id2}/status`, { to: 'assembly' })).statusCode, 200);
  assert.equal(ms.orders.at(-1)!.vatRate, null);
});

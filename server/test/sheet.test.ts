import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// web/sheet.js — обычный скрипт для браузера; запускаем его как есть.
type Row = (string | number)[];
type Cols = { row: number; name: number; code: number; qty: number; unit: number; price: number; petrovich: boolean };
type Sheet = {
  readTable(b: Uint8Array): Promise<Row[]>;
  findColumns(rows: Row[]): Cols | null;
  tableRows(rows: Row[], cols: Cols): { name: string; code: string; qty: number; unit: string; price: number | null }[];
};
const box: Record<string, unknown> = { module: { exports: {} }, TextDecoder, DecompressionStream, Response, Uint8Array, DataView, ArrayBuffer };
vm.runInNewContext(readFileSync(new URL('../web/sheet.js', import.meta.url), 'utf8'), box);
const sheet = (box.module as { exports: Sheet }).exports;
// Массивы из vm — другого «мира», deepEqual сравнивает и прототипы; переводим в обычные.
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const fixture = (f: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

test('смета Петровича .xls («Сметы» → «Скачать»): 5 товаров с кодами, количеством, единицами и ценой', async () => {
  const rows = await sheet.readTable(fixture('petrovich-smeta.xls'));
  const cols = sheet.findColumns(rows);
  assert.ok(cols);
  assert.equal(cols.petrovich, true);
  const items = sheet.tableRows(rows, cols);
  assert.deepEqual(plain(items.map((i) => [i.code, i.qty, i.unit, i.price])), [
    ['1164422', 1, 'шт', 3125], ['1234792', 3, 'пар', 2415], ['1078162', 4, 'шт', 6790], ['1004271', 5, 'шт', 899], ['153150', 6, 'упак', 2128.86],
  ]);
  assert.match(items[4]?.name ?? "", /^Ламинат 33 класс Tarkett Navigator/);
});

test('свой список в .xlsx: заголовок не в первой строке, «Итого» отсекается, количество строкой', async () => {
  const rows = await sheet.readTable(fixture('list.xlsx'));
  const cols = sheet.findColumns(rows);
  assert.ok(cols);
  assert.equal(cols.petrovich, false);
  assert.deepEqual(plain(sheet.tableRows(rows, cols).map((i) => [i.name, i.qty, i.unit])), [
    ['Ротбанд 30 кг', 10, 'меш'], ['Профиль ПП 60×27 3 м', 40.5, 'шт'], ['Грунтовка «Глубокая» 10 л', 2, 'л'],
  ]);
});

test('csv в windows-1251 с «;» и кавычками', async () => {
  const text = 'Наименование;Количество;Ед\r\n"Саморез ""клоп"" 4,2х13";1 000;шт\r\nГипсокартон;12,5;лист\r\n';
  const bytes = new Uint8Array([...text].map((ch) => { const c = ch.charCodeAt(0); return c >= 0x410 && c <= 0x44f ? c - 0x350 : c; }));
  const rows = await sheet.readTable(bytes);
  const cols = sheet.findColumns(rows);
  assert.ok(cols);
  assert.deepEqual(plain(sheet.tableRows(rows, cols).map((i) => [i.name, i.qty, i.unit])), [['Саморез "клоп" 4,2х13', 1000, 'шт'], ['Гипсокартон', 12.5, 'лист']]);
});

test('таблица без заголовков — null (тогда строки разбираются как обычный список)', async () => {
  assert.equal(sheet.findColumns(await sheet.readTable(new TextEncoder().encode('Ротбанд 10 меш\nГрунт 2 л\n'))), null);
});

test('испорченный файл — понятная ошибка, а не зависание', async () => {
  const bad = fixture('petrovich-smeta.xls').slice(0, 600);
  await assert.rejects(sheet.readTable(bad));
});

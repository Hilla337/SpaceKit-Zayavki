// Чтение таблиц без сторонних библиотек: Excel .xls (BIFF8), .xlsx и .csv → строки ячеек.
// Нужно для сметы Петровича («Сметы» → «Скачать» отдаёт .xls) и любых списков товаров в Excel.
// Работает в браузере и в Node (тесты): SKSheet.readTable(байты) → Promise<строки>, SKSheet.findColumns(строки).
(function (root) {
  'use strict';

  // ---------- .xls: составной документ (OLE) ----------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  var END = 0xfffffffa; // идентификаторы от 0xFFFFFFFA и выше — служебные (конец цепочки, свободно и т.п.)

  function oleStream(b, names) {
    if (u32(b, 0) !== 0xe011cfd0 || u32(b, 4) !== 0xe11ab1a1) throw new Error('not_ole');
    var secSize = 1 << u16(b, 30), miniSize = 1 << u16(b, 32), miniCutoff = u32(b, 56);
    // Сектор за концом файла читаем как нули: сайт Петровича отдаёт файл с обрезанным последним сектором.
    function sector(id) { var out = new Uint8Array(secSize), o = 512 + id * secSize; if (o < b.length) out.set(b.subarray(o, Math.min(o + secSize, b.length))); return out; }
    var fatSecs = [];
    for (var i = 0; i < 109; i++) { var s = u32(b, 76 + i * 4); if (s < END) fatSecs.push(s); }
    var difat = u32(b, 68), guard = 0;
    while (difat < END && guard++ < 1000) { var d = sector(difat); for (var j = 0; j < secSize / 4 - 1; j++) { var t = u32(d, j * 4); if (t < END) fatSecs.push(t); } difat = u32(d, secSize - 4); }
    var fat = [];
    fatSecs.forEach(function (fs) { var d = sector(fs); for (var k = 0; k < secSize; k += 4) fat.push(u32(d, k)); });
    // Цепочка секторов; повтор сектора или выход за таблицу — конец (не зацикливаемся на испорченном файле).
    function chain(start, table) { var ids = [], seen = {}; for (var id = start; id < END && id < table.length && !seen[id]; id = table[id]) { seen[id] = 1; ids.push(id); } return ids; }
    function read(start, size) { var ids = chain(start, fat), out = new Uint8Array(ids.length * secSize); ids.forEach(function (id, n) { out.set(sector(id), n * secSize); }); return out.subarray(0, size); }
    var dir = read(u32(b, 48), Infinity), entries = [];
    for (var e = 0; e + 128 <= dir.length; e += 128) {
      var len = u16(dir, e + 64), name = '';
      for (var c = 0; c + 2 < len; c += 2) name += String.fromCharCode(u16(dir, e + c));
      entries.push({ name: name, type: dir[e + 66], start: u32(dir, e + 116), size: u32(dir, e + 120) });
    }
    var rootE = entries[0], ent = entries.filter(function (x) { return x.type === 2 && names.indexOf(x.name) >= 0; })[0];
    if (!ent) throw new Error('no_workbook');
    if (ent.size >= miniCutoff) return read(ent.start, ent.size);
    // Маленький поток лежит в «мини-потоке» корневой записи.
    var miniStream = read(rootE.start, rootE.size), miniFatRaw = read(u32(b, 60), u32(b, 64) * secSize), miniFat = [];
    for (var m = 0; m < miniFatRaw.length; m += 4) miniFat.push(u32(miniFatRaw, m));
    var ids = chain(ent.start, miniFat), out = new Uint8Array(ids.length * miniSize);
    ids.forEach(function (id, n) { out.set(miniStream.subarray(id * miniSize, (id + 1) * miniSize), n * miniSize); });
    return out.subarray(0, ent.size);
  }

  // ---------- .xls: записи BIFF8 ----------
  function rkNum(rk) {
    var v;
    if (rk & 2) v = (rk | 0) >> 2;
    else { var buf = new DataView(new ArrayBuffer(8)); buf.setUint32(4, (rk & 0xfffffffc) >>> 0, true); buf.setUint32(0, 0, true); v = buf.getFloat64(0, true); }
    return rk & 1 ? v / 100 : v;
  }
  // Читатель строк, переходящих через записи CONTINUE (в начале каждой — новый флаг кодировки).
  function Chunks(list) { this.list = list; this.i = 0; this.o = 0; }
  Chunks.prototype.need = function () { while (this.i < this.list.length && this.o >= this.list[this.i].length) { this.i++; this.o = 0; } };
  Chunks.prototype.byte = function () { this.need(); var c = this.list[this.i]; return c ? c[this.o++] : 0; };
  Chunks.prototype.u16 = function () { return this.byte() | (this.byte() << 8); };
  Chunks.prototype.u32 = function () { return this.u16() + this.u16() * 65536; };
  Chunks.prototype.skip = function (n) { while (n-- > 0) this.byte(); };
  Chunks.prototype.str = function () {
    var cch = this.u16(), fl = this.byte(), high = fl & 1, runs = fl & 8 ? this.u16() : 0, ext = fl & 4 ? this.u32() : 0, s = '';
    while (s.length < cch) {
      if (this.i < this.list.length && this.o >= this.list[this.i].length) { this.i++; this.o = 0; if (this.i >= this.list.length) break; high = this.list[this.i][this.o++] & 1; }
      if (this.i >= this.list.length) break;
      s += String.fromCharCode(high ? this.u16() : this.byte());
    }
    this.skip(runs * 4 + ext);
    return s;
  };
  function shortStr(d, o) { var cch = u16(d, o), high = d[o + 2] & 1, s = ''; o += 3; for (var i = 0; i < cch; i++) { s += String.fromCharCode(high ? u16(d, o) : d[o]); o += high ? 2 : 1; } return s; }

  function readXls(bytes) {
    var w = oleStream(bytes, ['Workbook', 'Book']), dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
    var sst = [], sheets = [], cur = null, pendingStr = null, o = 0;
    function put(r, c, v) { if (!cur) return; (cur[r] || (cur[r] = []))[c] = v; }
    while (o + 4 <= w.length) {
      var type = u16(w, o), len = u16(w, o + 2), d = w.subarray(o + 4, o + 4 + len);
      o += 4 + len;
      if (type === 0x809) { cur = u16(d, 2) === 0x10 ? [] : null; if (cur) sheets.push(cur); }
      else if (type === 0xfc) {
        var parts = [d.subarray(8)];
        while (o + 4 <= w.length && u16(w, o) === 0x3c) { var l2 = u16(w, o + 2); parts.push(w.subarray(o + 4, o + 4 + l2)); o += 4 + l2; }
        var rd = new Chunks(parts), n = u32(d, 4);
        for (var k = 0; k < n && rd.i < parts.length; k++) sst.push(rd.str());
      }
      else if (!cur) continue;
      else if (type === 0xfd) put(u16(d, 0), u16(d, 2), sst[u32(d, 6)] == null ? '' : sst[u32(d, 6)]);
      else if (type === 0x204) put(u16(d, 0), u16(d, 2), shortStr(d, 6));
      else if (type === 0x203) put(u16(d, 0), u16(d, 2), dv.getFloat64(d.byteOffset - w.byteOffset + 6, true));
      else if (type === 0x27e) put(u16(d, 0), u16(d, 2), rkNum(u32(d, 6)));
      else if (type === 0xbd) { var row = u16(d, 0), col = u16(d, 2); for (var p = 4; p + 6 <= len - 2; p += 6) put(row, col++, rkNum(u32(d, p + 2))); }
      else if (type === 0x06) {
        if (u16(d, 12) !== 0xffff) put(u16(d, 0), u16(d, 2), dv.getFloat64(d.byteOffset - w.byteOffset + 6, true));
        else if (d[6] === 0) pendingStr = [u16(d, 0), u16(d, 2)];
      }
      else if (type === 0x207 && pendingStr) { put(pendingStr[0], pendingStr[1], shortStr(d, 0)); pendingStr = null; }
      else if (type === 0x0a && sheets.length) break; // первый лист прочитан
    }
    return dense(sheets[0] || []);
  }

  // ---------- .xlsx: zip + XML ----------
  function unzipEntries(b) {
    var eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not_zip');
    var n = u16(b, eocd + 10), o = u32(b, eocd + 16), out = {};
    for (var k = 0; k < n && u32(b, o) === 0x02014b50; k++) {
      var method = u16(b, o + 10), csize = u32(b, o + 20), nl = u16(b, o + 28), xl = u16(b, o + 30), cl = u16(b, o + 32), lho = u32(b, o + 42);
      var name = new TextDecoder().decode(b.subarray(o + 46, o + 46 + nl)), start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
      out[name] = { method: method, data: b.subarray(start, start + csize) };
      o += 46 + nl + xl + cl;
    }
    return out;
  }
  function inflate(entry) {
    if (!entry) return Promise.resolve('');
    if (entry.method === 0) return Promise.resolve(new TextDecoder().decode(entry.data));
    var ds = new DecompressionStream('deflate-raw'), wr = ds.writable.getWriter();
    wr.write(entry.data); wr.close();
    return new Response(ds.readable).arrayBuffer().then(function (ab) { return new TextDecoder().decode(ab); });
  }
  function xmlText(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, c) { return String.fromCharCode(+c); }).replace(/&amp;/g, '&'); }
  function texts(xml) { var s = '', m, rx = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; while ((m = rx.exec(xml))) s += m[1]; return xmlText(s); }
  function colIndex(ref) { var c = 0, m = ref.match(/^[A-Z]+/); if (!m) return -1; for (var i = 0; i < m[0].length; i++) c = c * 26 + m[0].charCodeAt(i) - 64; return c - 1; }

  function readXlsx(bytes) {
    var z = unzipEntries(bytes);
    var sheetName = Object.keys(z).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort(function (a, b) { return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10); })[0];
    if (!sheetName) throw new Error('no_sheet');
    return Promise.all([inflate(z['xl/sharedStrings.xml']), inflate(z[sheetName])]).then(function (r) {
      var shared = [], m, rx = /<si>([\s\S]*?)<\/si>/g;
      while ((m = rx.exec(r[0]))) shared.push(texts(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
      var rows = [], rr = /<row\b[^>]*?(?:\sr="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g, rm, rowN = 0;
      while ((rm = rr.exec(r[1]))) {
        var ri = rm[1] ? +rm[1] - 1 : rowN; rowN = ri + 1;
        var row = [], cr = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm, colN = 0;
        while ((cm = cr.exec(rm[2]))) {
          var attrs = cm[1], ref = (attrs.match(/\sr="([A-Z]+\d+)"/) || [])[1], t = (attrs.match(/\st="(\w+)"/) || [])[1], body = cm[2] || '';
          var ci = ref ? colIndex(ref) : colN; colN = ci + 1;
          var v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1], val = '';
          if (t === 's') val = shared[+v] || '';
          else if (t === 'inlineStr') val = texts(body);
          else if (t === 'str' || t === 'e') val = v == null ? '' : xmlText(v);
          else if (t === 'b') val = v === '1' ? 'ИСТИНА' : 'ЛОЖЬ';
          else if (v != null && v !== '') val = Number(v);
          row[ci] = val;
        }
        rows[ri] = row;
      }
      return dense(rows);
    });
  }

  // ---------- .csv ----------
  function readCsv(bytes) {
    var text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { text = new TextDecoder('windows-1251').decode(bytes); }
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '', delim = [';', '\t', ','].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { var t = c.trim(), n = t.replace(/[\s ]/g, '').replace(',', '.'); return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : t; }); });
  }

  function dense(rows) { var out = []; for (var i = 0; i < rows.length; i++) { var r = rows[i] || [], d = []; for (var j = 0; j < r.length; j++) d[j] = r[j] == null ? '' : r[j]; out.push(d); } return out; }

  function readTable(input) {
    var b = input instanceof Uint8Array ? input : new Uint8Array(input);
    try {
      if (b[0] === 0xd0 && b[1] === 0xcf) return Promise.resolve(readXls(b));
      if (b[0] === 0x50 && b[1] === 0x4b) return readXlsx(b);
      return Promise.resolve(readCsv(b));
    } catch (e) { return Promise.reject(e); }
  }

  // ---------- колонки списка товаров ----------
  // Ищем строку заголовков: название + количество (+ код, единица, цена). Нет заголовков — null.
  function findColumns(rows) {
    for (var r = 0; r < Math.min(rows.length, 30); r++) {
      var cols = { row: r, name: -1, code: -1, qty: -1, unit: -1, price: -1, priceRetail: -1 };
      rows[r].forEach(function (v, c) {
        var s = String(v).toLowerCase().trim();
        if (!s) return;
        if (cols.name < 0 && /назван|наимен|^товар|номенклат/.test(s)) cols.name = c;
        else if (cols.code < 0 && /код|артикул/.test(s)) cols.code = c;
        else if (cols.qty < 0 && /^кол|количество|^кол-во/.test(s)) cols.qty = c;
        else if (cols.unit < 0 && /^ед|единиц/.test(s)) cols.unit = c;
        else if (/^цена/.test(s)) { if (/скид/.test(s) || cols.price < 0) cols.price = c; if (/розн/.test(s)) cols.priceRetail = c; }
      });
      if (cols.name >= 0 && cols.qty >= 0) {
        var title = rows.slice(0, r + 1).map(function (x) { return x.join(' '); }).join(' ');
        cols.petrovich = /петрович/i.test(title);
        return cols;
      }
    }
    return null;
  }

  // Строки таблицы → позиции { name, code, qty, unit, price } (единица и цена как в файле).
  function tableRows(rows, cols) {
    var out = [];
    for (var r = cols.row + 1; r < rows.length; r++) {
      var row = rows[r], name = String(row[cols.name] == null ? '' : row[cols.name]).trim();
      if (/^(итого|всего)/i.test(name)) break;
      var qtyRaw = row[cols.qty], qty = typeof qtyRaw === 'number' ? qtyRaw : Number(String(qtyRaw || '').replace(/[\s ]/g, '').replace(',', '.'));
      var code = cols.code >= 0 ? String(row[cols.code] == null ? '' : row[cols.code]).trim().replace(/\.0+$/, '') : '';
      if (!name || !(qty > 0)) continue; // заголовки разделов («Товары», «Услуги») и пустые строки
      var price = cols.price >= 0 ? Number(row[cols.price]) : NaN;
      out.push({ name: name, code: code, qty: Math.round(qty * 1000) / 1000, unit: cols.unit >= 0 ? String(row[cols.unit] || '').trim() : '', price: price > 0 ? price : null });
    }
    return out;
  }

  var api = { readTable: readTable, findColumns: findColumns, tableRows: tableRows };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SKSheet = api;
})(typeof self !== 'undefined' ? self : this);

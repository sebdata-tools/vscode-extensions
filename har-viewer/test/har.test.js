'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const har = require('../src/har');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const sample = har.parseHar(fx('sample.har'));
const rows = har.buildRows(sample.entries);
const urls = (indexes) => indexes.map((i) => rows[i].url);

test('parses the sample and its meta', () => {
    assert.strictEqual(sample.entries.length, 13);
    assert.deepStrictEqual(sample.meta, { version: '1.2', creator: 'FixtureBrowser 1.0', browser: '', pages: 1 });
});

test('rejects what is not a HAR with a plain message', () => {
    assert.throws(() => har.parseHar(fx('not-har.har')), (e) => e instanceof har.HarError && /no "log"/.test(e.message));
    assert.throws(() => har.parseHar(fx('broken.har')), (e) => e instanceof har.HarError && /not valid JSON/.test(e.message));
    assert.throws(() => har.parseHar('  '), har.HarError);
    assert.throws(() => har.parseHar('{"log":{}}'), /no "entries"/);
});

test('sparse entries and a BOM do not break parsing or rows', () => {
    const p = har.parseHar(fx('sparse.har'));
    assert.strictEqual(p.entries.length, 3);
    const r = har.buildRows(p.entries);
    assert.strictEqual(r[0].path, 'not a url');
    assert.strictEqual(r[0].host, '');
    assert.strictEqual(r[1].method, '');
    assert.strictEqual(r[2].method, 'GET');
    assert.strictEqual(r[2].status, 204);
    assert.strictEqual(r[2].started, null);
    for (let i = 0; i < 3; i++) {
        assert.strictEqual(har.displayRow(r[i]).length, 9);
        assert.ok(har.detailOf(p.entries[i], i).general.length >= 1);
    }
});

test('rows: host, path, type, size, start offset', () => {
    assert.strictEqual(rows[3].host, 'api.example.com');
    assert.strictEqual(rows[3].path, '/v2/products?page=2&sort=price');
    assert.strictEqual(rows[3].type, 'xhr');
    assert.strictEqual(rows[0].type, 'document');
    assert.strictEqual(rows[1].type, 'stylesheet');
    assert.strictEqual(rows[2].type, 'script');
    assert.strictEqual(rows[5].type, 'image');
    assert.strictEqual(rows[2].size, 5120, 'transfer size wins');
    assert.strictEqual(rows[1].size, 14);
    assert.strictEqual(rows[10].size, 0, 'bodySize -1 falls back to content size');
    assert.strictEqual(rows[4].started, 400);
    assert.deepStrictEqual(har.displayRow(rows[9]), ['10', 'GET', '500', 'api.example.com', '/v2/report', 'text', '4 B', '2.40 s', '+900 ms']);
    assert.strictEqual(har.displayRow(rows[10])[2], '');
});

test('status classes', () => {
    assert.deepStrictEqual([200, 301, 404, 500, 0].map(har.statusClass), ['', 's3', 's4', 's5', 'failed']);
});

test('filter: plain words, fields, prefixes, exclusion', () => {
    assert.strictEqual(har.filterRows(rows, '').length, 13);
    assert.strictEqual(har.filterRows(rows, '   ').length, 13);
    assert.deepStrictEqual(urls(har.filterRows(rows, 'CART')), ['https://api.example.com/v2/cart']);
    assert.strictEqual(har.filterRows(rows, 'method:post').length, 2);
    assert.strictEqual(har.filterRows(rows, 'post').length, 2);
    assert.strictEqual(har.filterRows(rows, 'status:4xx').length, 2);
    assert.strictEqual(har.filterRows(rows, 'status:4').length, 2);
    assert.strictEqual(har.filterRows(rows, 'status:404').length, 1);
    assert.strictEqual(har.filterRows(rows, '404').length, 1);
    assert.strictEqual(har.filterRows(rows, 'status:0').length, 1);
    assert.strictEqual(har.filterRows(rows, 'host:api').length, 6);
    assert.strictEqual(har.filterRows(rows, 'host:api -status:2').length, 3);
    assert.strictEqual(har.filterRows(rows, 'host:api status:2 method:get').length, 2);
    assert.strictEqual(har.filterRows(rows, 'type:json').length, 3, 'xhr and fetch rows match on their MIME type');
    assert.strictEqual(har.filterRows(rows, '-example').length, 0);
    assert.strictEqual(har.filterRows(rows, 'path:/v2/ -type:text').length, 3);
    assert.strictEqual(har.filterRows(rows, 'status:').length, 13, 'an empty field value is ignored');
    assert.strictEqual(har.filterRows(rows, 'nomatch-anywhere').length, 0);
});

test('sort: numeric, text, descending, stable, empties last', () => {
    const all = () => rows.map((r) => r.index);
    assert.strictEqual(har.sortIndexes(rows, all(), 'time', true)[0], 9);
    assert.strictEqual(har.sortIndexes(rows, all(), 'time', false)[0], 10);
    assert.strictEqual(har.sortIndexes(rows, all(), 'status', false)[0], 10);
    const byMethod = har.sortIndexes(rows, all(), 'method', true);
    assert.deepStrictEqual(byMethod.slice(0, 2), [4, 12], 'ties keep file order');
    const byType = har.sortIndexes(rows, all(), 'type', false);
    assert.strictEqual(byType[byType.length - 1], 10, 'empty type sorts last');
    assert.strictEqual(har.sortIndexes(rows, all(), 'type', true)[12], 10, 'and stays last when reversed');
    assert.deepStrictEqual(har.sortIndexes(rows, [3, 1, 2], 'index', false), [1, 2, 3]);
    assert.deepStrictEqual(har.sortIndexes(rows, [3, 1, 2], 'nonsense', true), [3, 2, 1]);
});

test('detail: headers, query, cookies, timings', () => {
    const d = har.detailOf(sample.entries[3], 3);
    assert.deepStrictEqual(d.query, [['page', '2'], ['sort', 'price']]);
    assert.deepStrictEqual(d.responseHeaders[0], ['content-type', 'application/json']);
    assert.strictEqual(d.timings.length, 7);
    assert.deepStrictEqual(d.timings[5], ['wait', 60, '60 ms']);
    assert.ok(d.general.some((p) => p[0] === 'Status' && p[1] === '200 OK'));
    const c = har.detailOf(sample.entries[4], 4);
    assert.deepStrictEqual(c.requestCookies, [['session', 'abc123']]);
    assert.deepStrictEqual(c.responseCookies, [['cart', 'c-77']]);
    assert.strictEqual(c.requestBody.text, '{"productId":1,"qty":2}');
    const f = har.detailOf(sample.entries[10], 10);
    assert.deepStrictEqual(f.query, [['e', 'view']], 'query read from the URL when the list is empty');
    assert.strictEqual(f.timings.length, 3, 'negative timings are left out');
    assert.ok(f.general.some((p) => p[0] === 'Error'));
});

test('bodies: text, base64 text decoded, binary not shown, form fields, clipping', () => {
    assert.strictEqual(har.detailOf(sample.entries[11], 11).responseBody.text, 'café ✓');
    const img = har.detailOf(sample.entries[5], 5).responseBody;
    assert.strictEqual(img.text, '');
    assert.match(img.note, /Binary body/);
    assert.strictEqual(har.detailOf(sample.entries[7], 7).responseBody.note, 'No body.');
    const form = har.detailOf(sample.entries[12], 12).requestBody;
    assert.strictEqual(form.text, 'user=demo\nremember=1');
    const big = { request: {}, response: { content: { mimeType: 'text/plain', text: 'x'.repeat(har.MAX_BODY_CHARS + 5) } } };
    const b = har.detailOf(big, 0).responseBody;
    assert.strictEqual(b.text.length, har.MAX_BODY_CHARS);
    assert.match(b.note, /first 200,000 of 200,005/);
});

test('formatting and totals', () => {
    assert.strictEqual(har.formatBytes(999), '999 B');
    assert.strictEqual(har.formatBytes(1500), '1.5 kB');
    assert.strictEqual(har.formatBytes(2500000), '2.5 MB');
    assert.strictEqual(har.formatBytes(null), '');
    assert.strictEqual(har.formatMs(12.4), '12 ms');
    assert.strictEqual(har.formatMs(90000), '1.5 min');
    assert.strictEqual(har.formatMs(-1), '');
    const t = har.totals(rows, [0, 1]);
    assert.deepStrictEqual(t, { count: 2, size: '48 B', time: '355 ms' });
});

test('50,000 entries: parse, rows, filter and sort stay quick', () => {
    const entries = [];
    for (let i = 0; i < 50000; i++) {
        entries.push({ startedDateTime: new Date(1.7e12 + i * 7).toISOString(), time: (i * 37) % 900, request: { method: i % 9 ? 'GET' : 'POST', url: 'https://h' + (i % 50) + '.example.com/p/' + i + '?k=' + i, headers: [] }, response: { status: i % 11 ? 200 : 404, content: { size: i, mimeType: 'application/json' }, headers: [] } });
    }
    const text = JSON.stringify({ log: { version: '1.2', entries } });
    const start = Date.now();
    const p = har.parseHar(text);
    const r = har.buildRows(p.entries);
    const hit = har.sortIndexes(r, har.filterRows(r, 'status:404 method:get h7.'), 'time', true);
    const ms = Date.now() - start;
    assert.strictEqual(r.length, 50000);
    assert.ok(hit.length > 0 && hit.length < 50000);
    assert.ok(r[hit[0]].time >= r[hit[hit.length - 1]].time);
    assert.ok(ms < 5000, 'took ' + ms + ' ms');
});

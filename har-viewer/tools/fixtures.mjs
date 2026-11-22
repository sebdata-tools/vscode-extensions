// Writes the test fixtures (made-up traffic on example.com; deterministic).
//   node tools/fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
fs.mkdirSync(dir, { recursive: true });

const t0 = Date.parse('2026-01-15T10:00:00.000Z');
const entry = (offset, method, url, status, mime, o = {}) => ({
    startedDateTime: new Date(t0 + offset).toISOString(),
    time: o.time ?? 120,
    request: {
        method, url, httpVersion: 'HTTP/2', cookies: o.reqCookies ?? [],
        headers: [{ name: 'accept', value: '*/*' }, { name: 'user-agent', value: 'FixtureBrowser/1.0' }],
        queryString: o.query ?? [], headersSize: -1, bodySize: o.post && o.post.text ? o.post.text.length : 0,
        ...(o.post ? { postData: o.post } : {}),
    },
    response: {
        status, statusText: o.statusText ?? (status === 200 ? 'OK' : ''), httpVersion: 'HTTP/2', cookies: o.resCookies ?? [],
        headers: [{ name: 'content-type', value: mime }, { name: 'cache-control', value: 'no-store' }],
        content: { size: o.size ?? (o.text ? o.text.length : 0), mimeType: mime, ...(o.text !== undefined ? { text: o.text } : {}), ...(o.encoding ? { encoding: o.encoding } : {}) },
        redirectURL: o.redirect ?? '', headersSize: -1, bodySize: o.bodySize ?? (o.text ? o.text.length : 0),
        ...(o.transfer !== undefined ? { _transferSize: o.transfer } : {}),
        ...(o.error ? { _error: o.error } : {}),
    },
    cache: {},
    timings: o.timings ?? { blocked: 2, dns: 10, connect: 20, ssl: 15, send: 1, wait: 60, receive: 12 },
    ...(o.resourceType ? { _resourceType: o.resourceType } : {}),
    ...(o.ip ? { serverIPAddress: o.ip } : {}),
});

const sample = {
    log: {
        version: '1.2',
        creator: { name: 'FixtureBrowser', version: '1.0' },
        pages: [{ startedDateTime: new Date(t0).toISOString(), id: 'page_1', title: 'Shop', pageTimings: {} }],
        entries: [
            entry(0, 'GET', 'https://shop.example.com/', 200, 'text/html; charset=utf-8', { text: '<!doctype html><title>Shop</title>', time: 310, ip: '203.0.113.7' }),
            entry(40, 'GET', 'https://shop.example.com/assets/app.css', 200, 'text/css', { text: 'body{margin:0}', time: 45 }),
            entry(55, 'GET', 'https://shop.example.com/assets/app.js', 200, 'application/javascript', { text: 'console.log(1)', time: 80, transfer: 5120 }),
            entry(210, 'GET', 'https://api.example.com/v2/products?page=2&sort=price', 200, 'application/json', {
                text: '{"items":[{"id":1,"name":"Kettle"}],"page":2}', time: 150,
                query: [{ name: 'page', value: '2' }, { name: 'sort', value: 'price' }], resourceType: 'xhr',
            }),
            entry(400, 'POST', 'https://api.example.com/v2/cart', 201, 'application/json', {
                text: '{"ok":true}', statusText: 'Created', time: 95, resourceType: 'fetch',
                post: { mimeType: 'application/json', text: '{"productId":1,"qty":2}' },
                reqCookies: [{ name: 'session', value: 'abc123' }], resCookies: [{ name: 'cart', value: 'c-77' }],
            }),
            entry(450, 'GET', 'https://cdn.example.net/img/kettle.png', 200, 'image/png', { text: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', encoding: 'base64', size: 70, time: 33 }),
            entry(600, 'GET', 'https://api.example.com/v2/account', 401, 'application/json', { text: '{"error":"unauthorized"}', statusText: 'Unauthorized', time: 40 }),
            entry(640, 'GET', 'https://shop.example.com/old-page', 301, 'text/html', { statusText: 'Moved Permanently', redirect: 'https://shop.example.com/new-page', time: 12 }),
            entry(700, 'GET', 'https://api.example.com/v2/missing', 404, 'text/plain', { text: 'not found', statusText: 'Not Found', time: 22 }),
            entry(900, 'GET', 'https://api.example.com/v2/report', 500, 'text/plain', { text: 'boom', statusText: 'Internal Server Error', time: 2400 }),
            entry(950, 'GET', 'https://tracker.example.org/collect?e=view', 0, '', { time: 5, error: 'net::ERR_BLOCKED_BY_CLIENT', bodySize: -1, timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: 0, receive: 0 } }),
            entry(1200, 'GET', 'https://api.example.com/v2/note', 200, 'text/plain', { text: Buffer.from('café ✓', 'utf8').toString('base64'), encoding: 'base64', time: 18 }),
            entry(1300, 'POST', 'https://shop.example.com/login', 200, 'text/html', {
                text: 'ok', time: 70,
                post: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'user', value: 'demo' }, { name: 'remember', value: '1' }] },
            }),
        ],
    },
};
// postData with params only has no text: fix the bodySize the helper computed from it.
sample.log.entries[12].request.bodySize = 20;
fs.writeFileSync(path.join(dir, 'sample.har'), JSON.stringify(sample, null, 2));

// A sparse HAR: entries missing most fields, as some tools write them.
const sparse = { log: { entries: [{ request: { url: 'not a url' } }, {}, null, { request: { method: 'get', url: 'http://example.com/a' }, response: { status: 204 } }] } };
fs.writeFileSync(path.join(dir, 'sparse.har'), '﻿' + JSON.stringify(sparse));
fs.writeFileSync(path.join(dir, 'not-har.har'), '{"hello":"world"}');
fs.writeFileSync(path.join(dir, 'broken.har'), '{"log":{"entries":[');
console.log('fixtures written to', dir);

'use strict';
// Pure HAR logic: parsing, table rows, filter, sort, detail. No vscode, no I/O.

class HarError extends Error {}

const MAX_BODY_CHARS = 200000;

const COLUMNS = ['index', 'method', 'status', 'host', 'path', 'type', 'size', 'time', 'started'];

function parseHar(text) {
    if (typeof text !== 'string') throw new HarError('The file could not be read as text.');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) throw new HarError('The file is empty.');
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        throw new HarError('The file is not valid JSON: ' + e.message);
    }
    const log = json && typeof json === 'object' ? json.log : null;
    if (!log || typeof log !== 'object') throw new HarError('This JSON has no "log" object, so it is not a HAR file.');
    if (!Array.isArray(log.entries)) throw new HarError('The HAR "log" has no "entries" list.');
    const entries = log.entries.filter((e) => e && typeof e === 'object');
    const name = (o) => (o && typeof o === 'object' && o.name ? String(o.name) + (o.version ? ' ' + o.version : '') : '');
    return {
        entries,
        meta: {
            version: log.version ? String(log.version) : '',
            creator: name(log.creator),
            browser: name(log.browser),
            pages: Array.isArray(log.pages) ? log.pages.length : 0,
        },
    };
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v) => (v === undefined || v === null ? '' : String(v));

function splitUrl(raw) {
    const url = str(raw);
    try {
        const u = new URL(url);
        return { host: u.host, path: (u.pathname || '/') + u.search };
    } catch (e) {
        return { host: '', path: url };
    }
}

function typeOf(entry) {
    const res = entry.response || {};
    const rt = str(entry._resourceType).toLowerCase();
    if (rt) return rt;
    const mime = str(res.content && res.content.mimeType).split(';')[0].trim().toLowerCase();
    if (!mime) return '';
    if (mime.includes('json')) return 'json';
    if (mime.includes('javascript') || mime.includes('ecmascript')) return 'script';
    if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'document';
    if (mime === 'text/css') return 'stylesheet';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('font/') || mime.includes('font')) return 'font';
    if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
    if (mime.includes('xml')) return 'xml';
    if (mime.startsWith('text/')) return 'text';
    const slash = mime.indexOf('/');
    return slash >= 0 ? mime.slice(slash + 1) : mime;
}

// Size shown in the table: bytes over the wire when the HAR has them, else the body's size.
function sizeOf(entry) {
    const res = entry.response || {};
    const transfer = num(res._transferSize);
    if (transfer !== null && transfer >= 0) return transfer;
    const body = num(res.bodySize);
    if (body !== null && body >= 0) return body;
    const content = num(res.content && res.content.size);
    if (content !== null && content >= 0) return content;
    return null;
}

function buildRows(entries) {
    let first = null;
    const times = entries.map((e) => {
        const t = Date.parse(str(e.startedDateTime));
        if (!isNaN(t) && (first === null || t < first)) first = t;
        return isNaN(t) ? null : t;
    });
    return entries.map((e, i) => {
        const req = e.request || {};
        const res = e.response || {};
        const { host, path } = splitUrl(req.url);
        const status = num(res.status);
        return {
            index: i,
            method: str(req.method).toUpperCase(),
            status: status === null ? 0 : status,
            host,
            path,
            url: str(req.url),
            type: typeOf(e),
            mime: str(res.content && res.content.mimeType).split(';')[0].trim().toLowerCase(),
            size: sizeOf(e),
            time: num(e.time),
            started: times[i] === null || first === null ? null : times[i] - first,
        };
    });
}

// Filter language: words separated by spaces, all must match (case-insensitive).
// A plain word matches the URL, method, status or type. `key:value` narrows to one
// field (method, status, type, host, path, url); `status:4` or `status:4xx` matches
// by prefix. A leading `-` excludes.
function parseFilter(text) {
    const out = [];
    for (let word of str(text).trim().split(/\s+/)) {
        if (!word) continue;
        let negate = false;
        if (word.length > 1 && word[0] === '-') {
            negate = true;
            word = word.slice(1);
        }
        let field = '';
        const m = /^(method|status|type|host|path|url):(.*)$/i.exec(word);
        if (m) {
            field = m[1].toLowerCase();
            word = m[2];
            if (!word) continue;
        }
        out.push({ negate, field, value: word.toLowerCase() });
    }
    return out;
}

function matchTerm(row, term) {
    const v = term.value;
    switch (term.field) {
        case 'method':
            return row.method.toLowerCase() === v;
        case 'status':
            return String(row.status).startsWith(v.replace(/x+$/, ''));
        case 'type':
            return row.type.includes(v) || row.mime.includes(v);
        case 'host':
            return row.host.toLowerCase().includes(v);
        case 'path':
            return row.path.toLowerCase().includes(v);
        case 'url':
            return row.url.toLowerCase().includes(v);
        default:
            return (
                row.url.toLowerCase().includes(v) ||
                row.method.toLowerCase() === v ||
                String(row.status) === v ||
                row.type === v
            );
    }
}

function filterRows(rows, text) {
    const terms = parseFilter(text);
    if (!terms.length) return rows.map((r) => r.index);
    const out = [];
    for (const row of rows) {
        let ok = true;
        for (const t of terms) {
            if (matchTerm(row, t) === t.negate) {
                ok = false;
                break;
            }
        }
        if (ok) out.push(row.index);
    }
    return out;
}

// Sorts a list of row indexes in place by one column; ties keep file order. Empty values last.
function sortIndexes(rows, indexes, key, descending) {
    if (!COLUMNS.includes(key) || key === 'index') {
        indexes.sort((a, b) => a - b);
        if (descending) indexes.reverse();
        return indexes;
    }
    const numeric = key === 'status' || key === 'size' || key === 'time' || key === 'started';
    const dir = descending ? -1 : 1;
    indexes.sort((a, b) => {
        const x = rows[a][key];
        const y = rows[b][key];
        const xe = x === null || x === '';
        const ye = y === null || y === '';
        if (xe || ye) return xe && ye ? a - b : xe ? 1 : -1;
        let c;
        if (numeric) c = x - y;
        else c = x < y ? -1 : x > y ? 1 : 0;
        return c === 0 ? a - b : c * dir;
    });
    return indexes;
}

function formatBytes(n) {
    if (n === null || n === undefined || n < 0) return '';
    if (n < 1000) return n + ' B';
    if (n < 1e6) return (n / 1e3).toFixed(1) + ' kB';
    if (n < 1e9) return (n / 1e6).toFixed(1) + ' MB';
    return (n / 1e9).toFixed(2) + ' GB';
}

function formatMs(n) {
    if (n === null || n === undefined || n < 0) return '';
    if (n < 1000) return Math.round(n) + ' ms';
    if (n < 60000) return (n / 1000).toFixed(2) + ' s';
    return (n / 60000).toFixed(1) + ' min';
}

function displayRow(row) {
    return [
        String(row.index + 1),
        row.method,
        row.status ? String(row.status) : '',
        row.host,
        row.path,
        row.type,
        formatBytes(row.size),
        formatMs(row.time),
        row.started === null ? '' : '+' + formatMs(row.started),
    ];
}

function statusClass(status) {
    if (!status) return 'failed';
    if (status >= 500) return 's5';
    if (status >= 400) return 's4';
    if (status >= 300) return 's3';
    return '';
}

function pairs(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((p) => p && typeof p === 'object').map((p) => [str(p.name), str(p.value)]);
}

const TEXT_MIME = /^(text\/|application\/(json|javascript|ecmascript|xml|xhtml\+xml|x-www-form-urlencoded|graphql|x-ndjson|manifest\+json|ld\+json|problem\+json|x-javascript|sql|yaml|x-yaml|toml|csv))|(\+json|\+xml)$|^image\/svg\+xml$/i;

function isTextMime(mime) {
    return TEXT_MIME.test(str(mime).split(';')[0].trim());
}

function clip(text) {
    if (text.length <= MAX_BODY_CHARS) return { text, note: '' };
    return {
        text: text.slice(0, MAX_BODY_CHARS),
        note: 'Showing the first ' + MAX_BODY_CHARS.toLocaleString('en-US') + ' of ' + text.length.toLocaleString('en-US') + ' characters. The full body is in the JSON text view.',
    };
}

// Bodies are shown as text only. A base64 body is decoded when its MIME type is textual.
function bodyOf(mimeType, text, encoding, size) {
    const mime = str(mimeType);
    if (text === undefined || text === null || text === '') {
        const n = num(size);
        return { mimeType: mime, text: '', note: n !== null && n > 0 ? 'The HAR holds no body text for this (' + formatBytes(n) + ').' : 'No body.' };
    }
    let body = str(text);
    if (str(encoding).toLowerCase() === 'base64') {
        if (!isTextMime(mime)) {
            const bytes = Math.floor((body.replace(/=+$/, '').length * 3) / 4);
            return { mimeType: mime, text: '', note: 'Binary body (base64, about ' + formatBytes(bytes) + '): not shown.' };
        }
        try {
            body = Buffer.from(body, 'base64').toString('utf8');
        } catch (e) {
            return { mimeType: mime, text: '', note: 'The base64 body could not be decoded.' };
        }
    }
    const c = clip(body);
    return { mimeType: mime, text: c.text, note: c.note };
}

const TIMING_KEYS = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];

function detailOf(entry, index) {
    const req = entry.request || {};
    const res = entry.response || {};
    const content = res.content || {};
    const post = req.postData || {};
    const timings = entry.timings && typeof entry.timings === 'object' ? entry.timings : {};
    const general = [
        ['Request', '#' + (index + 1)],
        ['URL', str(req.url)],
        ['Method', str(req.method)],
        ['Status', (num(res.status) === null ? '' : res.status) + (res.statusText ? ' ' + res.statusText : '')],
        ['HTTP version', str(res.httpVersion || req.httpVersion)],
        ['Started', str(entry.startedDateTime)],
        ['Total time', formatMs(num(entry.time))],
        ['Server address', str(entry.serverIPAddress)],
        ['Redirect to', str(res.redirectURL)],
        ['Body size', formatBytes(num(res.bodySize))],
        ['Content size', formatBytes(num(content.size))],
        ['Error', str(res._error)],
    ].filter((p) => p[1] !== '');
    let query = pairs(req.queryString);
    if (!query.length) {
        try {
            query = Array.from(new URL(str(req.url)).searchParams.entries());
        } catch (e) {
            query = [];
        }
    }
    let requestBody = bodyOf(post.mimeType, post.text, post.encoding, req.bodySize);
    if (!requestBody.text && Array.isArray(post.params) && post.params.length) {
        requestBody = { mimeType: str(post.mimeType), text: pairs(post.params).map((p) => p[0] + '=' + p[1]).join('\n'), note: 'Form fields, one per line.' };
    }
    return {
        index,
        general,
        requestHeaders: pairs(req.headers),
        responseHeaders: pairs(res.headers),
        query,
        requestCookies: pairs(req.cookies),
        responseCookies: pairs(res.cookies),
        timings: TIMING_KEYS.map((k) => [k, num(timings[k])]).filter((p) => p[1] !== null && p[1] >= 0).map((p) => [p[0], p[1], formatMs(p[1])]),
        requestBody,
        responseBody: bodyOf(content.mimeType, content.text, content.encoding, content.size),
    };
}

function totals(rows, indexes) {
    let size = 0;
    let time = 0;
    for (const i of indexes) {
        size += rows[i].size || 0;
        time += rows[i].time || 0;
    }
    return { count: indexes.length, size: formatBytes(size), time: formatMs(time) };
}

module.exports = {
    HarError, COLUMNS, MAX_BODY_CHARS,
    parseHar, buildRows, parseFilter, filterRows, sortIndexes,
    formatBytes, formatMs, displayRow, statusClass, detailOf, totals, isTextMime,
};

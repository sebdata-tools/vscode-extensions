// Webview side of HAR File Viewer. Draws only the rows in view; asks the extension
// host for each window of rows. No network access, no storage outside VS Code's state.
(function () {
    'use strict';
    const vscode = acquireVsCodeApi();
    const ROW = 22;
    const OVERSCAN = 30;
    const MAX_HEIGHT = 8000000; // stay well under the browser's element height limit
    const COLS = [
        ['index', '#'], ['method', 'Method'], ['status', 'Status'], ['host', 'Host'], ['path', 'Path'],
        ['type', 'Type'], ['size', 'Size'], ['time', 'Time'], ['started', 'Start'],
    ];
    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const saved = vscode.getState() || {};
    const state = {
        filter: saved.filter || '', sortKey: saved.sortKey || 'index', descending: !!saved.descending,
        count: 0, total: 0, seq: 0, start: 0, rows: [], selected: null, selectedPos: -1,
        tab: saved.tab || 'Headers', detail: null, scale: 1,
    };
    const filter = $('filter'), scroll = $('scroll'), spacer = $('spacer'), rowsBox = $('rows');
    const head = $('head'), detailBox = $('detail'), pane = $('pane'), tabs = $('tabs');
    filter.value = state.filter;

    const save = () => vscode.setState({ filter: state.filter, sortKey: state.sortKey, descending: state.descending, tab: state.tab });
    const sendQuery = () => {
        save();
        vscode.postMessage({ type: 'query', filter: state.filter, sortKey: state.sortKey, descending: state.descending });
    };

    function drawHead() {
        head.textContent = '';
        for (const [key, label] of COLS) {
            const c = el('button', 'cell c-' + key, label + (state.sortKey === key ? (state.descending ? ' ▼' : ' ▲') : ''));
            c.title = 'Sort by ' + label.replace('#', 'file order');
            c.addEventListener('click', () => {
                if (state.sortKey === key) state.descending = !state.descending;
                else { state.sortKey = key; state.descending = false; }
                sendQuery();
            });
            head.appendChild(c);
        }
    }

    function layout() {
        const full = state.count * ROW;
        state.scale = full > MAX_HEIGHT ? full / MAX_HEIGHT : 1;
        spacer.style.height = Math.min(full, MAX_HEIGHT) + 'px';
        head.style.paddingRight = (scroll.offsetWidth - scroll.clientWidth) + 'px'; // keep the header over the columns
    }

    function requestWindow() {
        const top = scroll.scrollTop * state.scale;
        const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
        const last = Math.min(state.count, Math.ceil((top + scroll.clientHeight) / ROW) + OVERSCAN);
        state.seq++;
        vscode.postMessage({ type: 'rows', seq: state.seq, start: first, end: last });
    }

    function drawRows(start, rows) {
        state.start = start;
        state.rows = rows;
        rowsBox.textContent = '';
        // With a scaled spacer the window is pinned to the viewport instead of its true offset.
        const offset = state.scale === 1 ? start * ROW : scroll.scrollTop - (scroll.scrollTop * state.scale - start * ROW);
        rowsBox.style.transform = 'translateY(' + Math.max(0, offset) + 'px)';
        rows.forEach((r, i) => {
            const row = el('div', 'row' + (r.cls ? ' ' + r.cls : '') + (r.id === state.selected ? ' selected' : ''));
            row.setAttribute('role', 'row');
            row.title = r.url;
            r.cells.forEach((text, c) => row.appendChild(el('span', 'cell c-' + COLS[c][0], text)));
            row.addEventListener('click', () => select(r.id, start + i));
            rowsBox.appendChild(row);
        });
        report();
    }

    function select(id, pos) {
        state.selected = id;
        state.selectedPos = pos;
        for (const [i, node] of Array.from(rowsBox.children).entries()) {
            node.classList.toggle('selected', state.rows[i] && state.rows[i].id === id);
        }
        vscode.postMessage({ type: 'detail', id });
    }

    function kvTable(pairs, empty) {
        if (!pairs.length) return el('p', 'muted', empty);
        const t = el('table', 'kv');
        for (const [k, v] of pairs) {
            const tr = el('tr');
            tr.appendChild(el('th', '', k));
            tr.appendChild(el('td', '', v));
            t.appendChild(tr);
        }
        return t;
    }

    function section(title, node) {
        const f = document.createDocumentFragment();
        f.appendChild(el('h3', '', title));
        f.appendChild(node);
        return f;
    }

    function bodyView(body) {
        const f = document.createDocumentFragment();
        if (body.mimeType) f.appendChild(el('p', 'muted', body.mimeType));
        if (body.note) f.appendChild(el('p', 'note', body.note));
        if (body.text) {
            let text = body.text;
            if (/json/i.test(body.mimeType) && text.length < 2000000) {
                try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* shown as is */ }
            }
            const copy = el('button', 'small', 'Copy');
            copy.addEventListener('click', () => vscode.postMessage({ type: 'copy', text }));
            f.appendChild(copy);
            f.appendChild(el('pre', '', text));
        }
        return f;
    }

    function timingView(d) {
        if (!d.timings.length) return el('p', 'muted', 'The HAR has no timings for this request.');
        const sum = d.timings.reduce((n, t) => n + t[1], 0) || 1;
        const t = el('table', 'kv timings');
        for (const [name, ms, label] of d.timings) {
            const tr = el('tr');
            tr.appendChild(el('th', '', name));
            tr.appendChild(el('td', 'num', label));
            const bar = el('td', 'barcell');
            const fill = el('div', 'bar t-' + name);
            fill.style.width = Math.max(0.5, (ms / sum) * 100) + '%';
            bar.appendChild(fill);
            tr.appendChild(bar);
            t.appendChild(tr);
        }
        return t;
    }

    const TABS = ['Headers', 'Query', 'Cookies', 'Timings', 'Request body', 'Response body'];
    function drawDetail() {
        const d = state.detail;
        detailBox.hidden = !d;
        if (!d) { report(); return; }
        tabs.textContent = '';
        for (const name of TABS) {
            const b = el('button', 'tab' + (name === state.tab ? ' active' : ''), name);
            b.setAttribute('role', 'tab');
            b.addEventListener('click', () => { state.tab = name; save(); drawDetail(); });
            tabs.appendChild(b);
        }
        const close = el('button', 'tab close', 'Close');
        close.addEventListener('click', () => { state.detail = null; state.selected = null; drawDetail(); drawRows(state.start, state.rows); });
        tabs.appendChild(close);
        pane.textContent = '';
        if (state.tab === 'Headers') {
            pane.appendChild(section('General', kvTable(d.general, '')));
            pane.appendChild(section('Response headers', kvTable(d.responseHeaders, 'None recorded.')));
            pane.appendChild(section('Request headers', kvTable(d.requestHeaders, 'None recorded.')));
        } else if (state.tab === 'Query') {
            pane.appendChild(kvTable(d.query, 'This request has no query string.'));
        } else if (state.tab === 'Cookies') {
            pane.appendChild(section('Request cookies', kvTable(d.requestCookies, 'None recorded.')));
            pane.appendChild(section('Response cookies', kvTable(d.responseCookies, 'None recorded.')));
        } else if (state.tab === 'Timings') {
            pane.appendChild(timingView(d));
        } else if (state.tab === 'Request body') {
            pane.appendChild(bodyView(d.requestBody));
        } else {
            pane.appendChild(bodyView(d.responseBody));
        }
        pane.scrollTop = 0;
        report();
    }

    // Tells the host what is on screen (read by the in-editor test).
    function report() {
        const first = rowsBox.firstElementChild;
        vscode.postMessage({
            type: 'rendered',
            domRows: rowsBox.children.length,
            firstRow: first ? Array.from(first.children).map((c) => c.textContent).join(' | ') : '',
            detailOpen: !detailBox.hidden,
            detailText: detailBox.hidden ? '' : pane.textContent.slice(0, 2000),
        });
    }

    window.addEventListener('message', (ev) => {
        const m = ev.data;
        if (m.type === 'result') {
            state.count = m.count;
            state.total = m.total;
            state.sortKey = m.sortKey;
            state.descending = m.descending;
            const err = $('error');
            err.hidden = !m.error;
            err.textContent = m.error || '';
            const parts = [];
            if (!m.error) {
                parts.push(m.count === m.total ? m.total + ' requests' : m.count + ' of ' + m.total + ' requests');
                if (m.size) parts.push(m.size);
                if (m.time) parts.push(m.time + ' summed');
                if (m.meta && m.meta.creator) parts.push(m.meta.creator);
            }
            $('summary').textContent = parts.join(' · ');
            drawHead();
            layout();
            scroll.scrollTop = 0;
            if (m.count === 0) drawRows(0, []);
            requestWindow();
        } else if (m.type === 'rows') {
            if (m.seq === state.seq) drawRows(m.start, m.rows);
        } else if (m.type === 'detail') {
            state.detail = m.detail;
            drawDetail();
        } else if (m.type === 'test') {
            // Used only by the packaged-extension test: drives the same code paths as a user.
            if (m.filter !== undefined) { filter.value = m.filter; state.filter = m.filter; sendQuery(); }
            if (m.clickRow !== undefined && rowsBox.children[m.clickRow]) rowsBox.children[m.clickRow].click();
        }
    });

    let timer = 0;
    filter.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.filter = filter.value; sendQuery(); }, 120);
    });
    let raf = 0;
    scroll.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; requestWindow(); });
    });
    window.addEventListener('resize', requestWindow);
    scroll.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
        ev.preventDefault();
        const pos = state.selectedPos < 0 ? state.start : state.selectedPos + (ev.key === 'ArrowDown' ? 1 : -1);
        const local = pos - state.start;
        if (local < 0 || local >= state.rows.length) return;
        select(state.rows[local].id, pos);
        const node = rowsBox.children[local];
        if (node) node.scrollIntoView({ block: 'nearest' });
    });
    $('astext').addEventListener('click', () => vscode.postMessage({ type: 'openAsText' }));
    $('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));

    drawHead();
    vscode.postMessage({ type: 'ready' });
})();

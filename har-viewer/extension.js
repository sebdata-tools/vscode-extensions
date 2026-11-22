'use strict';
// HAR File Viewer: a read-only custom editor for *.har files.
// The file is read and parsed here, in the extension host; the webview only ever
// receives the rows it is showing. Nothing is written, nothing leaves the machine.
const vscode = require('vscode');
const crypto = require('crypto');
const har = require('./src/har');

const VIEW_TYPE = 'sebdata.harFileViewer';
const MAX_WINDOW = 400;

class HarDocument {
    constructor(uri) {
        this.uri = uri;
        this.error = '';
        this.entries = [];
        this.rows = [];
        this.meta = { version: '', creator: '', browser: '', pages: 0 };
        this.bytes = 0;
    }

    async load() {
        this.error = '';
        this.entries = [];
        this.rows = [];
        try {
            const data = await vscode.workspace.fs.readFile(this.uri);
            this.bytes = data.byteLength;
            const parsed = har.parseHar(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8'));
            this.entries = parsed.entries;
            this.meta = parsed.meta;
            this.rows = har.buildRows(parsed.entries);
        } catch (e) {
            this.error = e instanceof har.HarError ? e.message : 'The file could not be opened: ' + (e && e.message ? e.message : String(e));
        }
    }

    dispose() {
        this.entries = [];
        this.rows = [];
    }
}

class HarEditorProvider {
    constructor(context) {
        this.context = context;
        this.views = new Set();
    }

    async openCustomDocument(uri) {
        const doc = new HarDocument(uri);
        await doc.load();
        return doc;
    }

    resolveCustomEditor(doc, panel) {
        const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
        const view = { doc, panel, indexes: [], filter: '', sortKey: 'index', descending: false, rendered: null, ready: false };
        this.views.add(view);
        panel.onDidDispose(() => this.views.delete(view));

        const query = () => {
            view.indexes = har.sortIndexes(doc.rows, har.filterRows(doc.rows, view.filter), view.sortKey, view.descending);
            const shown = har.totals(doc.rows, view.indexes);
            panel.webview.postMessage({
                type: 'result',
                error: doc.error,
                total: doc.rows.length,
                count: shown.count,
                size: shown.size,
                time: shown.time,
                filter: view.filter,
                sortKey: view.sortKey,
                descending: view.descending,
                meta: doc.meta,
                fileBytes: har.formatBytes(doc.bytes),
            });
        };

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (!msg || typeof msg !== 'object') return;
            switch (msg.type) {
                case 'ready':
                    view.ready = true;
                    query();
                    break;
                case 'query':
                    view.filter = typeof msg.filter === 'string' ? msg.filter.slice(0, 500) : '';
                    view.sortKey = har.COLUMNS.includes(msg.sortKey) ? msg.sortKey : 'index';
                    view.descending = !!msg.descending;
                    query();
                    break;
                case 'rows': {
                    const start = Math.max(0, Math.min(view.indexes.length, msg.start | 0));
                    const end = Math.max(start, Math.min(view.indexes.length, msg.end | 0, start + MAX_WINDOW));
                    const rows = [];
                    for (let i = start; i < end; i++) {
                        const row = doc.rows[view.indexes[i]];
                        rows.push({ id: row.index, cells: har.displayRow(row), cls: har.statusClass(row.status), url: row.url });
                    }
                    panel.webview.postMessage({ type: 'rows', seq: msg.seq, start, rows });
                    break;
                }
                case 'detail': {
                    const entry = doc.entries[msg.id | 0];
                    if (entry) panel.webview.postMessage({ type: 'detail', detail: har.detailOf(entry, msg.id | 0) });
                    break;
                }
                case 'openAsText':
                    vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default');
                    break;
                case 'reload':
                    await doc.load();
                    query();
                    break;
                case 'copy':
                    if (typeof msg.text === 'string') vscode.env.clipboard.writeText(msg.text);
                    break;
                case 'rendered':
                    view.rendered = { domRows: msg.domRows | 0, firstRow: String(msg.firstRow || ''), detailOpen: !!msg.detailOpen, detailText: String(msg.detailText || '').slice(0, 2000) };
                    break;
            }
        });

        panel.webview.html = this.html(panel.webview, media);
    }

    html(webview, media) {
        const nonce = crypto.randomBytes(16).toString('hex');
        const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'view.css'));
        const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'view.js'));
        const csp = "default-src 'none'; style-src " + webview.cspSource + "; script-src 'nonce-" + nonce + "';";
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>HAR File Viewer</title>
</head>
<body>
<div id="toolbar">
  <input id="filter" type="text" spellcheck="false" placeholder="Filter: text, status:4xx, method:post, type:json, host:api, -exclude" aria-label="Filter requests">
  <span id="summary" role="status"></span>
  <span class="grow"></span>
  <button id="reload" title="Read the file again from disk">Reload</button>
  <button id="astext" title="Open this file in the normal JSON text editor">Open as JSON text</button>
</div>
<div id="error" hidden></div>
<div id="head" role="row"></div>
<div id="scroll" tabindex="0" role="grid" aria-label="Requests"><div id="spacer"><div id="rows"></div></div></div>
<div id="detail" hidden>
  <div id="tabs" role="tablist"></div>
  <div id="pane"></div>
</div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
    }

    // Read-only snapshot of the open viewers, for tests.
    inspect() {
        return Array.from(this.views).map((v) => ({
            uri: v.doc.uri.toString(),
            error: v.doc.error,
            entries: v.doc.rows.length,
            shown: v.indexes.length,
            filter: v.filter,
            ready: v.ready,
            rendered: v.rendered,
        }));
    }
}

function activate(context) {
    const provider = new HarEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        }),
        vscode.commands.registerCommand('harFileViewer.open', (uri) => {
            const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
            if (!target) return vscode.window.showInformationMessage('Open a .har file first.');
            return vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
        }),
        vscode.commands.registerCommand('harFileViewer.openAsText', (uri) => {
            let target = uri instanceof vscode.Uri ? uri : null;
            if (!target) {
                const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (tab && tab.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE) target = tab.input.uri;
            }
            if (!target) return undefined;
            return vscode.commands.executeCommand('vscode.openWith', target, 'default');
        })
    );
    // For the packaged-extension test only: look at the open viewers, or drive one like a user would.
    return {
        inspect: () => provider.inspect(),
        drive: (msg) => provider.views.forEach((v) => v.panel.webview.postMessage(Object.assign({}, msg, { type: 'test' }))),
    };
}

function deactivate() {}

module.exports = { activate, deactivate };

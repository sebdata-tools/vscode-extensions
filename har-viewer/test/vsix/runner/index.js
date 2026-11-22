// Runs inside VS Code's extension host (--extensionTestsPath) against the INSTALLED .vsix.
// Writes its result to the file named in HARTEST_OUT.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 20000) {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
        last = await fn();
        if (last) return last;
        await sleep(150);
    }
    throw new Error('timed out waiting for: ' + what);
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

exports.run = async () => {
    const out = process.env.HARTEST_OUT;
    const work = process.env.HARTEST_WORK;
    const steps = [];
    const res = { vscode: vscode.version, steps };
    try {
        const ext = vscode.extensions.getExtension('sebdata.har-file-viewer');
        if (!ext) throw new Error('extension not installed');
        res.version = ext.packageJSON.version;
        res.extensionPath = ext.extensionPath;
        if (!ext.extensionPath.startsWith(process.env.HARTEST_EXTDIR)) throw new Error('not running from the installed .vsix: ' + ext.extensionPath);
        steps.push('installed from the .vsix');

        const file = path.join(work, 'sample.har');
        const before = sha(file);
        const uri = vscode.Uri.file(file);
        // A plain open, as a click in the Explorer does: the viewer must be the default.
        await vscode.commands.executeCommand('vscode.open', uri);
        await until('custom editor tab', () => {
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            return tab && tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'sebdata.harFileViewer';
        });
        steps.push('a plain open of sample.har shows the viewer by default');
        const api = await until('activation', () => ext.isActive && ext.exports);
        const view = () => api.inspect().find((v) => v.uri === uri.toString());

        let v = await until('rows drawn', () => { const x = view(); return x && x.rendered && x.rendered.domRows > 0 && x; });
        if (v.entries !== 13 || v.shown !== 13) throw new Error('expected 13 entries, got ' + v.entries + '/' + v.shown);
        if (v.rendered.domRows !== 13) throw new Error('expected 13 rows drawn, got ' + v.rendered.domRows);
        if (!/^1 \| GET \| 200 \| shop\.example\.com \| \/ \| document/.test(v.rendered.firstRow)) throw new Error('first row: ' + v.rendered.firstRow);
        res.firstRow = v.rendered.firstRow;
        steps.push('13 rows drawn in the webview');

        api.drive({ filter: 'status:4xx' });
        v = await until('filter applied', () => { const x = view(); return x && x.shown === 2 && x.rendered && x.rendered.domRows === 2 && x; });
        if (!v.rendered.firstRow.includes('/v2/account')) throw new Error('filtered first row: ' + v.rendered.firstRow);
        steps.push('filter status:4xx leaves 2 rows');

        api.drive({ clickRow: 0 });
        v = await until('detail pane', () => { const x = view(); return x && x.rendered && x.rendered.detailOpen && x.rendered.detailText.includes('https://api.example.com/v2/account') && x; });
        if (!v.rendered.detailText.includes('401 Unauthorized')) throw new Error('detail: ' + v.rendered.detailText.slice(0, 300));
        steps.push('a click on a row opens its detail');

        await vscode.commands.executeCommand('harFileViewer.openAsText');
        await until('text editor', () => {
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            return tab && tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
        });
        steps.push('Open as JSON Text switches to the text editor');

        const broken = vscode.Uri.file(path.join(work, 'broken.har'));
        await vscode.commands.executeCommand('vscode.open', broken);
        const b = await until('error shown', () => { const x = api.inspect().find((y) => y.uri === broken.toString()); return x && x.ready && x; });
        if (!/not valid JSON/.test(b.error)) throw new Error('broken.har error: ' + b.error);
        steps.push('a broken file shows a plain error');

        const big = vscode.Uri.file(path.join(work, 'big.har'));
        const t = Date.now();
        await vscode.commands.executeCommand('vscode.open', big);
        const g = await until('big file drawn', () => { const x = api.inspect().find((y) => y.uri === big.toString()); return x && x.rendered && x.rendered.domRows > 0 && x; }, 60000);
        res.big = { entries: g.entries, domRows: g.rendered.domRows, ms: Date.now() - t };
        if (g.entries !== 60000) throw new Error('big.har entries ' + g.entries);
        if (g.rendered.domRows > 400) throw new Error('big.har drew ' + g.rendered.domRows + ' rows at once');
        steps.push('60,000 requests open with only a window of rows drawn');

        if (sha(file) !== before) throw new Error('sample.har was modified');
        steps.push('the file is unchanged');
        res.ok = true;
        fs.writeFileSync(out, JSON.stringify(res, null, 2));
    } catch (e) {
        res.ok = false;
        res.error = e.message;
        fs.writeFileSync(out, JSON.stringify(res, null, 2));
        throw e;
    }
};

// Installs a packaged .vsix into a throwaway VS Code profile and runs test/vsix/runner inside
// VS Code against it. Never touches the user's own profile or extensions.
//   node test/vsix/run.mjs <file.vsix>
// Needs VS Code on this machine (`code` on PATH). Exit code 0 = passed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const vsix = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(vsix)) { console.error('usage: node test/vsix/run.mjs <file.vsix>'); process.exit(2); }

const tmp = path.join(root, 'build', 'vsixtest');
fs.rmSync(tmp, { recursive: true, force: true });
const extDir = path.join(tmp, 'ext-dir'), userData = path.join(tmp, 'user-data'), work = path.join(tmp, 'work');
for (const d of [extDir, path.join(userData, 'User'), work]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
    'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'workbench.startupEditor': 'none',
}));
for (const f of ['sample.har', 'broken.har']) fs.copyFileSync(path.join(root, 'test', 'fixtures', f), path.join(work, f));
const entries = [];
for (let i = 0; i < 60000; i++) {
    entries.push({ startedDateTime: new Date(1.7e12 + i * 7).toISOString(), time: (i * 37) % 900, request: { method: 'GET', url: 'https://h' + (i % 50) + '.example.com/p/' + i, headers: [] }, response: { status: 200, content: { size: i, mimeType: 'application/json' }, headers: [] } });
}
fs.writeFileSync(path.join(work, 'big.har'), JSON.stringify({ log: { version: '1.2', entries } }));

const where = execFileSync('where.exe', ['code.cmd'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
const exe = path.join(path.dirname(where), '..', 'Code.exe');
const inst = spawnSync('cmd.exe', ['/c', where, '--extensions-dir', extDir, '--user-data-dir', userData, '--install-extension', vsix, '--force'], { encoding: 'utf8' });
console.log((inst.stdout || '').trim());
if (inst.status !== 0) { console.error(inst.stderr); process.exit(1); }

const out = path.join(tmp, 'result.json');
const run = spawnSync(exe, [
    '--extensions-dir=' + extDir, '--user-data-dir=' + userData,
    '--extensionDevelopmentPath=' + path.join(here, 'runner'), '--extensionTestsPath=' + path.join(here, 'runner', 'index.js'),
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--new-window', work,
], { encoding: 'utf8', timeout: 240000, env: { ...process.env, HARTEST_OUT: out, HARTEST_WORK: work, HARTEST_EXTDIR: extDir } });
const result = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '(no result file)';
console.log(result);
console.log('VS Code exit code:', run.status);
let ok = false;
try { ok = JSON.parse(result).ok === true && run.status === 0; } catch { /* no result */ }
if (ok) {
    fs.copyFileSync(out, path.join(root, 'build', 'vsixtest-result.json'));
    for (const d of [extDir, userData, work]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
process.exit(ok ? 0 : 1);

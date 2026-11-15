// Backup -> GitHub (fake API) -> restore on a "new phone", wrong password, tamper, path escape.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { execFile } = require('node:child_process');
(async () => {
  const oldPhone = fs.mkdtempSync(path.join(os.tmpdir(), 'old-')), newPhone = fs.mkdtempSync(path.join(os.tmpdir(), 'new-'));
  fs.mkdirSync(path.join(oldPhone, '.arjun-ai', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(oldPhone, '.arjun-ai', 'dimaag.md'), '# Mera dimaag\n');
  fs.writeFileSync(path.join(oldPhone, '.arjun-ai', 'yaad.md'), '- seekh\n');
  fs.writeFileSync(path.join(oldPhone, '.arjun-ai', 'tools', 'img.json'), '{"name":"img"}');
  fs.writeFileSync(path.join(oldPhone, '.arjun-ai', 'sent-log.jsonl'), 'skip me');
  const KEYS = 'export GEMINI_API_KEY=AQ.secret123\nexport GITHUB_TOKEN=ghp_tok\nexport ARJUN_BACKUP_REPO=arjun/arjun-backup\n';
  fs.writeFileSync(path.join(oldPhone, '.arjun-keys'), KEYS, { mode: 0o600 });
  // fake GitHub contents API
  const store = {}; let uploads = 0;
  const api = await new Promise((r) => { const s = http.createServer((q, w) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    assert.equal(q.headers.authorization, 'Bearer ghp_tok'); assert.ok(q.url.startsWith('/repos/arjun/arjun-backup/contents/backups/'));
    if (q.method === 'GET') { if (!store.c) { w.writeHead(404); return w.end('{}'); } w.writeHead(200); return w.end(JSON.stringify({ content: store.c, sha: 'abc' })); }
    const j = JSON.parse(b); if (store.c) assert.equal(j.sha, 'abc'); store.c = j.content; uploads++; w.writeHead(store.c ? 200 : 201); w.end('{}');
  }); }).listen(0, '127.0.0.1', () => r(s)); });
  const cli = path.join(__dirname, 'self-upgrade.cjs');
  const run = (home, args, input) => new Promise((resolve, reject) => {
    const c = execFile(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, HOME: home, GITHUB_API_URL: `http://127.0.0.1:${api.address().port}` } }, (err, stdout, stderr) => err ? reject(new Error(stdout + stderr)) : resolve(stdout));
    c.stdin.end(input);
  });
  // weak / mismatched password refused
  await assert.rejects(run(oldPhone, ['backup'], 'short\nshort\n'), /8 akshar/);
  const out = await run(oldPhone, ['backup'], 'Toonistaan@2026\nToonistaan@2026\n');
  assert.match(out, /Backup ban gaya \(4 files/); assert.match(out, /GitHub par bhi: arjun\/arjun-backup/);
  assert.ok(!out.includes('Toonistaan@2026') && !out.includes('AQ.secret123'));
  await run(oldPhone, ['backup'], 'Toonistaan@2026\nToonistaan@2026\n'); assert.equal(uploads, 2);       // update uses sha
  const local = fs.readdirSync(path.join(oldPhone, 'arjun-backup'))[0];
  const raw = fs.readFileSync(path.join(oldPhone, 'arjun-backup', local));
  assert.ok(!raw.includes('AQ.secret123') && !raw.includes('Mera dimaag'));                            // really encrypted
  // new phone: only token + repo known (typed once), everything comes back
  fs.writeFileSync(path.join(newPhone, '.arjun-keys'), 'export GITHUB_TOKEN=ghp_tok\nexport ARJUN_BACKUP_REPO=arjun/arjun-backup\n');
  await assert.rejects(run(newPhone, ['restore'], 'galat-password\n'), /Password galat/);
  const r = await run(newPhone, ['restore'], 'Toonistaan@2026\n');
  assert.match(r, /Restore ho gaya: 4 files/);
  assert.equal(fs.readFileSync(path.join(newPhone, '.arjun-ai', 'dimaag.md'), 'utf8'), '# Mera dimaag\n');
  assert.equal(fs.readFileSync(path.join(newPhone, '.arjun-keys'), 'utf8'), KEYS);
  assert.equal((fs.statSync(path.join(newPhone, '.arjun-keys')).mode & 0o777).toString(8), '600');
  assert.ok(!fs.existsSync(path.join(newPhone, '.arjun-ai', 'sent-log.jsonl')));
  assert.ok(fs.readdirSync(newPhone).some((f) => f.startsWith('.arjun-before-restore-')));             // old data kept safe
  // tampered file is rejected; a bundle cannot write outside ~/.arjun-ai
  const b = require('./backup.cjs');
  const bad = Buffer.from(raw); bad[bad.length - 5] ^= 1;
  assert.throws(() => b.unlock(bad, 'Toonistaan@2026'), /galat|kharab/);
  process.env.HOME = newPhone; delete process.env.ARJUN_AI_HOME;
  b.applyBundle({ files: { 'ai/../../evil.txt': Buffer.from('x').toString('base64') } });
  assert.ok(!fs.existsSync(path.join(path.dirname(newPhone), 'evil.txt')) && !fs.existsSync(path.join(newPhone, 'evil.txt')));
  api.close();
  console.log('BACKUP TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

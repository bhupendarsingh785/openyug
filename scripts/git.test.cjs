// GitHub flow with a local "remote" + fake GitHub API: branch, commit only changed files, push, PR.
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { execFileSync } = require('node:child_process');
const g = (cwd, ...a) => execFileSync('git', a, { cwd }).toString().trim();
(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch {
    console.log('GIT TESTS SKIPPED (phone mein git nahi hai — chahiye to: pkg install -y git)');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitt-'));
  const remote = path.join(tmp, 'remote.git'); execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const root = path.join(tmp, 'app'); fs.mkdirSync(root);
  g(root, 'init', '-q', '-b', 'main'); g(root, 'config', 'user.email', 't@t'); g(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'math.js'), 'module.exports.add=(a,b)=>a-b\n'); fs.writeFileSync(path.join(root, 'notes.txt'), 'mine\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.self-upgrade-*\n');
  g(root, 'add', '.'); g(root, 'commit', '-qm', 'init'); g(root, 'remote', 'add', 'origin', remote); g(root, 'push', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'my unsaved work\n'); // owner's own uncommitted change must NOT be committed
  const E = require('./self-development-engine.cjs');
  const eng = new E({ root }); await eng.initialize();
  await eng.connectAI({ name: 'mock', generate: async () => JSON.stringify({ summary: 'add theek', changes: [{ path: 'math.js', content: 'module.exports.add=(a,b)=>a+b\n' }] }) });
  const r = await eng.upgrade('add function theek karo', async () => true);
  assert.equal(r.success, true);
  assert.match(r.git.branch, /^arjun\/\d{12}-add-function-theek-karo$/);
  assert.equal(r.git.pushed, true);
  assert.equal(g(root, 'show', '--name-only', '--format=', 'HEAD'), 'math.js');           // only engine's file
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'my unsaved work\n'); // owner's work untouched
  assert.equal(g(remote, 'rev-parse', '--verify', '--quiet', 'main') !== '', true);
  assert.ok(g(remote, 'branch', '--list', 'arjun/*').includes('arjun/'));               // branch on remote
  assert.equal(g(remote, 'show', 'main:math.js'), 'module.exports.add=(a,b)=>a-b');      // main untouched
  // PR via fake GitHub API
  let got;
  const api = await new Promise((res) => { const s = http.createServer((q, w) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { got = { url: q.url, auth: q.headers.authorization, body: JSON.parse(b) }; w.writeHead(201); w.end(JSON.stringify({ html_url: 'https://github.com/arjun/demo/pull/7' })); }); }).listen(0, '127.0.0.1', () => res(s)); });
  const { openPullRequest, parseGitHub } = require('./git.cjs');
  assert.deepEqual(parseGitHub('https://github.com/arjun/demo.git'), { owner: 'arjun', repo: 'demo' });
  assert.deepEqual(parseGitHub('git@github.com:arjun/demo.git'), { owner: 'arjun', repo: 'demo' });
  const url = await openPullRequest({ owner: 'arjun', repo: 'demo', head: 'arjun/x', base: 'main', title: 't', body: 'b', token: 'tok', apiUrl: `http://127.0.0.1:${api.address().port}` });
  assert.equal(url, 'https://github.com/arjun/demo/pull/7'); assert.equal(got.url, '/repos/arjun/demo/pulls'); assert.equal(got.auth, 'Bearer tok'); assert.equal(got.body.base, 'main');
  api.close();
  // not a repo -> skipped quietly
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-')); fs.writeFileSync(path.join(plain, 'a.js'), '1;\n');
  const e2 = new E({ root: plain }); await e2.initialize(); await e2.connectAI({ generate: async () => JSON.stringify({ summary: 's', changes: [{ path: 'a.js', content: '2;\n' }] }) });
  assert.equal((await e2.upgrade('x', async () => true)).git.git, 'skipped');
  console.log('GIT TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

const assert = require('node:assert/strict');
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const E = require(process.argv[2] || require("node:path").join(__dirname, "self-development-engine.cjs"));
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eng-'));
  await fs.writeFile(path.join(root, 'math.js'), 'module.exports.add = (a, b) => a - b;\n');
  await fs.writeFile(path.join(root, 'test.js'), "const {add}=require('./math');if(add(2,3)!==5){console.error('add broken');process.exit(1)}console.log('ok')\n");
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }));
  await fs.writeFile(path.join(root, '.env'), 'SECRET=1');
  const answers = [
    // attempt 1: wrong fix + a new file -> tests fail -> rollback must remove new file
    JSON.stringify({ summary: 'try1', changes: [{ path: 'math.js', content: 'module.exports.add = (a, b) => a * b;\n' }, { path: 'extra.js', content: '1;\n' }] }),
    // attempt 2: correct, wrapped in markdown fence
    '```json\n' + JSON.stringify({ summary: 'add theek kiya', changes: [{ path: 'math.js', content: 'module.exports.add = (a, b) => a + b;\n' }] }) + '\n```',
  ];
  let calls = 0; const prompts = [];
  const eng = new E({ root });
  await eng.initialize();
  await eng.connectAI({ name: 'mock', generate: async ({ prompt }) => { prompts.push(prompt); return answers[calls++]; } });
  const r = await eng.upgrade('fix add', async (v, diff) => { assert.match(diff, /a \+ b|a \* b/); return true; });
  assert.equal(r.success, true); assert.equal(r.attempt, 2);
  assert.match(prompts[1], /add broken/);  // test error fed back
  assert.equal(await fs.readFile(path.join(root, 'math.js'), 'utf8'), 'module.exports.add = (a, b) => a + b;\n');
  await assert.rejects(fs.access(path.join(root, 'extra.js')));  // created file removed on rollback
  // safety
  await assert.rejects(eng.validateChanges([{ path: '../x.js', content: '' }]), /outside|Invalid/);
  await assert.rejects(eng.validateChanges([{ path: '.env', content: '' }]), /File type|Protected/);
  await assert.rejects(eng.validateChanges([{ path: '/etc/x.js', content: '' }]), /Invalid project path/);
  await assert.rejects(eng.validateChanges([{ path: 'bad.js', content: 'function (' }]), /syntax/);
  await assert.rejects(eng.validateChanges([{ path: '.self-upgrade-backups/a.js', content: '1' }]), /protected/i);
  assert.ok(!(await eng.readProject()).some(f => f.path === '.env'));
  // rejected approval writes nothing
  const before = await fs.readFile(path.join(root, 'math.js'), 'utf8');
  const rej = await eng.applyChanges([{ path: 'math.js', content: '//x\n' }], async () => false);
  assert.equal(rej.success, false); assert.equal(await fs.readFile(path.join(root, 'math.js'), 'utf8'), before);
  // manual restore
  const ok = await eng.applyChanges([{ path: 'math.js', content: '//y\n' }], async () => true);
  await eng.restoreBackup(ok.backupId); assert.equal(await fs.readFile(path.join(root, 'math.js'), 'utf8'), before);
  // config errors stop at once (no 3x retry)
  let n = 0;
  const bad = new E({ root });
  await bad.connectAI({ name: 'mock', generate: async () => { n++; const e = new Error('HTTP 404 model gone'); e.fatal = true; throw e; } });
  await assert.rejects(bad.upgrade('x', async () => true), /model gone/);
  assert.equal(n, 1);
  console.log('status', JSON.stringify(await eng.getStatus()));
  console.log('ALL ENGINE TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
// lock: a live lock from another process blocks writes; a stale one is cleaned
(async () => {
  const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
  const E = require(require('node:path').join(__dirname, 'self-development-engine.cjs'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-')); await fs.writeFile(path.join(root, 'a.js'), '1;\n');
  const eng = new E({ root }); await eng.initialize();
  await fs.writeFile(path.join(root, '.self-upgrade-backups', '.lock'), JSON.stringify({ pid: process.ppid, at: Date.now() }));
  await assert.rejects(eng.applyChanges([{ path: 'a.js', content: '2;\n' }], async () => true), /doosra upgrade/);
  await fs.writeFile(path.join(root, '.self-upgrade-backups', '.lock'), JSON.stringify({ pid: 999999, at: Date.now() }));
  const r = await eng.applyChanges([{ path: 'a.js', content: '2;\n' }], async () => true);
  assert.equal(r.success, true);
  await assert.rejects(fs.access(path.join(root, '.self-upgrade-backups', '.lock')));
  console.log('LOCK TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

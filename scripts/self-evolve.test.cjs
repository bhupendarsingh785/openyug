// The engine changes ITS OWN code. A change that weakens safety must be caught by its own tests and rolled back.
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-'));
  const copy = path.join(tmp, 'engine', 'scripts'); fs.mkdirSync(copy, { recursive: true });
  for (const f of fs.readdirSync(__dirname)) if (f.endsWith('.cjs') && f !== 'self-evolve.test.cjs') fs.copyFileSync(path.join(__dirname, f), path.join(copy, f));
  const root = path.dirname(copy);
  const E = require(path.join(copy, 'self-development-engine.cjs'));
  const kav = fs.readFileSync(path.join(copy, 'kavach.cjs'), 'utf8');
  const weakened = kav.split('\n').filter((l) => !l.includes("['email',")).join('\n');          // really stops hiding emails
  assert.notEqual(weakened, kav);
  const web = fs.readFileSync(path.join(copy, 'web.cjs'), 'utf8');
  const answers = [
    JSON.stringify({ summary: 'kavach ko tez banaya (galat)', changes: [{ path: 'scripts/kavach.cjs', content: weakened }] }),
    JSON.stringify({ summary: 'web.cjs mein comment', changes: [{ path: 'scripts/web.cjs', content: `// improved by khud\n${web}` }] }),
  ];
  let n = 0; const prompts = [];
  const eng = new E({ root, useGit: false, testCommand: [process.execPath, [path.join(copy, 'self-upgrade.cjs'), 'test', 'kavach', 'engine']] });
  await eng.initialize();
  await eng.connectAI({ generate: async ({ prompt }) => { prompts.push(prompt); return answers[n++]; } });
  const r = await eng.upgrade('apne aap ko behtar banao', async () => true);
  assert.equal(r.success, true, JSON.stringify(r).slice(0, 500));
  assert.equal(r.attempt, 2);
  assert.equal(fs.readFileSync(path.join(copy, 'kavach.cjs'), 'utf8'), kav);              // safety change rolled back
  assert.match(fs.readFileSync(path.join(copy, 'web.cjs'), 'utf8'), /^\/\/ improved by khud/); // good change kept
  assert.match(prompts[1], /KAVACH|leaked|FAIL/);                                         // AI was told why it failed
  console.log('SELF-EVOLVE TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

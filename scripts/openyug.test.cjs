// ☁️ OpenYug 2 (agent/*.py) + phone side (cloud.cjs): any order via AI, sub-agents, AI-planned jobs
// without raw shell, self-upgrade only via PR (never main), budgets, pause, cloud approvals, phone order push.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { execFileSync } = require('node:child_process');
const has = (bin) => { try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
(async () => {
  // cloud approvals (no python needed)
  const { approvals } = require('./cloud.cjs');
  const said = []; const ap = approvals(['kavach.cjs'], (m) => said.push(m));
  assert.equal(await ap.code([{ path: 'scripts/web.cjs' }], 'diff'), true);
  assert.equal(await ap.code([{ path: 'scripts/kavach.cjs' }], 'diff'), false);           // safety file → refused
  assert.equal(await ap.code([{ path: '.github/workflows/x.yml' }], 'diff'), false);     // CI → refused
  assert.equal(await ap.connect({}), false); assert.equal(await ap.newTool('x', []), false);
  assert.equal(await ap.tool({ name: 'a', trusted: false }), false); assert.equal(await ap.tool({ name: 'b', trusted: true }), true);
  assert.match(said.join('\n'), /Pull Request/);

  if (!has('python3') || !has('git')) { console.log('OPENYUG TESTS SKIPPED (python3/git nahi — GitHub par chalega; phone par: pkg install python git)'); return; }
  const SRC = path.resolve(__dirname, '..', 'agent');
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.py'))) execFileSync('python3', ['-m', 'py_compile', path.join(SRC, f)]);
  // a throw-away repo that looks like ~/engine, with a FAKE engine (records calls, never touches the network)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oy-'));
  fs.cpSync(SRC, path.join(root, 'agent'), { recursive: true, filter: (s) => !/__pycache__|[\\/]reports[\\/].+\.md$/.test(s) });
  fs.writeFileSync(path.join(root, 'agent', 'config.json'), JSON.stringify({ owner: 'Swag', sites: [], mirrors: [], limits: { heavy_per_run: 1, ask_per_run: 6, max_agents: 2 } }));
  fs.mkdirSync(path.join(root, 'scripts'));
  const LOG = path.join(root, '..', `${path.basename(root)}-calls.log`);
  fs.writeFileSync(path.join(root, 'scripts', 'self-upgrade.cjs'), `
const [cmd, ...rest] = process.argv.slice(2); const fs = require('fs');
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify([cmd, ...rest, process.env.ARJUN_CLOUD]) + '\\n');
const q = rest.slice(1).join(' ');
if (cmd === 'ask') {
  if (/JSON array/.test(q)) console.log('[{"kind":"known","text":"tests"},{"kind":"shell","text":"touch HACKED"},{"kind":"known","text":"rm -rf"},{"kind":"ask","text":"plan likho"}]');
  else if (/- \\[ \\] /.test(q)) console.log('- [ ] seekho: shorts trends\\n- [ ] sujhav: thumbnails\\n- [ ] likho: plan\\n- [ ] extra wala');
  else { console.error('🤖 jawab: fake/m1'); console.log('AI JAWAB OK'); }
} else if (['khud', 'banao', 'kaam'].includes(cmd)) {
  fs.writeFileSync('engine-touched.txt', 'x');                       // a stray change that must NOT stay on main
  console.log('🧠 1. sudhaar → change_code'); console.log('   ↳ Ho gaya. Git branch arjun/x, PR https://github.com/arjun/Antropic-project/pull/7.');
} else if (cmd === 'test') console.log('Sab tests pass 💪');
`);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-qm', 'init');
  const env = { ...process.env, OPENYUG_OFFLINE: '0', ARJUN_CLOUD: '1' };
  const py = () => execFileSync('python3', [path.join(root, 'agent', 'run.py')], { cwd: root, env }).toString();
  const orders = path.join(root, 'agent', 'orders.md');
  // first run: live files come from seed/
  py();
  assert.ok(fs.existsSync(orders) && fs.existsSync(path.join(root, 'agent', 'state.json')) && fs.existsSync(path.join(root, 'agent', 'knowledge.md')));
  fs.appendFileSync(orders, ['', '- [ ] sudhaar: report mein emoji kam karo', '- [ ] banao: ek chhota timer app', '- [ ] agent banao: youtube - Toonistaan ke video ideas',
    '- [ ] agent banao: a - x', '- [ ] agent banao: b - y', '- [ ] Har baar: purani report saaf karo', '- [ ] duniya ka sabse tez free AI kaun sa hai?', '- [ ] bada kaam: channel ka pura setup', ''].join('\n'));
  fs.mkdirSync(path.join(root, 'agent', 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent', 'jobs', 'old.json'), JSON.stringify({ id: 'old', goal: 'purana', steps: [{ name: 'evil', cmd: 'touch HACKED2', done: false }] }));
  const out1 = py();
  const o1 = fs.readFileSync(orders, 'utf8');
  assert.match(o1, /- \[x\] sudhaar: report mein emoji kam karo/);              // heavy #1 done
  assert.match(out1, /pull\/7/); assert.match(out1, /Merge karo/);
  assert.match(o1, /- \[ \] banao: ek chhota timer app/);                       // budget: waits for next run
  assert.match(out1, /AI-budget khatam/);
  assert.ok(!fs.existsSync(path.join(root, 'engine-touched.txt')), 'engine change leaked onto main');
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.match(o1, /- \[ \] Har baar: purani report saaf karo/);               // recurring stays open
  assert.match(o1, /- \[x\] duniya ka sabse tez/); assert.match(out1, /AI JAWAB OK/);
  const yt = fs.readFileSync(path.join(root, 'agent', 'agents', 'youtube.md'), 'utf8');
  assert.match(yt, /kaam: Toonistaan ke video ideas/); assert.equal((yt.match(/- \[ \]/g) || []).length, 3);
  assert.match(out1, /seema/);                                                   // max_agents = 2
  const job = JSON.parse(fs.readFileSync(path.join(root, 'agent', 'jobs', fs.readdirSync(path.join(root, 'agent', 'jobs')).find((f) => f !== 'old.json' && f.endsWith('.json'))), 'utf8'));
  assert.deepEqual(job.steps.map((s) => s.kind), ['known', 'ask']);              // shell + bad known dropped
  assert.ok(!fs.existsSync(path.join(root, 'HACKED')) && !fs.existsSync(path.join(root, 'HACKED2')), 'raw command ran');
  const st = JSON.parse(fs.readFileSync(path.join(root, 'agent', 'state.json'), 'utf8'));
  assert.equal(st.upgrades.at(-1).pr, 'https://github.com/arjun/Antropic-project/pull/7'); assert.match(st.version, /^2\.\d+$/);
  const calls = fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.every((c) => c.at(-1) === '1'), 'engine must run in cloud mode');
  assert.ok(calls.some((c) => c[0] === 'khud' && /emoji/.test(c[1])));
  // second run: next heavy order, agent's own order, next job step
  const out2 = py();
  assert.match(fs.readFileSync(orders, 'utf8'), /- \[x\] banao: ek chhota timer app/);
  assert.match(out2, /🤖 Agent youtube/);
  assert.equal((fs.readFileSync(path.join(root, 'agent', 'agents', 'youtube.md'), 'utf8').match(/- \[x\]/g) || []).length, 2); // one per run (new agent already worked in run 1)
  assert.ok(fs.readdirSync(path.join(root, 'agent', 'reports')).filter((f) => f.endsWith('.md')).length >= 1); // same-second runs share a name
  // pause
  fs.appendFileSync(orders, '- [ ] pause\n'); assert.match(py(), /paused/);
  // offline: no AI, still writes a report and never crashes
  fs.writeFileSync(orders, '- [ ] kuch bhi sawaal\n');
  const st2 = JSON.parse(fs.readFileSync(path.join(root, 'agent', 'state.json'), 'utf8')); st2.paused = false; fs.writeFileSync(path.join(root, 'agent', 'state.json'), JSON.stringify(st2));
  const off = execFileSync('python3', [path.join(root, 'agent', 'run.py')], { cwd: root, env: { ...env, OPENYUG_OFFLINE: '1' } }).toString();
  assert.match(off, /offline/); assert.match(fs.readFileSync(orders, 'utf8'), /- \[ \] kuch bhi sawaal/);

  // phone side: ai cloud order → pushed to GitHub (a local bare repo here); ai cloud → summary
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'oy-bare-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  g('remote', 'add', 'origin', bare); g('add', '-A'); g('commit', '-qm', 'run', '--allow-empty'); g('push', '-q', 'origin', 'main');
  process.env.ARJUN_CLOUD_ROOT = root; process.env.GITHUB_TOKEN = 'github_pat_fake';
  process.env.ARJUN_KEYS_FILE = path.join(bare, 'nokeys');
  const cloud = require('./cloud.cjs');
  assert.match(await cloud.order('sudhaar: panel tez karo'), /bhej diya/);
  const remoteOrders = execFileSync('git', ['--git-dir', bare, 'show', 'main:agent/orders.md']).toString();
  assert.match(remoteOrders, /- \[ \] sudhaar: panel tez karo/);
  await assert.rejects(cloud.order('  '), /Aadesh likho/);
  fs.writeFileSync(path.join(root, 'phone-note.txt'), 'naya');
  assert.match(await cloud.sync(), /bhej diye/);
  assert.equal(execFileSync('git', ['--git-dir', bare, 'show', 'main:phone-note.txt']).toString(), 'naya');
  const sum = await cloud.status();
  assert.match(sum, /Bache aadesh: 2/); assert.match(sum, /youtube/); assert.match(sum, /Aakhri report/);
  console.log('OPENYUG CLOUD AGENT TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

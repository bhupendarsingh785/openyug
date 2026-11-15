// Dimaag script: edit, history, restore, AI improve, brain reads it; panel API with token.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
(async () => {
  process.env.ARJUN_AI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dim-'));
  process.env.ARJUN_KEYS_FILE = path.join(process.env.ARJUN_AI_HOME, 'keys');
  const d = require('./dimaag.cjs');
  assert.match(d.read(), /Dimaag ki script/);                         // default before any edit
  d.write(`${d.DEFAULT}\n- Hamesha pehle story check karo.\n`, 'test');
  assert.match(d.read(), /pehle story check/); assert.equal(d.history().length, 1);
  d.write('# Naya dimaag\n- sirf test\n'); assert.equal(d.history().length, 2);
  d.restore(d.history()[0]); assert.match(d.read(), /pehle story check/); // restore newest old version
  assert.throws(() => d.write('   '), /Khaali/); assert.throws(() => d.restore('../x.md'), /Galat/);
  // AI improve returns a proposal only (nothing saved)
  const before = d.read();
  const p = await d.improve({ generate: async ({ prompt }) => { assert.match(prompt, /OWNER'S INSTRUCTION: cartoon/); return '```markdown\n# Behtar dimaag\n- cartoon pehle\n```'; } }, 'cartoon pehle');
  assert.equal(p, '# Behtar dimaag\n- cartoon pehle'); assert.equal(d.read(), before);
  // brain uses the script
  d.write('# Dimaag\n- KHAAS-NIYAM-123\n');
  let sys = '';
  const { createBrain } = require('./brain.cjs');
  await createBrain({ ai: { generate: async ({ system }) => { if (!sys) sys = system; return '{"action":"finish","input":{"answer":"ok"}}'; } }, root: '.', engine: {}, tools: {}, web: {}, approve: {}, ask: async () => '' }).kaam('x');
  assert.match(sys, /KHAAS-NIYAM-123/); assert.match(sys, /owner approvals are never skipped/);
  // panel API
  const { createPanel } = require('./panel.cjs');
  const { server, token } = createPanel({ getAi: () => ({ generate: async () => '# AI ka dimaag\n' }), status: async () => ({ providers: ['pollinations'], tools: [], yaad: '' }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/?t=wrong`)).status, 403);
  assert.match(await (await fetch(`${base}/?t=${token}`)).text(), /DIMAAG/);
  assert.equal((await fetch(`${base}/api/dimaag`)).status, 403);
  const H = { 'content-type': 'application/json', 'x-panel-token': token };
  assert.match((await (await fetch(`${base}/api/dimaag`, { headers: H })).json()).text, /KHAAS-NIYAM-123/);
  const prop = (await (await fetch(`${base}/api/dimaag/improve`, { method: 'POST', headers: H, body: JSON.stringify({ instruction: 'x' }) })).json()).proposal;
  assert.equal(prop, '# AI ka dimaag');
  assert.equal((await (await fetch(`${base}/api/dimaag`, { method: 'POST', headers: H, body: JSON.stringify({ text: prop }) })).json()).changed, true);
  assert.equal(d.read(), '# AI ka dimaag\n');
  await fetch(`${base}/api/dimaag/reset`, { method: 'POST', headers: H }); assert.equal(d.read(), d.DEFAULT);
  // keys box: many keys at once, auto-detect, ambiguous -> choose, never returns full keys
  const G = 'AIza' + 'Q'.repeat(35), O = 'sk-or-v1-' + 'ab'.repeat(32), D = 'sk-' + 'd'.repeat(32);
  const added = await (await fetch(`${base}/api/keys`, { method: 'POST', headers: H, body: JSON.stringify({ text: `${G}${O}\n${D}` }) })).json();
  assert.deepEqual(added.saved.sort(), ['GEMINI_API_KEY', 'OPENROUTER_API_KEY']); assert.equal(added.ambiguous.length, 1);
  assert.ok(!JSON.stringify(added).includes(D));
  assert.equal((await fetch(`${base}/api/keys/assign`, { method: 'POST', headers: H, body: JSON.stringify({ id: added.ambiguous[0].id, name: 'EVIL_VAR' }) })).status, 400);
  await fetch(`${base}/api/keys/assign`, { method: 'POST', headers: H, body: JSON.stringify({ id: added.ambiguous[0].id, name: 'DEEPSEEK_API_KEY' }) });
  const list = await (await fetch(`${base}/api/keys`, { headers: H })).text();
  assert.ok(!list.includes(G) && !list.includes(O) && !list.includes(D), 'full key leaked to browser');
  assert.match(list, /"name":"deepseek","region":"China","free":false,"connected":true/);
  assert.equal(require('./keys.cjs').readFileKeys().DEEPSEEK_API_KEY, D);
  await fetch(`${base}/api/keys/remove`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'DEEPSEEK_API_KEY' }) });
  assert.equal(require('./keys.cjs').readFileKeys().DEEPSEEK_API_KEY, undefined);
  assert.equal((await fetch(`${base}/api/keys`, { headers: { 'x-panel-token': 'nope' } })).status, 403);
  // real test button: a fake provider answers OK, a broken one gives a clear hint
  const http = require('node:http');
  const up = await new Promise((r) => { const sv = http.createServer((q, w) => { w.writeHead(q.url.includes('bad') ? 503 : 200); w.end(JSON.stringify({ model: 'm1', choices: [{ message: { content: 'OK' } }] })); }).listen(0, '127.0.0.1', () => r(sv)); });
  const pj = path.join(process.env.ARJUN_AI_HOME, 'prov.json');
  fs.writeFileSync(pj, JSON.stringify([{ name: 'good', url: `http://127.0.0.1:${up.address().port}/v1/chat/completions`, keyEnv: 'GOOD_KEY', model: 'm' }, { name: 'bad', url: `http://127.0.0.1:${up.address().port}/bad`, keyEnv: 'GOOD_KEY', model: 'm' }]));
  process.env.ARJUN_AI_PROVIDERS = pj; process.env.GOOD_KEY = 'x';
  const t1 = await (await fetch(`${base}/api/test`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'good' }) })).json();
  assert.equal(t1.ok, true); assert.equal(t1.reply, 'OK');
  const t2 = await (await fetch(`${base}/api/test`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'bad' }) })).json();
  assert.equal(t2.ok, false); assert.match(t2.error, /busy/);
  const t3 = await (await fetch(`${base}/api/test`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'groq' }) })).json();
  assert.match(t3.error, /Key nahi hai/);
  up.close(); delete process.env.ARJUN_AI_PROVIDERS; delete process.env.GOOD_KEY;
  // page shows a clear message when the server is down
  assert.match(await (await fetch(`${base}/?t=${token}`)).text(), /Panel ka server band hai/);
  server.close();
  // background mode: starts, prints a link, second call reuses it, 'band' stops it
  const { execFileSync } = require('node:child_process');
  const cli = path.join(__dirname, 'self-upgrade.cjs');
  const envBg = { ...process.env, ARJUN_PANEL_PORT: String(40000 + Math.floor(Math.random() * 20000)) };
  const o1 = execFileSync(process.execPath, [cli, 'panel'], { env: envBg }).toString();
  const link = o1.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+/)[0];
  assert.equal((await fetch(link)).status, 200);
  assert.match(execFileSync(process.execPath, [cli, 'panel'], { env: envBg }).toString(), /pehle se chal raha/);
  assert.match(execFileSync(process.execPath, [cli, 'panel', 'band'], { env: envBg }).toString(), /Panel band/);
  await new Promise((r) => setTimeout(r, 300));
  await assert.rejects(fetch(link));
  // no-key web AI is always in the auto chain (unless switched off), keyed free ones first
  const { buildChain } = require('./providers.cjs');
  const c1 = buildChain({ PATH: process.env.PATH, ARJUN_KEYS_FILE: '/nonexistent' }).chain.map((p) => p.name);
  assert.deepEqual(c1, ['pollinations']);
  const c2 = buildChain({ GEMINI_API_KEY: 'x', ARJUN_KEYS_FILE: '/nonexistent' }).chain.map((p) => p.name);
  assert.deepEqual(c2, ['gemini', 'pollinations']);
  assert.throws(() => buildChain({ ARJUN_NO_WEB_AI: '1', ARJUN_KEYS_FILE: '/nonexistent' }), /Koi AI key/);
  console.log('DIMAAG + PANEL TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

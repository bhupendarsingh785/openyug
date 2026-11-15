// 💬 Boss inbox: knows system state + activity, keeps chat history, never leaks key values, panel API with token.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
(async () => {
  process.env.ARJUN_AI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-'));
  process.env.ARJUN_KEYS_FILE = path.join(process.env.ARJUN_AI_HOME, 'keys');
  const SECRET = 'sk-or-v1-' + 'z'.repeat(64);
  require('./keys.cjs').writeFileKeys({ OPENROUTER_API_KEY: SECRET });
  // a daily quota rests the provider for hours, a normal 429 only for minutes
  const p = require('./providers.cjs');
  fs.writeFileSync(path.join(process.env.ARJUN_AI_HOME, 'health.json'), JSON.stringify({ openrouter: { until: Date.now() + 60 * 60 * 1000, reason: 'aaj ki free limit khatam' } }));
  const boss = require('./boss.cjs');
  boss.activity('▶️ Kaam shuru: panel mein button\n🧠 1. files dekh raha → list_files');
  assert.equal(boss.readActivity().length, 2);
  let seen;
  const ai = { name: 'fake', lastUsed: 'fake/m1', generate: async ({ system, prompt }) => { seen = { system, prompt }; return 'Boss: Sab theek, OpenRouter abhi aaram par hai.'; } };
  const r = await boss.reply(ai, 'kya chal raha hai?');
  assert.equal(r.reply, 'Sab theek, OpenRouter abhi aaram par hai.'); assert.equal(r.by, 'fake/m1');
  assert.match(seen.system, /openrouter.*aaram \(aaj ki free limit khatam/);   // knows provider health
  assert.match(seen.system, /OPENROUTER_API_KEY/);                              // key NAMES only
  assert.ok(!seen.system.includes(SECRET) && !seen.prompt.includes(SECRET), 'key value leaked to AI');
  assert.match(seen.system, /list_files/);                                       // knows recent activity
  assert.match(seen.system, /ai khud/);                                          // knows real commands
  assert.match(seen.prompt, /Arjun: kya chal raha hai\?/);
  await boss.reply(ai, 'aur?');
  assert.match(seen.prompt, /Pichhli baat:[\s\S]*kya chal raha hai/);            // remembers the conversation
  assert.equal(boss.history().length, 4);
  await assert.rejects(boss.reply(ai, '   '), /Kuch likho/);
  await assert.rejects(boss.reply({ generate: async () => '  ' }, 'hi'), /khaali/);
  assert.equal(boss.history().length, 4);                                        // failed turns are not saved
  boss.clear(); assert.equal(boss.history().length, 0);
  // panel API
  const { createPanel } = require('./panel.cjs');
  const { server, token } = createPanel({ getAi: () => ai, status: async () => ({ providers: [], tools: [], yaad: '' }) });
  await new Promise((res) => server.listen(0, '127.0.0.1', res)); const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(`${base}/?t=${token}`)).text(), /Boss se baat karo/);
  assert.equal((await fetch(`${base}/api/boss`, { method: 'POST', body: '{"message":"hi"}' })).status, 403);   // token required
  const H = { 'content-type': 'application/json', 'x-panel-token': token };
  const j = await (await fetch(`${base}/api/boss`, { method: 'POST', headers: H, body: JSON.stringify({ message: 'namaste' }) })).json();
  assert.match(j.reply, /Sab theek/);
  assert.equal((await (await fetch(`${base}/api/boss`, { headers: H })).json()).messages.length, 2);
  await fetch(`${base}/api/boss/clear`, { method: 'POST', headers: H });
  assert.equal((await (await fetch(`${base}/api/boss`, { headers: H })).json()).messages.length, 0);
  server.close();
  // daily quota (Gemini style) → rests ~3 hours; plain 429 → 15 min
  const http = require('node:http');
  const up = await new Promise((res) => { const sv = http.createServer((q, w) => { w.writeHead(429); w.end(q.url.includes('daily') ? '{"error":{"message":"You exceeded your current quota"}}' : '{"error":"slow down"}'); }).listen(0, '127.0.0.1', () => res(sv)); });
  const pj = path.join(process.env.ARJUN_AI_HOME, 'prov.json');
  fs.writeFileSync(pj, JSON.stringify([{ name: 'daily', url: `http://127.0.0.1:${up.address().port}/daily`, keyEnv: 'X_KEY', model: 'm' }, { name: 'short', url: `http://127.0.0.1:${up.address().port}/s`, keyEnv: 'X_KEY', model: 'm' }]));
  const env = { ...process.env, ARJUN_AI_PROVIDERS: pj, X_KEY: 'x', SELF_DEV_PROVIDER: 'daily,short', SELF_DEV_VERBOSE: '0', SELF_DEV_RETRIES: '0' };
  await assert.rejects(p.createProvider(env).generate({ system: 's', prompt: 'p' }));
  const h = p.readHealth(env);
  assert.ok(h.daily.until - Date.now() > 2 * 60 * 60 * 1000, 'daily quota should rest for hours'); assert.match(h.daily.reason, /aaj ki/);
  assert.ok(h.short.until - Date.now() < 20 * 60 * 1000, 'normal 429 should rest only minutes');
  up.close();
  console.log('BOSS INBOX TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });

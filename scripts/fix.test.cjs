// Self-repair: renamed model gets replaced automatically; busy/limit providers move to the back; bad key is explained.
const assert = require('node:assert/strict'); const http = require('node:http'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-'));
  process.env.ARJUN_AI_HOME = home; process.env.ARJUN_KEYS_FILE = path.join(home, 'keys');
  fs.writeFileSync(process.env.ARJUN_KEYS_FILE, 'export OLD_KEY=k\nexport BUSY_KEY=k\nexport BAD_KEY=k\nexport OK_KEY=k\n');
  const srv = await new Promise((r) => { const s = http.createServer((q, w) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    const u = q.url;
    if (u.startsWith('/old/models')) { w.writeHead(200); return w.end(JSON.stringify({ data: [{ id: 'text-embed-1' }, { id: 'super-flash-2' }, { id: 'tts-voice' }] })); }
    const model = b ? JSON.parse(b).model : '';
    if (u.startsWith('/old/')) { if (model === 'super-flash-2') { w.writeHead(200); return w.end(JSON.stringify({ model, choices: [{ message: { content: 'OK' } }] })); } w.writeHead(404); return w.end('{"error":{"message":"model gone-1 not found"}}'); }
    if (u.startsWith('/hot/models')) { w.writeHead(200); return w.end(JSON.stringify({ data: [{ id: 'hot-flash' }, { id: 'cool-flash-lite' }] })); }
    if (u.startsWith('/hot/')) { if (model === 'cool-flash-lite') { w.writeHead(200); return w.end(JSON.stringify({ model, choices: [{ message: { content: 'OK' } }] })); } w.writeHead(503); return w.end('{"error":{"message":"This model is currently experiencing high demand"}}'); }
    if (u.startsWith('/busy/')) { w.writeHead(429); return w.end('{"error":"quota"}'); }
    if (u.startsWith('/bad/')) { w.writeHead(401); return w.end('{"error":{"message":"invalid api key"}}'); }
    w.writeHead(200); w.end(JSON.stringify({ model: 'ok-m', choices: [{ message: { content: 'OK' } }] }));
  }); }).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const pj = path.join(home, 'p.json');
  fs.writeFileSync(pj, JSON.stringify([
    { name: 'old', url: `${base}/old/chat/completions`, keyEnv: 'OLD_KEY', model: 'gone-1', free: true },
    { name: 'busy', url: `${base}/busy/chat/completions`, keyEnv: 'BUSY_KEY', model: 'm', free: true },
    { name: 'bad', url: `${base}/bad/chat/completions`, keyEnv: 'BAD_KEY', model: 'm', free: true },
    { name: 'hot', url: `${base}/hot/chat/completions`, keyEnv: 'OK_KEY', model: 'hot-flash', free: true },
    { name: 'okk', url: `${base}/ok/chat/completions`, keyEnv: 'OK_KEY', model: 'm', free: true },
  ]));
  process.env.ARJUN_AI_PROVIDERS = pj; process.env.ARJUN_NO_WEB_AI = '1';
  const P = require('./providers.cjs');
  const r1 = await P.testProvider('old');
  assert.equal(r1.ok, true); assert.equal(r1.fixed, true); assert.match(r1.action, /super-flash-2/);
  assert.match(fs.readFileSync(process.env.ARJUN_KEYS_FILE, 'utf8'), /export OLD_MODEL=super-flash-2/);   // saved for next time
  assert.equal((await P.testProvider('old')).fixed, undefined);                                         // now works directly
  const rh = await P.testProvider('hot');
  assert.equal(rh.ok, true); assert.equal(rh.fixed, true); assert.match(rh.action, /busy tha.*cool-flash-lite/);
  const r2 = await P.testProvider('busy'); assert.equal(r2.ok, false); assert.match(r2.error, /limit/);
  const r3 = await P.testProvider('bad'); assert.equal(r3.ok, false); assert.match(r3.error, /nayi key/);
  // health: busy + bad are moved behind healthy ones in auto mode
  const order = P.buildChain({ ...process.env, SELF_DEV_PROVIDER: 'auto' }).chain.map((p) => p.name);
  assert.ok(order.indexOf('okk') < order.indexOf('busy') && order.indexOf('old') < order.indexOf('bad'), order.join());
  // failover during real use also records health and still answers
  const ai = P.createProvider({ ...process.env, SELF_DEV_PROVIDER: 'busy,okk', SELF_DEV_VERBOSE: '0', SELF_DEV_RETRY_MS: '1' });
  assert.equal(await ai.generate({ system: 's', prompt: 'p' }), 'OK');
  assert.ok(P.readHealth({}).busy.until > Date.now());
  // during NORMAL use (not fix): a busy model of ANY provider switches to its other model in the same call
  const hits = [];
  const srv2 = await new Promise((r) => { const sv = require('node:http').createServer((q, w) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    if (q.url.endsWith('/models')) { w.writeHead(200); return w.end(JSON.stringify({ data: [{ id: 'big-model' }, { id: 'small-chat' }] })); }
    const m = JSON.parse(b).model; hits.push(m);
    if (m === 'big-model') { w.writeHead(503); return w.end('{"error":"The model is overloaded"}'); }
    w.writeHead(200); w.end(JSON.stringify({ model: m, choices: [{ message: { content: 'from ' + m } }] }));
  }); }).listen(0, '127.0.0.1', () => r(sv)); });
  const pj2 = path.join(home, 'p2.json');
  fs.writeFileSync(pj2, JSON.stringify([{ name: 'groqish', url: `http://127.0.0.1:${srv2.address().port}/v1/chat/completions`, keyEnv: 'OK_KEY', model: 'big-model', free: true }]));
  const ai2 = P.createProvider({ ...process.env, ARJUN_AI_PROVIDERS: pj2, SELF_DEV_PROVIDER: 'groqish', SELF_DEV_VERBOSE: '0', SELF_DEV_RETRIES: '0' });
  assert.equal(await ai2.generate({ system: 's', prompt: 'p' }), 'from small-chat');
  assert.deepEqual(hits, ['big-model', 'small-chat']);
  // gateway uses the same smart path
  const { createGateway } = require('./gateway.cjs');
  const G = createGateway({ ...process.env, ARJUN_AI_PROVIDERS: pj2, SELF_DEV_PROVIDER: 'groqish', SELF_DEV_RETRIES: '0' }).listen(0, '127.0.0.1'); await new Promise((r) => G.once('listening', r));
  const gj = await (await fetch(`http://127.0.0.1:${G.address().port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) })).json();
  assert.equal(gj.choices[0].message.content, 'from small-chat');
  G.close(); srv2.close();
  const all = await P.fixAll(); assert.equal(all.filter((x) => x.ok).length, 3);
  srv.close();
  // thinking models need room: the live test must not starve them of tokens
  assert.ok(/max_tokens: 512/.test(require('node:fs').readFileSync(require('node:path').join(__dirname, 'providers.cjs'), 'utf8')));
  console.log('SELF-REPAIR TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

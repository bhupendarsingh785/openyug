// Failover test with local fake AI servers (no internet, no keys).
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const assert = require('node:assert/strict');
const http = require('node:http'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
function server(handler) { return new Promise((r) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => r(s)); }); }
(async () => {
  const hits = { a: 0, b: 0, c: 0 };
  const A = await server((q, s) => { hits.a++; s.writeHead(429); s.end('{"error":"quota"}'); });                         // limit khatam
  const B = await server((q, s) => { hits.b++; s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ choices: [{ message: { content: 'I cannot help with that.' } }] })); }); // refusal / not JSON
  const C = await server((q, s) => {
    let body = ''; q.on('data', (d) => (body += d)); q.on('end', () => {
      if (q.url.endsWith('/models')) { s.writeHead(200); return s.end(JSON.stringify({ data: [{ id: 'x-embed' }, { id: 'super-coder-v9' }] })); }
      hits.c++; assert.equal(JSON.parse(body).model, 'super-coder-v9'); // auto-picked newest coder model
      s.writeHead(200); s.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'ok', changes: [{ path: 'math.js', content: 'module.exports.add=(a,b)=>a+b\n' }] }) } }] }));
    });
  });
  const u = (s) => `http://127.0.0.1:${s.address().port}`;
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prov-')), 'providers.json');
  fs.writeFileSync(cfg, JSON.stringify([
    { name: 'aaa', url: `${u(A)}/v1/chat/completions`, keyEnv: 'AAA_KEY', model: 'm', free: true },
    { name: 'bbb', url: `${u(B)}/v1/chat/completions`, keyEnv: 'BBB_KEY', model: 'm', free: true },
    { name: 'ccc', url: `${u(C)}/v1/chat/completions`, keyEnv: 'CCC_KEY', model: 'auto', modelsUrl: `${u(C)}/v1/models` },
  ]));
  const env = { ARJUN_AI_PROVIDERS: cfg, AAA_KEY: '1', BBB_KEY: '1', CCC_KEY: '1', SELF_DEV_PROVIDER: 'aaa,bbb,ccc', SELF_DEV_VERBOSE: '0' };
  const { createProvider, listProviders } = require('./providers.cjs');
  assert.ok(listProviders(env).find((p) => p.name === 'ccc' && p.connected));
  assert.ok(listProviders(env).some((p) => p.name === 'sarvam') && listProviders(env).some((p) => p.name === 'kimi') && listProviders(env).some((p) => p.name === 'github'));
  const E = require('./self-development-engine.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-'));
  fs.writeFileSync(path.join(root, 'math.js'), 'module.exports.add=(a,b)=>a-b\n');
  const eng = new E({ root }); await eng.initialize(); await eng.connectAI(createProvider(env));
  const r = await eng.upgrade('fix add', async () => true);
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(path.join(root, 'math.js'), 'utf8'), 'module.exports.add=(a,b)=>a+b\n');
  assert.ok(hits.a >= 1 && hits.b >= 1 && hits.c === 1, JSON.stringify(hits)); // quota -> refusal -> success
  // all fail -> clear combined message
  const bad = createProvider({ ...env, SELF_DEV_PROVIDER: 'aaa' });
  await assert.rejects(bad.generate({ system: '', prompt: 'x' }), /Koi bhi AI provider nahi chala[\s\S]*429/);
  [A, B, C].forEach((s) => s.close());
  console.log('FAILOVER TESTS PASSED', JSON.stringify(hits));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

const assert = require('node:assert/strict');
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const http = require('node:http'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createVault } = require('./kavach.cjs');
(async () => {
  const v = createVault();
  const secret = 'AIza' + 'Sy' + 'A'.repeat(33);
  const src = `const KEY="${secret}"; // mail arjun.test@gmail.com call 9876543210\nconst pw = "password=SuperSecret123";\nconst n = 42; const card="4111 1111 1111 1111";`;
  const hidden = v.hide(src);
  for (const bad of [secret, 'arjun.test@gmail.com', '9876543210', 'SuperSecret123', '4111 1111 1111 1111']) assert.ok(!hidden.includes(bad), `leaked: ${bad}\n${hidden}`);
  assert.ok(hidden.includes('const n = 42'));               // normal code untouched
  assert.equal(v.reveal(hidden), src);                       // exact restore
  // end-to-end: fake AI server must never receive the secret, and the file must keep it
  let received = '';
  const S = await new Promise((r) => { const s = http.createServer((q, res) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    received += b; const prompt = JSON.parse(b).messages[1].content; const tok = prompt.match(/\[\[KAVACH_\d+\]\]/)[0];
    res.writeHead(200); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'ok', changes: [{ path: 'app.js', content: `const KEY="${tok}";\nmodule.exports.add=(a,b)=>a+b;\n` }] }) } }] })); }); }).listen(0, '127.0.0.1', () => r(s)); });
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kv-')), 'p.json');
  fs.writeFileSync(cfg, JSON.stringify([{ name: 'cloudy', url: `http://127.0.0.1:${S.address().port}/v1/chat/completions`, keyEnv: 'K', model: 'm' }]));
  const env = { ARJUN_AI_PROVIDERS: cfg, K: '1', SELF_DEV_PROVIDER: 'cloudy', SELF_DEV_VERBOSE: '0', ARJUN_AI_HOME: path.dirname(cfg) };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kvp-'));
  fs.writeFileSync(path.join(root, 'app.js'), `const KEY="${secret}";\nmodule.exports.add=(a,b)=>a-b;\n`);
  const E = require('./self-development-engine.cjs'); const { createProvider } = require('./providers.cjs');
  const eng = new E({ root }); await eng.initialize(); await eng.connectAI(createProvider(env));
  const r = await eng.upgrade('fix add', async () => true);
  assert.equal(r.success, true);
  assert.ok(!received.includes(secret), 'secret reached the AI server!');
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), `const KEY="${secret}";\nmodule.exports.add=(a,b)=>a+b;\n`);
  const log = fs.readFileSync(path.join(path.dirname(cfg), 'sent-log.jsonl'), 'utf8');
  assert.ok(log.includes('"provider":"cloudy"') && !log.includes(secret));
  // private mode: outside servers refused
  assert.throws(() => createProvider({ ...env, SELF_DEV_PRIVATE: '1', SELF_DEV_PROVIDER: 'gemini', GEMINI_API_KEY: 'x' }), /Private mode/);
  const priv = createProvider({ ...env, SELF_DEV_PRIVATE: '1', SELF_DEV_PROVIDER: 'auto', GEMINI_API_KEY: 'x', OLLAMA_HOST: 'http://127.0.0.1:1' });
  assert.ok(!priv.chain.includes('gemini') && priv.chain.includes('ollama'), priv.chain.join()); // auto + private = only on-device
  S.close();
  console.log('KAVACH TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

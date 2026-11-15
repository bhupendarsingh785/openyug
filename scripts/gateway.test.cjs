// Gateway: failover, tools passthrough, Kavach both ways, streaming, forced provider, token.
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const assert = require('node:assert/strict'); const http = require('node:http'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const srv = (h) => new Promise((r) => { const s = http.createServer(h).listen(0, '127.0.0.1', () => r(s)); });
const port = (s) => s.address().port;
(async () => {
  const SECRET = 'gsk_' + 'S'.repeat(40);
  let seenByB = '';
  const A = await srv((q, s) => { s.writeHead(503); s.end('down'); });                 // always down -> retried then failover
  const B = await srv((q, s) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    seenByB += b; const body = JSON.parse(b);
    assert.ok(body.tools && body.tools[0].function.name === 'save_file');            // tools passed through
    assert.equal(body.stream, undefined);                                              // upstream asked non-stream
    const tok = body.messages[1].content.match(/\[\[KAVACH_\d+\]\]/)[0];
    s.writeHead(200, { 'content-type': 'application/json' });
    s.end(JSON.stringify({ id: 'x', model: 'b-model', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: `key is ${tok}`, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'save_file', arguments: JSON.stringify({ text: tok }) } }] } }] }));
  }); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-')); const cfg = path.join(dir, 'p.json');
  fs.writeFileSync(cfg, JSON.stringify([
    { name: 'aaa', url: `http://127.0.0.1:${port(A)}/v1/chat/completions`, keyEnv: 'AK', model: 'm', free: true },
    { name: 'bbb', url: `http://127.0.0.1:${port(B)}/v1/chat/completions`, keyEnv: 'BK', model: 'm', free: true },
  ]));
  const env = { ARJUN_AI_PROVIDERS: cfg, AK: '1', BK: '1', SELF_DEV_PROVIDER: 'aaa,bbb', SELF_DEV_RETRY_MS: '1', ARJUN_AI_HOME: dir, ARJUN_KEYS_FILE: path.join(dir, 'none'), ARJUN_GATEWAY_TOKEN: 't0k' };
  const { createGateway } = require('./gateway.cjs');
  const G = createGateway(env).listen(0, '127.0.0.1'); await new Promise((r) => G.once('listening', r));
  const base = `http://127.0.0.1:${port(G)}/v1`;
  const req = (body, auth = 'Bearer t0k') => fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) });
  const body = { model: 'arjun-auto', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: `use ${SECRET}` }], tools: [{ type: 'function', function: { name: 'save_file', parameters: {} } }] };
  assert.equal((await req(body, 'Bearer wrong')).status, 401);
  const j = await (await req(body)).json();
  assert.ok(!seenByB.includes(SECRET), 'secret leaked to AI');
  assert.equal(j.choices[0].message.content, `key is ${SECRET}`);
  assert.equal(JSON.parse(j.choices[0].message.tool_calls[0].function.arguments).text, SECRET);
  const sse = await (await req({ ...body, stream: true })).text();
  assert.match(sse, /data: \[DONE\]/); assert.match(sse, /"tool_calls"/); assert.ok(sse.includes(SECRET));
  const forced = await req({ ...body, model: 'arjun/aaa' });
  assert.equal(forced.status, 502); assert.match((await forced.json()).error.message, /aaa HTTP 503/);
  const models = await (await fetch(`${base}/models`, { headers: { authorization: 'Bearer t0k' } })).json();
  assert.deepEqual(models.data.map((m) => m.id), ['arjun-auto', 'arjun/aaa', 'arjun/bbb']);
  [A, B, G].forEach((s) => s.close());
  console.log('GATEWAY TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

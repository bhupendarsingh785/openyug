// Tools (http/command/mcp/js) + dimaag loop, all offline with fakes.
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
  process.env.ARJUN_AI_HOME = path.join(tmp, 'home'); process.env.ARJUN_OUTPUT = path.join(tmp, 'out'); process.env.ARJUN_KEYS_FILE = path.join(tmp, 'nokeys');
  const tools = require('./tools.cjs');
  // --- fake MCP server (newline JSON-RPC) ---
  const mcpFile = path.join(tmp, 'fake-mcp.cjs');
  fs.writeFileSync(mcpFile, `const rl=require('readline').createInterface({input:process.stdin});
rl.on('line',l=>{const m=JSON.parse(l);if(m.id===undefined)return;let result;
if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}};
else if(m.method==='tools/list')result={tools:[{name:'shout',description:'uppercase text'}]};
else if(m.method==='tools/call')result={content:[{type:'text',text:String(m.params.arguments.text).toUpperCase()}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  tools.saveTool({ name: 'shouter', kind: 'mcp', mcp: { command: process.execPath, args: [mcpFile] } });
  assert.match(await tools.callTool('shouter', {}, { approve: async () => true }), /shout: uppercase text/);
  assert.equal(await tools.callTool('shouter', { tool: 'shout', args: { text: 'namaste' } }, { approve: async () => true }), 'NAMASTE');
  assert.match(await tools.callTool('shouter', {}, { approve: async () => false }), /ijaazat nahi/);   // owner said no
  // --- http tool: binary -> saved file, prompt URL-encoded ---
  let gotUrl;
  const img = await new Promise((r) => { const s = http.createServer((q, w) => { gotUrl = q.url; w.writeHead(200, { 'content-type': 'image/png' }); w.end(Buffer.from([137, 80, 78, 71])); }).listen(0, '127.0.0.1', () => r(s)); });
  tools.saveTool({ name: 'img', kind: 'http', http: { method: 'GET', url: `http://127.0.0.1:${img.address().port}/prompt/{{prompt}} saveAs: 'png' } });
  const saved = await tools.callTool('img', { prompt: 'hero & villain' });
  assert.equal(gotUrl, '/prompt/hero%20%26%20villain?w=512'); const pngPath = saved.split(': ')[1]; assert.equal(fs.readFileSync(pngPath).length, 4);
  // --- command tool ---
  tools.saveTool({ name: 'echoer', kind: 'command', command: { cmd: process.execPath, args: ['-e', 'console.log(process.argv.slice(1).join("+"))', '{{...args}}'] } });
  fs.mkdirSync(process.env.ARJUN_OUTPUT, { recursive: true });
  assert.equal(await tools.callTool('echoer', { args: ['a', 'b'] }, { approve: async () => true }), 'a+b');
  // --- catalog connect ---
  assert.equal(tools.connectFromCatalog('image-banao').kind, 'http');
  assert.ok(tools.listTools().some((t) => t.name === 'image-banao'));
  // --- project for the brain ---
  const root = path.join(tmp, 'proj'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'math.js'), 'module.exports.add=(a,b)=>a-b\n'); fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  const E = require('./self-development-engine.cjs'); const engine = new E({ root, useGit: false }); await engine.initialize();
  const script = [
    { action: 'list_files', input: {} },
    { action: 'read_file', input: { path: '.env' } },
    { action: 'read_file', input: { path: 'math.js' } },
    { action: 'use_tool', input: { name: 'img', input: { prompt: 'thumbnail' } } },
    { action: 'create_tool', input: { name: 'jod', description: 'do numbers jodo' } },
    { action: 'use_tool', input: { name: 'jod', input: { a: 2, b: 3 } } },
    { action: 'change_code', input: { instruction: 'add theek karo' } },
    { action: 'ask_owner', input: { question: 'kuch aur?' } },
    'not json at all',
    { action: 'finish', input: { answer: 'Sab ho gaya' } },
  ];
  const seen = [];
  let i = 0;
  const ai = { generate: async ({ system, prompt }) => {
    if (system.startsWith('You write small')) return "module.exports = async (input) => String(Number(input.a) + Number(input.b));";
    if (system.startsWith('Extract at most')) return '{"lessons":["math.js mein add galat tha, tests ke saath theek kiya"]}';
    if (system.includes('senior software engineer')) return JSON.stringify({ summary: 'add theek', changes: [{ path: 'math.js', content: 'module.exports.add=(a,b)=>a+b\n' }] });
    seen.push(prompt); const s = script[i++]; return typeof s === 'string' ? s : JSON.stringify({ thought: 't', ...s });
  } };
  await engine.connectAI(ai);
  const approve = { code: async () => true, tool: async () => true, connect: async () => true, newTool: async (code, risky) => { assert.deepEqual(risky, []); return true; } };
  const brain = require('./brain.cjs').createBrain({ ai, root, engine, tools, web: { search: async () => [], read: async () => '' }, approve, ask: async () => 'bas itna', maxSteps: 12 });
  const r = await brain.kaam('add theek karo aur thumbnail banao');
  assert.equal(r.done, true); assert.equal(r.answer, 'Sab ho gaya');
  const log = seen.join('\n');
  assert.match(log, /math\.js/);                                   // listed files
  assert.match(log, /protected/);                                  // .env refused
  assert.ok(!log.includes('SECRET=1'));
  assert.match(log, /File ban gayi/);                              // http tool
  assert.match(log, /Naya tool ban gaya: jod/); assert.match(log, /result: 5/);   // AI-made tool works
  assert.match(log, /Tests pass/);                                 // code changed via engine
  assert.match(log, /Owner: bas itna/);
  assert.match(log, /not valid JSON/);                             // recovered from bad reply
  assert.equal(fs.readFileSync(path.join(root, 'math.js'), 'utf8'), 'module.exports.add=(a,b)=>a+b\n');
  assert.match(require('./brain.cjs').readMemory(), /tests ke saath theek kiya/);   // learned
  // next goal sees the lesson
  let firstPrompt = ''; const ai2 = { generate: async ({ system, prompt }) => { if (!firstPrompt && !system.startsWith('Extract')) firstPrompt = prompt; return '{"action":"finish","input":{"answer":"ok"}}'; } };
  await require('./brain.cjs').createBrain({ ai: ai2, root, engine, tools, web: {}, approve, ask: async () => '' }).kaam('kuch');
  assert.match(firstPrompt, /LESSONS FROM EARLIER WORK[\s\S]*tests ke saath/);
  // risky code is flagged
  assert.deepEqual(tools.checkJsTool("module.exports = async () => require('child_process')"), ['child_process']);
  img.close();
  console.log('BRAIN + TOOLS TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
// auto-web decision
{ const { needsWeb } = require('./web.cjs'); const a = require('node:assert/strict');
  a.equal(needsWeb('aaj ki khabar'), true); a.equal(needsWeb('latest godot version'), true); a.equal(needsWeb('ek kahani likho'), false); }

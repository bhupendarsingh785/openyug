const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const k = require('./keys.cjs');
const G = 'AQ.' + 'Ab8RN6Ik_' + 'x'.repeat(40), O = 'sk-or-v1-' + 'a1'.repeat(32), Q = 'gsk_' + 'Z'.repeat(40), N = 'nvapi-' + 'q'.repeat(40), H = 'hf_' + 'h'.repeat(34), GH = 'github_pat_' + 'g'.repeat(60), D = 'sk-' + 'f'.repeat(32);
assert.equal(k.detect(G), 'GEMINI_API_KEY'); assert.equal(k.detect(O), 'OPENROUTER_API_KEY'); assert.equal(k.detect(Q), 'GROQ_API_KEY');
assert.equal(k.detect(N), 'NVIDIA_API_KEY'); assert.equal(k.detect(H), 'HF_TOKEN'); assert.equal(k.detect(GH), 'GITHUB_TOKEN'); assert.equal(k.detect(D), null); // DeepSeek-style -> ask
// glued together like Arjun's paste, plus a leftover template line
const glued = k.splitPasted(`${G}${O}export GEMINI_API_KEY=KEY_YAHAN ${Q}`);
assert.deepEqual(glued.map((x) => x.key), [G, O, Q], JSON.stringify(glued));
// interactive (piped): saves to file with 600 perms, masked output, engine loads it
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-')); const file = path.join(dir, '.arjun-keys');
const out = execFileSync(process.execPath, [path.join(__dirname, 'self-upgrade.cjs'), 'keys'], { input: `${G}${O}\n${D}\n1\n\n`, env: { ...process.env, ARJUN_KEYS_FILE: file } }).toString();
assert.ok(!out.includes(G) && !out.includes(O) && !out.includes(D), 'key printed on screen!\n' + out);
const saved = k.readFileKeys(file);
assert.equal(saved.GEMINI_API_KEY, G); assert.equal(saved.OPENROUTER_API_KEY, O); assert.equal(saved.DEEPSEEK_API_KEY, D);
assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
const models = execFileSync(process.execPath, [path.join(__dirname, 'self-upgrade.cjs'), 'models'], { env: { PATH: process.env.PATH, HOME: dir, ARJUN_KEYS_FILE: file } }).toString();
assert.match(models, /✅ gemini/); assert.match(models, /✅ openrouter/); assert.match(models, /✅ deepseek/);
// a stale shell value (old export) must not beat the saved key
const env = { ARJUN_KEYS_FILE: file, GEMINI_API_KEY: 'AAPKI_KEY' };
k.loadKeysIntoEnv(env); assert.equal(env.GEMINI_API_KEY, G);
console.log('KEYS TESTS PASSED');

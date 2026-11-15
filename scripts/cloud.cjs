'use strict';
/**
 * ☁️ OpenYug (cloud agent) ko phone se chalana.
 *   ai cloud                      → GitHub se taaza haal: aakhri report, bache aadesh, agents, PR
 *   ai cloud order "<aadesh>"     → agent/orders.md mein jodo + GitHub par bhejo (agent turant chalta hai)
 *   ai cloud agent "naam - kaam"  → naya sahayak agent
 * Engine ka folder (~/engine) hi GitHub repo hai. Token (~/.arjun-keys ka GITHUB_TOKEN)
 * sirf header mein jaata hai — kahin save nahi hota, screen par nahi aata.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadKeysIntoEnv } = require('./keys.cjs');

const run = promisify(execFile);
const ROOT = () => process.env.ARJUN_CLOUD_ROOT || path.resolve(__dirname, '..');
const A = (...p) => path.join(ROOT(), 'agent', ...p);

async function git(args, env) {
    const token = env.GITHUB_TOKEN || env.GH_TOKEN || '';
    const auth = token ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : [];
    const ident = ['-c', `user.name=${env.ARJUN_GIT_NAME || 'Arjun'}`, '-c', `user.email=${env.ARJUN_GIT_EMAIL || 'arjun@phone'}`];
    const { stdout } = await run('git', [...auth, ...ident, ...args], { cwd: ROOT(), timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return stdout.trim();
}

async function ready(envIn) {
    const env = loadKeysIntoEnv({ ...envIn });
    if (!fs.existsSync(path.join(ROOT(), '.git'))) throw new Error(`${ROOT()} abhi GitHub repo nahi hai — pehle git init + push wale steps karo`);
    if (!env.GITHUB_TOKEN && !env.GH_TOKEN) throw new Error('GitHub token nahi mila — panel ke 🔑 box mein github_pat_… jodo');
    return env;
}

async function pull(env) {
    try {
        await git(['pull', '-q', '--rebase', '--autostash', 'origin', 'main'], env);
        return true;
    } catch (error) {
        try { await git(['rebase', '--abort'], env); } catch { /* not rebasing */ }
        throw new Error(`GitHub se laana nahi hua: ${String(error.stderr || error.message).split('\n').filter(Boolean).slice(-2).join(' ')}`);
    }
}

async function push(env, files, message) {
    await git(['add', '--', ...files], env);
    try { await git(['commit', '-qm', message], env); } catch { return 'kuch naya nahi'; }
    for (let i = 0; i < 3; i++) {
        try {
            await git(['push', '-q', 'origin', 'HEAD:main'], env);
            return 'bhej diya ✅';
        } catch {
            await pull(env);
        }
    }
    throw new Error('GitHub par bhejna nahi hua — thodi der baad: ai cloud order dobara');
}

function pending(file) {
    try { return fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^\s*-\s*\[\s\]\s*\S/.test(l)).map((l) => l.replace(/^\s*-\s*\[\s\]\s*/, '').trim()); } catch { return []; }
}

function latestReport() {
    try {
        const files = fs.readdirSync(A('reports')).filter((f) => f.endsWith('.md')).sort();
        if (!files.length) return null;
        const f = files[files.length - 1];
        return { name: f, text: fs.readFileSync(A('reports', f), 'utf8') };
    } catch { return null; }
}

function agents() {
    try {
        return fs.readdirSync(A('agents')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => {
            const t = fs.readFileSync(A('agents', f), 'utf8');
            return { name: f.slice(0, -3), kaam: (t.match(/^kaam:\s*(.+)$/m) || [])[1] || '', pending: pending(A('agents', f)).length };
        });
    } catch { return []; }
}

/** Short local summary (no network) — used by Boss. */
function summary(max = 1500) {
    if (!fs.existsSync(A('run.py'))) return '';
    const r = latestReport();
    const ag = agents();
    const prs = (r && r.text.match(/https:\/\/github\.com\/\S+\/pull\/\d+/g)) || [];
    return [
        `Bache aadesh: ${pending(A('orders.md')).length}`,
        `Agents: ${ag.map((a) => `${a.name} (${a.kaam.slice(0, 60)}, ${a.pending} bache)`).join('; ') || 'abhi koi nahi'}`,
        prs.length ? `Merge ke liye PR: ${[...new Set(prs)].join(' ')}` : '',
        r ? `Aakhri report (${r.name}):\n${r.text.slice(0, max)}` : 'Abhi koi cloud report nahi (GitHub par pehla run hone do, phir: ai cloud)',
    ].filter(Boolean).join('\n');
}

async function status(envIn = process.env) {
    const env = await ready(envIn);
    await pull(env);
    return summary(3500);
}

async function order(text, envIn = process.env) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('Aadesh likho: ai cloud order "sudhaar: ..."');
    if (t.length > 500) throw new Error('Aadesh chhota rakho (500 akshar tak)');
    const env = await ready(envIn);
    await pull(env);
    const file = A('orders.md');
    if (!fs.existsSync(file) && fs.existsSync(A('seed', 'orders.md'))) fs.copyFileSync(A('seed', 'orders.md'), file);
    if (!fs.existsSync(file)) throw new Error('agent/orders.md nahi mila — OpenYug wala naya engine zip lagao');
    let s = fs.readFileSync(file, 'utf8');
    const line = `- [ ] ${t}`;
    // naya aadesh pehle aadesh-list ke ant mein (guide section se pehle)
    const guide = s.indexOf('\n## ');
    s = guide > -1 ? `${s.slice(0, guide).replace(/\s*$/, '')}\n${line}\n${s.slice(guide)}` : `${s.replace(/\s*$/, '')}\n${line}\n`;
    fs.writeFileSync(file, s);
    const r = await push(env, ['agent/orders.md'], `aadesh: ${t.slice(0, 60)}`);
    return `📨 Aadesh ${r}: ${t}\n   OpenYug GitHub par 1-2 minute mein shuru karega. Nateeja: ai cloud`;
}

/** ai cloud bhejo — phone ke saare badlav (engine, agent) GitHub par; pehle GitHub ke naye badlav laata hai. */
async function sync(envIn = process.env) {
    const env = await ready(envIn);
    await git(['add', '-A'], env);
    let committed = true;
    try { await git(['commit', '-qm', `phone: update ${new Date().toISOString().slice(0, 16)}`], env); } catch { committed = false; }
    await pull(env);
    await git(['push', '-q', 'origin', 'HEAD:main'], env).catch((error) => {
        const msg = String(error.stderr || error.message);
        if (/workflow/i.test(msg)) throw new Error('GitHub ne .github/workflows file rok di — token mein "Workflows: Read and write" permission jodo, phir dobara: ai cloud bhejo');
        throw new Error(`GitHub par nahi gaya: ${msg.split('\n').filter(Boolean).slice(-2).join(' ')}`);
    });
    return committed ? '☁️ Phone ke badlav GitHub par bhej diye ✅' : '☁️ GitHub se taaza haal le liya (bhejne ko kuch naya nahi tha) ✅';
}

/**
 * Cloud mode (GitHub Actions / OpenYug): no human can type "haan" there.
 * Code changes are allowed ONLY because they never land on main: the engine puts them
 * on a new branch + Pull Request, and the owner's Merge is the "haan".
 * Safety files, new connections, new tool code and untrusted tools are always refused.
 */
function approvals(safetyFiles, log = console.log) {
    const no = (why) => async () => { log(`   ⛔ cloud mein mana: ${why} — phone par Arjun ki haan chahiye`); return false; };
    return {
        code: async (validated, diff) => {
            const safety = validated.filter((v) => safetyFiles.includes(path.basename(v.path)) || /(^|\/)\.github\//.test(v.path));
            if (safety.length) { log(`   ⛔ cloud mein suraksha wali file nahi badlegi: ${safety.map((v) => v.path).join(', ')}`); return false; }
            log(`\n${String(diff).slice(0, 4000)}\n   ☁️ cloud: ye badlav alag branch + Pull Request mein jayega (main par nahi). Merge = Arjun ki haan.`);
            return true;
        },
        tool: async (t) => (t && t.trusted ? true : no(`tool "${t && t.name}" trusted nahi`)()),
        connect: no('naya connection'),
        newTool: no('naya tool code'),
    };
}

module.exports = { status, order, sync, summary, pending, latestReport, agents, approvals };

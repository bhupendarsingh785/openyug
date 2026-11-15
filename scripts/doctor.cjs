'use strict';
/** `self-upgrade.cjs doctor` — one command that checks everything and says what to fix. */
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { listProviders } = require('./providers.cjs');
const { readFileKeys } = require('./keys.cjs');

async function reach(url) {
    try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
        return r.status < 500;
    } catch {
        return false;
    }
}

async function doctor() {
    const out = [];
    const ok = (good, text, fix) => out.push(`${good ? '✅' : '❌'} ${text}${!good && fix ? `\n     → ${fix}` : ''}`);
    const major = Number(process.versions.node.split('.')[0]);
    ok(major >= 18, `Node.js ${process.versions.node}`, 'pkg upgrade nodejs');
    let git = false;
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }); git = true; } catch { /* missing */ }
    ok(git, 'git (GitHub ke liye)', 'pkg install -y git');
    try {
        const st = fs.statfsSync(os.homedir());
        const freeGb = (st.bavail * st.bsize) / 1e9;
        ok(freeGb > 1, `Khaali jagah: ${freeGb.toFixed(1)} GB`, 'Phone mein jagah khaali karo (kam se kam 1 GB)');
    } catch { /* statfs not available */ }
    const keys = Object.keys(readFileKeys());
    ok(keys.length > 0, `Saved keys: ${keys.length ? keys.join(', ') : 'koi nahi'}`, 'node self-upgrade.cjs keys');
    const providers = listProviders().filter((p) => p.connected);
    ok(providers.length > 0, `Jude hue AI: ${providers.map((p) => p.name).join(', ') || 'koi nahi'}`, 'Kam se kam Gemini key jodo');
    ok(providers.length > 1, 'Failover ke liye 2+ AI', 'Ek aur free key jodo (OpenRouter/Groq) — ek ruke to doosra chale');
    ok(await reach('https://html.duckduckgo.com/html/'), 'Internet / web search', 'Internet ya DNS check karo');
    ok(!(process.env.GITHUB_TOKEN || readFileKeys().GITHUB_TOKEN) ? false : true, 'GitHub token (auto push/PR)', 'GitHub ke liye: node self-upgrade.cjs keys (github_pat_… paste)');
    // live check of every connected AI (and self-repair where possible)
    try {
        const { fixAll } = require('./providers.cjs');
        for (const r of await fixAll()) {
            if (r.ok) out.push(`${r.fixed ? '🔧' : '✅'} AI ${r.name} chal raha${r.action ? ` — ${r.action}` : ''}`);
            else out.push(`❌ AI ${r.name}: ${r.error}`);
        }
    } catch (error) { out.push(`❌ AI live check: ${error.message}`); }
    console.log(out.join('\n'));
    const bad = out.filter((l) => l.startsWith('❌')).length;
    console.log(bad ? `\n${bad} cheez(ein) theek karni hain — upar → ke saath likha hai.` : '\nSab theek hai 💪');
}

module.exports = { doctor };

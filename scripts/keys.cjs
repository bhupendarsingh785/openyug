'use strict';
/**
 * Key manager: paste keys one after another — each is recognised and saved by itself.
 *
 *   node self-upgrade.cjs keys          # paste keys (hidden), Enter after each, empty Enter = done
 *   node self-upgrade.cjs keys list     # which keys are saved (masked)
 *   node self-upgrade.cjs keys remove GEMINI_API_KEY
 *
 * Keys live in ~/.arjun-keys (only you can read it). The engine loads this file by
 * itself, so no `source` or .bashrc step is needed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const readline = require('node:readline');

const KEY_FILE = () => process.env.ARJUN_KEYS_FILE || path.join(os.homedir(), '.arjun-keys');

// Order matters: more specific prefixes first.
const RULES = [
    ['OPENROUTER_API_KEY', /^sk-or-v1-[0-9a-f]{32,}$/i],
    ['ANTHROPIC_API_KEY', /^sk-ant-[0-9A-Za-z_-]{20,}$/],
    ['OPENAI_API_KEY', /^sk-(?:proj|svcacct|admin)-[0-9A-Za-z_-]{20,}$/],
    ['GEMINI_API_KEY', /^AIza[0-9A-Za-z_-]{30,}$/],
    ['GEMINI_API_KEY', /^AQ\.[0-9A-Za-z_-]{20,}$/],
    ['GROQ_API_KEY', /^gsk_[0-9A-Za-z]{20,}$/],
    ['NVIDIA_API_KEY', /^nvapi-[0-9A-Za-z_-]{20,}$/],
    ['HF_TOKEN', /^hf_[0-9A-Za-z]{20,}$/],
    ['GITHUB_TOKEN', /^(?:github_pat_[0-9A-Za-z_]{40,}|gh[pousr]_[0-9A-Za-z]{30,})$/],
    ['XAI_API_KEY', /^xai-[0-9A-Za-z]{20,}$/],
    ['CEREBRAS_API_KEY', /^csk-[0-9A-Za-z]{20,}$/],
    ['SARVAM_API_KEY', /^sk_[0-9A-Za-z_]{10,}$/],
];

// Prefixes that can be shared by several companies -> ask the owner.
const AMBIGUOUS_CHOICES = ['DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY', 'ZAI_API_KEY', 'MISTRAL_API_KEY', 'KRUTRIM_CLOUD_API_KEY'];

const KNOWN_PREFIX = /(sk-or-v1-|sk-ant-|sk-proj-|AIza|AQ\.|gsk_|nvapi-|hf_|github_pat_|gh[pousr]_|xai-|csk-|export)/g;

function detect(key) {
    for (const [name, re] of RULES) if (re.test(key)) return name;
    return null;
}

/** Split whatever was pasted (even several keys glued together) into separate keys. */
function splitPasted(text) {
    const out = [];
    for (const chunk of String(text).split(/[\s,;'"]+/).filter(Boolean)) {
        // "export NAME=value" lines
        const exp = chunk.match(/^(?:export)?([A-Z][A-Z0-9_]*)=(.*)$/);
        if (exp) { if (exp[2]) out.push({ name: exp[1], key: exp[2] }); continue; }
        // glued keys: cut before every known prefix
        const parts = chunk.replace(KNOWN_PREFIX, '\n$1').split('\n').filter(Boolean);
        for (const p of parts) if (!/^export$/i.test(p)) out.push({ name: null, key: p });
    }
    return out.filter((k) => (k.name ? k.key.length >= 1 : k.key.length >= 16) && !/^(KEY_|yahan|AQ\.x+$)/i.test(k.key));
}

function mask(key) {
    return key.length <= 10 ? '****' : `${key.slice(0, 6)}…${key.slice(-3)} (${key.length} akshar)`;
}

function readFileKeys(file = KEY_FILE()) {
    const keys = {};
    try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
            if (m && m[2].trim()) keys[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
        }
    } catch {
        // no file yet
    }
    return keys;
}

function writeFileKeys(keys, file = KEY_FILE()) {
    const body = Object.entries(keys).map(([k, v]) => `export ${k}=${v}`).join('\n') + '\n';
    fs.writeFileSync(file, body, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
}

/** Put saved keys into the environment (saved keys override stale shell values). */
function loadKeysIntoEnv(env = process.env) {
    // Use the key file named in THIS env (not just the global one), so callers stay isolated.
    // Saved keys WIN over old values left in the shell (e.g. an earlier `export`), because the
    // owner manages them live from the panel / `keys` command. Set ARJUN_ENV_KEYS_FIRST=1 to flip.
    const file = env.ARJUN_KEYS_FILE || KEY_FILE();
    const envFirst = env.ARJUN_ENV_KEYS_FIRST === '1';
    for (const [k, v] of Object.entries(readFileKeys(file))) if (!envFirst || !env[k]) env[k] = v;
    return env;
}

function hiddenInterface() {
    const out = new Writable({ write(chunk, enc, cb) { if (!out.muted) process.stdout.write(chunk, enc); cb(); } });
    out.muted = false;
    const rl = readline.createInterface({ input: process.stdin, output: out, terminal: Boolean(process.stdin.isTTY) });
    // Queue every line, so nothing pasted/typed early is lost.
    const lines = [];
    const waiters = [];
    let closed = false;
    rl.on('line', (l) => (waiters.length ? waiters.shift()(l) : lines.push(l)));
    rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
    const nextLine = () => (lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve('') : new Promise((r) => waiters.push(r)));
    return {
        async ask(q, hidden = false) {
            process.stdout.write(q);
            out.muted = hidden;
            const a = await nextLine();
            out.muted = false;
            if (hidden) process.stdout.write('\n');
            return a;
        },
        close: () => rl.close(),
    };
}

async function interactive() {
    const saved = readFileKeys();
    const io = hiddenInterface();
    console.log('🔑 Keys paste karo — screen par nahi dikhengi. Har paste ke baad Enter.');
    console.log('   Ek saath kai keys bhi paste kar sakte ho. Khatam: khaali Enter.\n');
    let added = 0;
    try {
        for (;;) {
            const line = await io.ask('Key: ', true);
            if (!line.trim()) break;
            const found = splitPasted(line);
            if (!found.length) { console.log('   ⚠️ Ye key jaisi nahi lagi, dobara paste karo.'); continue; }
            for (const item of found) {
                let name = item.name || detect(item.key);
                if (!name) {
                    console.log(`   ❓ ${mask(item.key)} — ye kis company ki key hai?`);
                    AMBIGUOUS_CHOICES.forEach((n, i) => console.log(`      ${i + 1}. ${n.replace(/_API_KEY|_CLOUD/g, '')}`));
                    const pick = Number(await io.ask('   Number likho (chhodne ke liye Enter): '));
                    name = AMBIGUOUS_CHOICES[pick - 1];
                    if (!name) { console.log('   ↪ chhod di'); continue; }
                }
                const replaced = Boolean(saved[name]);
                saved[name] = item.key;
                added++;
                writeFileKeys(saved); // save right away, nothing lost if Termux closes
                console.log(`   ✅ ${name} ${replaced ? 'badal di' : 'save ho gayi'}: ${mask(item.key)}`);
            }
        }
    } finally {
        io.close();
    }
    console.log(`\n${added} key(s) save. File: ${KEY_FILE()} (sirf aap padh sakte ho).`);
    console.log('Ab check karo:  node self-upgrade.cjs models');
}

function list() {
    const keys = readFileKeys();
    const names = Object.keys(keys);
    if (!names.length) return console.log('Koi key save nahi hai. Jodo:  node self-upgrade.cjs keys');
    for (const n of names) console.log(`✅ ${n.padEnd(22)} ${mask(keys[n])}`);
}

function remove(name) {
    const keys = readFileKeys();
    if (!keys[name]) return console.log(`${name} save nahi thi.`);
    delete keys[name];
    writeFileKeys(keys);
    console.log(`🗑️ ${name} hata di.`);
}

module.exports = { AMBIGUOUS_CHOICES, hiddenInterface, detect, splitPasted, mask, readFileKeys, writeFileKeys, loadKeysIntoEnv, interactive, list, remove };

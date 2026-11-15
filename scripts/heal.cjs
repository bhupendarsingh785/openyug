'use strict';
/**
 * Self-healing for AI providers.
 *
 *  - health.json remembers which provider failed and why, with a cool-down time.
 *    The failover chain skips cooling providers, so no time is wasted on them.
 *  - fix(name): really tests the provider; if the model is gone (404) or overloaded
 *    (5xx) it lists the provider's live models, tries them, and saves the first one
 *    that answers as <NAME>_MODEL. Quota (429) -> cool-down. Bad key -> clear advice.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const file = () => path.join(process.env.ARJUN_AI_HOME || path.join(os.homedir(), '.arjun-ai'), 'health.json');

const COOL = { quota: 15 * 60e3, busy: 3 * 60e3, badkey: 60 * 60e3, model: 10 * 60e3, net: 2 * 60e3 };

function read() {
    try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}

function write(h) {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(h, null, 2));
}

function classify(message) {
    const m = String(message || '');
    if (/\b(400|401|403)\b/.test(m) && /key|auth|permission|unauthori|invalid/i.test(m)) return 'badkey';
    if (/\b(401|403)\b/.test(m)) return 'badkey';
    if (/\b404\b|model.*(not found|does not exist|deprecated)/i.test(m)) return 'model';
    if (/\b429\b|quota|rate limit/i.test(m)) return 'quota';
    if (/\b5\d\d\b|overloaded|high demand|unavailable/i.test(m)) return 'busy';
    if (/timeout|fetch failed|ECONN|ENOTFOUND|network/i.test(m)) return 'net';
    return null;
}

/** Record a failure (called by the failover chain). */
function recordFailure(name, message) {
    const kind = classify(message);
    if (!kind) return null;
    const h = read();
    h[name] = { kind, until: Date.now() + COOL[kind], error: String(message).slice(0, 300), at: new Date().toISOString() };
    write(h);
    return kind;
}

function recordOk(name) {
    const h = read();
    if (h[name]) { delete h[name]; write(h); }
}

function isCooling(name, now = Date.now()) {
    const e = read()[name];
    return Boolean(e && e.until > now);
}

const ADVICE = {
    badkey: 'Key galat ya expire. Nayi key banao aur panel ke 🔑 box mein dobara jodo.',
    quota: 'Free limit khatam. Thodi der ke liye aaram par daal diya — doosre AI kaam karenge, baad mein apne aap wapas.',
    busy: 'Unka server busy hai. Thodi der aaram, phir apne aap wapas.',
    net: 'Internet/connection dikkat. Net check karo.',
    model: 'Model ab nahi chalta.',
};

function rankModels(ids, preferred) {
    const bad = /embed|whisper|tts|audio|image|imagen|veo|vision-only|guard|rerank|moderation|search|realtime|transcribe|dall|lyria|live/i;
    const pool = ids.filter((id) => !bad.test(id));
    const family = String(preferred || '').toLowerCase().split(/[-/:._]/).filter((w) => w.length > 2 && !/^\d+$/.test(w));
    const score = (id) => {
        const s = id.toLowerCase();
        let n = 0;
        for (const w of family) if (s.includes(w)) n += 3;
        if (/flash|mini|instant|small|lite|haiku|chat|instruct|coder|versatile/.test(s)) n += 2;
        if (/preview|exp|beta|test/.test(s)) n -= 2;
        return n;
    };
    return pool.sort((a, b) => score(b) - score(a));
}

/**
 * fix(name, deps): deps = { testProvider, catalog, loadKeysIntoEnv, readFileKeys, writeFileKeys, env }
 * Returns { ok, action, message }.
 */
async function fix(name, deps) {
    const { testProvider, catalog, loadKeysIntoEnv, readFileKeys, writeFileKeys } = deps;
    const env0 = deps.env || process.env;
    const first = await testProvider(name, env0);
    if (first.ok) { recordOk(name); return { ok: true, action: 'none', message: `✅ ${name} pehle se theek chal raha hai (${first.model})` }; }
    const kind = classify(first.error) || 'unknown';
    if (kind === 'badkey') { recordFailure(name, first.error); return { ok: false, action: 'need-key', message: `❌ ${name}: ${ADVICE.badkey}` }; }
    if (kind === 'quota' || kind === 'net') { recordFailure(name, first.error); return { ok: false, action: 'cooldown', message: `⏸️ ${name}: ${ADVICE[kind]}` }; }
    if (kind === 'model' || kind === 'busy') {
        const env = loadKeysIntoEnv({ ...env0 });
        const p = catalog(env).find((x) => x.name === name);
        const modelsUrl = p && (p.modelsUrl || String(p.url).replace(/\/chat\/completions$/, '/models'));
        if (!p || p.kind === 'anthropic' || !modelsUrl || modelsUrl === p.url) {
            recordFailure(name, first.error);
            return { ok: false, action: 'cooldown', message: `⏸️ ${name}: ${ADVICE[kind]} Abhi doosre AI kaam karenge.` };
        }
        let ids = [];
        try {
            const key = p.keyEnv ? env[p.keyEnv] : '';
            const res = await fetch(modelsUrl, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(20000) });
            const j = await res.json();
            ids = (j.data || j.models || []).map((m) => (m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
        } catch { /* fall through */ }
        const current = env[`${name.toUpperCase()}_MODEL`] || p.model;
        const candidates = rankModels(ids.filter((id) => id !== current), current).slice(0, 4);
        for (const model of candidates) {
            const t = await testProvider(name, { ...env0, [`${name.toUpperCase()}_MODEL`]: model });
            if (t.ok) {
                const saved = readFileKeys();
                saved[`${name.toUpperCase()}_MODEL`] = model;
                writeFileKeys(saved);
                recordOk(name);
                return { ok: true, action: 'model-switched', message: `🔧 ${name} theek: model "${current}" ki jagah "${model}" laga diya (test pass, ${(t.ms / 1000).toFixed(1)}s).` };
            }
        }
        recordFailure(name, first.error);
        return { ok: false, action: 'cooldown', message: `⏸️ ${name}: ${ADVICE[kind]} Koi doosra model bhi abhi nahi chala — thodi der aaram, doosre AI kaam karenge.` };
    }
    recordFailure(name, first.error);
    return { ok: false, action: 'unknown', message: `❌ ${name}: ${first.error}` };
}

module.exports = { read, recordFailure, recordOk, isCooling, classify, fix, rankModels, ADVICE };

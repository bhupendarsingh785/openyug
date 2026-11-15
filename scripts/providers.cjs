'use strict';
/**
 * World AI providers for Arjun's engine — America, China, India, Europe + free gateways.
 *
 * Every provider here speaks the OpenAI "chat/completions" format (Anthropic has
 * its own small adapter). To use one, set its key as an environment variable.
 * Model names change often: override any default with <NAME>_MODEL, e.g.
 *   export DEEPSEEK_MODEL=deepseek-reasoner
 *
 * New / future models: add them without touching code in
 *   ~/.arjun-ai/providers.json
 *   [{ "name": "mynew", "url": "https://.../v1/chat/completions",
 *      "keyEnv": "MYNEW_API_KEY", "model": "model-id", "free": true }]
 *
 * SELF_DEV_PROVIDER:
 *   auto (default)  — use every provider that has a key, free ones first; if one
 *                     fails, runs out of quota or refuses, the next one takes over
 *   <name>          — only that provider
 *   a,b,c           — your own order
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVault, isPrivate, logSend } = require('./kavach.cjs');
const { loadKeysIntoEnv, readFileKeys, writeFileKeys } = require('./keys.cjs');

// region, free?, url, key env, default model, where to get a key
const BUILT_IN = [
    // ---- free gateways (many world models behind one key) ----
    { name: 'gemini', region: 'USA (Google)', free: true, url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', keyEnv: 'GEMINI_API_KEY', model: 'gemini-3.8-flash', link: 'https://aistudio.google.com/apikey' },
    { name: 'openrouter', region: 'Gateway (USA+China+EU models)', free: true, url: 'https://openrouter.ai/api/v1/chat/completions', keyEnv: 'OPENROUTER_API_KEY', model: 'auto-free', modelsUrl: 'https://openrouter.ai/api/v1/models', link: 'https://openrouter.ai/keys' },
    { name: 'groq', region: 'USA (fast open models)', free: true, url: 'https://api.groq.com/openai/v1/chat/completions', keyEnv: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile', link: 'https://console.groq.com/keys' },
    { name: 'cerebras', region: 'USA (fast open models)', free: true, url: 'https://api.cerebras.ai/v1/chat/completions', keyEnv: 'CEREBRAS_API_KEY', model: 'auto', modelsUrl: 'https://api.cerebras.ai/v1/models', link: 'https://cloud.cerebras.ai' },
    { name: 'nvidia', region: 'Gateway (DeepSeek, Qwen, Kimi, Llama…)', free: true, url: 'https://integrate.api.nvidia.com/v1/chat/completions', keyEnv: 'NVIDIA_API_KEY', model: 'auto', modelsUrl: 'https://integrate.api.nvidia.com/v1/models', link: 'https://build.nvidia.com' },
    { name: 'huggingface', region: 'Gateway (Qwen, DeepSeek, GLM…)', free: true, url: 'https://router.huggingface.co/v1/chat/completions', keyEnv: 'HF_TOKEN', model: 'auto', modelsUrl: 'https://router.huggingface.co/v1/models', link: 'https://huggingface.co/settings/tokens' },
    { name: 'github', region: 'Gateway (GitHub Models: OpenAI, Meta, DeepSeek…)', free: true, url: 'https://models.github.ai/inference/chat/completions', keyEnv: 'GITHUB_TOKEN', model: 'openai/gpt-4.1-mini', link: 'https://github.com/settings/personal-access-tokens (permission: Models → read)' },
    { name: 'mistral', region: 'Europe (France)', free: true, url: 'https://api.mistral.ai/v1/chat/completions', keyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest', link: 'https://console.mistral.ai/api-keys' },
    // Free web AI without any key (rate-limited; may change any time). With POLLINATIONS_API_KEY it uses the newer keyed API.
    { name: 'pollinations', region: 'Free web AI (bina key)', free: true, nokey: true, url: 'https://text.pollinations.ai/openai', keyUrl: 'https://gen.pollinations.ai/v1/chat/completions', keyEnv: 'POLLINATIONS_API_KEY', model: 'openai', link: 'https://enter.pollinations.ai (key optional)' },
    { name: 'ollama', region: 'Your own device (offline)', free: true, url: `${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/v1/chat/completions`, keyEnv: null, model: 'qwen2.5-coder:7b', link: 'https://ollama.com/download' },
    // ---- India ----
    { name: 'sarvam', region: 'India', free: false, url: 'https://api.sarvam.ai/v1/chat/completions', keyEnv: 'SARVAM_API_KEY', model: 'sarvam-105b', link: 'https://dashboard.sarvam.ai', extraHeaders: (k) => ({ 'api-subscription-key': k }) },
    { name: 'krutrim', region: 'India (Ola)', free: false, url: 'https://cloud.olakrutrim.com/v1/chat/completions', keyEnv: 'KRUTRIM_CLOUD_API_KEY', model: 'auto', modelsUrl: 'https://cloud.olakrutrim.com/v1/models', link: 'https://cloud.olakrutrim.com' },
    // ---- China ----
    { name: 'deepseek', region: 'China', free: false, url: 'https://api.deepseek.com/chat/completions', keyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', link: 'https://platform.deepseek.com/api_keys' },
    { name: 'qwen', region: 'China (Alibaba)', free: false, url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', keyEnv: 'DASHSCOPE_API_KEY', model: 'qwen-plus', link: 'https://modelstudio.console.alibabacloud.com' },
    { name: 'kimi', region: 'China (Moonshot)', free: false, url: 'https://api.moonshot.ai/v1/chat/completions', keyEnv: 'MOONSHOT_API_KEY', model: 'kimi-k3', link: 'https://platform.kimi.ai' },
    { name: 'glm', region: 'China (Zhipu / Z.ai)', free: false, url: 'https://api.z.ai/api/paas/v4/chat/completions', keyEnv: 'ZAI_API_KEY', model: 'glm-5.1', link: 'https://z.ai/manage-apikey/apikey-list' },
    // ---- USA paid ----
    { name: 'openai', region: 'USA', free: false, url: 'https://api.openai.com/v1/chat/completions', keyEnv: 'OPENAI_API_KEY', model: 'gpt-4.1-mini', link: 'https://platform.openai.com/api-keys' },
    { name: 'xai', region: 'USA (Grok)', free: false, url: 'https://api.x.ai/v1/chat/completions', keyEnv: 'XAI_API_KEY', model: 'auto', modelsUrl: 'https://api.x.ai/v1/models', link: 'https://console.x.ai' },
    { name: 'anthropic', region: 'USA (Claude)', free: false, kind: 'anthropic', url: 'https://api.anthropic.com/v1/messages', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5-5', link: 'https://console.anthropic.com/settings/keys' },
];

const ALIASES = { claude: 'anthropic', google: 'gemini', moonshot: 'kimi', zai: 'glm', zhipu: 'glm', alibaba: 'qwen', dashscope: 'qwen', ola: 'krutrim', grok: 'xai', hf: 'huggingface', gh: 'github' };

function loadCustom(env) {
    const file = env.ARJUN_AI_PROVIDERS || path.join(os.homedir(), '.arjun-ai', 'providers.json');
    try {
        const list = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(list) ? list.filter((p) => p && p.name && p.url).map((p) => ({ region: 'Custom', free: false, ...p })) : [];
    } catch {
        return [];
    }
}

function catalog(env = process.env) {
    const custom = loadCustom(env);
    const names = new Set(custom.map((p) => p.name));
    return [...custom, ...BUILT_IN.filter((p) => !names.has(p.name))];
}

function keyFor(p, env) {
    if (p.keyEnv === null) return 'local';
    return env[p.keyEnv] || '';
}

function isAvailable(p, env) {
    if (p.nokey) return env.ARJUN_NO_WEB_AI !== '1';
    if (p.name === 'ollama') return Boolean(env.OLLAMA_HOST || env.SELF_DEV_PROVIDER === 'ollama');
    return Boolean(keyFor(p, env));
}

const healthFile = (env) => path.join(env.ARJUN_AI_HOME || process.env.ARJUN_AI_HOME || path.join(os.homedir(), '.arjun-ai'), 'health.json');

function readHealth(env) {
    try { return JSON.parse(fs.readFileSync(healthFile(env), 'utf8')); } catch { return {}; }
}

function setHealth(env, name, info) {
    try {
        const h = readHealth(env);
        if (info) h[name] = info; else delete h[name];
        fs.mkdirSync(path.dirname(healthFile(env)), { recursive: true });
        fs.writeFileSync(healthFile(env), JSON.stringify(h, null, 2));
    } catch { /* best effort */ }
}

function coolingDown(env, name) {
    const h = readHealth(env)[name];
    return Boolean(h && h.until && h.until > Date.now());
}

/** Remember a temporary problem so the next requests try healthy providers first. */
function noteFailure(env, name, error) {
    const m = String(error && error.message || error).match(/HTTP (\d{3})/);
    const status = m ? Number(m[1]) : (error && error.name === 'TimeoutError' ? 504 : 0);
    // a DAILY quota (e.g. Gemini "exceeded your current quota") won't come back in minutes — rest it longer so every step stops waiting on it
    const daily = /quota|per.?day|daily|PerDay|RPD/i.test(String(error && error.message || ''));
    if (status === 429) setHealth(env, name, { until: Date.now() + (daily ? 3 * 60 : 15) * 60 * 1000, reason: daily ? 'aaj ki free limit khatam' : 'free limit khatam' });
    else if (status >= 500 || status === 0) setHealth(env, name, { until: Date.now() + 5 * 60 * 1000, reason: 'server busy/network' });
    else if ([400, 401, 403].includes(status)) setHealth(env, name, { until: Date.now() + 60 * 60 * 1000, reason: 'key galat' });
}

function isLocal(p) {
    try {
        const host = new URL(p.url).hostname;
        return ['127.0.0.1', 'localhost', '::1'].includes(host);
    } catch {
        return false;
    }
}

function aiTimeout(env) {
    return AbortSignal.timeout(Number(env.SELF_DEV_TIMEOUT_MS) || 120_000);
}

class ProviderError extends Error {
    constructor(provider, status, body) {
        const hints = {
            400: 'request/key galat',
            401: 'key galat ya expire',
            402: 'credit khatam',
            403: 'is key ko permission nahi',
            404: 'model naam purana — <NAME>_MODEL set karo',
            429: 'free limit khatam',
        };
        super(`${provider} HTTP ${status}${hints[status] ? ` (${hints[status]})` : ''}: ${String(body).slice(0, 300)}`);
        this.provider = provider;
        this.status = status;
    }
}

const modelCache = new Map();

function modelsUrlFor(p) {
    if (p.modelsUrl) return p.modelsUrl;
    if (p.kind === 'anthropic') return 'https://api.anthropic.com/v1/models';
    return String(p.url).replace(/\/chat\/completions$/, '/models');
}

async function listModelIds(p, key, env) {
    const headers = p.kind === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : (key && key !== 'local' ? { authorization: `Bearer ${key}` } : {});
    const res = await fetch(modelsUrlFor(p), { headers, signal: aiTimeout(env) });
    if (!res.ok) throw new ProviderError(p.name, res.status, await res.text());
    const j = await res.json();
    return (j.data || j.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).map((id) => String(id).replace(/^models\//, ''));
}

/** Best chat models first: coder/strong families, never embeddings/tts/image models. */
function rankModels(ids, freeOnly) {
    let pool = freeOnly ? ids.filter((id) => id.endsWith(':free')) : ids;
    pool = pool.filter((id) => !/embed|whisper|tts|image|imagen|veo|vision-only|guard|rerank|audio|transcri|moderation|aqa|learnlm/i.test(id));
    const prefer = [/coder/i, /flash/i, /deepseek/i, /qwen/i, /glm/i, /kimi/i, /llama.*(70|405)/i, /sonnet|haiku/i, /instruct/i, /chat/i];
    const score = (id) => { const i = prefer.findIndex((re) => re.test(id)); return i < 0 ? prefer.length : i; };
    return [...pool].sort((a, b) => score(a) - score(b));
}

async function resolveModel(p, key, env) {
    const override = env[`${p.name.toUpperCase()}_MODEL`] || (env.SELF_DEV_ONLY_ONE ? env.SELF_DEV_MODEL : null);
    if (override) return override;
    if (p.model !== 'auto' && p.model !== 'auto-free') return p.model;
    if (modelCache.has(p.name)) return modelCache.get(p.name);
    // Ask the provider which models it has right now (new models show up automatically).
    const chosen = rankModels(await listModelIds(p, key, env), p.model === 'auto-free')[0];
    if (!chosen) throw new ProviderError(p.name, 404, 'koi model nahi mila');
    modelCache.set(p.name, chosen);
    return chosen;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST with automatic retry for temporary problems (network drop, server 5xx).
 * Quota (429) and key/model errors (4xx) are NOT retried here — the failover moves
 * to the next provider instead, which is faster.
 */
async function postJSON(p, url, headers, body, env) {
    const retries = env.SELF_DEV_RETRIES === undefined ? 2 : Number(env.SELF_DEV_RETRIES);
    const base = env.SELF_DEV_RETRY_MS === undefined ? 1500 : Number(env.SELF_DEV_RETRY_MS);
    for (let attempt = 0; ; attempt++) {
        let res;
        try {
            res = await fetch(url, { method: 'POST', signal: aiTimeout(env), headers, body: JSON.stringify(body) });
        } catch (error) {
            if (error.name === 'TimeoutError' || attempt >= retries) throw error;
            await sleep(base * 2 ** attempt);
            continue;
        }
        if (res.ok) return res.json();
        const text = await res.text();
        if (res.status >= 500 && attempt < retries) {
            await sleep(base * 2 ** attempt);
            continue;
        }
        throw new ProviderError(p.name, res.status, text);
    }
}

/** Anthropic Messages <-> OpenAI chat format (text only). */
function toAnthropic(body, model) {
    const system = body.messages.filter((m) => m.role === 'system').map((m) => contentText(m.content)).join('\n\n');
    const messages = body.messages.filter((m) => m.role !== 'system').map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: contentText(m.content) || ' ',
    }));
    return { model, max_tokens: body.max_tokens || 16000, system: system || undefined, messages };
}

function contentText(c) {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((part) => part.text || '').join('');
    return '';
}

/**
 * Send a full OpenAI-style chat body to provider `p` and always get an OpenAI-style
 * response back (used by the engine and by the local AI gateway).
 */
async function callChat(p, body, env) {
    const key = keyFor(p, env);
    const model = await resolveModel(p, key, env);
    if (p.kind === 'anthropic') {
        if (body.tools?.length) throw new ProviderError(p.name, 400, 'tools not supported via this adapter');
        const j = await postJSON(p, p.url, { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, toAnthropic(body, model), env);
        const text = (j.content || []).map((c) => c.text || '').join('');
        return {
            id: j.id || `arjun-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
            choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            usage: j.usage ? { prompt_tokens: j.usage.input_tokens, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.input_tokens + j.usage.output_tokens } : undefined,
        };
    }
    const headers = { 'content-type': 'application/json' };
    if (key && key !== 'local') headers.authorization = `Bearer ${key}`;
    if (p.extraHeaders) Object.assign(headers, p.extraHeaders(key));
    const { stream, stream_options, ...rest } = body; // always ask upstream for a full answer
    const url = p.nokey && key && p.keyUrl ? p.keyUrl : p.url;
    const j = await postJSON(p, url, headers, { ...rest, model }, env);
    return { ...j, model: j.model || model };
}

/** Is this error about the MODEL (busy / removed), so another model of the same AI may work? */
function isModelIssue(msg) {
    const m = String(msg || '');
    const gone = /\b404\b/.test(m) || (/model/i.test(m) && /not found|no longer|deprecat|does not exist|unknown/i.test(m));
    const busy = /\b(500|503|529)\b/.test(m) && /model|demand|overload|capacity/i.test(m);
    return gone || busy;
}

const altCache = new Map(); // provider -> {at, ids}

/**
 * callChat + same-AI model fallback: if the model is busy or removed, try up to 2 other
 * models of the SAME provider (any provider) before giving up on it. Works for every AI.
 */
async function callChatSmart(p, body, env) {
    try {
        return await callChat(p, body, env);
    } catch (error) {
        if (env.ARJUN_MODEL_FALLBACK === '0' || !isModelIssue(error.message)) throw error;
        const key = keyFor(p, env);
        const current = await resolveModel(p, key, env).catch(() => p.model);
        let ids;
        const cached = altCache.get(p.name);
        if (cached && Date.now() - cached.at < 30 * 60 * 1000) ids = cached.ids;
        else {
            try { ids = rankModels(await listModelIds(p, key, env), p.model === 'auto-free'); } catch { throw error; }
            altCache.set(p.name, { at: Date.now(), ids });
        }
        for (const alt of ids.filter((m) => m !== current).slice(0, 2)) {
            try {
                const j = await callChat(p, body, { ...env, [`${p.name.toUpperCase()}_MODEL`]: alt });
                if (env.SELF_DEV_VERBOSE !== '0') process.stderr.write(`   🔁 ${p.name}: "${current}" busy/band tha, "${alt}" se jawab liya\n`);
                return j;
            } catch { /* try the next model */ }
        }
        throw error;
    }
}

async function callOne(p, { system, prompt }, env) {
    const j = await callChatSmart(p, { messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2 }, env);
    return { text: j.choices?.[0]?.message?.content ?? '', model: j.model };
}

/** Which providers to use, in which order (shared by the engine and the gateway). */
function buildChain(envIn = process.env) {
    let env = loadKeysIntoEnv({ ...envIn });
    const all = catalog(env);
    const wanted = String(env.SELF_DEV_PROVIDER || 'auto').toLowerCase().split(',').map((x) => ALIASES[x.trim()] || x.trim()).filter(Boolean);
    let chain;
    if (wanted.length === 1 && wanted[0] === 'auto') {
        const rank = (p) => (p.free ? (p.nokey && !keyFor(p, env) ? 1 : 0) : 2); // keyed free → bina-key web AI → paid
        // healthy first; providers cooling down (busy / limit / bad key) go last but are still tried
        chain = all.filter((p) => isAvailable(p, env)).sort((a, b) => (Number(coolingDown(env, a.name)) - Number(coolingDown(env, b.name))) || (rank(a) - rank(b)));
    } else {
        chain = wanted.map((n) => all.find((p) => p.name === n)).filter(Boolean);
        const missing = chain.find((p) => !isAvailable(p, env));
        if (missing && chain.length === 1) {
            throw new Error(`🔌 Connection chahiye: ${missing.keyEnv}. Key yahan se lo: ${missing.link} — phir: node self-upgrade.cjs keys`);
        }
        chain = chain.filter((p) => isAvailable(p, env));
    }
    if (isPrivate(env)) {
        const outside = chain.filter((p) => !isLocal(p));
        if (outside.length && wanted[0] !== 'auto') {
            throw new Error(`🔒 Private mode on hai: ${outside.map((p) => p.name).join(', ')} bahar ke server hain. Sirf Ollama (offline) chalega — ya private mode band karo.`);
        }
        chain = all.filter((p) => isLocal(p));
    }
    if (env.SELF_DEV_MODEL && chain.length === 1) env = { ...env, SELF_DEV_ONLY_ONE: '1' };
    if (chain.length === 0) {
        throw new Error('Koi AI key set nahi hai. Sabse aasaan free: Gemini key (https://aistudio.google.com/apikey), phir: node self-upgrade.cjs keys');
    }
    return { chain, env };
}

/**
 * One provider object for the engine. With several keys it fails over:
 * error / timeout / quota / refusal on one -> the next provider answers.
 */
function createProvider(envIn = process.env) {
    const { chain, env } = buildChain(envIn);

    let start = 0;
    return {
        name: chain.map((p) => p.name).join('→'),
        chain: chain.map((p) => p.name),
        lastUsed: null,
        /** Engine calls this when a reply was unusable (e.g. a refusal), so the next try uses another model. */
        next() { start = (start + 1) % chain.length; },
        async generate(input) {
            // Data Kavach: hide secrets/personal details before anything leaves the device.
            const vault = createVault();
            const safeInput = { ...input, system: vault.hide(input.system), prompt: vault.hide(input.prompt) };
            if (vault.count && env.SELF_DEV_VERBOSE !== '0') process.stderr.write(`   🛡️ Kavach: ${vault.count} secret/personal cheezein chhupa di\n`);
            const errors = [];
            for (let i = 0; i < chain.length; i++) {
                const p = chain[(start + i) % chain.length];
                try {
                    const { text: raw, model } = await callOne(p, safeInput, env);
                    if (!raw || !raw.trim()) throw new Error(`${p.name}: khaali jawab`);
                    setHealth(env, p.name, null); // worked → healthy again
                    const text = vault.reveal(raw);
                    logSend({ provider: p.name, model, local: isLocal(p), sentChars: safeInput.system.length + safeInput.prompt.length, hidden: vault.count }, env);
                    this.lastUsed = `${p.name}/${model}`;
                    if (env.SELF_DEV_VERBOSE !== '0') process.stderr.write(`   🤖 jawab: ${this.lastUsed}\n`);
                    return text;
                } catch (error) {
                    const msg = error.name === 'TimeoutError' ? `${p.name}: 2 minute mein jawab nahi` : error.message;
                    errors.push(msg);
                    noteFailure(env, p.name, error);
                    if (chain.length > 1 && env.SELF_DEV_VERBOSE !== '0') process.stderr.write(`   ↪ ${p.name} nahi chala, agla try…\n`);
                }
            }
            const all = new Error(`Koi bhi AI provider nahi chala:\n- ${errors.join('\n- ')}`);
            all.fatal = true;
            throw all;
        },
    };
}

function listProviders(env = process.env) {
    env = loadKeysIntoEnv({ ...env });
    return catalog(env).map((p) => ({
        name: p.name,
        region: p.region,
        free: p.free,
        connected: isAvailable(p, env),
        keyEnv: p.keyEnv || '(none — local)',
        model: env[`${p.name.toUpperCase()}_MODEL`] || p.model,
        link: p.link || '',
    }));
}

function explain(msg, name) {
    if (/\b(400|401|403)\b/.test(msg) && /key|auth|permission|invalid|unauthor/i.test(msg)) return 'key galat ya expire — nayi key banao aur panel mein dobara jodo';
    if (/\b404\b/.test(msg) || /model.*(not|no longer|deprecat)|not.*model/i.test(msg)) return `model naam purana (auto-fix ${name.toUpperCase()}_MODEL set karta hai)`;
    if (/\b402\b/.test(msg) || /credit|balance|billing/i.test(msg)) return 'credit khatam — is provider mein paise daalne padenge (free wale chalte rahenge)';
    if (/\b429\b/.test(msg)) return 'free limit khatam — 15 minute tak baaki AI pehle use honge';
    if (/\b5\d\d\b/.test(msg) || /timeout|2 minute|fetch failed|network/i.test(msg)) return 'unka server busy/network — 5 minute tak baaki AI pehle use honge';
    return '';
}

async function oneShot(p, env) {
    const t = Date.now();
    const j = await callChat(p, { messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 512, temperature: 0 }, env);
    const reply = String(j.choices?.[0]?.message?.content ?? '').trim();
    if (!reply) throw new Error(`${p.name}: khaali jawab${j.choices?.[0]?.finish_reason === 'length' ? ' (model ne saare token sochne mein laga diye)' : ''}`);
    return { ms: Date.now() - t, model: j.model, reply: reply.slice(0, 60) };
}

/**
 * Really call ONE provider. If it fails, try to FIX it by itself:
 *  - model removed/renamed → list the provider's current models, find one that answers, save <NAME>_MODEL
 *  - busy / limit → mark it, so the failover uses healthy AIs first (fixes itself later)
 *  - bad key / no credit → cannot be fixed by code: says exactly what the owner must do
 * Returns {ok, fixed?, ms, model, reply | error, action}
 */
async function testProvider(name, envIn = process.env, { fix = true } = {}) {
    const env = loadKeysIntoEnv({ ...envIn, SELF_DEV_RETRIES: '0' });
    const p = catalog(env).find((x) => x.name === name);
    if (!p) return { ok: false, error: 'Ye provider list mein nahi hai' };
    if (!isAvailable(p, env)) return { ok: false, error: `Key nahi hai (${p.keyEnv})`, action: `Key yahan se lo: ${p.link}` };
    let firstError;
    try {
        const r = await oneShot(p, env);
        setHealth(env, p.name, null);
        return { ok: true, ...r };
    } catch (error) {
        firstError = error.name === 'TimeoutError' ? `${p.name}: 2 minute mein jawab nahi` : error.message;
    }
    const why = explain(firstError, name);
    noteFailure(env, p.name, { message: firstError });
    const modelGone = /\b404\b/.test(firstError) || (/model/i.test(firstError) && !/\b(401|403|429|5\d\d)\b/.test(firstError));
    // "this model is busy / overloaded" → another model of the same provider is often free right now
    const modelBusy = /\b(503|529|500)\b/.test(firstError) && /model|demand|overload|capacity/i.test(firstError);
    const modelProblem = modelGone || modelBusy;
    if (fix && modelProblem) {
        try {
            const key = keyFor(p, env);
            const tried = new Set([String(env[`${name.toUpperCase()}_MODEL`] || p.model)]);
            for (const candidate of rankModels(await listModelIds(p, key, env), p.model === 'auto-free').filter((m) => !tried.has(m)).slice(0, 4)) {
                try {
                    const r = await oneShot(p, { ...env, [`${name.toUpperCase()}_MODEL`]: candidate });
                    const keys = readFileKeys(env.ARJUN_KEYS_FILE || undefined);
                    keys[`${name.toUpperCase()}_MODEL`] = candidate;
                    writeFileKeys(keys, env.ARJUN_KEYS_FILE || undefined);
                    modelCache.delete(p.name);
                    setHealth(env, p.name, null);
                    return { ok: true, fixed: true, ...r, action: modelBusy ? `🔧 "${tried.values().next().value}" busy tha, isliye khaali model "${candidate}" laga diya (${name.toUpperCase()}_MODEL) — wapas purane par: panel mein ${name.toUpperCase()}_MODEL hatao` : `🔧 Purana model hata kar naya model "${candidate}" laga diya (${name.toUpperCase()}_MODEL)` };
                } catch { /* try next model */ }
            }
        } catch { /* could not list models */ }
    }
    return { ok: false, error: `${firstError.slice(0, 180)}${why ? ` → ${why}` : ''}`, action: why };
}

async function fixAll(envIn = process.env) {
    const env = loadKeysIntoEnv({ ...envIn });
    const out = [];
    for (const p of catalog(env).filter((x) => isAvailable(x, env))) out.push({ name: p.name, ...(await testProvider(p.name, envIn)) });
    return out;
}

module.exports = { callChatSmart, isModelIssue, fixAll, readHealth, rankModels, testProvider, createProvider, listProviders, catalog, buildChain, callChat, isLocal, ProviderError, BUILT_IN };

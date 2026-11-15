'use strict';
/**
 * Arjun AI Gateway — one local AI address for everything (dashboard agents, OpenCode,
 * your own apps). Behind it: every connected world AI, automatic failover, retries,
 * and Data Kavach. Speaks the OpenAI chat format.
 *
 *   node self-upgrade.cjs gateway            # http://127.0.0.1:4141/v1
 *
 * Use from any OpenAI-compatible tool:
 *   base URL: http://127.0.0.1:4141/v1   model: arjun-auto  (or arjun/gemini, arjun/deepseek …)
 *   api key:  anything — or ARJUN_GATEWAY_TOKEN if you set one
 *
 * Only listens on this device (127.0.0.1), so other phones/PCs on the Wi-Fi cannot use it.
 */
const http = require('node:http');
const { buildChain, callChatSmart, isLocal } = require('./providers.cjs');
const { createVault, logSend } = require('./kavach.cjs');

function hideBody(body, vault) {
    const hide = (c) => {
        if (typeof c === 'string') return vault.hide(c);
        if (Array.isArray(c)) return c.map((part) => (part && typeof part.text === 'string' ? { ...part, text: vault.hide(part.text) } : part));
        return c;
    };
    return {
        ...body,
        messages: (body.messages || []).map((m) => ({
            ...m,
            content: hide(m.content),
            ...(m.tool_calls ? { tool_calls: m.tool_calls.map((t) => ({ ...t, function: { ...t.function, arguments: vault.hide(t.function?.arguments ?? '') } })) } : {}),
        })),
    };
}

function revealResponse(j, vault) {
    for (const ch of j.choices || []) {
        const m = ch.message || {};
        if (typeof m.content === 'string') m.content = vault.reveal(m.content);
        for (const t of m.tool_calls || []) if (t.function) t.function.arguments = vault.reveal(t.function.arguments ?? '');
    }
    return j;
}

/** Turn a full answer into OpenAI streaming chunks (for tools that ask for stream: true). */
function writeAsStream(res, j) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const base = { id: j.id || `arjun-${Date.now()}`, object: 'chat.completion.chunk', created: j.created || Math.floor(Date.now() / 1000), model: j.model };
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const ch = j.choices?.[0] || {};
    const m = ch.message || {};
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    if (m.content) send({ ...base, choices: [{ index: 0, delta: { content: m.content }, finish_reason: null }] });
    if (m.tool_calls?.length) {
        send({ ...base, choices: [{ index: 0, delta: { tool_calls: m.tool_calls.map((t, i) => ({ index: i, id: t.id, type: 'function', function: { name: t.function?.name, arguments: t.function?.arguments ?? '' } })) }, finish_reason: null }] });
    }
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: ch.finish_reason || (m.tool_calls?.length ? 'tool_calls' : 'stop') }], usage: j.usage });
    res.write('data: [DONE]\n\n');
    res.end();
}

function readBody(req, limit = 20 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function jsonError(res, status, message) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'arjun_gateway_error' } }));
}

function createGateway(envIn = process.env) {
    const token = envIn.ARJUN_GATEWAY_TOKEN || '';
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://local');
            if (token && req.headers.authorization !== `Bearer ${token}`) return jsonError(res, 401, 'ARJUN_GATEWAY_TOKEN galat hai');
            if (req.method === 'GET' && url.pathname === '/health') {
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ ok: true }));
            }
            if (req.method === 'GET' && url.pathname === '/v1/models') {
                let names = [];
                try { names = buildChain(envIn).chain.map((p) => p.name); } catch { /* no keys yet */ }
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ object: 'list', data: [{ id: 'arjun-auto', object: 'model', owned_by: 'arjun' }, ...names.map((n) => ({ id: `arjun/${n}`, object: 'model', owned_by: n }))] }));
            }
            if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') return jsonError(res, 404, 'Sirf /v1/chat/completions aur /v1/models');

            const body = JSON.parse(await readBody(req));
            if (!Array.isArray(body.messages)) return jsonError(res, 400, 'messages chahiye');
            // model "arjun/<name>" forces one provider; anything else = auto failover
            const forced = typeof body.model === 'string' && body.model.startsWith('arjun/') ? body.model.slice(6) : null;
            const { chain, env } = buildChain(forced ? { ...envIn, SELF_DEV_PROVIDER: forced } : envIn);
            const vault = createVault();
            const safe = hideBody({ ...body, model: undefined }, vault);
            const errors = [];
            for (const p of chain) {
                try {
                    const answer = revealResponse(await callChatSmart(p, safe, env), vault);
                    logSend({ via: 'gateway', provider: p.name, model: answer.model, local: isLocal(p), hidden: vault.count }, env);
                    if (body.stream) return writeAsStream(res, answer);
                    res.writeHead(200, { 'content-type': 'application/json' });
                    return res.end(JSON.stringify(answer));
                } catch (error) {
                    errors.push(error.name === 'TimeoutError' ? `${p.name}: timeout` : error.message);
                }
            }
            return jsonError(res, 502, `Koi bhi AI provider nahi chala: ${errors.join(' | ')}`);
        } catch (error) {
            return jsonError(res, error.status || 500, error.message);
        }
    });
}

function startGateway(env = process.env) {
    const port = Number(env.ARJUN_GATEWAY_PORT) || 4141;
    const server = createGateway(env);
    server.listen(port, '127.0.0.1', () => {
        console.log(`🚪 Arjun AI Gateway chalu: http://127.0.0.1:${port}/v1  (model: arjun-auto)`);
        console.log('   Band karne ke liye: CTRL + c');
    });
    return server;
}

module.exports = { createGateway, startGateway };

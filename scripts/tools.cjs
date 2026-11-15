'use strict';
/**
 * Tools = extra abilities the engine and its "dimaag" can use. Four kinds:
 *   http     — any web API (image generators, weather, your own server…)
 *   command  — any program on the device (ffmpeg, blender, python script…)
 *   mcp      — any MCP server (thousands exist: GitHub, browser, files, design tools…)
 *   js       — a small function written by you or by the AI (`tool banao`)
 *
 * Saved in ~/.arjun-ai/tools/<name>.json. Tools that run code on the device
 * (command, mcp, js) ask the owner before every run unless marked trusted.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadKeysIntoEnv } = require('./keys.cjs');
const { withMcp } = require('./mcp.cjs');

const run = promisify(execFile);
const home = () => process.env.ARJUN_AI_HOME || path.join(os.homedir(), '.arjun-ai');
const toolsDir = () => path.join(home(), 'tools');
const outDir = () => process.env.ARJUN_OUTPUT || path.join(os.homedir(), 'arjun-output');
const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;

// Ready-to-connect tools. `connect search` also looks on npm + GitHub for more.
const CATALOG = [
    { name: 'image-banao', kind: 'http', free: true, description: 'Text se image banao (Pollinations, free, bina key)', link: 'https://pollinations.ai', def: { http: { method: 'GET', url: 'https://image.pollinations.ai/prompt/{{prompt}}?width={{width|1024}}&height={{height|1024}}&nologo=true', saveAs: 'png' }, input: { prompt: 'image ka varnan', width: 1024, height: 1024 } } },
    { name: 'text-pollinations', kind: 'http', free: true, description: 'Free text AI (Pollinations, bina key)', link: 'https://pollinations.ai', def: { http: { method: 'GET', url: 'https://text.pollinations.ai/{{prompt}}' }, input: { prompt: 'sawaal' } } },
    { name: 'wikipedia', kind: 'http', free: true, description: 'Wikipedia summary (hi/en)', link: 'https://wikipedia.org', def: { http: { method: 'GET', url: 'https://{{lang|en}}.wikipedia.org/api/rest_v1/page/summary/{{title}}' }, input: { title: 'Blender_(software)', lang: 'en' } } },
    { name: 'mausam', kind: 'http', free: true, description: 'Mausam (Open-Meteo, bina key)', link: 'https://open-meteo.com', def: { http: { method: 'GET', url: 'https://api.open-meteo.com/v1/forecast?latitude={{lat}}&longitude={{lon}}&current_weather=true' }, input: { lat: 28.61, lon: 77.21 } } },
    { name: 'ffmpeg', kind: 'command', free: true, description: 'Video/audio badlo, jodo, kaato (FFmpeg)', link: 'https://ffmpeg.org', setup: 'pkg install -y ffmpeg', def: { command: { cmd: 'ffmpeg', args: ['-y', '{{...args}}'] }, input: { args: ['-i', 'in.mp4', 'out.mp3'] } } },
    { name: 'blender', kind: 'command', free: true, description: '3D model/render (Blender Python script se, PC par)', link: 'https://www.blender.org', setup: 'PC par Blender install karo', def: { command: { cmd: 'blender', args: ['-b', '-P', '{{script}}'] }, input: { script: 'scene.py' } } },
    { name: 'files', kind: 'mcp', free: true, description: 'Ek folder ki files padhna/likhna (MCP filesystem)', link: 'https://github.com/modelcontextprotocol/servers', setup: 'Node/npx chahiye', def: { mcp: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{{folder|~/arjun-output}}'] } } },
    { name: 'memory-graph', kind: 'mcp', free: true, description: 'Knowledge-graph memory (MCP memory server)', link: 'https://github.com/modelcontextprotocol/servers', def: { mcp: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } } },
    { name: 'browser', kind: 'mcp', free: true, description: 'Website kholna, click, form (Playwright MCP — PC par)', link: 'https://github.com/microsoft/playwright-mcp', def: { mcp: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } } },
    { name: 'soch', kind: 'mcp', free: true, description: 'Step-by-step sochne wala tool (sequential thinking MCP)', link: 'https://github.com/modelcontextprotocol/servers', def: { mcp: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] } } },
];

function ensureDir() {
    fs.mkdirSync(toolsDir(), { recursive: true });
}

function listTools() {
    try {
        return fs.readdirSync(toolsDir()).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(toolsDir(), f), 'utf8')));
    } catch {
        return [];
    }
}

function getTool(name) {
    return listTools().find((t) => t.name === name) || null;
}

function saveTool(def) {
    if (!NAME_RE.test(def.name || '')) throw new Error('Tool ka naam chhote angrezi akshar/number/- mein ho (jaise image-banao)');
    if (!['http', 'command', 'mcp', 'js'].includes(def.kind)) throw new Error('kind: http | command | mcp | js');
    ensureDir();
    fs.writeFileSync(path.join(toolsDir(), `${def.name}.json`), JSON.stringify(def, null, 2), { mode: 0o600 });
    return def;
}

function removeTool(name) {
    const t = getTool(name);
    if (!t) return false;
    fs.rmSync(path.join(toolsDir(), `${name}.json`), { force: true });
    if (t.kind === 'js') fs.rmSync(path.join(toolsDir(), `${name}.cjs`), { force: true });
    return true;
}

/** {{field}}, {{field|default}}; in URLs values are URL-encoded. {{...args}} spreads an array. */
function fill(template, input, { url = false } = {}) {
    return String(template).replace(/\{\{([a-zA-Z0-9_]+)(?:\|([^}]*))?\}\}/g, (_, k, dflt) => {
        let v = input?.[k] ?? dflt ?? '';
        if (typeof v === 'string' && v.startsWith('~/')) v = path.join(os.homedir(), v.slice(2));
        return url ? encodeURIComponent(String(v)) : String(v);
    });
}

function fillArgs(args, input) {
    const out = [];
    for (const a of args || []) {
        const spread = String(a).match(/^\{\{\.\.\.([a-zA-Z0-9_]+)\}\}$/);
        if (spread) out.push(...(Array.isArray(input?.[spread[1]]) ? input[spread[1]].map(String) : []));
        else out.push(fill(a, input));
    }
    return out;
}

const needsApproval = (t) => !t.trusted && t.kind !== 'http';

/**
 * Run a tool. `approve(tool, input)` must return true for device-running tools
 * that are not trusted. Returns text (long results are cut; files are saved and their path returned).
 */
async function callTool(name, input = {}, { approve, env: envIn = process.env } = {}) {
    const t = getTool(name);
    if (!t) throw new Error(`Tool "${name}" juda nahi hai. Dekho: node self-upgrade.cjs connect list`);
    if (needsApproval(t)) {
        if (typeof approve !== 'function' || (await approve(t, input)) !== true) return '(owner ne is tool ko chalane ki ijaazat nahi di)';
    }
    const env = loadKeysIntoEnv({ ...envIn });
    if (t.kind === 'http') {
        const h = t.http;
        const headers = { 'user-agent': 'ArjunAgents/1.0', ...(h.headers || {}) };
        if (h.keyEnv) {
            if (!env[h.keyEnv]) throw new Error(`🔌 ${name} ke liye key chahiye: ${h.keyEnv} → node self-upgrade.cjs keys`);
            headers[h.keyHeader || 'authorization'] = (h.keyPrefix ?? 'Bearer ') + env[h.keyEnv];
        }
        const init = { method: h.method || 'GET', headers, signal: AbortSignal.timeout(Number(h.timeoutMs) || 120000) };
        if (h.body && init.method !== 'GET') {
            init.body = fill(JSON.stringify(h.body), input);
            headers['content-type'] = headers['content-type'] || 'application/json';
        }
        const res = await fetch(fill(h.url, input, { url: true }), init);
        const type = res.headers.get('content-type') || '';
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        if (h.saveAs || !/json|text|xml|html/.test(type)) {
            fs.mkdirSync(outDir(), { recursive: true });
            const ext = h.saveAs || (type.split('/')[1] || 'bin').split(';')[0];
            const file = path.join(outDir(), `${name}-${Date.now()}.${ext}`);
            fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
            return `File ban gayi: ${file}`;
        }
        return (await res.text()).slice(0, 20000);
    }
    if (t.kind === 'command') {
        const { stdout, stderr } = await run(t.command.cmd, fillArgs(t.command.args, input), { timeout: Number(t.command.timeoutMs) || 10 * 60 * 1000, maxBuffer: 20 * 1024 * 1024, cwd: input.cwd || outDir() }).catch((e) => {
            if (e.code === 'ENOENT') throw new Error(`"${t.command.cmd}" install nahi hai. ${t.setup || ''}`);
            throw new Error(`${name} fail: ${String(e.stderr || e.message).slice(-500)}`);
        });
        return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim().slice(-20000) || '(ho gaya)';
    }
    if (t.kind === 'mcp') {
        const def = { command: t.mcp.command, args: fillArgs(t.mcp.args, input), env: t.mcp.env || {} };
        return withMcp(def, async (c) => {
            if (!input.tool) {
                const list = await c.listTools();
                return `Is MCP mein ye tools hain (input mein "tool" aur "args" do):\n${list.map((x) => `- ${x.name}: ${(x.description || '').slice(0, 120)}`).join('\n')}`;
            }
            return (await c.callTool(input.tool, input.args || {})).slice(0, 20000);
        });
    }
    if (t.kind === 'js') {
        const file = path.join(toolsDir(), `${t.name}.cjs`);
        delete require.cache[require.resolve(file)];
        const fn = require(file);
        const out = await (typeof fn === 'function' ? fn : fn.run)(input, { outDir: outDir(), fetch });
        return typeof out === 'string' ? out.slice(0, 20000) : JSON.stringify(out, null, 2).slice(0, 20000);
    }
    throw new Error(`Unknown tool kind ${t.kind}`);
}

/** Search: built-in catalog + npm (MCP servers) + GitHub. */
async function search(query) {
    const q = String(query || '').toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const local = CATALOG.filter((c) => words.some((w) => `${c.name} ${c.description}`.toLowerCase().includes(w)));
    const found = { catalog: local, npm: [], github: [] };
    const tasks = [
        fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(`keywords:mcp ${query}`)}&size=20`, { signal: AbortSignal.timeout(15000) })
            .then((r) => r.json()).then((j) => {
                found.npm = (j.objects || [])
                    .map((o) => ({ name: o.package.name, description: o.package.description || '', link: o.package.links?.npm }))
                    .filter((p) => /mcp|model context protocol/i.test(`${p.name} ${p.description}`))
                    .slice(0, 6);
            }).catch(() => {}),
        fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} mcp OR api OR free in:name,description,topics`)}&sort=stars&per_page=6`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'ArjunAgents' }, signal: AbortSignal.timeout(15000) })
            .then((r) => r.json()).then((j) => { found.github = (j.items || []).map((r) => ({ name: r.full_name, description: `${r.description || ''} ★${r.stargazers_count}`, link: r.html_url })); }).catch(() => {}),
    ];
    await Promise.all(tasks);
    return found;
}

function connectFromCatalog(name, input = {}) {
    const c = CATALOG.find((x) => x.name === name);
    if (!c) return null;
    const def = { name: c.name, kind: c.kind, description: c.description, link: c.link, setup: c.setup, ...JSON.parse(JSON.stringify(c.def)) };
    if (c.kind === 'mcp' && input.folder) def.mcp.args = def.mcp.args.map((a) => a.replace('{{folder|~/arjun-output}}', input.folder));
    return saveTool(def);
}

/** Check AI-written tool code before the owner sees it. */
function checkJsTool(code) {
    try {
        new vm.Script(`(function(module, exports, require){${code}\n})`);
    } catch (error) {
        throw new Error(`Tool code mein syntax galti: ${error.message}`);
    }
    if (!/module\.exports\s*=/.test(code)) throw new Error('Tool code module.exports = async (input) => {...} jaisa hona chahiye');
    const risky = ['child_process', 'process.exit', 'rm -rf', 'fs.rm', 'unlink', '.ssh', '.arjun-keys', 'eval('].filter((w) => code.includes(w));
    return risky; // shown to the owner as a warning, not silently blocked
}

/**
 * AI writes a new js tool. Nothing is saved until the owner approves the code.
 * approve(code, risky) -> true to save.
 */
async function createJsTool({ name, description, ai, approve }) {
    if (!NAME_RE.test(name || '')) throw new Error('Naam aisa do: chhote akshar, jaise "thumbnail-banao"');
    const system = 'You write small, safe Node.js 18+ CommonJS tools. Reply with ONLY the code, no markdown. ' +
        'Format: module.exports = async (input, ctx) => { ... return "result text"; }. ' +
        'Use only Node built-ins and global fetch. Save output files inside ctx.outDir. Never delete files, never read keys or ~/.ssh, never run shell commands. ' +
        'Validate input and throw clear Hinglish errors. Keep it short.';
    let code = await ai.generate({ system, prompt: `Tool name: ${name}\nWhat it must do: ${description}` });
    code = String(code).replace(/^```(?:js|javascript)?\s*/i, '').replace(/```\s*$/, '').trim();
    const risky = checkJsTool(code);
    if ((await approve(code, risky)) !== true) return null;
    ensureDir();
    fs.writeFileSync(path.join(toolsDir(), `${name}.cjs`), `${code}\n`, { mode: 0o600 });
    return saveTool({ name, kind: 'js', description, createdBy: 'ai', trusted: false });
}

module.exports = { CATALOG, listTools, getTool, saveTool, removeTool, callTool, search, connectFromCatalog, createJsTool, checkJsTool, fill, fillArgs, toolsDir };

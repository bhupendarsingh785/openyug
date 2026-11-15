'use strict';
/**
 * Encrypted backup / restore of everything personal, so a new phone gets it all back.
 *
 *   node self-upgrade.cjs backup     # asks a password, makes a locked file; also uploads to your
 *                                     # private GitHub repo if ARJUN_BACKUP_REPO + GITHUB_TOKEN are saved
 *   node self-upgrade.cjs restore    # from GitHub (or: restore <file>), asks the password
 *
 * What is inside: ~/.arjun-ai (dimaag script + history, yaad, tools) and ~/.arjun-keys.
 * Lock: AES-256-GCM, key from your password with scrypt. Without the password nobody
 * (not GitHub, not Google) can read it. Forgot the password = keys are gone (make new ones).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { loadKeysIntoEnv } = require('./keys.cjs');

const MAGIC = 'ARJUNBAK1';
const homeDir = () => process.env.HOME || os.homedir();
const aiHome = () => process.env.ARJUN_AI_HOME || path.join(homeDir(), '.arjun-ai');
const keysFile = () => process.env.ARJUN_KEYS_FILE || path.join(homeDir(), '.arjun-keys');
const SKIP = [/^sent-log\.jsonl$/, /(^|\/)\.lock$/];
const MAX_FILE = 20 * 1024 * 1024;

function walk(dir, base = dir, out = []) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = path.relative(base, full).split(path.sep).join('/');
        if (e.isSymbolicLink() || SKIP.some((re) => re.test(rel))) continue;
        if (e.isDirectory()) walk(full, base, out);
        else if (e.isFile() && fs.statSync(full).size <= MAX_FILE) out.push({ rel, full });
    }
    return out;
}

function collect() {
    const files = {};
    for (const f of walk(aiHome())) files[`ai/${f.rel}`] = fs.readFileSync(f.full).toString('base64');
    if (fs.existsSync(keysFile())) files['keys/.arjun-keys'] = fs.readFileSync(keysFile()).toString('base64');
    return { version: 1, createdAt: new Date().toISOString(), device: `${os.platform()}-${os.arch()}`, files };
}

function lock(bundle, password) {
    if (String(password || '').length < 8) throw new Error('Password kam se kam 8 akshar ka rakho');
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(String(password), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(bundle)))), cipher.final()]);
    return Buffer.concat([Buffer.from(MAGIC), salt, iv, cipher.getAuthTag(), body]);
}

function unlock(buf, password) {
    if (buf.subarray(0, MAGIC.length).toString() !== MAGIC) throw new Error('Ye Arjun backup file nahi hai');
    let o = MAGIC.length;
    const salt = buf.subarray(o, (o += 16));
    const iv = buf.subarray(o, (o += 12));
    const tag = buf.subarray(o, (o += 16));
    const key = crypto.scryptSync(String(password), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    try {
        const plain = Buffer.concat([decipher.update(buf.subarray(o)), decipher.final()]);
        return JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
    } catch {
        throw new Error('Password galat hai (ya file kharab hai)');
    }
}

/** Write the bundle back. Current files are first copied to a safety folder. */
function applyBundle(bundle) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safety = path.join(homeDir(), `.arjun-before-restore-${stamp}`);
    if (fs.existsSync(aiHome())) fs.cpSync(aiHome(), path.join(safety, 'ai'), { recursive: true });
    if (fs.existsSync(keysFile())) { fs.mkdirSync(safety, { recursive: true }); fs.copyFileSync(keysFile(), path.join(safety, '.arjun-keys')); }
    let count = 0;
    for (const [rel, b64] of Object.entries(bundle.files || {})) {
        let target;
        if (rel === 'keys/.arjun-keys') target = keysFile();
        else if (rel.startsWith('ai/')) target = path.join(aiHome(), rel.slice(3));
        else continue;
        const resolved = path.resolve(target);
        if (rel.startsWith('ai/') && !resolved.startsWith(path.resolve(aiHome()) + path.sep)) continue; // no escaping the folder
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, Buffer.from(b64, 'base64'), { mode: 0o600 });
        fs.chmodSync(resolved, 0o600); // also when the file already existed
        count++;
    }
    return { count, safety: fs.existsSync(safety) ? safety : null };
}

// ---- GitHub (private repo) storage via the contents API ----
function ghConf(envIn) {
    const env = loadKeysIntoEnv({ ...envIn });
    const repo = env.ARJUN_BACKUP_REPO;
    if (!repo || !env.GITHUB_TOKEN) return null;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('ARJUN_BACKUP_REPO aisa ho: username/repo-naam');
    return { repo, token: env.GITHUB_TOKEN, api: env.GITHUB_API_URL || 'https://api.github.com' };
}

async function gh(conf, method, p, body) {
    const res = await fetch(`${conf.api}/repos/${conf.repo}/contents/${p}`, {
        method,
        headers: { authorization: `Bearer ${conf.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ArjunAgents' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, j };
}

async function uploadToGitHub(buf, envIn = process.env) {
    const conf = ghConf(envIn);
    if (!conf) return null;
    const p = 'backups/latest.arjunbak';
    const cur = await gh(conf, 'GET', p);
    const put = await gh(conf, 'PUT', p, { message: `Arjun backup ${new Date().toISOString()}`, content: buf.toString('base64'), ...(cur.status === 200 && cur.j.sha ? { sha: cur.j.sha } : {}) });
    if (put.status !== 200 && put.status !== 201) throw new Error(`GitHub par backup nahi gaya (HTTP ${put.status}): ${put.j.message || ''}. Repo private hai aur token ko Contents: write permission hai?`);
    return `${conf.repo}/${p}`;
}

async function downloadFromGitHub(envIn = process.env) {
    const conf = ghConf(envIn);
    if (!conf) throw new Error('GitHub backup ke liye ARJUN_BACKUP_REPO (username/repo) aur GITHUB_TOKEN chahiye — node self-upgrade.cjs keys');
    const r = await gh(conf, 'GET', 'backups/latest.arjunbak');
    if (r.status !== 200) throw new Error(`GitHub par backup nahi mila (HTTP ${r.status})`);
    if (r.j.content) return Buffer.from(r.j.content, 'base64');
    if (r.j.download_url) return Buffer.from(await (await fetch(r.j.download_url, { headers: { authorization: `Bearer ${conf.token}` } })).arrayBuffer());
    throw new Error('Backup file padh nahi paaya');
}

/** Save locally (and into phone Downloads if reachable, so Google Drive / any app can keep a copy). */
function saveLocal(buf) {
    const dir = path.join(homeDir(), 'arjun-backup');
    fs.mkdirSync(dir, { recursive: true });
    const name = `arjun-backup-${new Date().toISOString().slice(0, 10)}.arjunbak`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    const saved = [file];
    for (const dl of [path.join(homeDir(), 'storage', 'downloads'), path.join(homeDir(), 'storage', 'shared', 'Download')]) {
        try { if (fs.statSync(dl).isDirectory()) { fs.copyFileSync(file, path.join(dl, name)); saved.push(path.join(dl, name)); break; } } catch { /* not reachable */ }
    }
    return saved;
}

module.exports = { collect, lock, unlock, applyBundle, uploadToGitHub, downloadFromGitHub, saveLocal, MAGIC };

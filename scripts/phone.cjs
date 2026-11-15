'use strict';
/**
 * Phone control over Android's official Wireless debugging (ADB) — no root needed.
 *   node self-upgrade.cjs phone info            # model, chip, Android, RAM, storage, battery
 *   node self-upgrade.cjs phone apps [khoj]     # installed apps
 *   node self-upgrade.cjs phone halka <app>     # switch an app OFF (reversible) — phone gets lighter
 *   node self-upgrade.cjs phone wapas <app>     # switch it back ON
 *   node self-upgrade.cjs phone sab-wapas       # undo everything this tool ever switched off
 *
 * Safety (Arjun's rule: backup first, check, roll back on trouble):
 *   - every change is written to ~/.arjun-ai/phone-changes.json BEFORE it happens
 *   - apps are only DISABLED (never deleted) — always reversible
 *   - core apps (System UI, Settings, phone, keyboard, launcher, Play services, Termux…) are refused
 *   - after a change it checks the phone still answers; if not, it undoes the change
 * Setup: see arjun/phone/ADB-GUIDE.md (pair once with Wireless debugging).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const logFile = () => path.join(process.env.ARJUN_AI_HOME || path.join(os.homedir(), '.arjun-ai'), 'phone-changes.json');

const PROTECTED = [
    /^android$/, /^com\.android\.systemui$/, /^com\.android\.settings$/, /^com\.android\.phone$/, /dialer/i, /telephony/i, /^com\.android\.providers\./,
    /^com\.google\.android\.gms$/, /^com\.google\.android\.gsf$/, /^com\.android\.vending$/, /packageinstaller/i, /permissioncontroller/i,
    /inputmethod|keyboard|gboard|swiftkey/i, /launcher|\.home$|trebuchet/i, /webview/i, /^com\.termux/, /bluetooth/i, /^com\.android\.shell$/,
    /networkstack|wifi|connectivity/i, /^com\.android\.server\./, /^com\.qualcomm\.|^com\.mediatek\.|^vendor\./, /securitycenter|knox/i,
];

async function adb(args, { timeout = 30000 } = {}) {
    try {
        const { stdout } = await run(process.env.ARJUN_ADB || 'adb', args, { timeout, maxBuffer: 10 * 1024 * 1024 });
        return stdout.trim();
    } catch (error) {
        if (error.code === 'ENOENT') throw new Error('adb install nahi hai: pkg install -y android-tools — phir arjun/phone/ADB-GUIDE.md dekho');
        const msg = String(error.stderr || error.stdout || error.message);
        if (/no devices|device offline|unauthorized/i.test(msg)) throw new Error('Phone ADB se juda nahi hai. Wireless debugging chalu karke pair/connect karo (ADB-GUIDE.md).');
        throw new Error(msg.trim().split('\n').slice(-2).join(' '));
    }
}

const shell = (...a) => adb(['shell', ...a]);

function isProtected(pkg) {
    return PROTECTED.some((re) => re.test(pkg));
}

function readLog() {
    try { return JSON.parse(fs.readFileSync(logFile(), 'utf8')); } catch { return []; }
}

function writeLog(list) {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.writeFileSync(logFile(), JSON.stringify(list, null, 2));
}

async function info() {
    const p = async (k) => (await shell('getprop', k).catch(() => '')) || '-';
    const [model, brand, android, sdk, chip, platform, hw] = await Promise.all(['ro.product.model', 'ro.product.brand', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.soc.model', 'ro.board.platform', 'ro.hardware'].map(p));
    const mem = (await shell('cat', '/proc/meminfo').catch(() => '')).match(/MemTotal:\s+(\d+)/);
    const battery = (await shell('dumpsys', 'battery').catch(() => '')).match(/level:\s*(\d+)/);
    const df = (await shell('df', '-h', '/data').catch(() => '')).split('\n').pop();
    return [
        `📱 ${brand} ${model}`,
        `🤖 Android ${android} (SDK ${sdk})`,
        `🧠 Chip: ${chip !== '-' ? chip : platform} (platform ${platform}, hardware ${hw})`,
        `💾 RAM: ${mem ? (Number(mem[1]) / 1048576).toFixed(1) + ' GB' : '-'}`,
        `🗄️ Storage (/data): ${df || '-'}`,
        `🔋 Battery: ${battery ? battery[1] + '%' : '-'}`,
    ].join('\n');
}

async function apps(filter = '') {
    const user = (await shell('pm', 'list', 'packages', '-3')).split('\n').map((l) => l.replace('package:', '').trim()).filter(Boolean);
    const all = (await shell('pm', 'list', 'packages')).split('\n').map((l) => l.replace('package:', '').trim()).filter(Boolean);
    const disabled = new Set((await shell('pm', 'list', 'packages', '-d')).split('\n').map((l) => l.replace('package:', '').trim()).filter(Boolean));
    const f = (x) => !filter || x.toLowerCase().includes(filter.toLowerCase());
    const system = all.filter((x) => !user.includes(x));
    const line = (x) => `${disabled.has(x) ? '⏸️' : isProtected(x) ? '🔒' : '  '} ${x}`;
    return `Aapke apps (${user.length}):\n${user.filter(f).map(line).join('\n')}\n\nSystem apps (${system.length}) — 🔒 = zaroori, chhua nahi jaayega, ⏸️ = band:\n${system.filter(f).map(line).join('\n')}`;
}

/** Disable an app with backup-first + health check + auto-undo. */
async function halka(pkg) {
    if (!/^[a-zA-Z][\w.]+$/.test(pkg || '')) throw new Error('Package ka naam do, jaise com.example.app (dekho: phone apps)');
    if (isProtected(pkg)) throw new Error(`🔒 ${pkg} zaroori system app hai — ise band karne se phone ki dikkat ho sakti hai, isliye mana hai.`);
    const exists = (await shell('pm', 'list', 'packages', pkg)).split('\n').some((l) => l.trim() === `package:${pkg}`);
    if (!exists) throw new Error(`${pkg} phone mein nahi mila`);
    const log = readLog();
    log.push({ pkg, action: 'disable', at: new Date().toISOString(), undone: false });
    writeLog(log); // 1. record first
    await shell('pm', 'disable-user', '--user', '0', pkg); // 2. change
    // 3. check the phone still answers; if not, undo
    const ok = await shell('getprop', 'sys.boot_completed').then((v) => v.trim() === '1').catch(() => false);
    if (!ok) {
        await shell('pm', 'enable', pkg).catch(() => {});
        log[log.length - 1].undone = true;
        writeLog(log);
        throw new Error(`Badlav ke baad phone ne theek jawab nahi diya — ${pkg} wapas chalu kar diya.`);
    }
    return `⏸️ ${pkg} band ho gaya (hataya nahi). Wapas: phone wapas ${pkg}`;
}

async function wapas(pkg) {
    if (!/^[a-zA-Z][\w.]+$/.test(pkg || '')) throw new Error('Package ka naam do');
    await shell('pm', 'enable', pkg);
    const log = readLog();
    for (const e of log) if (e.pkg === pkg && e.action === 'disable') e.undone = true;
    writeLog(log);
    return `▶️ ${pkg} wapas chalu.`;
}

async function sabWapas() {
    const log = readLog();
    const todo = [...new Set(log.filter((e) => e.action === 'disable' && !e.undone).map((e) => e.pkg))];
    const removed = [...new Set(log.filter((e) => e.action === 'uninstall-user' && !e.undone).map((e) => e.pkg))];
    const out = [];
    for (const pkg of todo) out.push(await wapas(pkg).catch((e) => `⚠️ ${pkg}: ${e.message}`));
    for (const pkg of removed) out.push(await appWapas(pkg).catch((e) => `⚠️ ${pkg}: ${e.message}`));
    return out.join('\n') || 'Kuch band nahi kiya gaya tha.';
}


// ---------- deeper (still no root): settings + system apps, with Arjun's safety loop ----------
// copy current state → change → health check → if bad: put the old state back → report.

const backupDir = () => path.join(process.env.ARJUN_AI_HOME || path.join(os.homedir(), '.arjun-ai'), 'phone-backups');
const NS = ['global', 'secure', 'system'];
// settings that can lock the owner out or break calls/network — never changed
const PROTECTED_SETTINGS = /^(adb_enabled|development_settings_enabled|device_provisioned|user_setup_complete|airplane_mode_on|lock_screen|lockscreen|install_non_market_apps|package_verifier|verifier_|enabled_input_methods|default_input_method|wifi_on|mobile_data|data_roaming|bluetooth_on)/i;

async function healthy() {
    const boot = await shell('getprop', 'sys.boot_completed').then((v) => v.trim() === '1').catch(() => false);
    const pm = await shell('pm', 'path', 'android').then((v) => /package:/.test(v)).catch(() => false);
    return boot && pm;
}

/** Full copy of all settings (global/secure/system) to a file, before anything changes. */
async function settingsBackup(note = 'manual') {
    const snap = { at: new Date().toISOString(), note, settings: {} };
    for (const ns of NS) {
        snap.settings[ns] = {};
        for (const line of (await shell('settings', 'list', ns)).split('\n')) {
            const i = line.indexOf('=');
            if (i > 0) snap.settings[ns][line.slice(0, i).trim()] = line.slice(i + 1);
        }
    }
    fs.mkdirSync(backupDir(), { recursive: true });
    const file = path.join(backupDir(), `settings-${snap.at.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(snap, null, 2));
    return file;
}

function latestSettingsBackup() {
    try { return fs.readdirSync(backupDir()).filter((f) => f.startsWith('settings-')).sort().map((f) => path.join(backupDir(), f)).pop() || null; } catch { return null; }
}

async function putSetting(ns, key, value) {
    if (value === null || value === undefined) await shell('settings', 'delete', ns, key);
    else await shell('settings', 'put', ns, key, String(value));
}

/** Change one setting with the full safety loop. */
async function setSetting(ns, key, value) {
    if (!NS.includes(ns)) throw new Error('Namespace: global | secure | system');
    if (!/^[\w.]+$/.test(key || '')) throw new Error('Setting ka naam galat hai');
    if (PROTECTED_SETTINGS.test(key)) throw new Error(`🔒 "${key}" zaroori setting hai (lock/network/ADB) — isse aap phone se bahar ho sakte ho, isliye mana hai.`);
    const file = await settingsBackup(`before ${ns}/${key}`);                    // 1. copy
    const old = JSON.parse(fs.readFileSync(file, 'utf8')).settings[ns][key] ?? null;
    await putSetting(ns, key, value);                                            // 2. change
    const now = (await shell('settings', 'get', ns, key)).trim();
    const okValue = now === String(value);
    if (!okValue || !(await healthy())) {                                        // 3. check
        await putSetting(ns, key, old);                                          // 4. put the old one back
        throw new Error(`Badlav ke baad phone theek nahi laga (${okValue ? 'health check fail' : `value "${now}" set hui`}) — purani value "${old}" wapas laga di.`);
    }
    return `✅ ${ns}/${key}: "${old}" → "${value}". Pura backup: ${path.basename(file)} (wapas: phone settings-wapas)`;
}

/** Put every setting back exactly as in a backup (only changed keys are touched). */
async function settingsRestore(file = latestSettingsBackup()) {
    if (!file) throw new Error('Koi settings backup nahi mila');
    const snap = JSON.parse(fs.readFileSync(file, 'utf8')).settings;
    let changed = 0;
    for (const ns of NS) {
        const now = {};
        for (const line of (await shell('settings', 'list', ns)).split('\n')) { const i = line.indexOf('='); if (i > 0) now[line.slice(0, i).trim()] = line.slice(i + 1); }
        for (const [k, v] of Object.entries(snap[ns] || {})) if (now[k] !== v && !PROTECTED_SETTINGS.test(k)) { await putSetting(ns, k, v); changed++; }
        for (const k of Object.keys(now)) if (!(k in (snap[ns] || {})) && !PROTECTED_SETTINGS.test(k)) { await putSetting(ns, k, null); changed++; }
    }
    return `↩️ ${changed} setting(s) backup jaisi kar di (${path.basename(file)}).`;
}

/**
 * Remove a system app for this user ONLY (no root). The app file stays on the phone, so it can
 * always come back with: phone app-wapas <pkg>. Copy → remove → check → restore if bad.
 */
async function hatao(pkg) {
    if (!/^[a-zA-Z][\w.]+$/.test(pkg || '')) throw new Error('Package ka naam do (dekho: phone apps)');
    if (isProtected(pkg)) throw new Error(`🔒 ${pkg} zaroori system app hai — mana hai.`);
    const apk = (await shell('pm', 'path', pkg)).split('\n').map((l) => l.replace('package:', '').trim()).filter(Boolean);
    if (!apk.length) throw new Error(`${pkg} phone mein nahi mila`);
    const log = readLog();
    log.push({ pkg, action: 'uninstall-user', apk, at: new Date().toISOString(), undone: false });
    writeLog(log);                                                              // 1. record (+ where the app file lives)
    await shell('pm', 'uninstall', '-k', '--user', '0', pkg);                   // 2. remove for this user (data kept with -k)
    if (!(await healthy())) {                                                   // 3. check
        await shell('cmd', 'package', 'install-existing', pkg).catch(() => {});  // 4. bring it back
        log[log.length - 1].undone = true; writeLog(log);
        throw new Error(`Hatane ke baad phone theek nahi laga — ${pkg} wapas laga diya.`);
    }
    return `🗑️ ${pkg} is user ke liye hata diya (file phone mein surakshit hai). Wapas: phone app-wapas ${pkg}`;
}

async function appWapas(pkg) {
    if (!/^[a-zA-Z][\w.]+$/.test(pkg || '')) throw new Error('Package ka naam do');
    await shell('cmd', 'package', 'install-existing', pkg);
    const log = readLog();
    for (const e of log) if (e.pkg === pkg && e.action === 'uninstall-user') e.undone = true;
    writeLog(log);
    return `▶️ ${pkg} wapas aa gaya.`;
}

module.exports = { info, apps, halka, wapas, sabWapas, isProtected, adb, settingsBackup, setSetting, settingsRestore, hatao, appWapas, healthy };

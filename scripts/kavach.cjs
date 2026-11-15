'use strict';
/**
 * Data Kavach — the one security layer between Arjun's data and any outside AI.
 *
 * 1. Before anything leaves the device, secrets and personal details are swapped
 *    for placeholders like [[KAVACH_3]]. The AI never sees the real values.
 *    When the reply comes back, the placeholders are swapped back, so code still works.
 * 2. Private mode (SELF_DEV_PRIVATE=1 or --private): only the offline Ollama model
 *    is allowed, so nothing leaves the device at all.
 * 3. A log of what was sent where (sizes only, never content) in ~/.arjun-ai/sent-log.jsonl.
 *
 * Honest limit: whatever text is still sent (normal code, questions) reaches the AI
 * company. Kavach hides the sensitive parts; private mode is the only way to send nothing.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PATTERNS = [
    ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
    ['google-key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
    ['google-key', /\bAQ\.[0-9A-Za-z_-]{20,}\b/g],
    ['openai-like-key', /\bsk-(?:ant-|proj-|or-)?[0-9A-Za-z_-]{20,}\b/g],
    ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}\b|\bgithub_pat_[0-9A-Za-z_]{40,}\b/g],
    ['hf-token', /\bhf_[0-9A-Za-z]{30,}\b/g],
    ['groq-key', /\bgsk_[0-9A-Za-z]{30,}\b/g],
    ['slack-token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g],
    ['aws-key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['jwt', /\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\b/g],
    ['bearer', /\b(Bearer\s+)([0-9A-Za-z._~+/-]{20,}=*)/g, 2],
    ['password', /\b((?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?)([^\s"'`,;]{4,})/gi, 2],
    ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
    ['phone', /(?<![\w.])(?:\+91[\s-]?)?[6-9]\d{9}(?![\w.])/g],
    ['card', /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g],
];

function luhn(digits) {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = Number(digits[i]);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function createVault() {
    const byValue = new Map();
    const byToken = new Map();
    let n = 0;
    const tokenFor = (value) => {
        if (!byValue.has(value)) {
            const token = `[[KAVACH_${++n}]]`;
            byValue.set(value, token);
            byToken.set(token, value);
        }
        return byValue.get(value);
    };
    return {
        hide(text) {
            let out = String(text ?? '');
            for (const [kind, re, group] of PATTERNS) {
                out = out.replace(re, (...m) => {
                    const whole = m[0];
                    if (kind === 'card') {
                        const digits = whole.replace(/\D/g, '');
                        if (digits.length < 13 || !luhn(digits)) return whole;
                    }
                    if (group) return m[1] + tokenFor(m[group]);
                    return tokenFor(whole);
                });
            }
            return out;
        },
        reveal(text) {
            return String(text ?? '').replace(/\[\[KAVACH_\d+\]\]/g, (t) => byToken.get(t) ?? t);
        },
        get count() { return byToken.size; },
    };
}

function isPrivate(env = process.env) {
    return env.SELF_DEV_PRIVATE === '1';
}

function logSend(entry, env = process.env) {
    try {
        const dir = env.ARJUN_AI_HOME || process.env.ARJUN_AI_HOME || path.join(os.homedir(), '.arjun-ai');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'sent-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    } catch {
        // logging must never break the work
    }
}

module.exports = { createVault, isPrivate, logSend };

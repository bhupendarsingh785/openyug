'use strict';
/**
 * GitHub auto-connect for the engine.
 *
 * After an upgrade passes its tests:
 *   1. never touches main/master directly — makes a branch  arjun/<date>-<topic>
 *   2. commits only the files the engine changed
 *   3. if the project has a GitHub remote and GITHUB_TOKEN is saved: pushes the branch
 *      and opens a Pull Request, so the owner reviews and merges on GitHub
 * Never force-pushes, never merges by itself. If anything fails, the local commit stays.
 */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadKeysIntoEnv } = require('./keys.cjs');

const run = promisify(execFile);

async function git(root, args, extra = {}) {
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024, ...extra });
    return stdout.trim();
}

async function isRepo(root) {
    try {
        return (await git(root, ['rev-parse', '--is-inside-work-tree'])) === 'true';
    } catch {
        return false;
    }
}

function slug(text) {
    return String(text || 'upgrade').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'upgrade';
}

/** owner/repo from https://github.com/o/r(.git) or git@github.com:o/r(.git) */
function parseGitHub(remoteUrl) {
    const m = String(remoteUrl).match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
}

function authHeader(token) {
    return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}

async function openPullRequest({ owner, repo, head, base, title, body, token, apiUrl = 'https://api.github.com' }) {
    const res = await fetch(`${apiUrl}/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ArjunAgents' },
        body: JSON.stringify({ title, head, base, body }),
        signal: AbortSignal.timeout(30000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`PR nahi khula (HTTP ${res.status}): ${j.message || ''}`);
    return j.html_url;
}

/**
 * Called by the engine after tests pass. Returns a short report; never throws for
 * GitHub problems (the code change itself already succeeded).
 */
async function afterUpgrade(root, { files, summary, instruction }, envIn = process.env) {
    const env = loadKeysIntoEnv({ ...envIn });
    if (env.ARJUN_GIT === '0' || !(await isRepo(root))) return { git: 'skipped' };
    const report = { git: 'committed' };
    const ident = ['-c', `user.name=${env.ARJUN_GIT_NAME || 'Arjun Agents'}`, '-c', `user.email=${env.ARJUN_GIT_EMAIL || 'agents@arjun.local'}`];
    let branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD');
    const baseBranch = branch;
    if (['main', 'master', 'HEAD'].includes(branch)) {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        branch = `arjun/${stamp}-${slug(instruction)}`;
        await git(root, ['checkout', '-b', branch]);
    }
    await git(root, ['add', '--', ...files]);
    const staged = await git(root, ['diff', '--cached', '--name-only']);
    if (!staged) return { git: 'nothing-to-commit', branch };
    await git(root, [...ident, 'commit', '-m', `khud-sudhaar: ${summary || instruction}`.slice(0, 200), '-m', `Instruction: ${instruction}\n\nMade by Arjun's Self-Development Engine after tests passed.`]);
    report.branch = branch;
    report.commit = await git(root, ['rev-parse', '--short', 'HEAD']);

    const remote = await git(root, ['remote', 'get-url', 'origin']).catch(() => '');
    if (!remote) return report;
    const token = env.GITHUB_TOKEN || '';
    const gh = parseGitHub(remote);
    try {
        const pushArgs = gh && token ? ['-c', `http.extraHeader=${authHeader(token)}`, 'push', '-u', 'origin', branch] : ['push', '-u', 'origin', branch];
        await git(root, pushArgs, { timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        report.pushed = true;
    } catch (error) {
        report.pushed = false;
        report.pushError = gh && !token
            ? 'GitHub token nahi hai — node self-upgrade.cjs keys se github_pat_… jodo'
            : String(error.stderr || error.message).split('\n').slice(-3).join(' ');
        return report;
    }
    // Open a PR only for a branch we created from main/master (owner reviews + merges).
    if (gh && token && branch !== baseBranch) {
        try {
            report.pr = await openPullRequest({ ...gh, head: branch, base: baseBranch === 'HEAD' ? 'main' : baseBranch, title: `khud-sudhaar: ${summary || instruction}`.slice(0, 120), body: `**Instruction:** ${instruction}\n\n**Summary:** ${summary}\n\nTests passed before this was pushed. Review karke merge karo.`, token, apiUrl: env.GITHUB_API_URL });
        } catch (error) {
            report.prError = error.message;
        }
    }
    return report;
}

/** node self-upgrade.cjs github clone owner/repo [folder] */
async function clone(spec, folder, envIn = process.env) {
    const env = loadKeysIntoEnv({ ...envIn });
    const m = String(spec || '').match(/^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (!m) throw new Error('Aise likho: github clone owner/repo');
    const url = `https://github.com/${m[1]}/${m[2]}.git`;
    const args = env.GITHUB_TOKEN ? ['-c', `http.extraHeader=${authHeader(env.GITHUB_TOKEN)}`, 'clone', url, folder || m[2]] : ['clone', url, folder || m[2]];
    await run('git', args, { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return folder || m[2];
}

module.exports = { afterUpgrade, clone, isRepo, parseGitHub, openPullRequest, slug };

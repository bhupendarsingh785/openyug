'use strict';
/**
 * Free web research for the engine (no API key): DuckDuckGo search + Jina Reader
 * (clean page text) + Wikipedia. Used by `ask --web` and `run/propose --web`.
 */
const UA = 'ArjunAgents/1.0 (+self-hosted research helper)';

async function get(url, accept = 'text/html') {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res;
}

function clean(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

async function search(query, limit = 6) {
    const html = await (await get(`https://html.duckduckgo.com/html/
    const out = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
        let href = m[1];
        const uddg = href.match(/[?&]uddg=([^&]+)/);
        if (uddg) href = decodeURIComponent(uddg[1]);
        if (href.startsWith('//')) href = `https:${href}`;
        if (/duckduckgo\.com\/y\.js/.test(href)) continue; // ads
        const rest = html.slice(re.lastIndex, re.lastIndex + 1500);
        const snippet = clean(rest.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1]);
        out.push({ title: clean(m[2]), url: href, snippet });
    }
    return out;
}

async function read(url, maxChars = 6000) {
    const text = await (await get(`https://r.jina.ai/${url}`, 'text/plain')).text();
    return text.slice(0, maxChars);
}

/** Search, open the best pages, return a compact research pack for the AI. */
async function research(query, { pages = 2 } = {}) {
    const notes = [];
    let results = [];
    try {
        results = await search(query);
    } catch (error) {
        notes.push(`(web search failed: ${error.message})`);
    }
    let body = '';
    for (const r of results.slice(0, pages)) {
        try {
            body += `\n\n### ${r.title}\nSource: ${r.url}\n${await read(r.url)}`;
        } catch {
            body += `\n\n### ${r.title}\nSource: ${r.url}\n${r.snippet}`;
        }
    }
    const list = results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join('\n');
    return {
        results,
        text: `WEB RESEARCH for "${query}" (fetched ${new Date().toISOString().slice(0, 10)}):\n${list || '(no results)'}${body}\n${notes.join('\n')}`,
    };
}

/** Does this question need fresh facts from the public web? (Hinglish + English cues) */
function needsWeb(q) {
    const t = String(q || '').toLowerCase();
    return /\b(aaj|abhi|kal|latest|naya|naye|nayi|new|newest|current|recent|today|news|khabar|price|kimat|keemat|rate|launch|release|version|update|trending|top \d+|best|sabse|kaun sa|kaunsa|kaunse|kahan|weather|mausam|score|result|20\d\d)\b/.test(t) || /https?:\/\//.test(t);
}

module.exports = { search, read, research, needsWeb };

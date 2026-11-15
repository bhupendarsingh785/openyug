'use strict';
/**
 * Arjun Panel — phone browser page: 💬 Boss inbox (normal baat) + the big red 🧠 DIMAAG button.
 *   node self-upgrade.cjs panel   →  open the printed link in Chrome
 * Only this device can open it (127.0.0.1) and the link carries a secret token.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const dimaag = require('./dimaag.cjs');

const PAGE = (token) => `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arjun Panel — Dimaag</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;font-family:system-ui,sans-serif;background:#111;color:#eee}
  header{padding:16px;text-align:center;font-size:18px;color:#bbb}
  #big{display:block;margin:12px auto 20px;width:180px;height:180px;border-radius:50%;border:6px solid #ff8a80;
       background:radial-gradient(circle at 35% 30%,#ff5252,#b71c1c);color:#fff;font-size:30px;font-weight:800;
       box-shadow:0 10px 30px rgba(255,0,0,.35);cursor:pointer}
  #big:active{transform:scale(.96)}
  section{display:none;padding:0 14px 40px;max-width:820px;margin:auto}
  section.open{display:block}
  textarea{width:100%;box-sizing:border-box;min-height:46vh;background:#1c1c1c;color:#eee;border:1px solid #444;border-radius:10px;padding:12px;font:14px/1.5 ui-monospace,monospace}
  input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #444;background:#1c1c1c;color:#eee;font-size:15px}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  button.b{flex:1;min-width:120px;padding:12px;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}
  .save{background:#2e7d32;color:#fff}.ai{background:#6a1b9a;color:#fff}.grey{background:#333;color:#eee}.danger{background:#b71c1c;color:#fff}
  h3{margin:22px 0 8px;color:#ff8a80}
  #msg{position:sticky;top:0;z-index:5;background:#111;min-height:22px;color:#aed581;margin:8px 0;padding:8px 0;border-bottom:1px solid #2a2a2a}
  #hist div{display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #2a2a2a;font-size:13px}
  #boss{max-width:820px;margin:auto;padding:0 14px}
  #chat{background:#161616;border:1px solid #333;border-radius:12px;padding:10px;height:42vh;overflow:auto;font-size:15px;line-height:1.45}
  .m{margin:8px 0;padding:9px 12px;border-radius:12px;white-space:pre-wrap;max-width:88%;word-wrap:break-word}
  .me{background:#1b5e20;margin-left:auto}.bo{background:#262626}.by{font-size:11px;color:#888;margin-top:3px}
  pre{white-space:pre-wrap;background:#1c1c1c;padding:10px;border-radius:10px;font-size:13px;max-height:30vh;overflow:auto}
</style></head><body>
<header>Arjun Agents · Panel</header>
<div id="boss">
  <h3>💬 Boss se baat karo</h3>
  <div id="chat"><i style="color:#888">Kuch bhi poocho: "kya chal raha hai?", "kaun sa AI chal raha hai?", "aaj kya seekha?", "app kaise banwaun?"</i></div>
  <div class="row"><input id="bm" placeholder="Boss ko likho…" onkeydown="if(event.key==='Enter')talk()"><button class="b ai" style="flex:0;min-width:90px" onclick="talk()">Bhejo</button></div>
  <div class="row"><button class="b grey" onclick="talk('Abhi kya chal raha hai? Saare AI ka haal aur taaza kaam batao.')">📋 Kya chal raha hai?</button><button class="b grey" style="flex:0;min-width:110px" onclick="clearChat()">🗑️ Saaf</button></div>
</div>
<button id="big" onclick="toggle()">🧠<br>DIMAAG</button>
<section id="s">
  <div id="msg"></div>
  <h3>Dimaag ki script (seedha badlo)</h3>
  <textarea id="t" spellcheck="false"></textarea>
  <div class="row"><button class="b save" onclick="save()">💾 Save</button><button class="b grey" onclick="load()">↺ Dobara padho</button></div>
  <h3>AI se advance karwao</h3>
  <input id="ins" placeholder="Jaise: cartoon kaam mein pehle story check karo, phir image">
  <div class="row"><button class="b ai" onclick="improve()">✨ Sudhaar sujhao</button></div>
  <div id="prop" style="display:none"><p>Naya version (pehle padho, phir lagao):</p><textarea id="pt" spellcheck="false"></textarea>
    <div class="row"><button class="b save" onclick="accept()">✅ Ye lagao</button><button class="b grey" onclick="hideProp()">✖ Nahi</button></div></div>
  <h3>🔑 API Keys — saare AI jodo</h3>
  <p style="font-size:13px;color:#aaa">Kitni bhi keys ek saath paste karo (chipki hui bhi chalegi). System khud pehchaan kar jodega. Keys yahan kabhi poori nahi dikhti.</p>
  <textarea id="kt" style="min-height:90px" placeholder="AIza…  sk-or-v1-…  gsk_…  nvapi-…  hf_…  github_pat_…" spellcheck="false" autocomplete="off"></textarea>
  <div class="row"><button class="b save" onclick="addKeys()">🔌 Jodo</button></div>
  <div id="amb"></div>
  <div id="ks"></div>
  <h3>Purane versions</h3><div id="hist"></div>
  <div class="row"><button class="b danger" onclick="resetIt()">⚠️ Shuruati script par wapas</button></div>
  <h3>System</h3><pre id="st">…</pre>
</section>
<script>
const T=${JSON.stringify(token)};
const api=(p,o={})=>fetch(p,{...o,headers:{'content-type':'application/json','x-panel-token':T}}).catch(()=>{throw new Error('Panel ka server band hai. Termux mein "panel" likh kar chalao, phir naya link kholo.')}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j});
const $=id=>document.getElementById(id);const say=m=>{$('msg').textContent=m};
function toggle(){$('s').classList.toggle('open');if($('s').classList.contains('open'))load()}
async function load(){try{const j=await api('/api/dimaag');$('t').value=j.text;$('hist').innerHTML=j.history.map(h=>'<div><span>'+h.replace(/</g,'&lt;')+'</span><button class="b grey" style="flex:0;min-width:90px" data-v="'+h+'">Wapas lao</button></div>').join('')||'<i>abhi koi nahi</i>';
 document.querySelectorAll('#hist button').forEach(b=>b.onclick=()=>restore(b.dataset.v));status();keys()}catch(e){say('❌ '+e.message)}}
async function keys(){try{const j=await api('/api/keys');
 $('ks').innerHTML='<p><b>Saved:</b></p>'+(j.saved.map(k=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2a2a2a;font-size:13px"><span>✅ '+k.name+' <span style="color:#888">'+k.masked+'</span></span><button class="b grey" style="flex:0;min-width:70px" data-k="'+k.name+'">Hatao</button></div>').join('')||'<i>abhi koi nahi</i>')
 +'<p style="margin-top:14px"><b>AI providers:</b></p>'+j.providers.map(p=>'<div style="font-size:13px;padding:4px 0">'+(p.connected?'✅':'⬜')+' <b>'+p.name+'</b> '+(p.free?'FREE':'paid')+' · '+p.region+(p.connected?' <button class="b grey" style="flex:0;min-width:70px;padding:4px 10px;font-size:12px" data-t="'+p.name+'">Test + Fix</button> <span id="tr-'+p.name+'"></span>':' — <a style="color:#90caf9" target="_blank" rel="noopener" href="'+(p.link.split(' ')[0])+'">key lo</a>')+'</div>').join('')
 +'<div class="row"><button class="b ai" id="testall">🩺 Sab check + theek karo</button></div>';
 document.querySelectorAll('#ks button[data-t]').forEach(b=>b.onclick=()=>testOne(b.dataset.t));
 $('testall').onclick=async()=>{say('⏳ Sab AI check ho rahe hain…');for(const b of document.querySelectorAll('#ks button[data-t]'))await testOne(b.dataset.t);say('✅ Check poora — jo ❌ hai uske aage wajah aur ilaaj likha hai');status()};
 document.querySelectorAll('#ks button[data-k]').forEach(b=>b.onclick=()=>removeKey(b.dataset.k))}catch(e){say('❌ '+e.message)}}
async function addKeys(){const t=$('kt').value;if(!t.trim())return say('Pehle keys paste karo');try{const j=await api('/api/keys',{method:'POST',body:JSON.stringify({text:t})});$('kt').value='';
 say(j.saved.length?'✅ Jud gaye: '+j.saved.join(', '):'Koi key pehchaan mein nahi aayi');
 $('amb').innerHTML=j.ambiguous.map(a=>'<div style="padding:8px;border:1px solid #444;border-radius:10px;margin:8px 0;font-size:13px">❓ '+a.masked+' — kis company ki hai? <select data-id="'+a.id+'" style="margin-top:6px;width:100%;padding:8px;background:#1c1c1c;color:#eee;border-radius:8px"><option value="">chuno…</option>'+j.choices.map(c=>'<option>'+c+'</option>').join('')+'</select></div>').join('');
 document.querySelectorAll('#amb select').forEach(sel=>sel.onchange=async()=>{if(!sel.value)return;try{await api('/api/keys/assign',{method:'POST',body:JSON.stringify({id:sel.dataset.id,name:sel.value})});sel.parentElement.remove();say('✅ '+sel.value+' jud gaya');keys();status()}catch(e){say('❌ '+e.message)}});
 keys();status()}catch(e){say('❌ '+e.message)}}
async function testOne(n){const el=$('tr-'+n);if(el)el.textContent='⏳';try{const r=await api('/api/test',{method:'POST',body:JSON.stringify({name:n})});
 if(el){el.textContent=r.ok?((r.fixed?'🔧 theek kiya + ':'')+'✅ chal raha ('+(r.ms/1000).toFixed(1)+'s)'+(r.action?' — '+r.action:'')):('❌ '+r.error);el.style.color=r.ok?'#aed581':'#ff8a80'}}catch(e){if(el)el.textContent='❌ '+e.message}}
async function removeKey(n){if(!confirm(n+' hataun?'))return;try{await api('/api/keys/remove',{method:'POST',body:JSON.stringify({name:n})});say('🗑️ '+n+' hata di');keys();status()}catch(e){say('❌ '+e.message)}}
async function status(){try{const j=await api('/api/status');$('st').textContent='Jude AI: '+j.providers.join(', ')+'\\nTools: '+(j.tools.join(', ')||'koi nahi')+'\\n\\nSeekh (yaad):\\n'+(j.yaad||'abhi kuch nahi')}catch(e){}}
async function save(){try{const j=await api('/api/dimaag',{method:'POST',body:JSON.stringify({text:$('t').value})});say(j.changed?'✅ Save ho gaya — purana version history mein hai':'Koi badlav nahi');load()}catch(e){say('❌ '+e.message)}}
async function improve(){const i=$('ins').value.trim();if(!i)return say('Pehle likho kya sudhaarna hai');say('⏳ AI soch raha hai…');try{const j=await api('/api/dimaag/improve',{method:'POST',body:JSON.stringify({instruction:i})});$('pt').value=j.proposal;$('prop').style.display='block';say('Naya version taiyaar — padh kar "Ye lagao" dabao')}catch(e){say('❌ '+e.message)}}
async function accept(){try{await api('/api/dimaag',{method:'POST',body:JSON.stringify({text:$('pt').value,note:'ai'})});hideProp();say('✅ Naya dimaag lag gaya');load()}catch(e){say('❌ '+e.message)}}
function hideProp(){$('prop').style.display='none'}
async function restore(v){if(!confirm('Ye version wapas lagaun?'))return;try{await api('/api/dimaag/restore',{method:'POST',body:JSON.stringify({name:v})});say('✅ Purana version wapas');load()}catch(e){say('❌ '+e.message)}}
async function resetIt(){if(!confirm('Shuruati script lagaun? (abhi wali history mein bachi rahegi)'))return;try{await api('/api/dimaag/reset',{method:'POST'});say('✅ Reset');load()}catch(e){say('❌ '+e.message)}}
const esc=t=>String(t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function bubble(role,text,by){const c=$('chat');if(c.querySelector('i'))c.innerHTML='';const d=document.createElement('div');d.className='m '+(role==='user'?'me':'bo');d.innerHTML=esc(text)+(by?'<div class="by">'+esc(by)+'</div>':'');c.appendChild(d);c.scrollTop=c.scrollHeight;return d}
async function loadChat(){try{const j=await api('/api/boss');if(j.messages.length){$('chat').innerHTML='';j.messages.forEach(m=>bubble(m.role,m.text,m.by))}}catch(e){}}
let busy=false;
async function talk(q){if(busy)return;const t=(q||$('bm').value).trim();if(!t)return;$('bm').value='';bubble('user',t);const w=bubble('boss','⏳ Boss soch raha hai… (free AI mein kabhi 1 minute tak)');busy=true;try{const j=await api('/api/boss',{method:'POST',body:JSON.stringify({message:t})});w.innerHTML=esc(j.reply)+'<div class="by">'+esc(j.by||'')+'</div>'}catch(e){w.textContent='❌ '+e.message}busy=false;$('chat').scrollTop=$('chat').scrollHeight}
async function clearChat(){if(!confirm('Saari baatcheet mitaun?'))return;try{await api('/api/boss/clear',{method:'POST'});$('chat').innerHTML='<i style="color:#888">Saaf. Naya kuch poocho.</i>'}catch(e){}}
loadChat();
</script></body></html>`;

function readJson(req) {
    return new Promise((resolve, reject) => {
        let b = '';
        req.on('data', (c) => { b += c; if (b.length > 200000) { reject(new Error('bahut bada')); req.destroy(); } });
        req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('galat JSON')); } });
    });
}

function createPanel({ token = crypto.randomBytes(16).toString('hex'), getAi, status } = {}) {
    const k = require('./keys.cjs');
    const pending = new Map(); // id -> key, for keys whose company the owner must pick (kept in memory only)
    const server = http.createServer(async (req, res) => {
        const send = (code, obj, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj); };
        try {
            const url = new URL(req.url, 'http://local');
            if (req.method === 'GET' && url.pathname === '/') {
                if (url.searchParams.get('t') !== token) return send(403, 'Link mein sahi token chahiye — Termux mein dikha poora link kholo.', 'text/plain; charset=utf-8');
                return send(200, PAGE(token), 'text/html; charset=utf-8');
            }
            if (req.headers['x-panel-token'] !== token) return send(403, { error: 'token galat' });
            if (req.method === 'GET' && url.pathname === '/api/dimaag') return send(200, { text: dimaag.read(), history: dimaag.history() });
            if (req.method === 'GET' && url.pathname === '/api/keys') {
                const saved = Object.entries(k.readFileKeys()).map(([name, v]) => ({ name, masked: k.mask(v) }));
                const { listProviders } = require('./providers.cjs');
                return send(200, { saved, providers: listProviders().map((p) => ({ name: p.name, region: p.region, free: p.free, connected: p.connected, link: p.link })) });
            }
            if (req.method === 'GET' && url.pathname === '/api/boss') return send(200, { messages: require('./boss.cjs').history(60) });
            if (req.method === 'GET' && url.pathname === '/api/status') return send(200, status ? await status() : { providers: [], tools: [], yaad: '' });
            if (req.method !== 'POST') return send(404, { error: 'nahi mila' });
            const body = await readJson(req);
            if (url.pathname === '/api/dimaag') return send(200, dimaag.write(body.text, body.note || 'panel'));
            if (url.pathname === '/api/dimaag/restore') return send(200, dimaag.restore(body.name));
            if (url.pathname === '/api/dimaag/reset') return send(200, dimaag.reset());
            if (url.pathname === '/api/keys') {
                const found = k.splitPasted(String(body.text || ''));
                const saved = k.readFileKeys();
                const added = [];
                const ambiguous = [];
                for (const item of found) {
                    const name = item.name || k.detect(item.key);
                    if (name && /^[A-Z][A-Z0-9_]{1,60}$/.test(name)) { saved[name] = item.key; added.push(name); }
                    else { const id = crypto.randomBytes(6).toString('hex'); pending.set(id, item.key); ambiguous.push({ id, masked: k.mask(item.key) }); }
                }
                if (added.length) k.writeFileKeys(saved);
                return send(200, { saved: added, ambiguous, choices: k.AMBIGUOUS_CHOICES });
            }
            if (url.pathname === '/api/keys/assign') {
                const key = pending.get(String(body.id));
                if (!key) return send(400, { error: 'Ye key ab yaad nahi — dobara paste karo' });
                if (!k.AMBIGUOUS_CHOICES.includes(body.name)) return send(400, { error: 'Galat naam' });
                const saved = k.readFileKeys();
                saved[body.name] = key;
                k.writeFileKeys(saved);
                pending.delete(String(body.id));
                return send(200, { ok: true });
            }
            if (url.pathname === '/api/test') {
                const { testProvider } = require('./providers.cjs');
                return send(200, await testProvider(String(body.name || '')));
            }
            if (url.pathname === '/api/keys/remove') {
                const saved = k.readFileKeys();
                if (!saved[body.name]) return send(404, { error: 'Ye key save nahi thi' });
                delete saved[body.name];
                k.writeFileKeys(saved);
                return send(200, { ok: true });
            }
            if (url.pathname === '/api/boss') return send(200, await require('./boss.cjs').reply(getAi(), body.message));
            if (url.pathname === '/api/boss/clear') { require('./boss.cjs').clear(); return send(200, { ok: true }); }
            if (url.pathname === '/api/dimaag/improve') {
                if (!String(body.instruction || '').trim()) return send(400, { error: 'instruction chahiye' });
                return send(200, { proposal: await dimaag.improve(getAi(), String(body.instruction)) });
            }
            return send(404, { error: 'nahi mila' });
        } catch (error) {
            return send(500, { error: error.message });
        }
    });
    return { server, token };
}

module.exports = { createPanel };

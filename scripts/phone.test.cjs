// Phone/ADB with a fake adb: info, protected refusal, backup-first log, auto-undo on bad health, sab-wapas.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-'));
  process.env.ARJUN_AI_HOME = tmp;
  const state = path.join(tmp, 'state.json'); fs.writeFileSync(state, JSON.stringify({ disabled: [], boot: '1', calls: [] }));
  const fake = path.join(tmp, 'adb');
  fs.writeFileSync(fake, `#!${process.execPath}
const fs=require('fs');const st=JSON.parse(fs.readFileSync(${JSON.stringify(state)}));const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(state + '.calls')},a.join(' ')+'\\n');
let dirty=false;const out=(s)=>{if(dirty){const t=${JSON.stringify(state)}+'.'+process.pid;fs.writeFileSync(t,JSON.stringify(st));fs.renameSync(t,${JSON.stringify(state)});}process.stdout.write(s+'\\n')};
const pk=['com.example.game','com.android.systemui','com.vendor.bloat','com.termux'];
if(a[0]!=='shell')return out('');
const c=a.slice(1).join(' ');
if(c==='getprop sys.boot_completed')return out(st.boot);
if(c.startsWith('getprop ro.product.model'))return out('Pixel Test');
if(c.startsWith('getprop ro.soc.model'))return out('SM8650');
if(c.startsWith('getprop'))return out('x');
if(c==='cat /proc/meminfo')return out('MemTotal:        8000000 kB');
if(c==='dumpsys battery')return out('  level: 77');
if(c.startsWith('df'))return out('/dev/x 100G 40G 60G 40% /data');
if(c==='pm list packages -3')return out('package:com.example.game');
if(c==='pm list packages -d')return out(st.disabled.map(p=>'package:'+p).join('\\n'));
if(c.startsWith('pm list packages '))return out(pk.filter(p=>p.includes(a[a.length-1])).map(p=>'package:'+p).join('\\n'));
if(c==='pm list packages')return out(pk.map(p=>'package:'+p).join('\\n'));
if(a[1]==='pm'&&a[2]==='disable-user'){dirty=true;st.disabled.push(a[5]);if(a[5]==='com.vendor.bloat')st.boot='0';return out('disabled');}
if(a[1]==='pm'&&a[2]==='enable'){dirty=true;st.disabled=st.disabled.filter(p=>p!==a[3]);st.boot='1';return out('enabled');}
out('');`);
  fs.chmodSync(fake, 0o755); process.env.ARJUN_ADB = fake;
  const ph = require('./phone.cjs');
  const info = await ph.info(); assert.match(info, /Pixel Test/); assert.match(info, /SM8650/); assert.match(info, /7\.6 GB/); assert.match(info, /77%/);
  assert.match(await ph.apps(), /🔒 com\.android\.systemui/);
  await assert.rejects(ph.halka('com.android.systemui'), /zaroori/);           // protected
  await assert.rejects(ph.halka('com.termux'), /zaroori/);
  await assert.rejects(ph.halka('com.not.there'), /nahi mila/);
  await assert.rejects(ph.halka('bad name; rm -rf'), /Package/);
  assert.match(await ph.halka('com.example.game'), /band ho gaya/);
  const log = JSON.parse(fs.readFileSync(path.join(tmp, 'phone-changes.json'), 'utf8'));
  assert.equal(log[0].pkg, 'com.example.game');                                // recorded
  await assert.rejects(ph.halka('com.vendor.bloat'), /wapas chalu kar diya/);    // health check failed -> undone
  let st = JSON.parse(fs.readFileSync(state, 'utf8'));
  assert.deepEqual(st.disabled, ['com.example.game']);
  assert.match(await ph.sabWapas(), /com\.example\.game wapas chalu/);
  st = JSON.parse(fs.readFileSync(state, 'utf8')); assert.deepEqual(st.disabled, []);
  assert.ok(!fs.readFileSync(state + '.calls', 'utf8').includes(' uninstall '));                      // never deletes apps
  console.log('PHONE TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

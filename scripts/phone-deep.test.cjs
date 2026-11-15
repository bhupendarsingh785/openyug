// Deep phone changes with Arjun's loop: copy → change → check → restore. Fake adb, no real phone touched.
process.env.ARJUN_AI_HOME = process.env.ARJUN_AI_HOME_ISOLATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'iso-'));
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const tmp = process.env.ARJUN_AI_HOME;
  const state = path.join(tmp, 'st.json');
  fs.writeFileSync(state, JSON.stringify({ boot: '1', settings: { global: { animator_duration_scale: '1.0', window_animation_scale: '1.0' }, secure: { a: '1' }, system: { font_scale: '1.0', screen_brightness: '128' } }, removed: [] }));
  const fake = path.join(tmp, 'adb');
  fs.writeFileSync(fake, `#!${process.execPath}
const fs=require('fs');const F=${JSON.stringify(state)};const st=JSON.parse(fs.readFileSync(F));const a=process.argv.slice(2);
const save=()=>{const t=F+'.'+process.pid;fs.writeFileSync(t,JSON.stringify(st));fs.renameSync(t,F)};const out=s=>process.stdout.write(s+'\\n');
const pk=['com.vendor.bloat','com.vendor.evil','com.android.systemui','android'];
if(a[0]!=='shell')return out('');const c=a.slice(1);
if(c[0]==='getprop'&&c[1]==='sys.boot_completed')return out(st.boot);
if(c[0]==='settings'&&c[1]==='list')return out(Object.entries(st.settings[c[2]]).map(([k,v])=>k+'='+v).join('\\n'));
if(c[0]==='settings'&&c[1]==='get')return out(st.settings[c[2]][c[3]]??'null');
if(c[0]==='settings'&&c[1]==='put'){st.settings[c[2]][c[3]]=c[4];if(c[3]==='break_me')st.boot=c[4]==='1'?'0':'1';save();return out('')}
if(c[0]==='settings'&&c[1]==='delete'){delete st.settings[c[2]][c[3]];if(c[3]==='break_me')st.boot='1';save();return out('')}
if(c[0]==='pm'&&c[1]==='path'){const p=c[2];if(p==='android')return out('package:/system/framework/framework-res.apk');return out(pk.includes(p)&&!st.removed.includes(p)?'package:/system/app/'+p+'.apk':'')}
if(c[0]==='pm'&&c[1]==='uninstall'){st.removed.push(c[5]);if(c[5]==='com.vendor.evil')st.boot='0';save();return out('Success')}
if(c[0]==='cmd'&&c[1]==='package'&&c[2]==='install-existing'){st.removed=st.removed.filter(p=>p!==c[3]);st.boot='1';save();return out('installed')}
out('');`);
  fs.chmodSync(fake, 0o755); process.env.ARJUN_ADB = fake;
  const ph = require('./phone.cjs');
  const read = () => JSON.parse(fs.readFileSync(state, 'utf8'));
  // 1) normal setting change: copy first, then change
  assert.match(await ph.setSetting('global', 'animator_duration_scale', '0.5'), /1\.0" → "0\.5/);
  assert.equal(read().settings.global.animator_duration_scale, '0.5');
  assert.ok(fs.readdirSync(path.join(tmp, 'phone-backups')).length >= 1);
  // 2) a change that breaks the phone → old value put back automatically
  await assert.rejects(ph.setSetting('system', 'break_me', '1'), /wapas laga di/);
  assert.equal(read().boot, '1'); assert.equal(read().settings.system.break_me, undefined);
  // 3) protected settings refused
  await assert.rejects(ph.setSetting('global', 'adb_enabled', '0'), /zaroori/);
  await assert.rejects(ph.setSetting('evil', 'x', '1'), /Namespace/);
  // 4) restore everything from the first backup
  const first = fs.readdirSync(path.join(tmp, 'phone-backups')).sort()[0];
  await ph.settingsRestore(path.join(tmp, 'phone-backups', first));
  assert.equal(read().settings.global.animator_duration_scale, '1.0');
  // 5) system app removed for user only, comes back; one that breaks the phone is auto-restored
  assert.match(await ph.hatao('com.vendor.bloat'), /hata diya/); assert.deepEqual(read().removed, ['com.vendor.bloat']);
  await assert.rejects(ph.hatao('com.vendor.evil'), /wapas laga diya/); assert.deepEqual(read().removed, ['com.vendor.bloat']); assert.equal(read().boot, '1');
  await assert.rejects(ph.hatao('com.android.systemui'), /zaroori/);
  assert.match(await ph.sabWapas(), /com\.vendor\.bloat wapas aa gaya/); assert.deepEqual(read().removed, []);
  console.log('PHONE DEEP TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

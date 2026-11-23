'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('../lib/store');
test('guest usage counters are idempotent, isolated from members and contain no document/customer data',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-usage-'));
 const dbFile=path.join(dir,'metrics.sqlite'),key='ab'.repeat(32),db=createStore(dbFile,key);
 const origin='http://127.0.0.1:19913';
 const session='test-admin-usage-token';
 db.run('INSERT INTO admins(id,username,salt,password,role) VALUES(?,?,?,?,?)','owner','owner','test-salt','unused','owner');
 db.run('INSERT INTO sessions(hash,actor,kind,role,csrf,expires,created) VALUES(?,?,?,?,?,?,?)',
  db.hash(session),'owner','admin','owner','',Date.now()+600000,Date.now());
 const child=cp.spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),
  env:{...process.env,APP_MODE:'test',PORT:'19913',PUBLIC_ORIGIN:origin,DATA_FILE:dbFile,DATA_KEY_HEX:key,
   ONEBIZ_GUEST_USAGE_ENABLED:'true',ONEBIZ_GUEST_SIGN_ENABLED:'false',DOCUMENT_TRACKING_POLL_ENABLED:'false'},stdio:'pipe'});
 t.after(()=>{child.kill('SIGTERM');db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
 let ready=false;
 for(let i=0;i<80;i++){await new Promise(resolve=>setTimeout(resolve,60));
  try{if((await fetch(origin+'/health')).ok){ready=true;break}}catch{}
 }
 assert.ok(ready,'test server startup');
 const token1=crypto.randomBytes(32).toString('base64url'),token2=crypto.randomBytes(32).toString('base64url'),
 token3=crypto.randomBytes(32).toString('base64url');
 const counts={customers:3,quotes:4,contracts:2,signed:1,employees:0};
 async function sync(token,payload={counts},headers={}){
  const r=await fetch(origin+'/api/guest-usage/sync',{method:'POST',headers:{
   'Content-Type':'application/json','X-Onebiz-Client':'android','X-Onebiz-Guest-Usage-Key':token,...headers
  },body:JSON.stringify(payload)});
  return {status:r.status,body:await r.json()};
 }
 async function dashboard(){
  const r=await fetch(origin+'/api/admin/dashboard',{headers:{Authorization:'Bearer '+session}});
  assert.equal(r.status,200);return r.json();
 }
 assert.equal((await sync('bad')).status,401);
 assert.equal((await sync(token1,{counts:{...counts,extra:99}})).status,400);
 assert.equal((await sync(token1,{counts:{...counts,signed:3}})).status,400);
 assert.equal((await sync(token1,{counts}, {'X-Onebiz-Client':'web'})).status,403);
 assert.equal((await sync(token1,{counts}, {Origin:'https://evil.example'})).status,403);
 assert.equal((await sync(token1)).status,200);
 assert.equal((await sync(token1)).status,200);
 let d=await dashboard();
 assert.equal(d.users,0,'no member account must be created');
 assert.equal(d.guestUsage.devices,0,'legacy debug clients are not production');
 assert.equal(d.testUsage.devices,1,'repeat sync is not a new device');
 assert.equal(d.testUsage.counts.quotes,4);
 assert.equal(d.testUsage.counts.signed,1);
 assert.equal(d.counts.quotes||0,0,'member counters remain separate');
 assert.equal((await sync(token1,{counts:{...counts,quotes:5,contracts:3}})).status,200);
 assert.equal((await sync(token2,{counts:{...counts,quotes:1,contracts:1,signed:0}})).status,200);
 d=await dashboard();
 assert.equal(d.testUsage.devices,2);
 assert.equal(d.testUsage.counts.quotes,6);
 assert.equal(d.testUsage.counts.contracts,4);
 assert.equal(d.testUsage.counts.signed,1);
 assert.equal((await sync(token3,{counts:{...counts,quotes:7,contracts:4,signed:2},channel:'production'})).status,200);
 assert.equal((await sync(token1,{counts,channel:'production'})).status,200,'legacy device cannot switch cohorts');
 assert.equal((await sync(token3,{counts,channel:'unknown'})).status,400);
 d=await dashboard();
 assert.equal(d.guestUsage.devices,1);
 assert.equal(d.guestUsage.counts.quotes,7);
 assert.equal(d.testUsage.devices,2);
 assert.equal(d.testUsage.counts.quotes,5);
 assert.equal(db.one('SELECT COUNT(*) n FROM users').n,0);
 const stored=db.all('SELECT device_hash,counts FROM guest_usage_counters');
 assert.equal(stored.length,3);
 for(const row of stored){
  assert.ok(!row.device_hash.includes(token1)&&!row.device_hash.includes(token2));
  assert.deepEqual(Object.keys(JSON.parse(row.counts)).sort(),['contracts','customers','employees','quotes','signed']);
 }
});

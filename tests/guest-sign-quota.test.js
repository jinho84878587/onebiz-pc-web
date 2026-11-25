'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('../lib/store');
test('frequent signed-status polling cannot exhaust new-link requests; create limit still applies', async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-sign-quota-'));
 const dbFile=path.join(home,'test.sqlite'),key='6f'.repeat(32),port=19878,base='http://127.0.0.1:'+port;
 const db=createStore(dbFile,key);
 const child=cp.spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{
  ...process.env,APP_MODE:'test',PORT:String(port),PUBLIC_ORIGIN:base,DATA_FILE:dbFile,DATA_KEY_HEX:key,
  ONEBIZ_GUEST_SIGN_ENABLED:'true',ONEBIZ_GUEST_SIGN_SELFHOSTED:'true',
  SOLAPI_SEND_ENABLED:'false',SOLAPI_GUEST_SEND_ENABLED:'false',
  DOCUMENT_TRACKING_POLL_ENABLED:'false'
 },stdio:'pipe'});
 t.after(()=>{child.kill('SIGTERM');db.db.close();fs.rmSync(home,{recursive:true,force:true})});
 let ready=false;
 for(let i=0;i<80;i++){await new Promise(resolve=>setTimeout(resolve,75));try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}}
 assert.ok(ready,'server must start');
 const secret=crypto.randomBytes(32).toString('base64url');
 const contract=n=>({
  id:'C-2026-'+String(92000+n),quoteId:'Q-2026-'+String(92000+n),customer:'시험 고객',phone:'01012345678',
  amount:320000,item:'시험 설치',contractDate:'2026-11-25',contractType:'공사·설치',
  standardTerms:'표준 원문',specialTerms:'시험 특약',supplier:{businessName:'시험 업체'}
 });
 async function request(endpoint,n){
  const response=await fetch(base+'/api/guest-sign/'+endpoint,{method:'POST',
   headers:{'Content-Type':'application/json','X-Onebiz-Client':'android','X-Onebiz-Guest-Sign-Key':secret},
   body:JSON.stringify({contract:contract(n),confirm:true})});
  return {status:response.status,json:await response.json()};
 }
 for(let i=0;i<25;i++){
  const r=await request('status',0);
  assert.equal(r.status,200,'background status poll '+i+' must not be throttled');
 }
 const first=await request('link',0);
 assert.equal(first.status,200,'first link after 25 status polls should still work');
 assert.ok(first.json.signUrl.includes('/sign/'));
 for(let i=1;i<8;i++)assert.equal((await request('link',i)).status,200,'within 8 new links per device');
 assert.equal((await request('link',8)).status,429,'9th distinct link must be throttled');
 assert.equal((await request('status',0)).status,200,'status poll must remain available after link throttling');
});

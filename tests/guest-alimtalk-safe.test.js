'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {createStore}=require('../lib/store');
test('guest Alimtalk remains blocked without explicit operator approval; opaque short URL works',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-alim-'));
 const key='5a'.repeat(32),file=path.join(folder,'db.sqlite'),origin='http://127.0.0.1:19939';
 const store=createStore(file,key),secret=crypto.randomBytes(32).toString('base64url');
 const child=cp.spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),
  env:{...process.env,APP_MODE:'test',PORT:'19939',PUBLIC_ORIGIN:origin,DATA_FILE:file,DATA_KEY_HEX:key,
   ONEBIZ_GUEST_SIGN_ENABLED:'true',ONEBIZ_GUEST_SIGN_SELFHOSTED:'true',
   ONEBIZ_GUEST_ALIMTALK_ENABLED:'false',SOLAPI_GUEST_SEND_ENABLED:'false',SOLAPI_SEND_ENABLED:'false',
   DOCUMENT_TRACKING_POLL_ENABLED:'false'},stdio:'pipe'});
 t.after(()=>{child.kill('SIGTERM');store.db.close();fs.rmSync(folder,{recursive:true,force:true});});
 let ready=false;
 for(let i=0;i<80;i++){await new Promise(resolve=>setTimeout(resolve,80));try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}}
 assert.ok(ready,'server ready');
 const contract={id:'C-2026-99100',quoteId:'Q-2026-99100',customer:'시험 고객',phone:'01012345678',amount:120000,
  contractDate:'2026-11-24',workDate:'2026-12-02',item:'시험 장비',specialTerms:'원문 특약',
  standardTerms:'제1조 원문 계약조건',signed:false,
  supplier:{businessName:'시험 업체',representative:'공급자',phone:'01055554444'}};
 async function req(route,data,token=secret){
  const r=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',
   'X-Onebiz-Client':'android','X-Onebiz-Guest-Sign-Key':token},body:JSON.stringify(data)});
  return {status:r.status,body:await r.json()};
 }
 const created=await req('/api/guest-sign/link',{contract,confirm:true});
 assert.equal(created.status,200,JSON.stringify(created.body));
 const signUrl=created.body.signUrl;
 const original=new URL(signUrl),token=original.searchParams.get('token');
 assert.ok(token&&token.length===43);
 const short=await fetch(origin+'/gs/'+token,{redirect:'manual'});
 assert.equal(short.status,302);
 assert.equal(short.headers.get('location'),signUrl);
 assert.ok(!short.headers.get('location').includes('other-service'));
 const preview=await req('/api/guest-alimtalk/contract/preview',{contractId:contract.id});
 assert.equal(preview.status,200,JSON.stringify(preview.body));
 assert.equal(preview.body.dryRun,true);
 assert.equal(preview.body.sendEnabled,false);
 assert.equal(preview.body.maskedTo,'010-****-5678');
 const send=await req('/api/guest-alimtalk/contract/send',{contractId:contract.id,confirm:true});
 assert.equal(send.status,503,'unauthorized sending must be disabled');
 const outsider=await req('/api/guest-alimtalk/contract/preview',{contractId:contract.id},crypto.randomBytes(32).toString('base64url'));
 assert.equal(outsider.status,404);
 assert.equal(store.one('SELECT COUNT(*) n FROM alimtalk_logs').n,0,'provider sends must not occur');
});

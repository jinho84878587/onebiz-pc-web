'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function availablePort(){
 const s=net.createServer(); await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;
}
test('local-only no-login document API: ownership, grants, edit/revoke and one-time action', {timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-guest-api-'));
 const port=await availablePort(),root='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,APP_MODE:'test',ONEBIZ_GUEST_DOCUMENT_DEV_API:'true',
    PORT:String(port),DATA_FILE:path.join(dir,'test.sqlite'),DATA_KEY_HEX:'11'.repeat(32)},
  stdio:['ignore','pipe','pipe']
 });
 t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM'); await pause(100);fs.rmSync(dir,{recursive:true,force:true});});
 let ready=false;
 for(let i=0;i<80;i++){try{const r=await fetch(root+'/health');if(r.ok){ready=true;break;}}catch{}await pause(100);}
 assert.equal(ready,true,'Test server did not start');
 const post=async(action,payload)=>{
  const response=await fetch(root+'/api/guest-dev/'+action,{
   method:'POST',headers:{'content-type':'application/json','x-onebiz-client':'android'},
   body:JSON.stringify(payload||{})
  });
  return {status:response.status,...await response.json()};
 };
 const secret=crypto.randomBytes(32).toString('base64url'),fp='a'.repeat(64),next='b'.repeat(64);
 const registered=await post('register',{secret,fingerprint:fp});
 assert.equal(registered.status,201);
 assert.match(registered.documentId,/^[a-f0-9-]{36}$/);
 const bad=await post('grant',{documentId:registered.documentId,ownerSecret:crypto.randomBytes(32).toString('base64url'),
  scope:'alimtalk.send',confirm:true});
 assert.equal(bad.status,403);
 const first=await post('grant',{documentId:registered.documentId,ownerSecret:secret,scope:'alimtalk.send',confirm:true});
 assert.equal(first.status,200);
 assert.equal((await post('validate',{documentId:registered.documentId,token:first.token,scope:'alimtalk.send'})).valid,true);
 assert.equal((await post('consume-test',{documentId:registered.documentId,token:first.token,scope:'alimtalk.send'})).consumed,true);
 assert.equal((await post('consume-test',{documentId:registered.documentId,token:first.token,scope:'alimtalk.send'})).consumed,false);
 const stale=await post('grant',{documentId:registered.documentId,ownerSecret:secret,scope:'sign.request',confirm:true});
 assert.equal(stale.status,200);
 assert.equal((await post('rotate',{documentId:registered.documentId,ownerSecret:secret,expectedFingerprint:fp,nextFingerprint:next})).status,200);
 assert.equal((await post('validate',{documentId:registered.documentId,token:stale.token,scope:'sign.request'})).valid,false);
 assert.equal((await post('revoke',{documentId:registered.documentId,ownerSecret:secret})).status,200);
 const denied=await post('grant',{documentId:registered.documentId,ownerSecret:secret,scope:'sign.request',confirm:true});
 assert.equal(denied.status,403);
 const isolatedOwner=crypto.randomBytes(32).toString('base64url');
 const uploaded=await post('document',{ownerSecret:isolatedOwner,consent:true,
  contract:{customer:'가상 고객',phone:'01012345678',item:'에어컨 시공',amount:4900000}});
 assert.equal(uploaded.status,201);
 const blocked=await post('grant',{documentId:uploaded.documentId,ownerSecret:crypto.randomBytes(32).toString('base64url'),
  scope:'sign.request',confirm:true});
 assert.equal(blocked.status,403);
 const permission=await post('grant',{documentId:uploaded.documentId,ownerSecret:isolatedOwner,
  scope:'sign.request',confirm:true});
 assert.equal(permission.status,200);
 const sent=await post('dispatch-test',{documentId:uploaded.documentId,scope:'sign.request',token:permission.token});
 assert.equal(sent.ok,true);assert.equal(sent.dryRun,true);
 const duplicate=await post('dispatch-test',{documentId:uploaded.documentId,scope:'sign.request',token:permission.token});
 assert.equal(duplicate.ok,false);assert.equal(duplicate.code,'not_authorized');
});
test('guest API remains off by default in a local/test server', {timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-guest-off-'));
 const port=await availablePort(),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,APP_MODE:'test',ONEBIZ_GUEST_DOCUMENT_DEV_API:'false',
   PORT:String(port),DATA_FILE:path.join(dir,'test.sqlite'),DATA_KEY_HEX:'11'.repeat(32)},
  stdio:['ignore','pipe','pipe']
 });
 t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');await pause(100);fs.rmSync(dir,{recursive:true,force:true});});
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await pause(100);}
 assert.equal(ready,true);
 const response=await fetch(base+'/api/guest-dev/register',{method:'POST',
 headers:{'content-type':'application/json','x-onebiz-client':'android'},body:'{}'});
 assert.equal(response.status,404);
});

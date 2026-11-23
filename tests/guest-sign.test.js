'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {createStore}=require('../lib/store');

test('게스트 전자서명: 기기 분리, 동의, 내용 변경 차단, 서명 원본 암호화 저장',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-guest-sign-'));
 const dbFile=path.join(dir,'guest.sqlite'),dbKey='55'.repeat(32);
 const store=createStore(dbFile,dbKey);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9SAAAAAASUVORK5CYII=';
 let signed=false,created=0,statusCalls=0,receiptCalls=0;
 const mock=http.createServer(async(req,res)=>{
  let body='';
  for await(const part of req)body+=part;
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='POST'&&req.url==='/api/contracts'){
   const data=JSON.parse(body);assert.match(data.id,/^ob-[a-f0-9]{40}$/);
   created++;return json(200,{signUrl:'https://hiwon-websign-server.onrender.com/sign/'+data.id+'?token='+'t'.repeat(48)});
  }
  if(req.method==='GET'&&/^\/api\/contracts\/ob-[a-f0-9]{40}\/status$/.test(req.url)){
   statusCalls++;return json(200,{status:signed?'signed':'pending',signerName:'테스트 서명자',identityStatus:'전자서명 완료',signedAt:'2026-11-20T05:00:00Z'});
  }
  if(req.method==='GET'&&/^\/receipt\/ob-[a-f0-9]{40}\?token=/.test(req.url)){
   receiptCalls++;res.writeHead(200,{'Content-Type':'text/html'});return res.end('<html><img src="'+png+'"></html>');
  }
  return json(404,{error:'unknown'});
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const mockPort=mock.address().port;
 const preload=path.join(dir,'mock-fetch.js');
 fs.writeFileSync(preload,
  "const real=global.fetch;global.fetch=(url,init)=>{const u=new URL(url);return real(u.hostname==='hiwon-websign-server.onrender.com'?'http://127.0.0.1:"+mockPort+"'+u.pathname+u.search:url,init);};");
 const port=19947;
 const origin='http://127.0.0.1:'+port;
 const server=cp.spawn(process.execPath,['--require',preload,'server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,APP_MODE:'test',PORT:String(port),PUBLIC_ORIGIN:origin,
   DATA_FILE:dbFile,DATA_KEY_HEX:dbKey,ONEBIZ_GUEST_SIGN_ENABLED:'true',HIWON_SIGN_APP_KEY:'test-only-key'},
  stdio:'pipe'
 });
 t.after(()=>{server.kill('SIGTERM');mock.close();store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
 let ready=false;
 for(let i=0;i<80;i++){
  await new Promise(r=>setTimeout(r,50));
  try{const r=await fetch(origin+'/health');if(r.ok){ready=true;break;}}catch{}
 }
 assert.ok(ready,'test server must start');
 const k1=crypto.randomBytes(32).toString('base64url'),k2=crypto.randomBytes(32).toString('base64url');
 const contract={id:'C-2026-9001',customer:'테스트 고객',phone:'01012345678',
  amount:250000,standardTerms:'보존할 약관',specialTerms:'보존할 특약',signed:false};
 async function request(route,key,contractData=contract,confirm=true,extraHeaders={}){
  const r=await fetch(origin+route,{method:'POST',headers:{
   'Content-Type':'application/json','X-Onebiz-Client':'android',
   'X-Onebiz-Guest-Sign-Key':key,...extraHeaders
  },body:JSON.stringify({contract:contractData,confirm})});
  return {status:r.status,body:await r.json()};
 }
 assert.equal((await request('/api/guest-sign/link','invalid')).status,401);
 assert.equal((await request('/api/guest-sign/link',k1,contract,false)).status,400);
 assert.equal((await request('/api/guest-sign/link',k1,contract,true,{Origin:'https://unauthorized.example'})).status,403);
 const made=await request('/api/guest-sign/link',k1);
 assert.equal(made.status,200,JSON.stringify(made.body));
 assert.match(made.body.signUrl,/^https:\/\/hiwon-websign-server\.onrender\.com\/sign\/ob-/);
 assert.equal(created,1);
 const archived=store.one('SELECT * FROM guest_sign_links WHERE contract_id=?',contract.id);
 assert.ok(archived);
 assert.ok(!archived.contract_body.includes('보존할 특약'));
 assert.ok(!archived.sign_url.includes('/sign/'));
 assert.equal((await request('/api/guest-sign/status',k2)).body.exists,false);
 assert.equal((await request('/api/guest-sign/status',k1)).body.signed,false);
 assert.equal((await request('/api/guest-sign/link',k1,{...contract,amount:300000})).status,409);
 signed=true;
 const complete=await request('/api/guest-sign/status',k1);
 assert.equal(complete.status,200,JSON.stringify(complete.body));
 assert.equal(complete.body.signed,true);
 assert.equal(complete.body.signatureName,'테스트 서명자');
 const final=store.one('SELECT * FROM guest_sign_links WHERE contract_id=?',contract.id);
 assert.ok(!final.signed_info.includes(png));
 assert.equal(store.open(final.signed_info).signatureDataUrl,png);
 assert.equal(receiptCalls,1);
 assert.equal((await request('/api/guest-sign/status',k1)).body.signed,true);
 assert.equal(receiptCalls,1,'cached original must not be fetched again');
 assert.equal(created,1,'re-check must not create duplicate signing requests');
});

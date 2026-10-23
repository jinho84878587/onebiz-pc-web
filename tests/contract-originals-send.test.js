'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../lib/store'),websign=require('../lib/websign-bridge');
test('완료 알림톡 사전확인·접수 실패 취소·정상 원본 연결·재발송 제한',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-original-send-')),file=path.join(dir,'db.sqlite'),key='44'.repeat(32),s=createStore(file,key),now=Date.now();
 let fail=true,remoteSigned=true;const sent=[];
 const mock=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/kakao/v2/templates/sendable')return res.end(JSON.stringify([{templateId:'DONE',channelId:'approved_channel',content:'#{고객명} #{업체명} #{계약금액}',buttons:[{linkMo:'http://127.0.0.1:19889/contract/#{계약서토큰}',linkPc:'http://127.0.0.1:19889/contract/#{계약서토큰}'}]}]));
  if(req.url.endsWith('/status'))return res.end(JSON.stringify({status:remoteSigned?'signed':'pending'}));
  if(req.url==='/messages/v4/send-many/detail'){
   let raw='';for await(const c of req)raw+=c;sent.push(JSON.parse(raw));
   return res.end(JSON.stringify({groupInfo:{count:{registeredSuccess:fail?0:1,registeredFailed:fail?1:0}},failedMessageList:fail?[{statusCode:'1048',statusMessage:'provider reject'}]:[]}));
  }
  res.statusCode=404;res.end('{}');
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const mockPort=mock.address().port,origin='http://127.0.0.1:19889',url=websign.BASE+'/sign/'+'o'.repeat(180),c={id:'C-DONE',customer:'고객',phone:'01000000051',amount:250000,signed:true,signatureMethod:'카카오톡 웹서명',signedAt:'2026-10-23T05:30:58Z'};
 s.run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)','owner',s.seal({businessName:'업체'}),'{}',now,now);
 s.run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',s.hash('test-bearer'),'owner','user','owner','',now+600000,now);
 s.run('INSERT INTO snapshots VALUES(?,?,?,?,?)','owner',1,s.seal({data:{contracts:[c]}}),'{}',now);
 const digest=websign.fingerprint(c,'owner');s.run('INSERT INTO websign_links VALUES(?,?,?,?,?,?)','owner',c.id,websign.providerId('owner',c.id,digest),s.seal(url),digest,now);
 const preload=path.join(dir,'mock-fetch.js');fs.writeFileSync(preload,`const real=global.fetch;global.fetch=(url,init)=>{const u=new URL(url);return real(['api.solapi.com','hiwon-websign-server.onrender.com'].includes(u.hostname)?'http://127.0.0.1:${mockPort}'+u.pathname+u.search:url,init)};`);
 const child=cp.spawn(process.execPath,['--require',preload,'server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,APP_MODE:'test',PORT:'19889',PUBLIC_ORIGIN:origin,DATA_FILE:file,DATA_KEY_HEX:key,HIWON_SIGN_APP_KEY:'test-only',SOLAPI_API_KEY:'test-only',SOLAPI_API_SECRET:'test-only',SOLAPI_PFID:'legacy_channel',SOLAPI_TEMPLATE_CONTRACT_DONE:'DONE',SOLAPI_SEND_ENABLED:'true',SOLAPI_MEMBER_SEND_ENABLED:'true'},stdio:'pipe'});
 t.after(()=>{child.kill('SIGTERM');mock.close();s.db.close();});
 let ready=false;for(let n=0;n<60;n++){await new Promise(r=>setTimeout(r,50));try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}}
 assert.ok(ready,'server started');
 async function request(p,data){const r=await fetch(origin+p,{method:'POST',headers:{'Content-Type':'application/json','X-Onebiz-Client':'android',Authorization:'Bearer test-bearer'},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};}
 const base='/api/alimtalk/customer/contract/completed';
 assert.equal((await request(base+'/preview',{contractId:c.id})).body.dryRun,true);assert.equal(sent.length,0);assert.equal(s.one('SELECT count(*) n FROM signed_contract_links').n,0);
 assert.equal((await request(base+'/send',{contractId:c.id})).status,400);
 const failed=await request(base+'/send',{contractId:c.id,confirm:true});assert.equal(failed.status,502);assert.ok(failed.body.error.includes('1048'));assert.equal(s.one('SELECT count(*) n FROM signed_contract_links').n,0);
 fail=false;
 const concurrent=await Promise.all([request(base+'/send',{contractId:c.id,confirm:true,to:'01099999999',signUrl:'https://evil.example/'}),request(base+'/send',{contractId:c.id,confirm:true})]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,429]);assert.equal(concurrent.find(r=>r.status===200).body.accepted,true);
 const options=sent[1].messages[0].kakaoOptions;assert.equal(options.pfId,'approved_channel');assert.equal(sent[1].messages[0].to,c.phone);assert.equal(options.disableSms,true);
 const token=options.variables['#{계약서토큰}'],view=await fetch(origin+'/contract/'+token,{redirect:'manual'});assert.equal(view.status,302);assert.equal(view.headers.get('location'),url);assert.equal(view.headers.get('cache-control'),'no-store');
 const duplicate=await request(base+'/send',{contractId:c.id,confirm:true});assert.equal(duplicate.status,429);assert.ok(duplicate.body.error.includes('10분'));assert.equal(sent.length,2);
 remoteSigned=false;assert.equal((await request(base+'/preview',{contractId:c.id})).status,409);assert.equal(sent.length,2);
});

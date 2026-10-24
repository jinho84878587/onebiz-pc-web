'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../lib/store'),websign=require('../lib/websign-bridge');
const PUBLIC='https://onebiz-pc-web.onrender.com';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9SAAAAAASUVORK5CYII=';
test('document center end-to-end: all document sends, delivery reconciliation, explicit opens, scoped notifications, signing, unknown retry and durable history',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-center-')),file=path.join(dir,'db.sqlite'),key='73'.repeat(32),s=createStore(file,key),now=Date.now();
 const sent=[],providerReads=[],signReads=[],messages=new Map();let sendingMode='accepted',deliveryMode='pending',signed=false,sequence=0,serverLogs='';
 const templates=[
  {templateId:'QUOTE',channelId:'approved_channel',content:'#{고객명} #{업체명} #{견적금액}',buttons:[{linkMo:PUBLIC+'/quote/#{문서토큰}'}]},
  {templateId:'SIGN',channelId:'approved_channel',content:'#{고객명} #{업체명} #{계약금액}',buttons:[{linkMo:'https://#{서명링크}'}]},
  {templateId:'DONE',channelId:'approved_channel',content:'#{고객명} #{업체명} #{계약금액}',buttons:[{linkMo:PUBLIC+'/contract/#{계약서토큰}'}]},
  ...['statement','receipt'].map(kind=>({templateId:kind.toUpperCase(),channelId:'approved_channel',content:'#{고객명} #{업체명} #{거래금액}',buttons:[{linkMo:PUBLIC+'/'+kind+'/#{문서토큰}'}]}))
 ];
 const mock=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://test');
  if(url.pathname==='/kakao/v2/templates/sendable')return res.end(JSON.stringify(templates));
  if(url.pathname==='/messages/v4/send-many/detail'){
   let raw='';for await(const c of req)raw+=c;const msg=JSON.parse(raw).messages[0];sent.push(msg);await new Promise(resolve=>setTimeout(resolve,35));
   if(sendingMode==='unknown'){res.destroy();return;}
   const groupId='G4V-'+(++sequence),messageId='M4V-'+sequence;messages.set(groupId,{messageId,groupId,to:msg.to,templateId:msg.kakaoOptions.templateId});
   return res.end(JSON.stringify({groupInfo:{groupId,count:{registeredSuccess:1,registeredFailed:0}},messageList:[{messageId,groupId,to:msg.to}],failedMessageList:[]}));
  }
  if(/^\/messages\/v4\/groups\/[^/]+\/messages$/.test(url.pathname)){
   providerReads.push(url.pathname);const groupId=url.pathname.split('/')[4],message=messages.get(groupId);if(!message){res.statusCode=404;return res.end('{}');}
   const complete=deliveryMode!=='pending',fail=deliveryMode==='failed';return res.end(JSON.stringify({messageList:{[message.messageId]:{...message,status:complete?'COMPLETE':'PENDING',statusCode:complete?(fail?'3001':'4000'):'2000',reason:fail?'수신 실패':'정상 처리',dateReported:new Date().toISOString()}}}));
  }
  if(url.pathname==='/api/contracts'&&req.method==='POST'){let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw);return res.end(JSON.stringify({signUrl:websign.BASE+'/sign/'+data.id+'?token='+'x'.repeat(48)}));}
  if(url.pathname.endsWith('/status')){signReads.push(url.pathname);return res.end(JSON.stringify({status:signed?'signed':'pending',signedAt:signed?new Date(now+1000).toISOString():'',signerName:'Private customer',identityStatus:'전화번호 확인 완료'}));}
  if(url.pathname.startsWith('/receipt/')){res.setHeader('Content-Type','text/html');return res.end('<html><img src="'+png+'"></html>');}
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const quote={id:'Q1',customer:'Private customer',phone:'01000000051',createdAt:new Date().toISOString().slice(0,10),validityDays:90,items:[{name:'Original item',qty:1,unitPrice:110000}],pricingVersion:2,vatEnabled:true,discountAmount:0};
 const contract={id:'C-SIGN',customer:quote.customer,phone:quote.phone,amount:110000,signed:false,item:'Original work',standardTerms:'Original terms'};
 const completed={...contract,id:'C-DONE',signed:true,signatureMethod:'현장 직접 전자서명',signaturePath:'0,0;10,10',signatureName:quote.customer,signedAt:new Date(now-10000).toISOString()};
 function seed(actor){s.run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)',actor,s.seal({businessName:'Private supplier',representative:'Owner'}),'{}',now,now);s.run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',s.hash(actor+'-token'),actor,'user','owner','',now+3600000,now);s.run('INSERT INTO snapshots VALUES(?,?,?,?,?)',actor,1,s.seal({data:{customers:[],quotes:[quote],contracts:[contract,completed]},employees:[],schedules:[]}),'{}',now);}
 for(const actor of ['owner','other','timeout-quote','timeout-sign','timeout-done'])seed(actor);
 s.run('INSERT INTO alimtalk_logs VALUES(?,?,?,?,?,?,?,?,?)','legacy','owner','quote','quote:OLD','010-****-0000','QUOTE','accepted','{}',now-10000);
 const preload=path.join(dir,'mock-fetch.cjs');fs.writeFileSync(preload,`const real=global.fetch;global.fetch=(input,init)=>{const u=new URL(input);if(['api.solapi.com','hiwon-websign-server.onrender.com'].includes(u.hostname))return real('http://127.0.0.1:${mock.address().port}'+u.pathname+u.search,init);if(u.hostname==='127.0.0.1')return real(input,init);throw Error('All external network is blocked in this test')};`);
 const local='http://127.0.0.1:19894';
 let child;
 function start(){child=cp.spawn(process.execPath,['--require',preload,'server.js'],{cwd:path.join(__dirname,'..'),env:{PATH:process.env.PATH,APP_MODE:'test',PORT:'19894',PUBLIC_ORIGIN:PUBLIC,DATA_FILE:file,DATA_KEY_HEX:key,HIWON_SIGN_APP_KEY:'test-only',SOLAPI_API_KEY:'test-only',SOLAPI_API_SECRET:'test-only',SOLAPI_PFID:'legacy_channel',SOLAPI_TEMPLATE_QUOTE:'QUOTE',SOLAPI_TEMPLATE_CONTRACT_SIGN:'SIGN',SOLAPI_TEMPLATE_CONTRACT_DONE:'DONE',SOLAPI_TEMPLATE_STATEMENT:'STATEMENT',SOLAPI_TEMPLATE_RECEIPT:'RECEIPT',SOLAPI_SEND_ENABLED:'true',SOLAPI_MEMBER_SEND_ENABLED:'true'},stdio:'pipe'});child.stdout.on('data',v=>serverLogs+=v);child.stderr.on('data',v=>serverLogs+=v);}
 async function ready(){for(let i=0;i<80;i++){try{if((await fetch(local+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,40));}assert.fail('server failed to start: '+serverLogs);}
 async function stop(){const current=child;if(current?.exitCode===null){await new Promise(resolve=>{current.once('exit',resolve);current.kill('SIGTERM');});}}
 t.after(async()=>{await stop();mock.close();s.db.close();});start();await ready();
 class Client{
  constructor(actor=''){this.actor=actor;this.cookies={};}
  async call(route,method='GET',data,extra={}){
   const headers={'Content-Type':'application/json',Origin:PUBLIC,'X-Onebiz-Client':this.actor?'android':'web','User-Agent':'Mozilla/5.0 QA Human',Cookie:Object.entries(this.cookies).map(([k,v])=>k+'='+v).join('; '),...(this.actor?{Authorization:'Bearer '+this.actor+'-token'}:{}),...extra};
   const r=await fetch(local+route,{method,headers,redirect:'manual',...(data===undefined?{}:{body:JSON.stringify(data)})});for(const c of r.headers.getSetCookie()){const [pair]=c.split(';'),[k,...v]=pair.split('=');this.cookies[k]=v.join('=');}
   const raw=await r.text();let body;try{body=JSON.parse(raw);}catch{body={text:raw};}return {status:r.status,body,headers:r.headers};
  }
 }
 const owner=new Client('owner'),other=new Client('other'),visitor=new Client(),bot=new Client();
 assert.equal((await visitor.call('/api/document-center')).status,401);
 let center=(await owner.call('/api/document-center')).body;assert.equal(center.userId,'owner');assert.equal(center.documents[0].deliveryStatus,'unavailable');assert.equal(center.unreadCount,0);
 assert.equal((await other.call('/api/document-center/documents/'+center.documents[0].id)).status,404);
 const sendQuote=client=>client.call('/api/alimtalk/customer/quote/send','POST',{quoteId:'Q1',confirm:true});
 const sendSign=client=>client.call('/api/alimtalk/customer/send','POST',{kind:'contractSign',contractId:'C-SIGN',confirm:true});
 const sendDone=client=>client.call('/api/alimtalk/customer/contract/completed/send','POST',{contractId:'C-DONE',confirm:true});
 const concurrentQuote=await Promise.all([sendQuote(owner),sendQuote(owner)]);assert.deepEqual(concurrentQuote.map(r=>r.status).sort(),[200,429]);assert.equal(sent.length,1);
 const quoteToken=sent[0].kakaoOptions.variables['#{문서토큰}'];
 for(const kind of ['statement','receipt']){const response=await owner.call('/api/alimtalk/customer/document/send','POST',{kind,quoteId:'Q1',receivedAmount:50000,confirm:true});assert.equal(response.status,200,JSON.stringify(response.body));}
 assert.equal((await owner.call('/api/contract/sign-link','POST',{contractId:'C-SIGN'})).status,200);
 const signs=await Promise.all([sendSign(owner),sendSign(owner)]);assert.deepEqual(signs.map(r=>r.status).sort(),[200,429]);assert.equal(sent.filter(m=>m.kakaoOptions.templateId==='SIGN').length,1);
 // Clear only the synthetic rate limiter to test the independent done route.
 s.run('DELETE FROM rates WHERE k=?',s.hash('customer-alim-minute:owner'));
 const dones=await Promise.all([sendDone(owner),sendDone(owner)]);assert.deepEqual(dones.map(r=>r.status).sort(),[200,429]);assert.equal(sent.filter(m=>m.kakaoOptions.templateId==='DONE').length,1);
 center=(await owner.call('/api/document-center')).body;assert.equal(center.documents.length,6);assert.equal(center.documents.filter(d=>d.deliveryStatus==='accepted').length,5);
 for(const record of s.all("SELECT * FROM document_outbox WHERE user_id='owner' AND delivery_status='accepted'")){assert.ok(record.provider_group_id);assert.ok(record.provider_message_id);assert.ok(!record.body.includes('Private customer'));}
 const sourceBefore=s.one("SELECT * FROM snapshots WHERE user_id='owner'");
 assert.equal((await visitor.call('/quote/'+quoteToken)).status,200);assert.equal((await visitor.call('/quote/'+quoteToken,'HEAD')).status,200);assert.equal((await visitor.call('/api/public/quote/'+quoteToken)).status,200);
 let quoteDoc=center.documents.find(d=>d.kind==='quote'&&!d.legacy);assert.equal(quoteDoc.firstOpenedAt,null);assert.equal(s.one('SELECT last_view FROM quote_links WHERE token_hash=?',s.hash(quoteToken)).last_view,0);
 for(const [templateId,kind,variable,table]of [['STATEMENT','statement','문서토큰','quote_document_links'],['RECEIPT','receipt','문서토큰','quote_document_links'],['DONE','contract','계약서토큰','signed_contract_links']]){
  const token=sent.find(m=>m.kakaoOptions.templateId===templateId).kakaoOptions.variables['#{'+variable+'}'];
  assert.equal((await visitor.call('/'+kind+'/'+token)).status,200);assert.equal((await visitor.call('/'+kind+'/'+token,'HEAD')).status,200);assert.equal((await visitor.call('/api/public/'+kind+'/'+token)).status,200);
  assert.equal(s.one(`SELECT last_view FROM ${table} WHERE token_hash=?`,s.hash(token)).last_view,0);assert.equal(s.one('SELECT open_count FROM document_outbox WHERE token_hash=?',s.hash(token)).open_count,0);
 }
 const prefix='/api/public/document-access/quote/'+quoteToken;
 const grant=(await visitor.call(prefix+'/challenge','POST',{})).body;
 assert.equal((await new Client().call(prefix+'/open','POST',{challenge:grant.challenge})).status,400);
 assert.equal((await visitor.call(prefix+'/open','POST',{challenge:grant.challenge}, {Origin:'https://evil.example'})).status,403);
 const openResult=await visitor.call(prefix+'/open','POST',{challenge:grant.challenge});assert.equal(openResult.status,200,JSON.stringify(openResult.body));assert.equal(openResult.body.recorded,true);
 assert.equal((await visitor.call(prefix+'/open','POST',{challenge:grant.challenge})).body.recorded,false);
 const botGrant=await bot.call(prefix+'/challenge','POST',{}, {'User-Agent':'facebookexternalhit/1.1'});assert.equal(botGrant.body.mode,'automated');assert.equal((await bot.call(prefix+'/open','POST',{challenge:null},{'User-Agent':'facebookexternalhit/1.1'})).body.recorded,false);
 const ownerGrant=await owner.call(prefix+'/challenge','POST',{});assert.equal(ownerGrant.body.mode,'owner_preview');assert.equal((await owner.call(prefix+'/open','POST',{challenge:null})).body.recorded,false);
 const preview=new URL(quoteDoc.previewUrl),previewToken=preview.searchParams.get('preview'),externalOwner=new Client();assert.equal((await externalOwner.call(prefix+'/challenge','POST',{previewToken})).body.mode,'owner_preview');assert.equal((await externalOwner.call(prefix+'/open','POST',{challenge:null,previewToken})).body.recorded,false);
 const otherToken=sent.find(m=>m.kakaoOptions.templateId==='STATEMENT').kakaoOptions.variables['#{문서토큰}'];assert.equal((await visitor.call('/api/public/document-access/statement/'+otherToken+'/open','POST',{challenge:grant.challenge})).status,400);
 center=(await owner.call('/api/document-center')).body;quoteDoc=center.documents.find(d=>d.id===quoteDoc.id);assert.equal(quoteDoc.openCount,1);assert.equal(center.notifications.filter(n=>n.kind==='opened').length,1);
 const notification=center.notifications[0];await other.call('/api/document-center/notifications/read','POST',{ids:[notification.id]});assert.equal((await owner.call('/api/document-center')).body.unreadCount,1);
 await owner.call('/api/document-center/notifications/read','POST',{ids:[notification.id]});assert.equal((await owner.call('/api/document-center')).body.unreadCount,0);
 await owner.call('/api/document-center/settings','PUT',{mobileNotifications:true,deliveryComplete:true});assert.equal((await other.call('/api/document-center')).body.settings.mobileNotifications,false);
 assert.equal((await owner.call('/api/document-center/settings','PUT',{ownerAlimtalk:true})).status,400);
 const signToken=sent.find(m=>m.kakaoOptions.templateId==='SIGN').kakaoOptions.variables['#{서명링크}'].split('/').pop(),signPrefix='/api/public/document-access/sign/'+signToken;
 assert.equal((await visitor.call('/s/'+signToken)).headers.get('location'),null);
 const signGrant=(await visitor.call(signPrefix+'/challenge','POST',{})).body,signOpened=(await visitor.call(signPrefix+'/open','POST',{challenge:signGrant.challenge})).body;assert.ok(signOpened.redirectUrl.startsWith(websign.BASE));
 const requestDoc=(await owner.call('/api/document-center')).body.documents.find(d=>d.variant==='sign_request');assert.equal(requestDoc.firstOpenedAt,null);assert.equal(requestDoc.signLinkOpenCount,1);
 // The worker is disabled in tests; GET never makes a provider request.
 assert.equal(providerReads.length,0);deliveryMode='delivered';signed=true;
 const refreshed=await owner.call('/api/document-center/refresh','POST',{});assert.equal(refreshed.status,200,JSON.stringify(refreshed.body));assert.equal(refreshed.body.documents.filter(d=>d.deliveryStatus==='delivered').length,5);
 assert.equal(refreshed.body.documents.find(d=>d.variant==='sign_request').signedAt,now+1000);assert.equal(refreshed.body.notifications.filter(n=>n.kind==='signed').length,1);assert.ok(signReads.length>0);
 assert.equal(s.one("SELECT COUNT(*) n FROM websign_archives WHERE user_id='owner'").n,1);assert.deepEqual(s.one("SELECT * FROM snapshots WHERE user_id='owner'"),sourceBefore);
 const readCount=providerReads.length;await owner.call('/api/document-center/refresh','POST',{});assert.equal(providerReads.length,readCount);assert.equal(sent.length,5);
 // Late notifications can resolve a document outside the requested first page.
 const limited=(await owner.call('/api/document-center?limit=1')).body;assert.equal(limited.hasMore,true);assert.equal((await owner.call('/api/document-center/documents/'+quoteDoc.id)).body.document.id,quoteDoc.id);
 // Changing current source data cannot mutate an issued quote or its center metadata.
 s.run("UPDATE snapshots SET body=? WHERE user_id='owner'",s.seal({data:{customers:[],quotes:[{...quote,customer:'Changed customer',items:[{name:'Changed',qty:1,unitPrice:1}]}],contracts:[contract,completed]},employees:[]}));
 assert.equal((await visitor.call('/api/public/quote/'+quoteToken)).body.quote.customer,'Private customer');assert.equal((await owner.call('/api/document-center/documents/'+quoteDoc.id)).body.document.amount,110000);
 // No provider result IDs exist after transport disconnect; every send family
 // retains an unknown outcome and blocks a retry durably across restart.
 sendingMode='unknown';
 for(const [actor,send]of [['timeout-quote',sendQuote],['timeout-sign',sendSign],['timeout-done',sendDone]]){
  const client=new Client(actor);if(actor==='timeout-sign')assert.equal((await client.call('/api/contract/sign-link','POST',{contractId:'C-SIGN'})).status,200);
  const before=sent.length;assert.equal((await send(client)).status,502);assert.equal((await send(client)).status,429);assert.equal(sent.length,before+1);assert.equal((await client.call('/api/document-center')).body.documents[0].deliveryStatus,'unknown');
 }
 await stop();start();await ready();assert.equal((await sendQuote(new Client('timeout-quote'))).status,429);
 assert.equal((await owner.call('/api/document-center')).body.settings.mobileNotifications,true);assert.equal((await owner.call('/api/document-center/documents/'+quoteDoc.id)).body.document.openCount,1);
 s.run("UPDATE users SET status='suspended' WHERE id='owner'");assert.equal((await owner.call('/api/document-center')).status,403);assert.equal((await visitor.call(prefix+'/challenge','POST',{})).status,410);assert.equal((await visitor.call('/api/public/quote/'+quoteToken)).status,410);
 assert.ok(!serverLogs.includes('Private customer'));assert.ok(!serverLogs.includes(quoteToken));assert.ok(!serverLogs.includes('01000000051'));
});

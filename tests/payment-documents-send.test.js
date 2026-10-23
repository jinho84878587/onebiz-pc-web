'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createStore}=require('../lib/store');

test('payment documents: concurrent sends, immutable originals, legacy warning, failure retry and compatible schedules',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-payment-send-')),file=path.join(dir,'db.sqlite'),key='57'.repeat(32),store=createStore(file,key),now=Date.now(),sent=[];
 let providerMode='ok',sequence=0;
 const template=kind=>({templateId:kind.toUpperCase(),channelId:'approved_channel',content:'#{고객명} #{업체명} #{거래금액}',buttons:[{linkMo:'https://onebiz-pc-web.onrender.com/'+kind+'/#{문서토큰}'}]});
 const mock=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/kakao/v2/templates/sendable')return res.end(JSON.stringify([template('statement'),template('receipt')]));
  if(req.url==='/messages/v4/send-many/detail'){
   let raw='';for await(const chunk of req)raw+=chunk;sent.push(JSON.parse(raw));
   await new Promise(resolve=>setTimeout(resolve,40));
   if(providerMode==='unknown'){res.destroy();return;}
   const fail=providerMode==='fail';
   return res.end(JSON.stringify({groupInfo:{groupId:'test-'+(++sequence),count:{registeredSuccess:fail?0:1,registeredFailed:fail?1:0}},failedMessageList:fail?[{statusCode:'1048',statusMessage:'provider rejection'}]:[]}));
  }
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const port=mock.address().port,origin='http://127.0.0.1:19892';
 const quote={id:'Q-DOCUMENT',customer:'Private customer',phone:'01000000051',createdAt:'2026-10-24',items:[{name:'Original item',spec:'A',qty:1,unitPrice:110000}],pricingVersion:2,vatEnabled:true,discountAmount:10000};
 function seed(actor){
  store.run('INSERT INTO users(id,profile,consent,created,last_login,complete) VALUES(?,?,?,?,?,?)',actor,store.seal({businessName:'Private supplier',representative:'Owner',profileType:'PERSONAL'}),'{}',now,now,1);
  store.run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',store.hash(actor+'-bearer'),actor,'user','owner','',now+600000,now);
  store.run('INSERT INTO snapshots VALUES(?,?,?,?,?)',actor,1,store.seal({data:{customers:[],quotes:[quote],contracts:[]},employees:[]}),'{}',now);
 }
 for(const actor of ['owner','retry','unknown'])seed(actor);
 const preload=path.join(dir,'mock-fetch.cjs');
 fs.writeFileSync(preload,`const real=global.fetch;global.fetch=(input,init)=>{const u=new URL(input);if(u.hostname==='api.solapi.com')return real('http://127.0.0.1:${port}'+u.pathname+u.search,init);if(u.hostname==='127.0.0.1')return real(input,init);throw Error('External network blocked in test')};`);
 const child=cp.spawn(process.execPath,['--require',preload,'server.js'],{cwd:path.join(__dirname,'..'),env:{PATH:process.env.PATH,APP_MODE:'test',PORT:'19892',PUBLIC_ORIGIN:origin,DATA_FILE:file,DATA_KEY_HEX:key,SOLAPI_API_KEY:'test-only',SOLAPI_API_SECRET:'test-only',SOLAPI_PFID:'legacy_channel',SOLAPI_TEMPLATE_STATEMENT:'STATEMENT',SOLAPI_TEMPLATE_RECEIPT:'RECEIPT',SOLAPI_SEND_ENABLED:'true',SOLAPI_MEMBER_SEND_ENABLED:'true'},stdio:'pipe'});
 let logs='';child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);
 t.after(()=>{child.kill('SIGTERM');mock.close();store.db.close();});
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
 assert.ok(ready,'server started: '+logs);
 async function request(route,data,method='POST',actor='owner'){
  const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json','X-Onebiz-Client':'android',Authorization:'Bearer '+actor+'-bearer'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,body:await response.json(),headers:response.headers};
 }
 const base='/api/alimtalk/customer/document',send=(kind,actor='owner',receivedAmount)=>request(base+'/send',{kind,quoteId:quote.id,confirm:true,receivedAmount},'POST',actor);
 const preview=await request(base+'/preview',{kind:'statement',quoteId:quote.id});
 assert.equal(preview.status,200);assert.equal(preview.body.amount,100000);assert.equal(sent.length,0);
 assert.equal((await request(base+'/preview',{kind:'receipt',quoteId:quote.id,receivedAmount:0})).status,400);
 assert.equal((await request(base+'/preview',{kind:'receipt',quoteId:quote.id,receivedAmount:100001})).status,400);
 const concurrent=await Promise.all([send('statement'),send('statement')]);
 assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,429]);assert.equal(sent.length,1);
 assert.equal(sent[0].messages[0].kakaoOptions.pfId,'approved_channel');
 const statementToken=sent[0].messages[0].kakaoOptions.variables['#{문서토큰}'];
 const statementBefore=await request('/api/public/statement/'+statementToken,undefined,'GET');
 assert.equal(statementBefore.body.archive.originalAtIssue,true);
 assert.equal(statementBefore.body.statement.total,100000);
 assert.equal(statementBefore.body.statement.lines.reduce((sum,row)=>sum+row.amount,0),100000);
 assert.equal((await send('receipt','owner',50000)).status,200);
 const receiptToken=sent.at(-1).messages[0].kakaoOptions.variables['#{문서토큰}'];
 const receiptBefore=await request('/api/public/receipt/'+receiptToken,undefined,'GET');
 assert.equal(receiptBefore.body.receipt.paidAmount,50000);
 const changed={...quote,customer:'Changed customer',items:[{name:'Changed item',qty:1,unitPrice:220000}],discountAmount:0};
 const schedule={id:1,title:'Manual schedule',date:'2026-10-24'};
 const data={customers:[],quotes:[changed],contracts:[],futureCollection:[{id:'extension'}]};
 const saved=await request('/api/snapshot',{revision:1,data,employees:[],schedules:[schedule]},'PUT');
 assert.equal(saved.status,200);
 const current=await request('/api/snapshot',undefined,'GET');assert.deepEqual(current.body.schedules,[schedule]);
 const oldClient=await request('/api/snapshot',{revision:current.body.revision,data:{customers:[],quotes:[changed],contracts:[]},employees:[]},'PUT');assert.equal(oldClient.status,200);
 const afterOldClient=await request('/api/snapshot',undefined,'GET');assert.deepEqual(afterOldClient.body.schedules,[schedule]);assert.deepEqual(afterOldClient.body.data.futureCollection,[{id:'extension'}]);
 assert.equal((await request('/api/snapshot',{revision:1,data,employees:[],schedules:[]},'PUT')).status,409);
 assert.equal((await request('/api/snapshot',{revision:afterOldClient.body.revision,data,employees:[],schedules:[null]},'PUT')).status,400);
 store.run('UPDATE users SET profile=? WHERE id=?',store.seal({businessName:'Changed supplier'}),'owner');
 assert.deepEqual((await request('/api/public/statement/'+statementToken,undefined,'GET')).body,statementBefore.body);
 assert.deepEqual((await request('/api/public/receipt/'+receiptToken,undefined,'GET')).body,receiptBefore.body);
 const legacy='L'.repeat(43);
 store.run('INSERT INTO quote_document_links(token_hash,user_id,quote_id,kind,created,expires) VALUES(?,?,?,?,?,?)',store.hash(legacy),'owner',quote.id,'statement',now-86400000,now+600000);
 const legacyBody=(await request('/api/public/statement/'+legacy,undefined,'GET')).body;
 assert.equal(legacyBody.archive.originalAtIssue,false);assert.ok(legacyBody.archive.notice.includes('최초 발행 당시 원본'));
 assert.equal(legacyBody.statement.total,220000);
 // Removing the editable source cannot rewrite or break already archived documents.
 store.run('UPDATE snapshots SET body=? WHERE user_id=?',store.seal({data:{customers:[],quotes:[],contracts:[]},employees:[]}),'owner');
 assert.deepEqual((await request('/api/public/statement/'+legacy,undefined,'GET')).body,legacyBody);
 assert.deepEqual((await request('/api/public/receipt/'+receiptToken,undefined,'GET')).body,receiptBefore.body);
 assert.ok(!store.one('SELECT body FROM payment_document_archives WHERE token_hash=?',store.hash(statementToken)).body.includes('Private customer'));
 store.run('UPDATE quote_document_links SET expires=? WHERE token_hash=?',now-1,store.hash(statementToken));
 assert.equal((await request('/api/public/statement/'+statementToken,undefined,'GET')).status,410);
 // The older signed-contract document endpoints also archive at issue time.
 const contract={id:'C-DOC',customer:'Contract customer',quoteId:quote.id,amount:100000,paidAmount:50000,signed:true,item:'Contract item'};
 store.run('UPDATE snapshots SET body=? WHERE user_id=?',store.seal({data:{customers:[],quotes:[quote],contracts:[contract]},employees:[]}),'owner');
 const contractStatement=await request('/api/contracts/C-DOC/statement-link',{}),contractReceipt=await request('/api/contracts/C-DOC/receipt-link',{});
 assert.equal(contractStatement.status,200);assert.equal(contractReceipt.status,200);
 const oldStatementUrl='/api/public/statement/'+contractStatement.body.token,oldReceiptUrl='/api/public/receipt/'+contractReceipt.body.token;
 const oldStatement=(await request(oldStatementUrl,undefined,'GET')).body,oldReceipt=(await request(oldReceiptUrl,undefined,'GET')).body;
 store.run('UPDATE snapshots SET body=? WHERE user_id=?',store.seal({data:{customers:[],quotes:[changed],contracts:[{...contract,customer:'Later contract customer',paidAmount:90000}]},employees:[]}),'owner');
 const newContractStatement=await request('/api/contracts/C-DOC/statement-link',{}),newContractReceipt=await request('/api/contracts/C-DOC/receipt-link',{});
 assert.equal(newContractStatement.status,200);assert.equal(newContractReceipt.status,200);
 assert.notEqual(contractStatement.body.token,newContractStatement.body.token);
 assert.deepEqual((await request(oldStatementUrl,undefined,'GET')).body,oldStatement);
 assert.deepEqual((await request(oldReceiptUrl,undefined,'GET')).body,oldReceipt);
 providerMode='fail';
 const failed=await send('statement','retry');assert.equal(failed.status,502);assert.equal(failed.body.status,'failed');
 const failedToken=sent.at(-1).messages[0].kakaoOptions.variables['#{문서토큰}'];
 assert.equal((await request('/api/public/statement/'+failedToken,undefined,'GET')).status,404);
 providerMode='ok';assert.equal((await send('statement','retry')).status,200);
 providerMode='unknown';
 const unknown=await send('receipt','unknown',50000);assert.equal(unknown.status,502);assert.equal(unknown.body.status,'unknown');
 const unknownToken=sent.at(-1).messages[0].kakaoOptions.variables['#{문서토큰}'];
 assert.equal((await request('/api/public/receipt/'+unknownToken,undefined,'GET')).status,200);
 const beforeRetry=sent.length;assert.equal((await send('receipt','unknown',50000)).status,429);assert.equal(sent.length,beforeRetry);
 assert.ok(statementBefore.headers.get('x-request-id'));
 assert.ok(!logs.includes(statementToken)&&!logs.includes('01000000051')&&!logs.includes('Private customer'));
});

test('statement renders all 23 items, discount and legacy warning with HTML escaping',()=>{
 const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,{classList:{add(){},remove(){}},innerHTML:'',textContent:'',onclick:null});return nodes.get(selector);};
 const context={document:{querySelector:node},location:{pathname:'/',href:'http://localhost/'},window:{print(){}},navigator:{},alert(){},Intl,URL};vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/statement.js'),'utf8')+'\nthis.testRender=render;',context);
 const lines=Array.from({length:23},(_,i)=>({name:'ITEM_'+(i+1),qty:1,unitPrice:1000,supply:1000,vat:0,amount:1000}));
 lines.push({name:'할인',lineType:'discount',supply:-1000,vat:0,amount:-1000});
 context.testRender({supplier:{},archive:{notice:'Legacy <script> warning'},statement:{items:lines.slice(0,23),lines,supply:22000,vat:0,total:22000,discountAmount:1000}});
 const html=node('#statement').innerHTML;assert.equal((html.match(/ITEM_/g)||[]).length,23);assert.ok(html.includes('ITEM_23'));
 assert.ok(html.includes('할인'));assert.ok(html.includes('-1,000원'));assert.ok(html.includes('Legacy &lt;script&gt; warning'));
 const amounts=[...html.matchAll(/<td class="num emphasis">(-?[\d,]+)원<\/td>/g)].map(x=>Number(x[1].replace(/,/g,'')));
 assert.equal(amounts.reduce((a,b)=>a+b,0),22000);
});


test('public quote keeps decimal quantity, unit price and discount visible',()=>{
 const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,{classList:{add(){},remove(){}},innerHTML:'',textContent:'',onclick:null});return nodes.get(selector);};
 const context={document:{querySelector:node},location:{pathname:'/',href:'http://localhost/'},window:{print(){}},navigator:{},alert(){},Intl,URL};vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/quote.js'),'utf8')+'\nthis.testRender=render;',context);
 context.testRender({supplier:{},quote:{items:[{name:'Decimal item',qty:1.5,unitPrice:1000.5,amount:1500.75}],discountAmount:0.25,total:1501,supply:1365,vat:136,vatEnabled:true}});
 const html=node('#quote').innerHTML;
 assert.ok(html.includes('>1.5</td>'));assert.ok(html.includes('>1,000.5</td>'));assert.ok(html.includes('>1,500.75</td>'));assert.ok(html.includes('>-0.25</span>'));
});

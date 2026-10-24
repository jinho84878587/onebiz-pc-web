'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
class Element{
 constructor(){this.innerHTML='';this.textContent='';this.disabled=false;this.hidden=false;this.children=[];this.attributes={};this.events={};this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:v=>this.classes.has(v)};}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,v){this.events[k]=v;}
 removeEventListener(k,v){if(this.events[k]===v)delete this.events[k];}
 contains(){return true;}
 append(child){this.children.push(child);}
 insertAdjacentElement(_,child){this.after=child;}
}
function gateEnvironment({fetch,search='',pathname='/quote/'+('a'.repeat(43))}={}){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key);};
 const events={},document={querySelector:node,body:new Element(),visibilityState:'visible',createElement:()=>new Element(),addEventListener:(k,v)=>events[k]=v,removeEventListener:(k,v)=>{if(events[k]===v)delete events[k];}};
 const redirects=[],location={origin:'https://onebiz.example',pathname,search,assign:url=>redirects.push(url)};
 const window={document,location,fetch};const ctx={window,document,location,URL,URLSearchParams,Promise};vm.createContext(ctx);vm.runInContext(read('document-open.js'),ctx);
 return {window,document,nodes,node,events,redirects};
}
const ok=body=>Promise.resolve({ok:true,json:async()=>({ok:true,...body})});
test('공개문서는 자동 또는 합성 클릭으로 기록하지 않고, 실제 클릭 뒤 렌더 성공 후 기록한다',async()=>{
 const calls=[],order=[];
 const env=gateEnvironment({search:'?preview=owner-proof',fetch:async(url,init)=>{calls.push({url,init});order.push(url.endsWith('/challenge')?'challenge':'open');return ok(url.endsWith('/challenge')?{challenge:'one-use',mode:'customer'}:{recorded:true});}});
 env.window.OnebizDocumentAccess.mount({kind:'quote',token:'a'.repeat(43),onOpen:async()=>{order.push('render');env.node('#status').classList.add('hidden');}});
 assert.equal(calls.length,0);
 await env.node('#documentOpenBtn').onclick({isTrusted:false});assert.equal(calls.length,0);
 await env.node('#documentOpenBtn').onclick({isTrusted:true});
 assert.deepEqual(order,['challenge','render','open']);
 assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[1].init.credentials,'same-origin');
 assert.deepEqual(JSON.parse(calls[0].init.body),{previewToken:'owner-proof'});
 assert.deepEqual(JSON.parse(calls[1].init.body),{challenge:'one-use',previewToken:'owner-proof'});
 assert.equal(env.document.body.classList.contains('document-awaiting-open'),false);
 await env.node('#documentOpenBtn').onclick({isTrusted:true});assert.equal(calls.length,2);
 assert.equal(env.window.OnebizDocumentAccess.shareUrl(),'https://onebiz.example/quote/'+('a'.repeat(43)));
});
test('문서 불러오기 실패는 열림으로 기록하지 않고 같은 화면에서 다시 열 수 있다',async()=>{
 const calls=[];let fail=true;
 const env=gateEnvironment({fetch:async url=>{calls.push(url);return ok(url.endsWith('/challenge')?{challenge:'proof'}:{recorded:true});}});
 env.window.OnebizDocumentAccess.mount({kind:'statement',token:'b'.repeat(43),onOpen:async()=>{if(fail)throw Error('문서 조회 실패');}});
 await env.node('#documentOpenBtn').onclick({isTrusted:true});
 assert.equal(calls.length,1);assert.equal(env.node('#documentOpenBtn').disabled,false);
 assert.equal(env.node('#documentOpenError').textContent,'문서 조회 실패');assert.equal(env.node('#status').classList.contains('hidden'),false);
 fail=false;await env.node('#documentOpenBtn').onclick({isTrusted:true});assert.equal(calls.filter(p=>p.endsWith('/open')).length,1);
});
test('열림 저장 실패가 이미 열린 문서 읽기를 막지 않는다',async()=>{
 const env=gateEnvironment({fetch:async url=>url.endsWith('/challenge')?ok({challenge:'proof'}):Promise.reject(Error('network'))});
 let rendered=false;
 env.window.OnebizDocumentAccess.mount({kind:'receipt',token:'c'.repeat(43),onOpen:async()=>{rendered=true;env.node('#status').classList.add('hidden');}});
 await env.node('#documentOpenBtn').onclick({isTrusted:true});
 assert.equal(rendered,true);assert.equal(env.document.body.classList.contains('document-awaiting-open'),false);
 assert.match(env.node('#status').after.textContent,/문서는 열렸지만/);assert.equal(env.node('#status').after.children[0].textContent,'다시 저장');
});
test('보이지 않는 탭에서는 렌더 뒤에도 표시 시점까지 열림 기록을 보류한다',async()=>{
 const calls=[];
 const env=gateEnvironment({fetch:async url=>{calls.push(url);return ok(url.endsWith('/challenge')?{challenge:'proof'}:{recorded:true});}});
 env.document.visibilityState='hidden';
 env.window.OnebizDocumentAccess.mount({kind:'quote',token:'d'.repeat(43),onOpen:async()=>{}});
 const click=env.node('#documentOpenBtn').onclick({isTrusted:true});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(p=>p.endsWith('/open')).length,0);
 env.document.visibilityState='visible';env.events.visibilitychange();await click;
 assert.equal(calls.filter(p=>p.endsWith('/open')).length,1);
});
test('발행자 미리보기는 null challenge를 서버에 전달하고 미리보기 안내를 표시한다',async()=>{
 const bodies=[];
 const env=gateEnvironment({search:'?preview=valid-proof',fetch:async(url,init)=>{bodies.push(JSON.parse(init.body));return ok(url.endsWith('/challenge')?{challenge:null,mode:'owner_preview'}:{recorded:false,reason:'owner_preview'});}});
 env.window.OnebizDocumentAccess.mount({kind:'contract',token:'e'.repeat(43),onOpen:async()=>{}});
 await env.node('#documentOpenBtn').onclick({isTrusted:true});
 assert.equal(bodies[1].challenge,null);assert.equal(bodies[1].previewToken,'valid-proof');
 assert.match(env.node('#status').after.textContent,/발행자 미리보기/);
});
test('서명 이동은 서버가 확인한 주소만 열고 임의 외부 주소를 거부한다',async()=>{
 let target='https://attacker.example/capture';
 const env=gateEnvironment({pathname:'/s/'+('f'.repeat(43)),fetch:async url=>ok(url.endsWith('/challenge')?{challenge:'proof'}:{recorded:true,redirectUrl:target})});
 env.window.OnebizDocumentAccess.mount({kind:'sign',token:'f'.repeat(43)});
 await env.node('#documentOpenBtn').onclick({isTrusted:true});assert.equal(env.redirects.length,0);assert.match(env.node('#documentOpenError').textContent,/연결 주소/);
 target='https://hiwon-websign-server.onrender.com/sign/audit?token=example';
 await env.node('#documentOpenBtn').onclick({isTrusted:true});assert.deepEqual(env.redirects,[target]);
});
function centerEnvironment(payload,detailDocument){
 const root=new Element(),requests=[],counts=[];
 const window={location:{origin:'https://onebiz.example'}};const ctx={window,URL,Intl,Date,Number,Set};vm.createContext(ctx);vm.runInContext(read('document-center.js'),ctx);
 const request=async(url,options={})=>{requests.push({url,options});if(url.startsWith('/api/document-center/documents/'))return {ok:true,document:detailDocument};if(url.endsWith('/notifications/read'))return {ok:true,unreadCount:0};if(url.endsWith('/settings'))return {ok:true,settings:{...payload.settings,...JSON.parse(options.body)}};return payload;};
 const mount=window.OnebizDocumentCenter.mount({root,request,onUnread:v=>counts.push(v)});
 const click=data=>root.events.click({target:{closest:()=>({dataset:data,disabled:false})}});
 return {root,requests,counts,window,mount,click};
}
const fixture=()=>({ok:true,documents:[{id:'D1',kind:'contract',variant:'sign_request',sourceId:'C1',customer:'<img src=x onerror=alert(1)>',amount:null,deliveryStatus:'accepted',sentAt:1792830000000,firstOpenedAt:null,signLinkOpenedAt:1792830010000,signedAt:null,previewUrl:'javascript:alert(1)',events:[{type:'accepted',at:1792830000000,message:'발송 접수'}]}],notifications:[{id:'N1',documentId:'D1',kind:'opened',title:'<script>bad()</script>',body:'가상 고객 알림',createdAt:1792830010000,readAt:null}],settings:{firstOpen:true,signatureComplete:true,deliveryFailure:true,deliveryComplete:false,mobileNotifications:false},capabilities:{providerDelivery:false,instantPush:false,ownerAlimtalk:false},unreadCount:1,refreshedAt:1792830020000});
test('문서센터는 미확인 수와 상태를 분리하고 고객 입력을 HTML로 실행하지 않는다',async()=>{
 const env=centerEnvironment(fixture());await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(env.counts,[1]);assert.match(env.root.innerHTML,/금액 기록 없음/);assert.doesNotMatch(env.root.innerHTML,/0원/);
 assert.match(env.root.innerHTML,/&lt;img/);assert.doesNotMatch(env.root.innerHTML,/<img src=x/);
 assert.match(env.root.innerHTML,/발송 접수/);assert.match(env.root.innerHTML,/서명 페이지 이동/);assert.doesNotMatch(env.root.innerHTML,/>서명 완료</);
 const status=env.window.OnebizDocumentCenter.describeDocument(fixture().documents[0]);assert.equal(status.opened,false);assert.equal(status.signed,false);assert.equal(status.preview,'');
 env.mount.destroy();assert.equal(env.root.events.click,undefined);
});
test('알림 모두 확인과 설정 변경은 전용 API만 호출하고 설정되지 않은 채널을 활성화하지 않는다',async()=>{
 const env=centerEnvironment(fixture());await new Promise(resolve=>setImmediate(resolve));
 env.click({dcTab:'notifications'});assert.match(env.root.innerHTML,/&lt;script&gt;bad/);
 env.click({dcAction:'read-all'});await new Promise(resolve=>setImmediate(resolve));
 const readRequest=env.requests.find(r=>r.url.endsWith('/notifications/read'));assert.equal(readRequest.options.method,'POST');assert.deepEqual(JSON.parse(readRequest.options.body),{all:true});assert.equal(env.counts.at(-1),0);
 env.click({dcTab:'settings'});assert.match(env.root.innerHTML,/휴대폰 알림 · 주기 확인/);assert.match(env.root.innerHTML,/최소 15분/);assert.match(env.root.innerHTML,/미연결/);
 assert.doesNotMatch(env.root.innerHTML,/data-dc-setting="(?:instantPush|ownerAlimtalk)"/);
 env.root.events.change({target:{dataset:{dcSetting:'deliveryComplete'},checked:true}});await new Promise(resolve=>setImmediate(resolve));
 const settings=env.requests.find(r=>r.url.endsWith('/settings'));assert.equal(settings.options.method,'PUT');assert.deepEqual(JSON.parse(settings.options.body),{deliveryComplete:true});
 assert.equal(env.requests.some(r=>r.url.includes('snapshot')||r.url.includes('/send')),false);
});
test('공개문서 4종은 공용 열기 흐름을 거치고 기존 원본 렌더러를 유지한다',()=>{
 for(const kind of ['quote','statement','receipt','contract']){
  const html=read(kind+'.html'),js=read(kind+'.js');
  assert.ok(html.indexOf('/document-open.js')<html.indexOf('/'+kind+'.js'));
  assert.match(js,new RegExp("mount\\(\\{kind:'"+kind+"',token,onOpen:start\\}\\)"));
  assert.match(js,/function render\(data\)/);assert.match(js,/PDF 저장\/인쇄/);
  assert.match(js,/OnebizDocumentAccess.shareUrl\(\)/);
 }
});
test('최근 목록 범위 밖 알림도 소유자 상세 API에서 문서를 확인한다',async()=>{
 const payload=fixture(),detail=payload.documents[0];payload.documents=[];
 const env=centerEnvironment(payload,detail);await new Promise(resolve=>setImmediate(resolve));
 env.click({dcTab:'notifications'});env.click({dcNotification:'N1'});await new Promise(resolve=>setImmediate(resolve));
 assert.ok(env.requests.some(r=>r.url==='/api/document-center/documents/D1'));
 assert.match(env.root.innerHTML,/진행 이력/);assert.match(env.root.innerHTML,/금액 기록 없음/);assert.equal(env.counts.at(-1),0);
});

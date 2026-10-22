'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('./lib/store');
const {HttpError,check,random,equal,sha,phone,text,passwordHash,totp}=require('./lib/security');
const provider=require('./lib/providers');
const templateInspector=require('./lib/solapi-template-inspector');
const env=process.env,mode=env.APP_MODE||'production',demo=mode==='demo',test=mode==='test',local=demo||test;
check(['production','demo','test'].includes(mode),500,'Invalid APP_MODE');
const host=local?'127.0.0.1':'0.0.0.0';const port=Number(env.PORT||10000);
const origin=env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
if(!local){check(origin.startsWith('https://'),500,'Production requires PUBLIC_ORIGIN=https://...');check(env.POLICIES_APPROVED==='true',500,'확정한 약관·개인정보처리방침을 적용 후 POLICIES_APPROVED=true로 설정하세요.');}
check(new URL(origin).origin===origin,500,'PUBLIC_ORIGIN must not contain a path or trailing slash.');
const store=createStore(env.DATA_FILE||path.join(__dirname,'data',local?'demo.sqlite':'onebiz.sqlite'),env.DATA_KEY_HEX||(local?'11'.repeat(32):''));
const {one,all,run,tx,log,rate,hash,seal,open}=store;
const policyVersion='2026-09-18-draft';
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
function redirect(res,to){res.writeHead(303,{Location:to,'Cache-Control':'no-store'});res.end();}
function cookie(req,key){const part=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='));return part?part.slice(key.length+1):'';}
function setCookie(res,key,value,maxAge=43200){const values=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[...values,`${key}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local?'':'; Secure'}`]);}
async function body(req){check((req.headers['content-type']||'').startsWith('application/json'),415,'JSON 요청이 필요합니다.');let n=0;const chunks=[];for await(const chunk of req){n+=chunk.length;check(n<=2*1024*1024,413,'요청 데이터가 너무 큽니다.');chunks.push(chunk);}try{const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');check(b&&typeof b==='object'&&!Array.isArray(b),400,'객체가 필요합니다.');return b;}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'JSON 형식을 확인해 주세요.');}}
function ip(req){return env.TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').pop().trim():req.socket.remoteAddress;}
function limit(req,k,n,ms){check(rate(k,n,ms),429,'요청이 많습니다. 잠시 후 다시 시도해 주세요.');}
function writeGuard(req,session){
 check(req.headers['x-onebiz-client']==='web'||req.headers['x-onebiz-client']==='android',403,'클라이언트 확인 실패');
 if(req.headers.origin)check(req.headers.origin===origin,403,'허용되지 않은 출처입니다.');
 else check(req.headers['x-onebiz-client']==='android',403,'요청 출처를 확인해 주세요.');
 if(session&&!session.bearer)check(equal(req.headers['x-csrf-token']||'',session.csrf),403,'화면을 새로고침한 후 다시 시도해 주세요.');
}
const androidSessionTtl=30*86400000;
function getSession(req,kind='user',optional=false){
 const bearer=(req.headers.authorization||'').startsWith('Bearer '),token=bearer?req.headers.authorization.slice(7):cookie(req,kind==='admin'?'ob_admin':'ob_user');
 const tokenHash=token?hash(token):'',s=token?one('SELECT * FROM sessions WHERE hash=? AND kind=? AND expires>?',tokenHash,kind,Date.now()):null;
 if(!s){if(optional)return null;throw new HttpError(401,'로그인이 필요합니다.');}
 if(kind==='user'){const u=one('SELECT status FROM users WHERE id=?',s.actor);check(u&&u.status==='active',403,'이 계정은 이용이 제한되어 있습니다.');if(bearer)run('UPDATE sessions SET expires=? WHERE hash=?',Date.now()+androidSessionTtl,tokenHash);}
 return {...s,bearer};
}
function sessionCreate(req,res,id,kind='user',role='owner',asBearer=false){
 const token=random(),csrf=random(),now=Date.now(),ttl=kind==='admin'?3600000:(asBearer?androidSessionTtl:43200000);run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',hash(token),id,kind,role,csrf,now+ttl,now);
 if(!asBearer)setCookie(res,kind==='admin'?'ob_admin':'ob_user',token,kind==='admin'?3600:43200);
 return asBearer?{token,expiresAt:now+ttl}:{csrf};
}
function consent(b){check(b.terms===true&&b.privacy===true,400,'필수 약관과 개인정보 안내를 확인해 주세요.');return {terms:true,privacy:true,marketing:b.marketing===true,version:policyVersion,at:Date.now()};}
function identity(p,subject,terms,linkUser=null,name=''){
 return tx(()=>{
  const h=hash(p+':'+subject),prev=one('SELECT user_id FROM identities WHERE provider=? AND subject_hash=?',p,h);
  if(linkUser){check(!prev||prev.user_id===linkUser,409,'다른 원비즈 계정에 연결된 로그인 수단입니다. 자동 병합하지 않습니다.');if(!prev)run('INSERT INTO identities VALUES(?,?,?)',p,h,linkUser);log(linkUser,'identity.link',linkUser,{provider:p});return linkUser;}
  if(prev){check(one('SELECT status FROM users WHERE id=?',prev.user_id)?.status==='active',403,'이용 제한된 계정입니다.');run('UPDATE users SET last_login=? WHERE id=?',Date.now(),prev.user_id);return prev.user_id;}
  const id=crypto.randomUUID(),now=Date.now(),profile={profileType:'PERSONAL',representative:text(name,80),phone:p==='phone'?subject:'',businessName:''};
  run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)',id,seal(profile),JSON.stringify(terms),now,now);
  run('INSERT INTO identities VALUES(?,?,?)',p,h,id);log(id,'signup',id,{provider:p});return id;
 });
}
function subscriptionInfo(u){const plan=['free','pro'].includes(String(u.subscription||'').toLowerCase())?String(u.subscription).toLowerCase():'free',status=String(u.subscription_status||'active'),expiresAt=Number(u.subscription_expires||0),active=plan==='free'||(status==='active'&&(!expiresAt||expiresAt>Date.now()));let custom={};try{custom=JSON.parse(u.entitlements||'{}');}catch{}const pro=plan==='pro'&&active,features={core_documents:true,customer_management:true,dispatch:true,employee_management:true,automatic_sync:true,ad_free:pro||u.ad_free===1,premium_templates:pro,cloud_backup:pro,advanced_admin:pro,...custom};return{plan,status,active,expiresAt:expiresAt||null,adFree:features.ad_free===true,features,updatedAt:Number(u.subscription_updated||0)||null,billingConnected:false};}
function hasEntitlement(userId,feature){const u=one('SELECT * FROM users WHERE id=?',userId);return !!(u&&subscriptionInfo(u).features[feature]);}
function userInfo(id){const u=one('SELECT * FROM users WHERE id=?',id);return {id:u.id,profile:open(u.profile),profileRevision:u.profile_rev,profileComplete:!!u.complete,createdAt:u.created,identities:all('SELECT provider FROM identities WHERE user_id=?',id).map(i=>i.provider),subscription:subscriptionInfo(u)};}
function mustAdmin(req,roles=['owner','operator','viewer']){const s=getSession(req,'admin');check(roles.includes(s.role),403,'관리자 권한이 부족합니다.');return s;}
function profileValidate(b){const p={};for(const k of ['businessName','representative','registrationNo','address','addressDetail','phone','email','bankName','accountNumber','accountHolder','industry'])p[k]=text(b[k],k.includes('address')?300:120);p.profileType=b.profileType==='BUSINESS'?'BUSINESS':'PERSONAL';const types=['개인회원','프리랜서','개인/프리랜서','개인사업자','법인사업자'];p.businessType=types.includes(text(b.businessType,30))?text(b.businessType,30):(p.profileType==='BUSINESS'?'개인사업자':'개인/프리랜서');if(p.profileType==='PERSONAL'&&!p.representative)p.representative=p.businessName;check(p.representative,400,'이름을 입력해 주세요.');if(p.profileType==='BUSINESS')check(p.businessName&&/^\d{10}$/.test(p.registrationNo.replace(/\D/g,''))&&p.address,400,'상호·10자리 사업자번호·사업장 주소를 입력해 주세요.');return p;}
const alimtalkKinds={
 contractSign:{envKey:'SOLAPI_TEMPLATE_CONTRACT_SIGN',fields:['고객명','업체명','계약금액','서명링크']},
 receivable:{envKey:'SOLAPI_TEMPLATE_RECEIVABLE',fields:['고객명','업체명','미수금액','지급예정일']},
 dispatchRequest:{envKey:'SOLAPI_TEMPLATE_DISPATCH_REQUEST',fields:['고객명','업체명','장비종류','사용일','예정시간','사용시간','현장주소']},
 dispatchChange:{envKey:'SOLAPI_TEMPLATE_DISPATCH_CHANGE',fields:['고객명','업체명','장비종류','변경사용일','변경시간','사용시간','현장주소']},
 dispatchDone:{envKey:'SOLAPI_TEMPLATE_DISPATCH_DONE',fields:['고객명','업체명','장비종류','사용일','예정시간','사용시간','현장주소']},
 dispatchCancel:{envKey:'SOLAPI_TEMPLATE_DISPATCH_CANCEL',fields:['고객명','업체명','장비종류','사용일']}
};

const alimtalkAdditionalRegistry=[{"name":"견적 유효기간 만료 안내","envKey":"SOLAPI_TEMPLATE_QUOTE_EXPIRED","reviewStatus":"검수완료"},{"name":"계약서 서명 재안내","envKey":"SOLAPI_TEMPLATE_CONTRACT_SIGN_REMINDER","reviewStatus":"검수완료"},{"name":"중도금 지급일 안내","envKey":"SOLAPI_TEMPLATE_MIDDLE_DUE","reviewStatus":"검수완료"},{"name":"계약금 지급일 안내","envKey":"SOLAPI_TEMPLATE_DEPOSIT_DUE","reviewStatus":"검수완료"},{"name":"잔금 지급일 안내","envKey":"SOLAPI_TEMPLATE_BALANCE_DUE","reviewStatus":"검수완료"},{"name":"시공 당일 안내","envKey":"SOLAPI_TEMPLATE_WORK_TODAY","reviewStatus":"검수완료"},{"name":"시공 전날 안내","envKey":"SOLAPI_TEMPLATE_WORK_TOMORROW","reviewStatus":"검수완료"},{"name":"미수금 재안내","envKey":"SOLAPI_TEMPLATE_RECEIVABLE_REMINDER","reviewStatus":"검수완료"},{"name":"완납 안내","envKey":"SOLAPI_TEMPLATE_FULL_PAYMENT","reviewStatus":"검수완료"},{"name":"입금 확인 안내","envKey":"SOLAPI_TEMPLATE_PAYMENT_CONFIRMED","reviewStatus":"검수완료"},{"name":"일정 취소 안내","envKey":"SOLAPI_TEMPLATE_SCHEDULE_CANCEL","reviewStatus":"검수완료"},{"name":"일정 변경 안내","envKey":"SOLAPI_TEMPLATE_SCHEDULE_CHANGE","reviewStatus":"검수완료"},{"name":"일정 안내","envKey":"SOLAPI_TEMPLATE_SCHEDULE_NOTICE","reviewStatus":"검수완료"},{"name":"전자서명 완료 안내","envKey":"SOLAPI_TEMPLATE_ESIGN_DONE","reviewStatus":"검수완료"},{"name":"계약 체결 완료","envKey":"SOLAPI_TEMPLATE_CONTRACT_DONE","reviewStatus":"검수완료"},{"name":"간이영수증 발행 안내","envKey":"SOLAPI_TEMPLATE_RECEIPT","reviewStatus":"검수진행중"},{"name":"거래명세서 발행 안내","envKey":"SOLAPI_TEMPLATE_STATEMENT","reviewStatus":"검수진행중"},{"name":"견적서 재안내","envKey":"SOLAPI_TEMPLATE_QUOTE_REMINDER","reviewStatus":"검수진행중"},{"name":"견적서 발송 안내","envKey":"SOLAPI_TEMPLATE_QUOTE","reviewStatus":"검수진행중"}];
const alimtalkPausedTemplateKeys=new Set(["SOLAPI_TEMPLATE_PAYMENT_CONFIRMED","SOLAPI_TEMPLATE_FULL_PAYMENT","SOLAPI_TEMPLATE_DEPOSIT_DUE","SOLAPI_TEMPLATE_MIDDLE_DUE","SOLAPI_TEMPLATE_BALANCE_DUE"]);
function alimtalkTemplatePaused(templateId){return [...alimtalkPausedTemplateKeys].some(key=>env[key]&&env[key]===templateId);}
function solapiCredential(v){return String(v||'').trim().replace(/^['\"]|['\"]$/g,'').trim();}
function alimtalkAuth(){const date=new Date().toISOString(),salt=crypto.randomBytes(16).toString('hex'),key=solapiCredential(env.SOLAPI_API_KEY),secret=solapiCredential(env.SOLAPI_API_SECRET),sig=crypto.createHmac('sha256',secret).update(date+salt).digest('hex');return 'HMAC-SHA256 apiKey='+key+', date='+date+', salt='+salt+', signature='+sig;}
function alimtalkPreview(input){
 const kind=text(input.kind,40),type=alimtalkKinds[kind];check(type,400,'지원되지 않는 알림톡 종류입니다.');
 const templateId=env[type.envKey];check(templateId&&env.SOLAPI_PFID,503,'템플릿 또는 채널 설정이 완료되지 않았습니다.');
 const to=String(input.to||'').replace(/[^0-9]/g,'');check(/^01[016789][0-9]{7,8}$/.test(to),400,'수신번호를 확인해 주세요.');
 const vars={};for(const key of type.fields){const value=text((input.variables||{})[key],500);check(value,400,key+' 값을 입력해 주세요.');if(['사용일','변경사용일','지급예정일'].includes(key)){check(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,400,key+'은 YYYY-MM-DD 날짜 형식으로 입력해 주세요.');}vars['#{'+key+'}']=value;}
 const opts={pfId:env.SOLAPI_PFID,templateId,disableSms:true,variables:vars};
 if(kind==='contractSign'){const url='https://'+vars['#{서명링크}'].replace(/^https?:\/\//,'');check(/^https:\/\/[-a-z0-9.]+\/[a-zA-Z0-9_/?=&%-]+$/i.test(url)&&new URL(url).hostname.endsWith('.onrender.com'),400,'서명 링크가 올바르지 않습니다.');opts.variables['#{서명링크}']=url.slice(8);}
 return {kind,to,templateId,options:opts};
}
async function sendAlimtalk(msg){
 check(!alimtalkTemplatePaused(msg?.options?.templateId),403,'운영자가 발송 중단한 알림톡 템플릿입니다.');
 check(env.SOLAPI_API_KEY&&env.SOLAPI_API_SECRET&&env.SOLAPI_PFID,503,'SOLAPI 인증이 설정되지 않았습니다.');
 const approved=await templateInspector.sendable(alimtalkAuth);
 const template=approved.find(t=>t.templateId===msg?.options?.templateId);
 check(template,403,'SOLAPI에서 발송 가능한 승인 템플릿이 아닙니다.');
 const actualNames=templateInspector.inspect([{kind:'send',name:'send',envKey:'SOLAPI_RUNTIME_TEMPLATE',fields:null,reviewStatus:'검수완료'}],[template],{SOLAPI_RUNTIME_TEMPLATE:msg.options.templateId})[0].variables;
 const requestedNames=Object.keys(msg.options.variables||{}).map(k=>k.replace(/^#\{/,'').replace(/\}$/,'')).sort((a,b)=>a.localeCompare(b,'ko'));
 check(actualNames.length===requestedNames.length&&actualNames.every((x,i)=>x===requestedNames[i]),403,'승인 템플릿 변수명과 원비즈 전송 변수가 일치하지 않습니다.');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
 try{const r=await fetch('https://api.solapi.com/messages/v4/send-many/detail',{method:'POST',headers:{'Content-Type':'application/json',Authorization:alimtalkAuth()},body:JSON.stringify({messages:[{to:msg.to,kakaoOptions:msg.options}]}),signal:ctrl.signal});const result=await r.json();return {ok:r.ok,status:r.status,result};}
 finally{clearTimeout(timer);}
}

function userAlimtalkRequest(actor,input){
 const kind=text(input.kind,40),contractId=text(input.contractId,100);
 check(['contractSign','receivable'].includes(kind),400,'회원이 직접 발송할 수 있는 안내를 선택해 주세요.');
 check(contractId,400,'계약서 번호가 필요합니다.');
 const row=one('SELECT body FROM snapshots WHERE user_id=?',actor);
 check(row,404,'계약서 데이터를 동기화한 후 발송해 주세요.');
 const contract=(open(row.body).data?.contracts||[]).find(c=>String(c.id)===contractId);
 check(contract,404,'내 계약서에서 발송 대상을 찾을 수 없습니다.');
 const profileRow=one('SELECT profile FROM users WHERE id=?',actor),profile=open(profileRow.profile);
 const supplier=text(profile.businessName||profile.representative,120);
 check(supplier,400,'내 업체 정보를 등록해 주세요.');
 const recipient=phone(contract.phone),customer=text(contract.customer,80);
 check(customer,400,'계약 상대방 이름이 필요합니다.');
 const variables={'고객명':customer,'업체명':supplier};
 if(kind==='contractSign'){
  check(contract.signed!==true,400,'이미 체결된 계약서입니다.');
  const signUrl=text(contract.signUrl,500);
  check(signUrl,400,'이 계약서의 전자서명 링크를 먼저 생성·동기화해 주세요.');
  variables['계약금액']=Math.round(Number(contract.amount)||0).toLocaleString('ko-KR');
  variables['서명링크']=signUrl;
 }else{
  check(contract.signed===true,400,'계약 체결 확인 후 미수금을 안내할 수 있습니다.');
  const amount=Math.max(0,Math.round((Number(contract.amount)||0)-(Number(contract.paidAmount)||0)));
  check(amount>0,400,'현재 미수금이 없습니다.');
  const due=text(contract.balanceDueDate,20);
  check(due,400,'계약서의 잔금 지급예정일을 먼저 입력해 주세요.');
  variables['미수금액']=amount.toLocaleString('ko-KR');
  variables['지급예정일']=due;
 }
 const data=alimtalkPreview({kind,to:recipient,variables});
 return {...data,actor,contractId,customer,supplier,phoneMask:phoneMask(recipient)};
}
function dispatchAlimtalkPlan(dispatchRow,record,status,changed){
 const kind=changed&&status!=='작업완료'&&status!=='취소'?'dispatchChange':status==='확인중'?'dispatchRequest':status==='배차완료'&&!changed?'dispatchDone':status==='취소'?'dispatchCancel':null;
 if(!kind)return null;
 const user=one('SELECT profile,status FROM users WHERE id=?',dispatchRow.user_id);
 if(!user||user.status!=='active')return {kind,error:'신청 회원 계정 확인 필요'};
 const p=open(user.profile),applicant=text(p.representative||p.businessName,80),company=text(p.businessName||p.representative,120);
 const recipient=String(p.phone||'').replace(/\D/g,'');
 if(!/^010\d{8}$/.test(recipient))return {kind,error:'신청 회원의 휴대폰 미등록'};
 const variables={'고객명':applicant,'업체명':company,'장비종류':record.equipment,'사용일':record.date,'예정시간':record.arrivalTime||'미정','사용시간':String(record.minutes)+'분','현장주소':record.address,'변경사용일':record.date,'변경시간':record.arrivalTime||'미정'};
 try{const data=alimtalkPreview({kind,to:recipient,variables});return {...data,actor:dispatchRow.user_id,dispatchId:dispatchRow.id,phoneMask:phoneMask(recipient)};}
 catch(e){return {kind,error:e.status?e.message:'알림톡 구성 오류'};}
}
function alimtalkResultLog(actor,kind,targetRef,data,result,status){
 const id=crypto.randomUUID();
 const safe={httpStatus:result?.status||0,providerError:result?.ok?'':text(result?.result?.error||result?.result?.message||'',160)};
 run('INSERT INTO alimtalk_logs(id,actor,kind,target_ref,phone_mask,template_id,status,response,created) VALUES(?,?,?,?,?,?,?,?,?)',id,actor,kind,targetRef,data.phoneMask||phoneMask(data.to),data.templateId,status,JSON.stringify(safe),Date.now());
 return id;
}
function alimtalkSendingAllowed(mode){
 return env.SOLAPI_SEND_ENABLED==='true'&&env.SOLAPI_TEMPLATE_VARIABLES_VERIFIED==='true'&&(mode==='user'?env.SOLAPI_MEMBER_SEND_ENABLED==='true':env.SOLAPI_DISPATCH_AUTO_ENABLED==='true');
}
function dispatchValidate(b,previous={}){const pick=(k,d='')=>b[k]!==undefined?b[k]:(previous[k]!==undefined?previous[k]:d);const customerName=text(pick('customerName'),80),equipment=text(pick('equipment'),30),address=text(pick('address'),300),date=text(pick('date'),20),arrivalTime=text(pick('arrivalTime'),10),floor=text(pick('floor'),30),goods=text(pick('goods'),200),note=text(pick('note'),500),minutes=Number(pick('minutes',30)),phoneValue=phone(pick('phone')),estimatedAmount=Math.max(0,Math.round(Number(pick('estimatedAmount',0))||0)),requiresControlRoom=pick('requiresControlRoom',false)===true,controlRoomConfirmed=pick('controlRoomConfirmed',false)===true;check(['사다리차','스카이차','크레인'].includes(equipment),400,'장비를 선택해 주세요.');check(address&&/^\d{4}-\d{2}-\d{2}$/.test(date),400,'주소와 날짜를 확인해 주세요.');if(arrivalTime)check(/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime),400,'도착시간을 확인해 주세요.');check(Number.isInteger(minutes)&&minutes>=30&&minutes<=1440&&minutes%30===0,400,'사용시간은 30분 단위로 입력해 주세요.');check(estimatedAmount<=100000000,400,'예상요금을 확인해 주세요.');return {customerName,equipment,address,date,arrivalTime,floor,goods,note,minutes,phone:phoneValue,estimatedAmount,requiresControlRoom,controlRoomConfirmed};}
function snapshotValidate(b){check(b.data&&typeof b.data==='object'&&!Array.isArray(b.data),400,'업무 데이터를 확인해 주세요.');for(const k of ['customers','quotes','contracts'])check(Array.isArray(b.data[k])&&b.data[k].length<=10000,400,'업무 목록 형식 또는 개수를 확인해 주세요.');check(Array.isArray(b.employees)&&b.employees.length<=10000,400,'직원 목록 형식을 확인해 주세요.');const out=JSON.parse(JSON.stringify({data:b.data,employees:b.employees}));for(const a of [...Object.values(out.data),out.employees]){if(Array.isArray(a))for(const item of a)check(item&&typeof item==='object'&&!Array.isArray(item),400,'각 항목은 객체여야 합니다.');}return out;}
function countsFor(s){return {customers:s.data.customers.length,quotes:s.data.quotes.length,contracts:s.data.contracts.length,signed:s.data.contracts.filter(c=>c.signed===true).length,employees:s.employees.length};}
function quoteSupply(q){return Math.max(0,(Array.isArray(q.items)?q.items:[]).reduce((sum,i)=>sum+(Number(i.qty)||0)*(Number(i.unitPrice)||0),0)-(Number(q.discountAmount)||0));}
function quoteVat(q){return q.vatEnabled===false?0:Math.round(quoteSupply(q)*0.1);}
function quoteTotal(q){return quoteSupply(q)+quoteVat(q);}
function quoteValidUntil(q){const days=Math.max(1,Math.min(365,Number(q.validityDays)||15)),date=/^\d{4}-\d{2}-\d{2}$/.test(String(q.createdAt||''))?String(q.createdAt):new Date().toISOString().slice(0,10);return Date.parse(date+'T23:59:59+09:00')+(days-1)*86400000;}
function publicQuotePayload(userId,q){const row=one('SELECT profile FROM users WHERE id=?',userId);check(row,404,'견적서를 찾을 수 없습니다.');const p=open(row.profile),items=(Array.isArray(q.items)?q.items:[]).map(i=>({name:text(i.name,160),spec:text(i.spec,160),qty:Number(i.qty)||0,unitPrice:Number(i.unitPrice)||0,amount:(Number(i.qty)||0)*(Number(i.unitPrice)||0)}));return {supplier:{businessName:text(p.businessName||'ONEBIZ',120),representative:text(p.representative,80),phone:text(p.phone,40),registrationNo:text(p.registrationNo,40),address:[p.address,p.addressDetail].filter(Boolean).join(' ')},quote:{id:text(q.id,100),customer:text(q.customer,100),createdAt:text(q.createdAt,20),siteAddress:[q.siteAddress,q.siteAddressDetail].filter(Boolean).join(' '),items,discountAmount:Number(q.discountAmount)||0,vatEnabled:q.vatEnabled!==false,note:text(q.note,2000),validityDays:Math.max(1,Number(q.validityDays)||15),status:text(q.status,40),supply:quoteSupply(q),vat:quoteVat(q),total:quoteTotal(q),validUntil:quoteValidUntil(q)}};}
function publicContractPayload(userId,c){const row=one('SELECT profile FROM users WHERE id=?',userId);check(row,404,'계약서를 찾을 수 없습니다.');const p=open(row.profile),amount=Math.max(0,Number(c.amount)||0),paid=Math.max(0,Number(c.paidAmount)||0);return {supplier:{businessName:text(p.businessName||'ONEBIZ',120),representative:text(p.representative,80),phone:text(p.phone,40),registrationNo:text(p.registrationNo,40),address:[p.address,p.addressDetail].filter(Boolean).join(' ')},contract:{id:text(c.id,100),customer:text(c.customer,100),item:text(c.item,300),amount,contractDate:text(c.contractDate,20),workDate:text(c.workDate,20),siteAddress:[c.siteAddress,c.siteAddressDetail].filter(Boolean).join(' '),depositAmount:Number(c.depositAmount)||0,depositDueDate:text(c.depositDueDate,20),middleAmount:Number(c.middleAmount)||0,middleDueDate:text(c.middleDueDate,20),balanceAmount:Number(c.balanceAmount)||0,balanceDueDate:text(c.balanceDueDate,20),paidAmount:paid,receivable:Math.max(0,amount-paid),signed:c.signed===true}};}
function publicStatementPayload(userId,c,q){const row=one('SELECT profile FROM users WHERE id=?',userId);check(row,404,'거래명세서를 찾을 수 없습니다.');const p=open(row.profile),amount=Math.max(0,Number(c.amount)||0),paid=Math.max(0,Number(c.paidAmount)||0),quoteItems=Array.isArray(q?.items)?q.items:[],items=quoteItems.length?quoteItems.map(i=>({name:text(i.name,160),spec:text(i.spec,160),qty:Number(i.qty)||0,unitPrice:Number(i.unitPrice)||0,amount:(Number(i.qty)||0)*(Number(i.unitPrice)||0)})):[{name:text(c.item||'계약금액',160),spec:'',qty:1,unitPrice:amount,amount}];const supply=q?quoteSupply(q):amount,vat=q?quoteVat(q):0,total=q?quoteTotal(q):amount;return {supplier:{businessName:text(p.businessName||'ONEBIZ',120),representative:text(p.representative,80),phone:text(p.phone,40),registrationNo:text(p.registrationNo,40),address:[p.address,p.addressDetail].filter(Boolean).join(' ')},statement:{id:'TS-'+text(c.id,90),contractId:text(c.id,100),customer:text(c.customer,100),issuedAt:new Date().toISOString().slice(0,10),contractDate:text(c.contractDate,20),siteAddress:[c.siteAddress,c.siteAddressDetail].filter(Boolean).join(' '),items,supply,vat,total,paidAmount:paid,receivable:Math.max(0,amount-paid)}};}
function publicReceiptPayload(userId,c){const row=one('SELECT profile FROM users WHERE id=?',userId);check(row,404,'간이영수증을 찾을 수 없습니다.');const p=open(row.profile),paid=Math.max(0,Number(c.paidAmount)||0),amount=Math.max(0,Number(c.amount)||0);check(paid>0,400,'입금 등록 후 간이영수증을 발행할 수 있습니다.');return {supplier:{businessName:text(p.businessName||'ONEBIZ',120),representative:text(p.representative,80),phone:text(p.phone,40),registrationNo:text(p.registrationNo,40),address:[p.address,p.addressDetail].filter(Boolean).join(' ')},receipt:{id:'RC-'+text(c.id,90),contractId:text(c.id,100),customer:text(c.customer,100),item:text(c.item||'계약대금',300),issuedAt:new Date().toISOString().slice(0,10),contractDate:text(c.contractDate,20),siteAddress:[c.siteAddress,c.siteAddressDetail].filter(Boolean).join(' '),paidAmount:paid,contractAmount:amount,receivable:Math.max(0,amount-paid)}};}
function masked(v){const s=String(v||'');if(!s)return '';return s.length<3?s.slice(0,1)+'*':s.slice(0,1)+'*'.repeat(Math.min(s.length-2,5))+s.slice(-1);}
function phoneMask(v){const d=String(v||'').replace(/\D/g,'');return d.length>=8?d.slice(0,3)+'-****-'+d.slice(-4):'-';}
function publicStats(u,full=false){const p=open(u.profile),snap=one('SELECT counts,updated FROM snapshots WHERE user_id=?',u.id),identities=all('SELECT provider FROM identities WHERE user_id=?',u.id).map(i=>i.provider),businessType=String(p.businessType||(p.profileType==='BUSINESS'?'개인사업자':'개인/프리랜서'));return {id:u.id,name:full?String(p.representative||''):masked(p.representative),businessName:full?String(p.businessName||''):masked(p.businessName),phone:full?String(p.phone||''):phoneMask(p.phone),address:full?[p.address,p.addressDetail].filter(Boolean).join(' '):'',industry:full?String(p.industry||''):'',registrationNo:full?String(p.registrationNo||''):'',businessType,type:p.profileType,profileComplete:!!u.complete,createdAt:u.created,lastLogin:u.last_login,status:u.status,subscription:subscriptionInfo(u),identities,counts:snap?JSON.parse(snap.counts):{customers:0,quotes:0,contracts:0,signed:0,employees:0},lastSync:snap?.updated||null};}
async function route(req,res){
 const u=new URL(req.url,origin),p=u.pathname,m=req.method;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 if(!local)res.setHeader('Strict-Transport-Security','max-age=31536000');
 if(p==='/health')return json(res,200,{ok:true,version:'2.0.0-dev.1',mode});
 if(p==='/api/config'&&m==='GET')return json(res,200,{mode,providers:Object.fromEntries(['kakao','naver','google'].map(k=>[k,provider.configured(env,k)])),phoneEnabled:local||!!(env.NCP_SERVICE_ID&&env.NCP_ACCESS_KEY&&env.NCP_SECRET_KEY&&env.NCP_SENDER),policyVersion,nativeSync:'automatic-account-sync',push:false,payments:false,subscription:{billingConnected:false,plans:['free','pro'],featureGateReady:true}});
 if(p==='/api/auth/phone/request'&&m==='POST'){
  writeGuard(req);limit(req,'sms-ip:'+ip(req),20,3600000);const b=await body(req),number=phone(b.phone),c=consent(b);
  let link=null;if(b.link===true){const s=getSession(req);writeGuard(req,s);check(Date.now()-s.created<600000,403,'로그인 후 10분 이내에 계정을 연결해 주세요.');link=s.actor;}
  check(local||env.NCP_SERVICE_ID&&env.NCP_ACCESS_KEY&&env.NCP_SECRET_KEY&&env.NCP_SENDER,503,'문자 인증 서비스 설정 전입니다.');
  limit(req,'sms-minute:'+number,1,60000);limit(req,'sms-hour:'+number,5,3600000);limit(req,'sms-global',Number(env.SMS_DAILY_LIMIT||100),86400000);
  const id=random(),code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  if(!local)await provider.sendSMS(env,number,code);
  run('UPDATE otp SET used=1 WHERE phone_hash=?',hash(number));
  run('INSERT INTO otp(id,phone,phone_hash,hash,expires,consent,link_user) VALUES(?,?,?,?,?,?,?)',id,seal(number),hash(number),hash(id+':'+code),Date.now()+300000,JSON.stringify(c),link);
  log(link||'anonymous','otp.request','',{mode});return json(res,200,{ok:true,challengeId:id,expiresIn:300,...(local?{demoCode:code,notice:'개발 모드: 실제 문자 발송 없음'}:{})});
 }
 if(p==='/api/auth/phone/verify'&&m==='POST'){
  writeGuard(req);limit(req,'verify-ip:'+ip(req),30,600000);const b=await body(req),o=one('SELECT * FROM otp WHERE id=?',text(b.challengeId,100));
  check(o&&!o.used&&o.expires>Date.now()&&o.attempts<5,400,'인증번호가 만료되었거나 시도 횟수를 초과했습니다.');
  run('UPDATE otp SET attempts=attempts+1 WHERE id=?',o.id);check(equal(o.hash,hash(o.id+':'+String(b.code||''))),400,'인증번호가 올바르지 않습니다.');
  if(o.link_user){const s=getSession(req);writeGuard(req,s);check(s.actor===o.link_user,403,'연결 요청 계정이 다릅니다.');}
  run('UPDATE otp SET used=1 WHERE id=?',o.id);
  const id=identity('phone',open(o.phone),JSON.parse(o.consent),o.link_user);
  if(o.link_user){const row=one('SELECT profile FROM users WHERE id=?',id),prof=open(row.profile);prof.phone=open(o.phone);run('UPDATE users SET profile=?,profile_rev=profile_rev+1 WHERE id=?',seal(prof),id);}
  const ses=sessionCreate(req,res,id);return json(res,200,{ok:true,...ses,user:userInfo(id)});
 }
 if(/^\/api\/auth\/social\/(kakao|naver|google)$/.test(p)&&m==='POST'){
  writeGuard(req);limit(req,'social:'+ip(req),30,600000);const b=await body(req),name=p.split('/').pop();check(provider.configured(env,name),503,'소셜 로그인 앱 키·콜백 주소 설정 전입니다.');
  let terms;
  const deviceRequest=text(b.deviceRequest,100);
  if(deviceRequest){
   const d=one('SELECT provider,consent,expires,used FROM devices WHERE id=?',deviceRequest);
   check(d&&!d.used&&d.expires>Date.now()&&d.provider===name,400,'기기 로그인 요청이 만료되었거나 일치하지 않습니다.');
   try{terms=JSON.parse(d.consent||'{}');}catch{terms={};}
   check(terms.terms===true&&terms.privacy===true,400,'필수 약관과 개인정보 안내를 확인해 주세요.');
  }else terms=consent(b);
  let link=null;if(b.link===true){const s=getSession(req);writeGuard(req,s);check(Date.now()-s.created<600000,403,'다시 로그인한 후 연결해 주세요.');link=s.actor;}
  const state=random(),binding=random(),verifier=random(),nonce=random();
  run('INSERT INTO oauth(state_hash,provider,binding,verifier,nonce,expires,consent,link_user,device_request) VALUES(?,?,?,?,?,?,?,?,?)',hash(state),name,hash(binding),seal(verifier),nonce,Date.now()+600000,JSON.stringify(terms),link,'');
  setCookie(res,'ob_oauth',binding,600);return json(res,200,{url:provider.authUrl(env,name,origin,state,verifier,nonce)});
 }
 if(/^\/auth\/callback\/(kakao|naver|google)$/.test(p)&&m==='GET'){
  const name=p.split('/').pop(),state=u.searchParams.get('state')||'',s=one('SELECT * FROM oauth WHERE state_hash=?',hash(state));
  const deviceRequest=String(s?.device_request||''),isDevice=!!deviceRequest;
  check(s&&s.expires>Date.now()&&s.provider===name&&(isDevice||equal(s.binding,hash(cookie(req,'ob_oauth')))),400,'로그인 요청이 만료되었거나 확인되지 않았습니다. 시작 화면에서 다시 시도해 주세요.');
  run('DELETE FROM oauth WHERE state_hash=?',hash(state));if(!isDevice)setCookie(res,'ob_oauth','',0);check(!u.searchParams.get('error')&&u.searchParams.get('code'),400,'소셜 로그인이 취소되었습니다.');
  if(s.link_user)check(getSession(req).actor===s.link_user,403,'연결 계정이 일치하지 않습니다.');
  const result=await provider.exchange(env,name,origin,u.searchParams.get('code'),state,open(s.verifier),s.nonce);
  const id=identity(name,result.subject,JSON.parse(s.consent),s.link_user,result.name);
  if(isDevice){
   const d=one('SELECT * FROM devices WHERE id=?',deviceRequest);
   check(d&&!d.used&&!d.user_id&&d.expires>Date.now()&&d.provider===name,400,'앱 로그인 요청이 만료되었습니다. 원비즈 앱에서 다시 시작해 주세요.');
   run('UPDATE devices SET user_id=? WHERE id=?',id,d.id);log(id,'device.social.approve',d.id,{provider:name});
   return redirect(res,'onebiz://connected');
  }
  sessionCreate(req,res,id);return redirect(res,'/');
 }
 if(p==='/api/me'&&m==='GET'){const s=getSession(req);return json(res,200,{ok:true,csrf:s.csrf,user:userInfo(s.actor)});}
 if(p==='/api/logout'&&m==='POST'){const s=getSession(req);writeGuard(req,s);run('DELETE FROM sessions WHERE hash=?',s.hash);setCookie(res,'ob_user','',0);return json(res,200,{ok:true});}
 if(p==='/api/profile'&&m==='PUT'){const s=getSession(req);writeGuard(req,s);const b=await body(req),profile=profileValidate(b.profile||{});const row=one('SELECT profile_rev FROM users WHERE id=?',s.actor);check(b.revision===row.profile_rev,409,'다른 기기에서 정보가 변경됐습니다. 새로 불러와 주세요.');run('UPDATE users SET profile=?,profile_rev=profile_rev+1,complete=1 WHERE id=?',seal(profile),s.actor);log(s.actor,'profile.update',s.actor);return json(res,200,{ok:true,user:userInfo(s.actor)});}
 if(p==='/api/snapshot'&&m==='GET'){const s=getSession(req),r=one('SELECT * FROM snapshots WHERE user_id=?',s.actor);return json(res,200,{ok:true,userId:s.actor,revision:r?.revision||0,updatedAt:r?.updated||null,profile:userInfo(s.actor).profile,...(r?open(r.body):{data:{customers:[],quotes:[],contracts:[]},employees:[]})});}
 if(p==='/api/snapshot'&&m==='PUT'){
  const s=getSession(req);writeGuard(req,s);const b=await body(req),snap=snapshotValidate(b);check(userInfo(s.actor).profileComplete,400,'기본정보를 먼저 등록해 주세요.');
  const revision=tx(()=>{const row=one('SELECT revision,body FROM snapshots WHERE user_id=?',s.actor),previous=row?open(row.body):null;check(b.revision===(row?.revision||0),409,'다른 기기의 최신 데이터가 있습니다. 덮어쓰지 않았습니다. 새로 불러와 주세요.');
   // V2 일반 편집 API는 새로운 전자서명 체결을 생성하지 않는다. 기존 체결기록은 보존한다.
   const signed=(previous?.data.contracts||[]).filter(c=>c.signed===true);for(const old of signed){const next=snap.data.contracts.find(c=>c.id===old.id);check(next&&next.signed===true,409,'체결된 계약 원본은 이 화면에서 삭제하거나 서명을 변경할 수 없습니다.');for(const k of ['customer','amount','item','standardTerms','specialTerms','signatureName','signaturePath','signedAt','consentAccepted'])check(JSON.stringify(next[k])===JSON.stringify(old[k]),409,'체결된 계약 원문은 변경할 수 없습니다.');}
   for(const c of snap.data.contracts.filter(c=>c.signed===true))check(signed.some(x=>x.id===c.id)||s.bearer,400,'전자서명은 별도 서명 절차에서 처리해야 합니다.');
   const rev=(row?.revision||0)+1;run('INSERT OR REPLACE INTO snapshots VALUES(?,?,?,?,?)',s.actor,rev,seal(snap),JSON.stringify(countsFor(snap)),Date.now());return rev;});
  log(s.actor,'snapshot.save',s.actor,{revision});return json(res,200,{ok:true,revision});
 }
 if(/^\/api\/quotes\/[^/]+\/public-link$/.test(p)&&m==='POST'){
  const s=getSession(req);writeGuard(req,s);const quoteId=decodeURIComponent(p.split('/')[3]),row=one('SELECT body FROM snapshots WHERE user_id=?',s.actor);check(row,404,'견적서 데이터를 먼저 동기화해 주세요.');const snap=open(row.body),q=(snap.data?.quotes||[]).find(x=>String(x.id)===quoteId);check(q,404,'견적서를 찾을 수 없습니다.');const expires=quoteValidUntil(q);check(expires>Date.now(),400,'견적 유효기간이 지났습니다. 유효기간을 수정한 후 다시 발송해 주세요.');const token=random();run('INSERT OR REPLACE INTO quote_links(token_hash,user_id,quote_id,expires,created,last_view) VALUES(?,?,?,?,?,0)',hash(token),s.actor,quoteId,expires,Date.now());log(s.actor,'quote.public_link.create',quoteId,{expires});return json(res,200,{ok:true,token,url:origin+'/quote/'+token,expiresAt:expires});
 }
 if(/^\/api\/quotes\/[^/]+\/public-link$/.test(p)&&m==='DELETE'){
  const s=getSession(req);writeGuard(req,s);const quoteId=decodeURIComponent(p.split('/')[3]);run('DELETE FROM quote_links WHERE user_id=? AND quote_id=?',s.actor,quoteId);log(s.actor,'quote.public_link.revoke',quoteId);return json(res,200,{ok:true});
 }
 if(/^\/api\/public\/quote\/[A-Za-z0-9_-]{43}$/.test(p)&&m==='GET'){
  limit(req,'public-quote:'+ip(req),120,600000);const token=p.split('/').pop(),link=one('SELECT * FROM quote_links WHERE token_hash=?',hash(token));check(link,404,'견적 링크를 찾을 수 없습니다.');check(link.expires>Date.now(),410,'견적 링크가 만료되었습니다.');const row=one('SELECT body FROM snapshots WHERE user_id=?',link.user_id);check(row,404,'견적서를 찾을 수 없습니다.');const snap=open(row.body),q=(snap.data?.quotes||[]).find(x=>String(x.id)===String(link.quote_id));check(q,404,'견적서를 찾을 수 없습니다.');run('UPDATE quote_links SET last_view=? WHERE token_hash=?',Date.now(),link.token_hash);return json(res,200,{ok:true,...publicQuotePayload(link.user_id,q),linkExpiresAt:link.expires});
 }
 if(/^\/api\/contracts\/[^/]+\/public-link$/.test(p)&&m==='POST'){
  const s=getSession(req);writeGuard(req,s);const contractId=decodeURIComponent(p.split('/')[3]),row=one('SELECT body FROM snapshots WHERE user_id=?',s.actor);check(row,404,'계약서 데이터를 먼저 동기화해 주세요.');const snap=open(row.body),contract=(snap.data?.contracts||[]).find(x=>String(x.id)===contractId);check(contract,404,'계약서를 찾을 수 없습니다.');check(contract.signed===true,400,'체결 완료된 계약서만 확인 링크를 만들 수 있습니다.');const expires=Date.now()+365*86400000,token=random();run('INSERT OR REPLACE INTO contract_links(token_hash,user_id,contract_id,expires,created,last_view) VALUES(?,?,?,?,?,0)',hash(token),s.actor,contractId,expires,Date.now());return json(res,200,{ok:true,token,url:origin+'/contract/'+token,expiresAt:expires});
 }
 if(/^\/api\/public\/contract\/[A-Za-z0-9_-]{43}$/.test(p)&&m==='GET'){
  limit(req,'public-contract:'+ip(req),120,600000);const token=p.split('/').pop(),link=one('SELECT * FROM contract_links WHERE token_hash=?',hash(token));check(link,404,'계약서 링크를 찾을 수 없습니다.');check(link.expires>Date.now(),410,'계약서 링크가 만료되었습니다.');const row=one('SELECT body FROM snapshots WHERE user_id=?',link.user_id);check(row,404,'계약서를 찾을 수 없습니다.');const snap=open(row.body),contract=(snap.data?.contracts||[]).find(x=>String(x.id)===String(link.contract_id));check(contract&&contract.signed===true,404,'체결 완료된 계약서를 찾을 수 없습니다.');run('UPDATE contract_links SET last_view=? WHERE token_hash=?',Date.now(),link.token_hash);return json(res,200,{ok:true,...publicContractPayload(link.user_id,contract),linkExpiresAt:link.expires});
 }
 if(/^\/api\/contracts\/[^/]+\/statement-link$/.test(p)&&m==='POST'){
  const s=getSession(req);writeGuard(req,s);const contractId=decodeURIComponent(p.split('/')[3]),row=one('SELECT body FROM snapshots WHERE user_id=?',s.actor);check(row,404,'계약서 데이터를 먼저 동기화해 주세요.');const snap=open(row.body),contract=(snap.data?.contracts||[]).find(x=>String(x.id)===contractId);check(contract,404,'계약서를 찾을 수 없습니다.');check(contract.signed===true,400,'체결 완료된 계약서만 거래명세서를 발행할 수 있습니다.');const expires=Date.now()+365*86400000,token=random();run('INSERT OR REPLACE INTO statement_links(token_hash,user_id,contract_id,expires,created,last_view) VALUES(?,?,?,?,?,0)',hash(token),s.actor,contractId,expires,Date.now());log(s.actor,'statement.public_link.create',contractId,{expires});return json(res,200,{ok:true,token,url:origin+'/statement/'+token,expiresAt:expires});
 }
 if(/^\/api\/public\/statement\/[A-Za-z0-9_-]{43}$/.test(p)&&m==='GET'){
  limit(req,'public-statement:'+ip(req),120,600000);const token=p.split('/').pop(),link=one('SELECT * FROM statement_links WHERE token_hash=?',hash(token));check(link,404,'거래명세서 링크를 찾을 수 없습니다.');check(link.expires>Date.now(),410,'거래명세서 링크가 만료되었습니다.');const row=one('SELECT body FROM snapshots WHERE user_id=?',link.user_id);check(row,404,'거래명세서를 찾을 수 없습니다.');const snap=open(row.body),contract=(snap.data?.contracts||[]).find(x=>String(x.id)===String(link.contract_id));check(contract&&contract.signed===true,404,'거래명세서를 찾을 수 없습니다.');const quote=(snap.data?.quotes||[]).find(x=>String(x.id)===String(contract.quoteId||''));run('UPDATE statement_links SET last_view=? WHERE token_hash=?',Date.now(),link.token_hash);return json(res,200,{ok:true,...publicStatementPayload(link.user_id,contract,quote),linkExpiresAt:link.expires});
 }
 if(/^\/api\/contracts\/[^/]+\/receipt-link$/.test(p)&&m==='POST'){
  const s=getSession(req);writeGuard(req,s);const contractId=decodeURIComponent(p.split('/')[3]),row=one('SELECT body FROM snapshots WHERE user_id=?',s.actor);check(row,404,'계약서 데이터를 먼저 동기화해 주세요.');const snap=open(row.body),contract=(snap.data?.contracts||[]).find(x=>String(x.id)===contractId);check(contract,404,'계약서를 찾을 수 없습니다.');check(contract.signed===true,400,'체결 완료된 계약서만 간이영수증을 발행할 수 있습니다.');check((Number(contract.paidAmount)||0)>0,400,'입금 등록 후 간이영수증을 발행할 수 있습니다.');const expires=Date.now()+365*86400000,token=random();run('INSERT OR REPLACE INTO receipt_links(token_hash,user_id,contract_id,expires,created,last_view) VALUES(?,?,?,?,?,0)',hash(token),s.actor,contractId,expires,Date.now());log(s.actor,'receipt.public_link.create',contractId,{expires});return json(res,200,{ok:true,token,url:origin+'/receipt/'+token,expiresAt:expires});
 }
 if(/^\/api\/public\/receipt\/[A-Za-z0-9_-]{43}$/.test(p)&&m==='GET'){
  limit(req,'public-receipt:'+ip(req),120,600000);const token=p.split('/').pop(),link=one('SELECT * FROM receipt_links WHERE token_hash=?',hash(token));check(link,404,'간이영수증 링크를 찾을 수 없습니다.');check(link.expires>Date.now(),410,'간이영수증 링크가 만료되었습니다.');const row=one('SELECT body FROM snapshots WHERE user_id=?',link.user_id);check(row,404,'간이영수증을 찾을 수 없습니다.');const snap=open(row.body),contract=(snap.data?.contracts||[]).find(x=>String(x.id)===String(link.contract_id));check(contract&&contract.signed===true,404,'간이영수증을 찾을 수 없습니다.');run('UPDATE receipt_links SET last_view=? WHERE token_hash=?',Date.now(),link.token_hash);return json(res,200,{ok:true,...publicReceiptPayload(link.user_id,contract),linkExpiresAt:link.expires});
 }
 if(p==='/api/device/start'&&m==='POST'){
  writeGuard(req);limit(req,'device-start:'+ip(req),10,600000);const b=await body(req);check(/^[a-zA-Z0-9_-]{43}$/.test(b.challenge||''),400,'기기 인증 요청을 확인해 주세요.');
  const providerName=['kakao','naver','google'].includes(String(b.provider||''))?String(b.provider):'';
  let deviceConsent={};if(providerName){check(provider.configured(env,providerName),503,'소셜 로그인 앱 키·콜백 주소 설정 전입니다.');deviceConsent=consent(b);}
  const id=random(),phrase=crypto.randomInt(100000,1000000).toString();
  run('INSERT INTO devices(id,challenge,phrase,expires,provider,consent) VALUES(?,?,?,?,?,?)',id,b.challenge,phrase,Date.now()+600000,providerName,JSON.stringify(deviceConsent));
  if(providerName){
   const state=random(),binding=random(),oauthVerifier=random(),nonce=random();
   run('INSERT INTO oauth(state_hash,provider,binding,verifier,nonce,expires,consent,link_user,device_request) VALUES(?,?,?,?,?,?,?,?,?)',hash(state),providerName,hash(binding),seal(oauthVerifier),nonce,Date.now()+600000,JSON.stringify(deviceConsent),null,id);
   return json(res,200,{requestId:id,authUrl:provider.authUrl(env,providerName,origin,state,oauthVerifier,nonce),interval:3,expiresIn:600,provider:providerName});
  }
  const verificationUrl=origin+'/connect?request='+encodeURIComponent(id);
  return json(res,200,{requestId:id,verificationUrl,phrase,interval:3,expiresIn:600,provider:null});
 }
 if(p==='/api/device/info'&&m==='GET'){getSession(req);const d=one('SELECT phrase,expires FROM devices WHERE id=? AND used=0',u.searchParams.get('request')||'');check(d&&d.expires>Date.now(),404,'기기 연결 요청이 만료되었습니다.');return json(res,200,{phrase:d.phrase});}
 if(p==='/api/device/approve'&&m==='POST'){const s=getSession(req);writeGuard(req,s);check(Date.now()-s.created<600000,403,'다시 로그인한 후 기기를 연결해 주세요.');check(userInfo(s.actor).profileComplete,400,'기본정보 등록 후 연결해 주세요.');const b=await body(req);const d=one('SELECT * FROM devices WHERE id=?',text(b.requestId,100));check(d&&!d.used&&!d.user_id&&d.expires>Date.now()&&b.confirm===true,400,'연결 요청을 확인해 주세요.');run('UPDATE devices SET user_id=? WHERE id=?',s.actor,d.id);log(s.actor,'device.approve',d.id);return json(res,200,{ok:true});}
 if(p==='/api/device/poll'&&m==='POST'){writeGuard(req);limit(req,'device-poll:'+ip(req),240,600000);const b=await body(req),d=one('SELECT * FROM devices WHERE id=?',text(b.requestId,100));check(d&&!d.used&&d.expires>Date.now()&&/^[a-zA-Z0-9_-]{43,128}$/.test(b.verifier||'')&&equal(sha(b.verifier),d.challenge),400,'기기 연결 요청이 만료되었거나 확인되지 않았습니다.');if(!d.user_id)return json(res,202,{pending:true});check(one('SELECT status FROM users WHERE id=?',d.user_id)?.status==='active',403,'이용 제한된 계정입니다.');run('UPDATE devices SET used=1 WHERE id=?',d.id);return json(res,200,{ok:true,userId:d.user_id,...sessionCreate(req,res,d.user_id,'user','owner',true)});}

 if(p==='/api/alimtalk/customer/preview'&&m==='POST'){
  const s=getSession(req);writeGuard(req,s);limit(req,'customer-alim-preview:'+s.actor,45,600000);
  const data=userAlimtalkRequest(s.actor,await body(req));
  log(s.actor,'alimtalk.customer.preview',data.contractId,{kind:data.kind});
  return json(res,200,{ok:true,dryRun:true,kind:data.kind,contractId:data.contractId,customer:data.customer,supplier:data.supplier,maskedTo:data.phoneMask,variables:data.options.variables,sendEnabled:alimtalkSendingAllowed('user')});
 }
 if(p==='/api/alimtalk/customer/send'&&m==='POST'){
  const s=getSession(req);writeGuard(req,s);
  check(alimtalkSendingAllowed('user'),503,'승인 템플릿 확인 및 회원 발송 설정 전입니다. 미리보기만 가능합니다.');
  const b=await body(req);check(b.confirm===true,400,'회원의 발송 확인이 필요합니다.');
  limit(req,'customer-alim-minute:'+s.actor,3,60000);limit(req,'customer-alim-day:'+s.actor,30,86400000);
  const data=userAlimtalkRequest(s.actor,b);
  const ref='contract:'+data.contractId;
  const last=one("SELECT created FROM alimtalk_logs WHERE actor=? AND kind=? AND target_ref=? AND status='accepted' ORDER BY created DESC LIMIT 1",s.actor,data.kind,ref);
  check(!last||Date.now()-last.created>=600000,429,'같은 계약에 대한 발송은 10분 후 다시 시도할 수 있습니다.');
  let result;try{result=await sendAlimtalk(data);}catch{result={ok:false,status:0,result:{error:'외부 발송 서비스 연결 실패'}};}
  const id=alimtalkResultLog(s.actor,data.kind,ref,data,result,result.ok?'accepted':'failed');
  log(s.actor,'alimtalk.customer.send',ref,{kind:data.kind,accepted:result.ok});
  return json(res,result.ok?200:502,{ok:result.ok,requestId:id,accepted:result.ok,notice:'SOLAPI 접수 결과이며 실제 수신 성공 여부는 발송내역 확인이 필요합니다.'});
 }
 if(p==='/api/alimtalk/customer/logs'&&m==='GET'){
  const s=getSession(req);
  return json(res,200,{items:all("SELECT id,kind,target_ref,phone_mask,status,created FROM alimtalk_logs WHERE actor=? AND target_ref LIKE 'contract:%' ORDER BY created DESC LIMIT 50",s.actor)});
 }
 if(p==='/api/dispatch'&&m==='POST'){const s=getSession(req);writeGuard(req,s);const b=await body(req),record=dispatchValidate(b);const id=crypto.randomUUID();run('INSERT INTO dispatch(id,user_id,body,status,created) VALUES(?,?,?,?,?)',id,s.actor,seal(record),'접수대기',Date.now());log(s.actor,'dispatch.create',id,{equipment:record.equipment,date:record.date});return json(res,201,{ok:true,id,status:'접수대기',record});}
 if(p==='/api/dispatch'&&m==='GET'){const s=getSession(req);return json(res,200,{items:all('SELECT * FROM dispatch WHERE user_id=? ORDER BY created DESC',s.actor).map(d=>({id:d.id,status:d.status,created:d.created,...open(d.body)}))});}
 if(p==='/api/notices'&&m==='GET'){const s=getSession(req),now=Date.now();return json(res,200,{items:all("SELECT * FROM notices WHERE active=1 AND starts<=? AND ends>? AND (target='all' OR target=?) ORDER BY important DESC,created DESC",now,now,s.actor)});}
 if(p==='/api/admin/login'&&m==='POST'){
  writeGuard(req);limit(req,'admin-ip:'+ip(req),10,900000);const b=await body(req),username=text(b.username,120).toLowerCase();limit(req,'admin-name:'+username,10,900000);const a=one('SELECT * FROM admins WHERE username=?',username);
  const calculated=passwordHash(String(b.password||''),a?.salt||'dummy-salt');check(a&&equal(calculated,a.password),401,'관리자 인증에 실패했습니다.');
  if(!local||a.totp){check(a.totp,403,'관리자 2단계 인증 설정이 필요합니다.');const step=Math.floor(Date.now()/30000);let accepted=-1;for(const x of [step-1,step,step+1])if(x>a.last_step&&equal(totp(open(a.totp),x),String(b.code||'')))accepted=x;check(accepted>=0,401,'2단계 인증번호를 확인해 주세요.');run('UPDATE admins SET last_step=? WHERE id=?',accepted,a.id);}
  log(a.id,'admin.login',a.id);return json(res,200,{ok:true,...sessionCreate(req,res,a.id,'admin',a.role)});
 }
 if(p==='/api/admin/me'&&m==='GET'){const s=mustAdmin(req);return json(res,200,{csrf:s.csrf,role:s.role,username:one('SELECT username FROM admins WHERE id=?',s.actor).username});}
 if(p==='/api/admin/logout'&&m==='POST'){const s=mustAdmin(req);writeGuard(req,s);run('DELETE FROM sessions WHERE hash=?',s.hash);setCookie(res,'ob_admin','',0);return json(res,200,{ok:true});}
 if(p==='/api/admin/alimtalk/provider-check'&&m==='GET'){
  const s=mustAdmin(req,['owner','operator']);
  limit(req,'alimtalk-provider-check:'+s.actor,12,3600000);
  check(env.SOLAPI_API_KEY&&env.SOLAPI_API_SECRET,503,'SOLAPI 인증정보를 확인해 주세요.');
  const sendable=await templateInspector.sendable(alimtalkAuth);
  const registry=[...Object.entries(alimtalkKinds).map(([kind,t])=>({
   kind,name:({contractSign:'계약서 서명 요청',receivable:'미수금 지급 요청',dispatchRequest:'장비배차 접수 안내',dispatchChange:'장비배차 변경 안내',dispatchDone:'장비배차 완료',dispatchCancel:'장비배차 취소'})[kind],
   envKey:t.envKey,fields:t.fields,reviewStatus:'검수완료'
  })),...alimtalkAdditionalRegistry.map(t=>({...t,kind:t.envKey,fields:null}))];
  const items=templateInspector.inspect(registry,sendable,env);
  log(s.actor,'alimtalk.provider.read',String(items.length),{sendable:items.filter(x=>x.providerSendable).length});
  return json(res,200,{ok:true,checkedAt:Date.now(),sendableCount:items.filter(x=>x.providerSendable).length,items});
 }
 if(p==='/api/admin/alimtalk/templates'&&m==='GET'){mustAdmin(req);return json(res,200,{sendEnabled:env.SOLAPI_SEND_ENABLED==='true',kinds:Object.fromEntries(Object.entries(alimtalkKinds).map(([k,v])=>[k,{configured:!!env[v.envKey],reviewStatus:'검수완료',variableVerification:'pending',variables:v.fields}])),templateSummary:{total:25,approved:21,underReview:4},additionalTemplates:alimtalkAdditionalRegistry.map(t=>({name:t.name,configured:!!env[t.envKey],reviewStatus:t.reviewStatus,paused:alimtalkPausedTemplateKeys.has(t.envKey),variableVerification:'pending',sendAvailable:false}))});}
 if(p==='/api/admin/alimtalk/preview'&&m==='POST'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);limit(req,'alimtalk-preview:'+s.actor,60,600000);const data=alimtalkPreview(await body(req));log(s.actor,'alimtalk.preview',data.kind,{templateId:data.templateId});return json(res,200,{ok:true,dryRun:true,kind:data.kind,templateId:data.templateId,maskedTo:data.to.slice(0,3)+'****'+data.to.slice(-4),variables:data.options.variables});}
 if(p==='/api/admin/alimtalk/send'&&m==='POST'){
  const s=mustAdmin(req,['owner']);writeGuard(req,s);limit(req,'alimtalk-send:'+s.actor,10,600000);check(env.SOLAPI_SEND_ENABLED==='true',503,'실제 알림톡 발송이 비활성화되어 있습니다. 검증 후 활성화하세요.');
  const b=await body(req);check(b.confirm===true&&b.purpose==='test',400,'테스트 발송 확인이 필요합니다.');
  check(env.SOLAPI_TEST_PHONE&&phone(b.to)===phone(env.SOLAPI_TEST_PHONE),403,'관리자 테스트는 등록된 테스트 번호로만 발송할 수 있습니다.');const data=alimtalkPreview(b),id=crypto.randomUUID(),masked=data.to.slice(0,3)+'****'+data.to.slice(-4);
  let result;try{result=await sendAlimtalk(data);}catch(e){result={ok:false,status:0,result:{error:'SOLAPI 요청 실패'}};}
  run('INSERT INTO alimtalk_logs(id,actor,kind,target_ref,phone_mask,template_id,status,response,created) VALUES(?,?,?,?,?,?,?,?,?)',id,s.actor,data.kind,'manual-test',masked,data.templateId,result.ok?'accepted':'failed',JSON.stringify(result.result).slice(0,4000),Date.now());
  log(s.actor,'alimtalk.send.test',id,{kind:data.kind,accepted:result.ok});return json(res,result.ok?200:502,{ok:result.ok,requestId:id,accepted:result.ok,providerStatus:result.status});
 }
 if(p==='/api/admin/alimtalk/logs'&&m==='GET'){mustAdmin(req,['owner','operator']);return json(res,200,{items:all('SELECT id,kind,phone_mask,template_id,status,created FROM alimtalk_logs ORDER BY created DESC LIMIT 100')});}
 if(p==='/api/admin/dashboard'&&m==='GET'){const s=mustAdmin(req);return json(res,200,{users:one('SELECT COUNT(*) n FROM users').n,incomplete:one('SELECT COUNT(*) n FROM users WHERE complete=0').n,pending:one("SELECT COUNT(*) n FROM dispatch WHERE status='접수대기'").n,activeNotices:one('SELECT COUNT(*) n FROM notices WHERE active=1 AND starts<=? AND ends>?',Date.now(),Date.now()).n,counts:all('SELECT counts FROM snapshots').reduce((acc,r)=>{for(const [k,v]of Object.entries(JSON.parse(r.counts)))acc[k]=(acc[k]||0)+v;return acc;},{}),mode,features:{push:false,billing:false,documentOriginalAccess:false}});}
 if(p==='/api/admin/users'&&m==='GET'){const s=mustAdmin(req);const page=Math.max(0,Number(u.searchParams.get('page'))||0),full=s.role!=='viewer',keyword=text(u.searchParams.get('q'),120).toLowerCase(),businessType=text(u.searchParams.get('businessType'),30);const raw=all('SELECT * FROM users ORDER BY created DESC'),profiles=new Map(),phoneGroups=new Map(),regGroups=new Map();for(const row of raw){const pr=open(row.profile);profiles.set(row.id,pr);const ph=String(pr.phone||'').replace(/\D/g,''),reg=String(pr.registrationNo||'').replace(/\D/g,'');if(ph){if(!phoneGroups.has(ph))phoneGroups.set(ph,[]);phoneGroups.get(ph).push(row.id);}if(reg){if(!regGroups.has(reg))regGroups.set(reg,[]);regGroups.get(reg).push(row.id);}}const decorated=raw.map(row=>{const pr=profiles.get(row.id),base=publicStats(row,full),ph=String(pr.phone||'').replace(/\D/g,''),reg=String(pr.registrationNo||'').replace(/\D/g,''),phoneDup=ph&&(phoneGroups.get(ph)||[]).length>1,regDup=reg&&(regGroups.get(reg)||[]).length>1,duplicateStatus=regDup||phoneDup?'중복의심':'정상',duplicateReason=regDup?'사업자번호 동일':phoneDup?'연락처 동일':'';return {...base,duplicateStatus,duplicateReason};}).filter(x=>!businessType||x.businessType===businessType).filter(x=>!keyword||[x.businessName,x.name,x.phone,x.address,x.registrationNo,x.industry,x.businessType].join(' ').toLowerCase().includes(keyword));const total=decorated.length,items=decorated.slice(page*100,page*100+100),duplicateCount=decorated.filter(x=>x.duplicateStatus==='중복의심').length;log(s.actor,'users.list','',{page,full,keyword,businessType});return json(res,200,{items,total,duplicateCount,fullProfile:full});}
 if(/^\/api\/admin\/users\/[^/]+\/status$/.test(p)&&m==='PUT'){const s=mustAdmin(req,['owner']);writeGuard(req,s);const id=p.split('/')[4],b=await body(req);check(['active','suspended'].includes(b.status)&&text(b.reason).length>=5,400,'상태와 사유(5자 이상)를 입력해 주세요.');check(one('SELECT id FROM users WHERE id=?',id),404,'사용자가 없습니다.');tx(()=>{run('UPDATE users SET status=? WHERE id=?',b.status,id);run('DELETE FROM sessions WHERE actor=? AND kind=?',id,'user');log(s.actor,'user.status',id,{status:b.status,reason:text(b.reason)});});return json(res,200,{ok:true});}
 if(/^\/api\/admin\/users\/[^/]+\/business-type$/.test(p)&&m==='PUT'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const id=p.split('/')[4],b=await body(req),value=text(b.businessType,30),allowed=['개인회원','프리랜서','개인/프리랜서','개인사업자','법인사업자'];check(allowed.includes(value),400,'사업자 유형을 확인해 주세요.');const row=one('SELECT profile FROM users WHERE id=?',id);check(row,404,'사용자가 없습니다.');const pr=open(row.profile);pr.businessType=value;run('UPDATE users SET profile=?,profile_rev=profile_rev+1 WHERE id=?',seal(pr),id);log(s.actor,'user.businessType',id,{businessType:value});return json(res,200,{ok:true,businessType:value});}
 if(p==='/api/admin/dispatch'&&m==='GET'){const s=mustAdmin(req),full=s.role!=='viewer';log(s.actor,'dispatch.list','',{full});return json(res,200,{items:all('SELECT * FROM dispatch ORDER BY created DESC LIMIT 200').map(d=>{const b=open(d.body),user=one('SELECT profile FROM users WHERE id=?',d.user_id),up=user?open(user.profile):{};return{id:d.id,userId:d.user_id,status:d.status,revision:d.revision,created:d.created,applicantName:up.businessName||up.representative||'',applicantPhone:full?String(up.phone||''):phoneMask(up.phone),customerName:b.customerName||'',equipment:b.equipment,date:b.date,arrivalTime:b.arrivalTime||'',phone:full?b.phone:phoneMask(b.phone),address:full?b.address:b.address.split(' ').slice(0,2).join(' '),area:b.address.split(' ').slice(0,2).join(' '),goods:b.goods||'',floor:b.floor||'',note:b.note||'',minutes:b.minutes||30,estimatedAmount:b.estimatedAmount||0,requiresControlRoom:b.requiresControlRoom===true,controlRoomConfirmed:b.controlRoomConfirmed===true};})});}
 if(p==='/api/admin/dispatch'&&m==='POST'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const b=await body(req),userId=text(b.userId,100),user=one('SELECT id,status,profile FROM users WHERE id=?',userId);check(user&&user.status==='active',400,'등록할 원비즈 회원을 선택해 주세요.');const record=dispatchValidate(b.record||{}),id=crypto.randomUUID();run('INSERT INTO dispatch(id,user_id,body,status,created) VALUES(?,?,?,?,?)',id,userId,seal(record),'접수대기',Date.now());log(s.actor,'dispatch.admin.create',id,{userId,equipment:record.equipment,date:record.date});return json(res,201,{ok:true,id,status:'접수대기'});}
 if(/^\/api\/admin\/dispatch\/[^/]+$/.test(p)&&m==='POST'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const b=await body(req);check(text(b.reason).length>=5,400,'업무상 조회 사유를 입력해 주세요.');const d=one('SELECT * FROM dispatch WHERE id=?',p.split('/').pop());check(d,404,'요청이 없습니다.');log(s.actor,'dispatch.detail',d.id,{reason:text(b.reason)});return json(res,200,{id:d.id,userId:d.user_id,status:d.status,revision:d.revision,...open(d.body)});}
 if(/^\/api\/admin\/dispatch\/[^/]+$/.test(p)&&m==='PUT'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const b=await body(req),d=one('SELECT * FROM dispatch WHERE id=?',p.split('/').pop());check(d,404,'요청이 없습니다.');check(b.revision===d.revision,409,'다른 관리자가 수정했습니다. 다시 불러와 주세요.');const transitions={'접수대기':['확인중','배차완료','취소'],'확인중':['배차완료','취소'],'배차완료':['작업완료','취소'],'작업완료':[],'취소':[]},nextStatus=b.status===undefined?d.status:text(b.status,20);if(nextStatus!==d.status)check(transitions[d.status].includes(nextStatus),400,'허용되지 않는 상태 변경입니다.');const current=open(d.body),nextBody=b.record?dispatchValidate(b.record,current):current,changed=JSON.stringify(nextBody)!==JSON.stringify(current);run('UPDATE dispatch SET body=?,status=?,revision=revision+1 WHERE id=?',seal(nextBody),nextStatus,d.id);log(s.actor,'dispatch.update',d.id,{from:d.status,to:nextStatus,edited:!!b.record});
  const eventStatus=nextStatus!==d.status?nextStatus:null;
  const notification=(eventStatus||changed)?dispatchAlimtalkPlan(d,nextBody,eventStatus||nextStatus,changed&&nextStatus===d.status):null;
  let alert={state:'not_required'};
  if(notification){
   alert={state:notification.error?'needs_information':'preview_only',kind:notification.kind,...(notification.error?{reason:notification.error}:{maskedTo:notification.phoneMask})};
   if(!notification.error&&alimtalkSendingAllowed('dispatch')){
    let result;try{result=await sendAlimtalk(notification);}catch{result={ok:false,status:0,result:{error:'외부 발송 서비스 연결 실패'}};}
    const target='dispatch:'+d.id+':'+(d.revision+1),id=alimtalkResultLog(d.user_id,notification.kind,target,notification,result,result.ok?'accepted':'failed');
    alert={state:result.ok?'accepted':'failed',kind:notification.kind,requestId:id};
   }
  }
  return json(res,200,{ok:true,status:nextStatus,revision:d.revision+1,notification:alert});}
 if(/^\/api\/admin\/dispatch\/[^/]+$/.test(p)&&m==='DELETE'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const id=p.split('/').pop(),d=one('SELECT * FROM dispatch WHERE id=?',id);check(d,404,'요청이 없습니다.');run('DELETE FROM dispatch WHERE id=?',id);log(s.actor,'dispatch.delete',id,{status:d.status,userId:d.user_id});return json(res,200,{ok:true});}
 if(p==='/api/admin/notices'&&m==='GET'){mustAdmin(req);return json(res,200,{items:all('SELECT * FROM notices ORDER BY created DESC LIMIT 200')});}
 if(p==='/api/admin/notices'&&m==='POST'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const b=await body(req),starts=Number(b.starts),ends=Number(b.ends),target=b.target||'all';check(text(b.title)&&text(b.body,4000)&&Number.isFinite(starts)&&Number.isFinite(ends)&&ends>starts,400,'제목·내용·게시기간을 확인해 주세요.');check(target==='all'||one('SELECT id FROM users WHERE id=?',text(target,100)),400,'대상 사용자를 확인해 주세요.');const id=crypto.randomUUID();run('INSERT INTO notices VALUES(?,?,?,?,?,?,?,?,?)',id,text(b.title,120),text(b.body,4000),target,starts,ends,b.important===true?1:0,1,Date.now());log(s.actor,'notice.create',id,{target});return json(res,201,{ok:true,id});}
 if(/^\/api\/admin\/notices\/[^/]+$/.test(p)&&m==='DELETE'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const id=p.split('/').pop();run('UPDATE notices SET active=0 WHERE id=?',id);log(s.actor,'notice.disable',id);return json(res,200,{ok:true});}
 if(p==='/api/admin/audit'&&m==='GET'){mustAdmin(req,['owner']);return json(res,200,{items:all('SELECT * FROM audit ORDER BY id DESC LIMIT 200')});}
 if(p==='/api/admin/devices'&&m==='GET'){
  mustAdmin(req);const now=Date.now();
  return json(res,200,{items:all('SELECT id,phrase,expires,user_id,used FROM devices WHERE used=0 AND expires>? ORDER BY expires ASC',now).map(d=>({id:d.id,phrase:d.phrase,expiresAt:d.expires,userId:d.user_id||null,approved:!!d.user_id}))});
 }
 if(/^\/api\/admin\/devices\/[^/]+\/approve$/.test(p)&&m==='POST'){
  const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const id=p.split('/')[4],d=one('SELECT * FROM devices WHERE id=?',id);
  check(d&&!d.used&&d.expires>Date.now(),404,'기기 연결 요청이 만료되었거나 없습니다.');
  if(d.user_id)return json(res,200,{ok:true,userId:d.user_id,alreadyApproved:true});
  const b=await body(req);let userId=text(b.userId,100);
  if(userId){const u=one('SELECT id,status FROM users WHERE id=?',userId);check(u&&u.status==='active',400,'연결할 사용자를 확인해 주세요.');}
  else{
   userId=crypto.randomUUID();const now=Date.now(),profile={profileType:'BUSINESS',representative:'',phone:'',businessName:'',industry:''};
   const consent={terms:false,privacy:false,marketing:false,version:policyVersion,at:now,source:'admin_device_pair'};
   run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)',userId,seal(profile),JSON.stringify(consent),now,now);
  }
  run('UPDATE devices SET user_id=? WHERE id=?',userId,d.id);log(s.actor,'device.approve',d.id,{userId});return json(res,200,{ok:true,userId});
 }
 if(p==='/api/admin/settings'&&m==='GET'){mustAdmin(req);return json(res,200,{mode,phone:local?'demo':env.NCP_SERVICE_ID?'configured':'not_configured',oauth:Object.fromEntries(['kakao','naver','google'].map(k=>[k,provider.configured(env,k)])),dataStorage:'encrypted SQLite / single instance',nativeSync:'automatic / account based',push:'not_connected',billing:'not_connected',subscription:{schemaReady:true,featureGateReady:true,defaultPlan:'free',plans:['free','pro'],googlePlayBillingConnected:false,adsConnected:false},legal:env.POLICIES_APPROVED==='true'?'approved_by_operator':'draft'});}
 // Old shared-key and fixed PIN APIs are deliberately unavailable.
 if(p.startsWith('/api/')||p.startsWith('/auth/'))throw new HttpError(404,'지원하지 않는 경로입니다.');
 if(m!=='GET'&&m!=='HEAD')throw new HttpError(405,'지원하지 않는 요청입니다.');
 const pages={'/':'index.html','/connect':'index.html','/workspace':'workspace.html','/admin':'admin.html','/legal/terms':'terms.html','/legal/privacy':'privacy.html'};const publicQuotePage=/^\/quote\/[A-Za-z0-9_-]{43}$/.test(p)?'quote.html':null,publicContractPage=/^\/contract\/[A-Za-z0-9_-]{43}$/.test(p)?'contract.html':null,publicStatementPage=/^\/statement\/[A-Za-z0-9_-]{43}$/.test(p)?'statement.html':null,publicReceiptPage=/^\/receipt\/[A-Za-z0-9_-]{43}$/.test(p)?'receipt.html':null;const file=path.resolve(__dirname,'public',publicReceiptPage||publicStatementPage||publicContractPage||publicQuotePage||pages[p]||p.slice(1));
 check(file.startsWith(path.join(__dirname,'public')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile(),404,'페이지를 찾을 수 없습니다.');
 const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});if(m==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
}
const server=http.createServer((req,res)=>route(req,res).catch(e=>{if(!res.headersSent)json(res,e.status||500,{ok:false,error:e.status?e.message:'서버 처리 오류입니다. 데이터는 자동 초기화하지 않았습니다.'});else res.end();if(!e.status)console.error('server_error',e.name);}));
server.requestTimeout=20000;server.headersTimeout=10000;
const cleanup=setInterval(()=>{const now=Date.now();for(const table of ['sessions','otp','rates','oauth','devices','quote_links','contract_links','statement_links','receipt_links'])run(`DELETE FROM ${table} WHERE expires<?`,now-3600000);},600000);cleanup.unref();
server.listen(port,host,()=>console.log(`ONEBIZ V2 ${mode} listening ${host}:${port}`));
// Only safe boolean diagnostics: never log credential values or raw hashes.
if(!local){
 console.info('solapi_auth_config_check',JSON.stringify({
  keyPresent:!!solapiCredential(env.SOLAPI_API_KEY),
  secretPresent:!!solapiCredential(env.SOLAPI_API_SECRET),
  keyWhitespace:!!env.SOLAPI_API_KEY&&String(env.SOLAPI_API_KEY)!==solapiCredential(env.SOLAPI_API_KEY),
  secretWhitespace:!!env.SOLAPI_API_SECRET&&String(env.SOLAPI_API_SECRET)!==solapiCredential(env.SOLAPI_API_SECRET)
 }));
}
// Read-only deployment sanity check. No recipients, API secrets, or message contents in logs.
if(!local&&env.SOLAPI_API_KEY&&env.SOLAPI_API_SECRET){
 setTimeout(async()=>{
  try{
   const sendable=await templateInspector.sendable(alimtalkAuth);
   const registry=[
    ...Object.entries(alimtalkKinds).map(([kind,t])=>({kind,name:kind,envKey:t.envKey,fields:t.fields,reviewStatus:'검수완료'})),
    ...alimtalkAdditionalRegistry.map(t=>({...t,kind:t.envKey,fields:null}))
   ];
   const items=templateInspector.inspect(registry,sendable,env);
   const stats={registered:items.filter(x=>x.registered).length,sendable:items.filter(x=>x.providerSendable).length,matches:items.filter(x=>x.variableMatch==='match').length,mismatches:items.filter(x=>x.variableMatch==='mismatch').length};
   console.info('solapi_readonly_check_summary',JSON.stringify(stats));
   for(const t of items)console.info('solapi_readonly_template',JSON.stringify({kind:t.kind,sendable:t.providerSendable,match:t.variableMatch,variables:t.variables}));
  }catch(e){console.warn('solapi_readonly_check_failed',String(e.message||'external_api').slice(0,180));const checks=await templateInspector.diagnose(alimtalkAuth);console.info('solapi_readonly_permissions',JSON.stringify(checks));}
 },1000).unref();
}
process.on('SIGTERM',()=>server.close(()=>{store.db.close();process.exit(0);}));

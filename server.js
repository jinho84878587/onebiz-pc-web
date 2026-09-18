'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('./lib/store');
const {HttpError,check,random,equal,sha,phone,text,passwordHash,totp}=require('./lib/security');
const provider=require('./lib/providers');
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
function getSession(req,kind='user',optional=false){
 const bearer=(req.headers.authorization||'').startsWith('Bearer '),token=bearer?req.headers.authorization.slice(7):cookie(req,kind==='admin'?'ob_admin':'ob_user');
 const s=token?one('SELECT * FROM sessions WHERE hash=? AND kind=? AND expires>?',hash(token),kind,Date.now()):null;
 if(!s){if(optional)return null;throw new HttpError(401,'로그인이 필요합니다.');}
 if(kind==='user'){const u=one('SELECT status FROM users WHERE id=?',s.actor);check(u&&u.status==='active',403,'이 계정은 이용이 제한되어 있습니다.');}
 return {...s,bearer};
}
function sessionCreate(req,res,id,kind='user',role='owner',asBearer=false){
 const token=random(),csrf=random(),now=Date.now();run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',hash(token),id,kind,role,csrf,now+(kind==='admin'?3600000:43200000),now);
 if(!asBearer)setCookie(res,kind==='admin'?'ob_admin':'ob_user',token,kind==='admin'?3600:43200);
 return asBearer?{token,expiresAt:now+43200000}:{csrf};
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
function userInfo(id){const u=one('SELECT * FROM users WHERE id=?',id);return {id:u.id,profile:open(u.profile),profileRevision:u.profile_rev,profileComplete:!!u.complete,createdAt:u.created,identities:all('SELECT provider FROM identities WHERE user_id=?',id).map(i=>i.provider),subscription:u.subscription};}
function mustAdmin(req,roles=['owner','operator','viewer']){const s=getSession(req,'admin');check(roles.includes(s.role),403,'관리자 권한이 부족합니다.');return s;}
function profileValidate(b){const p={};for(const k of ['businessName','representative','registrationNo','address','addressDetail','phone','email','bankName','accountNumber','accountHolder'])p[k]=text(b[k],k.includes('address')?300:120);p.profileType=b.profileType==='BUSINESS'?'BUSINESS':'PERSONAL';check(p.representative,400,'이름을 입력해 주세요.');if(p.profileType==='BUSINESS')check(p.businessName&&/^\d{10}$/.test(p.registrationNo.replace(/\D/g,''))&&p.address,400,'상호·10자리 사업자번호·사업장 주소를 입력해 주세요.');return p;}
function snapshotValidate(b){check(b.data&&typeof b.data==='object'&&!Array.isArray(b.data),400,'업무 데이터를 확인해 주세요.');for(const k of ['customers','quotes','contracts'])check(Array.isArray(b.data[k])&&b.data[k].length<=10000,400,'업무 목록 형식 또는 개수를 확인해 주세요.');check(Array.isArray(b.employees)&&b.employees.length<=10000,400,'직원 목록 형식을 확인해 주세요.');const out=JSON.parse(JSON.stringify({data:b.data,employees:b.employees}));for(const a of [...Object.values(out.data),out.employees]){if(Array.isArray(a))for(const item of a)check(item&&typeof item==='object'&&!Array.isArray(item),400,'각 항목은 객체여야 합니다.');}return out;}
function countsFor(s){return {customers:s.data.customers.length,quotes:s.data.quotes.length,contracts:s.data.contracts.length,signed:s.data.contracts.filter(c=>c.signed===true).length,employees:s.employees.length};}
function masked(v){const s=String(v||'');if(!s)return '';return s.length<3?s.slice(0,1)+'*':s.slice(0,1)+'*'.repeat(Math.min(s.length-2,5))+s.slice(-1);}
function phoneMask(v){const d=String(v||'').replace(/\D/g,'');return d.length>=8?d.slice(0,3)+'-****-'+d.slice(-4):'-';}
function publicStats(u){const p=open(u.profile),snap=one('SELECT counts,updated FROM snapshots WHERE user_id=?',u.id);return {id:u.id,name:masked(p.representative),businessName:masked(p.businessName),phone:phoneMask(p.phone),type:p.profileType,profileComplete:!!u.complete,createdAt:u.created,lastLogin:u.last_login,status:u.status,subscription:u.subscription,counts:snap?JSON.parse(snap.counts):{customers:0,quotes:0,contracts:0,signed:0,employees:0},lastSync:snap?.updated||null};}
async function route(req,res){
 const u=new URL(req.url,origin),p=u.pathname,m=req.method;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 if(!local)res.setHeader('Strict-Transport-Security','max-age=31536000');
 if(p==='/health')return json(res,200,{ok:true,version:'2.0.0-dev.1',mode});
 if(p==='/api/config'&&m==='GET')return json(res,200,{mode,providers:Object.fromEntries(['kakao','naver','google'].map(k=>[k,provider.configured(env,k)])),phoneEnabled:local||!!(env.NCP_SERVICE_ID&&env.NCP_ACCESS_KEY&&env.NCP_SECRET_KEY&&env.NCP_SENDER),policyVersion,nativeSync:'manual-revision-checked',push:false,payments:false});
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
  writeGuard(req);limit(req,'social:'+ip(req),30,600000);const b=await body(req),name=p.split('/').pop();check(provider.configured(env,name),503,'소셜 로그인 앱 키·콜백 주소 설정 전입니다.');const terms=consent(b);
  let link=null;if(b.link===true){const s=getSession(req);writeGuard(req,s);check(Date.now()-s.created<600000,403,'다시 로그인한 후 연결해 주세요.');link=s.actor;}
  const state=random(),binding=random(),verifier=random(),nonce=random();
  run('INSERT INTO oauth VALUES(?,?,?,?,?,?,?,?)',hash(state),name,hash(binding),seal(verifier),nonce,Date.now()+600000,JSON.stringify(terms),link);
  setCookie(res,'ob_oauth',binding,600);return json(res,200,{url:provider.authUrl(env,name,origin,state,verifier,nonce)});
 }
 if(/^\/auth\/callback\/(kakao|naver|google)$/.test(p)&&m==='GET'){
  const name=p.split('/').pop(),state=u.searchParams.get('state')||'',s=one('SELECT * FROM oauth WHERE state_hash=?',hash(state));
  check(s&&s.expires>Date.now()&&s.provider===name&&equal(s.binding,hash(cookie(req,'ob_oauth'))),400,'로그인 요청이 만료되었거나 확인되지 않았습니다. 시작 화면에서 다시 시도해 주세요.');
  run('DELETE FROM oauth WHERE state_hash=?',hash(state));setCookie(res,'ob_oauth','',0);check(!u.searchParams.get('error')&&u.searchParams.get('code'),400,'소셜 로그인이 취소되었습니다.');
  if(s.link_user)check(getSession(req).actor===s.link_user,403,'연결 계정이 일치하지 않습니다.');
  const result=await provider.exchange(env,name,origin,u.searchParams.get('code'),state,open(s.verifier),s.nonce);
  const id=identity(name,result.subject,JSON.parse(s.consent),s.link_user,result.name);sessionCreate(req,res,id);return redirect(res,'/');
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
 if(p==='/api/device/start'&&m==='POST'){
  writeGuard(req);limit(req,'device-start:'+ip(req),10,600000);const b=await body(req);check(/^[a-zA-Z0-9_-]{43}$/.test(b.challenge||''),400,'기기 인증 요청을 확인해 주세요.');const id=random(),phrase=crypto.randomInt(100000,1000000).toString();run('INSERT INTO devices(id,challenge,phrase,expires) VALUES(?,?,?,?)',id,b.challenge,phrase,Date.now()+600000);return json(res,200,{requestId:id,verificationUrl:origin+'/connect?request='+id,phrase,interval:3,expiresIn:600});
 }
 if(p==='/api/device/info'&&m==='GET'){getSession(req);const d=one('SELECT phrase,expires FROM devices WHERE id=? AND used=0',u.searchParams.get('request')||'');check(d&&d.expires>Date.now(),404,'기기 연결 요청이 만료되었습니다.');return json(res,200,{phrase:d.phrase});}
 if(p==='/api/device/approve'&&m==='POST'){const s=getSession(req);writeGuard(req,s);check(Date.now()-s.created<600000,403,'다시 로그인한 후 기기를 연결해 주세요.');check(userInfo(s.actor).profileComplete,400,'기본정보 등록 후 연결해 주세요.');const b=await body(req);const d=one('SELECT * FROM devices WHERE id=?',text(b.requestId,100));check(d&&!d.used&&!d.user_id&&d.expires>Date.now()&&b.confirm===true,400,'연결 요청을 확인해 주세요.');run('UPDATE devices SET user_id=? WHERE id=?',s.actor,d.id);log(s.actor,'device.approve',d.id);return json(res,200,{ok:true});}
 if(p==='/api/device/poll'&&m==='POST'){writeGuard(req);limit(req,'device-poll:'+ip(req),240,600000);const b=await body(req),d=one('SELECT * FROM devices WHERE id=?',text(b.requestId,100));check(d&&!d.used&&d.expires>Date.now()&&/^[a-zA-Z0-9_-]{43,128}$/.test(b.verifier||'')&&equal(sha(b.verifier),d.challenge),400,'기기 연결 요청이 만료되었거나 확인되지 않았습니다.');if(!d.user_id)return json(res,202,{pending:true});check(one('SELECT status FROM users WHERE id=?',d.user_id)?.status==='active',403,'이용 제한된 계정입니다.');run('UPDATE devices SET used=1 WHERE id=?',d.id);return json(res,200,{ok:true,userId:d.user_id,...sessionCreate(req,res,d.user_id,'user','owner',true)});}
 if(p==='/api/dispatch'&&m==='POST'){const s=getSession(req);writeGuard(req,s);const b=await body(req);check(['사다리차','스카이차','크레인'].includes(b.equipment),400,'장비를 선택해 주세요.');check(text(b.address)&&/^\d{4}-\d{2}-\d{2}$/.test(b.date||''),400,'주소와 날짜를 확인해 주세요.');const record={equipment:b.equipment,address:text(b.address,300),date:b.date,floor:text(b.floor,30),goods:text(b.goods,200),minutes:Number(b.minutes),phone:phone(b.phone)};check(Number.isInteger(record.minutes)&&record.minutes>=30&&record.minutes<=1440&&record.minutes%30===0,400,'사용시간은 30분 단위로 입력해 주세요.');const id=crypto.randomUUID();run('INSERT INTO dispatch(id,user_id,body,status,created) VALUES(?,?,?,?,?)',id,s.actor,seal(record),'접수대기',Date.now());log(s.actor,'dispatch.create',id);return json(res,201,{ok:true,id});}
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
 if(p==='/api/admin/dashboard'&&m==='GET'){const s=mustAdmin(req);return json(res,200,{users:one('SELECT COUNT(*) n FROM users').n,incomplete:one('SELECT COUNT(*) n FROM users WHERE complete=0').n,pending:one("SELECT COUNT(*) n FROM dispatch WHERE status='접수대기'").n,activeNotices:one('SELECT COUNT(*) n FROM notices WHERE active=1 AND starts<=? AND ends>?',Date.now(),Date.now()).n,counts:all('SELECT counts FROM snapshots').reduce((acc,r)=>{for(const [k,v]of Object.entries(JSON.parse(r.counts)))acc[k]=(acc[k]||0)+v;return acc;},{}),mode,features:{push:false,billing:false,documentOriginalAccess:false}});}
 if(p==='/api/admin/users'&&m==='GET'){const s=mustAdmin(req);const page=Math.max(0,Number(u.searchParams.get('page'))||0);log(s.actor,'users.list','',{page});return json(res,200,{items:all('SELECT * FROM users ORDER BY created DESC LIMIT 100 OFFSET ?',page*100).map(publicStats),total:one('SELECT COUNT(*) n FROM users').n});}
 if(/^\/api\/admin\/users\/[^/]+\/status$/.test(p)&&m==='PUT'){const s=mustAdmin(req,['owner']);writeGuard(req,s);const id=p.split('/')[4],b=await body(req);check(['active','suspended'].includes(b.status)&&text(b.reason).length>=5,400,'상태와 사유(5자 이상)를 입력해 주세요.');check(one('SELECT id FROM users WHERE id=?',id),404,'사용자가 없습니다.');tx(()=>{run('UPDATE users SET status=? WHERE id=?',b.status,id);run('DELETE FROM sessions WHERE actor=? AND kind=?',id,'user');log(s.actor,'user.status',id,{status:b.status,reason:text(b.reason)});});return json(res,200,{ok:true});}
 if(p==='/api/admin/dispatch'&&m==='GET'){mustAdmin(req);return json(res,200,{items:all('SELECT * FROM dispatch ORDER BY created DESC LIMIT 200').map(d=>{const b=open(d.body);return{id:d.id,userId:d.user_id,status:d.status,revision:d.revision,created:d.created,equipment:b.equipment,date:b.date,phone:phoneMask(b.phone),area:b.address.split(' ').slice(0,2).join(' ')};})});}
 if(/^\/api\/admin\/dispatch\/[^/]+$/.test(p)&&m==='POST'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const b=await body(req);check(text(b.reason).length>=5,400,'업무상 조회 사유를 입력해 주세요.');const d=one('SELECT * FROM dispatch WHERE id=?',p.split('/').pop());check(d,404,'요청이 없습니다.');log(s.actor,'dispatch.detail',d.id,{reason:text(b.reason)});return json(res,200,{id:d.id,status:d.status,revision:d.revision,...open(d.body)});}
 if(/^\/api\/admin\/dispatch\/[^/]+$/.test(p)&&m==='PUT'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const b=await body(req),d=one('SELECT * FROM dispatch WHERE id=?',p.split('/').pop());check(d,404,'요청이 없습니다.');check(b.revision===d.revision,409,'다른 관리자가 수정했습니다. 다시 불러와 주세요.');const transitions={'접수대기':['확인중','취소'],'확인중':['배차완료','취소'],'배차완료':['작업완료','취소'],'작업완료':[],'취소':[]};check(transitions[d.status].includes(b.status),400,'허용되지 않는 상태 변경입니다.');run('UPDATE dispatch SET status=?,revision=revision+1 WHERE id=?',b.status,d.id);log(s.actor,'dispatch.status',d.id,{from:d.status,to:b.status});return json(res,200,{ok:true});}
 if(p==='/api/admin/notices'&&m==='GET'){mustAdmin(req);return json(res,200,{items:all('SELECT * FROM notices ORDER BY created DESC LIMIT 200')});}
 if(p==='/api/admin/notices'&&m==='POST'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const b=await body(req),starts=Number(b.starts),ends=Number(b.ends),target=b.target||'all';check(text(b.title)&&text(b.body,4000)&&Number.isFinite(starts)&&Number.isFinite(ends)&&ends>starts,400,'제목·내용·게시기간을 확인해 주세요.');check(target==='all'||one('SELECT id FROM users WHERE id=?',text(target,100)),400,'대상 사용자를 확인해 주세요.');const id=crypto.randomUUID();run('INSERT INTO notices VALUES(?,?,?,?,?,?,?,?,?)',id,text(b.title,120),text(b.body,4000),target,starts,ends,b.important===true?1:0,1,Date.now());log(s.actor,'notice.create',id,{target});return json(res,201,{ok:true,id});}
 if(/^\/api\/admin\/notices\/[^/]+$/.test(p)&&m==='DELETE'){const s=mustAdmin(req,['owner','operator']);writeGuard(req,s);const id=p.split('/').pop();run('UPDATE notices SET active=0 WHERE id=?',id);log(s.actor,'notice.disable',id);return json(res,200,{ok:true});}
 if(p==='/api/admin/audit'&&m==='GET'){mustAdmin(req,['owner']);return json(res,200,{items:all('SELECT * FROM audit ORDER BY id DESC LIMIT 200')});}
 if(p==='/api/admin/settings'&&m==='GET'){mustAdmin(req);return json(res,200,{mode,phone:local?'demo':env.NCP_SERVICE_ID?'configured':'not_configured',oauth:Object.fromEntries(['kakao','naver','google'].map(k=>[k,provider.configured(env,k)])),dataStorage:'encrypted SQLite / single instance',nativeSync:'manual / revision checked',push:'not_connected',billing:'not_connected',legal:env.POLICIES_APPROVED==='true'?'approved_by_operator':'draft'});}
 // Old shared-key and fixed PIN APIs are deliberately unavailable.
 if(p.startsWith('/api/')||p.startsWith('/auth/'))throw new HttpError(404,'지원하지 않는 경로입니다.');
 if(m!=='GET'&&m!=='HEAD')throw new HttpError(405,'지원하지 않는 요청입니다.');
 const pages={'/':'index.html','/connect':'index.html','/workspace':'workspace.html','/admin':'admin.html','/legal/terms':'terms.html','/legal/privacy':'privacy.html'};const file=path.resolve(__dirname,'public',pages[p]||p.slice(1));
 check(file.startsWith(path.join(__dirname,'public')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile(),404,'페이지를 찾을 수 없습니다.');
 const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});if(m==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
}
const server=http.createServer((req,res)=>route(req,res).catch(e=>{if(!res.headersSent)json(res,e.status||500,{ok:false,error:e.status?e.message:'서버 처리 오류입니다. 데이터는 자동 초기화하지 않았습니다.'});else res.end();if(!e.status)console.error('server_error',e.name);}));
server.requestTimeout=20000;server.headersTimeout=10000;
const cleanup=setInterval(()=>{const now=Date.now();for(const table of ['sessions','otp','rates','oauth','devices'])run(`DELETE FROM ${table} WHERE expires<?`,now-3600000);},600000);cleanup.unref();
server.listen(port,host,()=>console.log(`ONEBIZ V2 ${mode} listening ${host}:${port}`));
process.on('SIGTERM',()=>server.close(()=>{store.db.close();process.exit(0);}));

'use strict';
const crypto=require('node:crypto');
const {check,text,phone}=require('./security');
const websign=require('./websign-bridge');
const inspector=require('./solapi-template-inspector');
const TTL=365*86400000;
function strokes(value){
 const raw=String(value||'');check(raw.length<=200000,400,'저장된 서명 크기를 확인해 주세요.');
 return raw.split('|').map(s=>s.split(';').map(p=>p.split(',')).filter(p=>p.length===2&&p.every(v=>v.trim()!=='')).map(p=>p.map(Number)).filter(p=>p.every(Number.isFinite))).filter(s=>s.length>=2);
}
function source(store,userId,contractId){
 const user=store.one('SELECT profile,status FROM users WHERE id=?',userId);
 check(user?.status==='active',403,'회원정보를 확인해 주세요.');
 const snapshot=store.one('SELECT body FROM snapshots WHERE user_id=?',userId);
 const c=snapshot&&(store.open(snapshot.body).data?.contracts||[]).find(c=>String(c.id)===String(contractId));
 check(c,404,'내 계약 목록에서 계약서를 찾을 수 없습니다.');
 check(c.signed===true,400,'서명이 완료된 계약서만 원본을 보낼 수 있습니다.');
 const p=store.open(user.profile),points=strokes(c.signaturePath),remote=c.signatureMethod==='카카오톡 웹서명'||!points.length;
 let originalUrl='',providerId='';
 if(remote){
  const saved=store.one('SELECT provider_id,sign_url,payload_hash FROM websign_links WHERE user_id=? AND contract_id=?',userId,String(c.id));
  const digest=websign.fingerprint(c,userId);
  check(saved&&saved.payload_hash===digest&&saved.provider_id===websign.providerId(userId,c.id,digest),409,'서명된 계약서 원본과 현재 계약 내용이 일치하지 않습니다.');
  originalUrl=websign.verifyUrl(store.open(saved.sign_url));providerId=saved.provider_id;
 }
 const supplier={businessName:text(p.businessName||p.representative,120),representative:text(p.representative,80),phone:text(p.phone,40),registrationNo:text(p.registrationNo,40),address:[p.address,p.addressDetail].filter(Boolean).join(' ')};
 const contract={};
 for(const key of ['id','quoteId','customer','phone','address','item','contractDate','workDate','depositDueDate','middleDueDate','balanceDueDate','standardTerms','specialTerms','contractType','signatureName','signatureMethod','identityStatus','signedAt'])contract[key]=String(c[key]||'');
 for(const key of ['amount','depositAmount','middleAmount','balanceAmount','paidAmount'])contract[key]=Math.max(0,Number(c[key])||0);
 contract.receivable=Math.max(0,contract.amount-contract.paidAmount);
 contract.siteAddress=[c.siteAddress,c.siteAddressDetail].filter(Boolean).join(' ');
 contract.signed=true;contract.signatureStrokes=remote?[]:points;
 return {userId,contractId:String(c.id),recipient:String(c.phone||'').replace(/\D/g,''),supplier,contract,originalUrl,providerId,source:remote?'websign':'onsite'};
}
function create(store,origin,info,now=Date.now()){
 const token=crypto.randomBytes(32).toString('base64url'),expires=now+TTL;
 const payload={supplier:info.supplier,contract:info.contract,source:info.source,originalUrl:info.originalUrl};
 const url=origin+'/contract/'+token;
 check(Buffer.byteLength(url,'utf8')<=100,503,'계약서 원본 링크 길이를 확인해 주세요.');
 store.run('INSERT INTO signed_contract_links(token_hash,user_id,contract_id,body,created,expires,last_view) VALUES(?,?,?,?,?,?,0)',store.hash(token),info.userId,info.contractId,store.seal(payload),now,expires);
 return {token,url,expiresAt:expires};
}
function resolve(store,token,now=Date.now()){
 check(/^[A-Za-z0-9_-]{43}$/.test(String(token)),404,'계약서 링크를 찾을 수 없습니다.');
 const link=store.one('SELECT * FROM signed_contract_links WHERE token_hash=?',store.hash(token));
 if(!link)return null;
 check(link.expires>now,410,'계약서 확인 링크가 만료되었습니다.');
 check(store.one('SELECT status FROM users WHERE id=?',link.user_id)?.status==='active',410,'현재 사용할 수 없는 계약서 링크입니다.');
 const data=store.open(link.body);
 if(data.originalUrl)data.originalUrl=websign.verifyUrl(data.originalUrl);
 store.run('UPDATE signed_contract_links SET last_view=? WHERE token_hash=?',now,link.token_hash);
 return {...data,linkExpiresAt:link.expires};
}
function message(info,approved,token,origin){
 const links=(approved.buttons||[]).flatMap(b=>[b.linkMo,b.linkPc].filter(Boolean));
 const expected=origin+'/contract/#{계약서토큰}';
 check(links.length>0&&links.every(link=>link===expected),503,'승인된 완료 안내 버튼이 계약서 원본 경로와 일치하지 않습니다.');
 const names=inspector.inspect([{kind:'contractDone',name:'contractDone',envKey:'DONE',fields:['고객명','업체명','계약금액','계약서토큰']}],[approved],{DONE:approved.templateId})[0];
 check(names.variableMatch==='match',503,'완료 안내 템플릿 변수가 계약서 원본과 일치하지 않습니다.');
 check(info.supplier.businessName&&info.contract.customer,400,'업체명과 고객명을 확인해 주세요.');
 return {kind:'contractDone',to:phone(info.recipient),templateId:approved.templateId,options:{templateId:approved.templateId,disableSms:true,variables:{
  '#{고객명}':info.contract.customer,'#{업체명}':info.supplier.businessName,'#{계약금액}':Math.round(info.contract.amount).toLocaleString('ko-KR'),'#{계약서토큰}':token
 }}};
}
module.exports={source,create,resolve,message,TTL};

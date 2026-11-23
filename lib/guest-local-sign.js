'use strict';
// Isolated first-party guest signing. Requires ONEBIZ_GUEST_SIGN_SELFHOSTED=true.
// Uses the existing encrypted SQLite store; no external signing service is called.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {check}=require('./security');
const websign=require('./websign-bridge');
const DAY=86400000;
const HTML=fs.readFileSync(path.join(__dirname,'..','public','guest-sign.html'),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function send(res,status,body,type='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});
 res.end(type.startsWith('application/json')?JSON.stringify(body):body);
}
function create(store,origin,guestId,contract){
 const digest=websign.fingerprint(contract,guestId);
 const old=store.one('SELECT * FROM guest_local_sign_links WHERE guest_hash=? AND contract_id=?',guestId,contract.id);
 check(!old||old.payload_hash===digest,409,'서명 요청 후 계약 내용이 변경됐습니다.');
 if(old)return {ok:true,contractId:contract.id,signUrl:store.open(old.sign_url)};
 const providerId=websign.providerId(guestId,contract.id,digest);
 const token=crypto.randomBytes(32).toString('base64url'),now=Date.now();
 const signUrl=origin+'/sign/'+providerId+'?token='+token;
 store.run('INSERT INTO guest_local_sign_links(guest_hash,contract_id,payload_hash,provider_id,token_hash,sign_url,contract_body,created,expires) VALUES(?,?,?,?,?,?,?,?,?)',
  guestId,contract.id,digest,providerId,store.hash(token),store.seal(signUrl),store.seal(contract),now,now+7*DAY);
 return {ok:true,contractId:contract.id,signUrl};
}
function status(store,guestId,contract){
 const digest=websign.fingerprint(contract,guestId);
 const old=store.one('SELECT * FROM guest_local_sign_links WHERE guest_hash=? AND contract_id=?',guestId,contract.id);
 if(!old)return {ok:true,exists:false,signed:false};
 check(old.payload_hash===digest,409,'서명 요청 후 계약 내용이 변경됐습니다.');
 if(!old.signed_info)return {ok:true,exists:true,signed:false};
 const info=store.open(old.signed_info);
 return {ok:true,exists:true,signed:true,signatureName:info.signatureName,identityStatus:info.identityStatus,signedAt:info.signedAt};
}
function lookup(store,id,token){
 check(/^ob-[a-f0-9]{40}$/.test(id)&&/^[A-Za-z0-9_-]{43}$/.test(token),404,'서명 주소를 확인해 주세요.');
 const row=store.one('SELECT * FROM guest_local_sign_links WHERE provider_id=? AND token_hash=?',id,store.hash(token));
 check(row,404,'서명 주소를 찾을 수 없습니다.');
 check(row.expires>Date.now()||row.signed_info,410,'서명 주소의 유효기간이 만료되었습니다.');
 return {row,contract:store.open(row.contract_body)};
}
function publicContract(contract,row,origin){
 const phone=String(contract.phone||'').replace(/\D/g,'');
 return {
  id:contract.id,customer:contract.customer,item:contract.item,
  amount:contract.amount,contractDate:contract.contractDate,workDate:contract.workDate,
  standardTerms:contract.standardTerms,specialTerms:contract.specialTerms,
  phoneMasked:phone.length===11?phone.slice(0,3)+'-****-'+phone.slice(-4):'',
  signed:!!row.signed_info,
 };
}
function receipt(contract,info){
 const money=Number(contract.amount||0).toLocaleString('ko-KR');
 return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>원비즈 전자계약 완료</title><body>'+
 '<main><h1>원비즈 체결 계약서</h1><p>전자서명 완료</p><dl>'+
 '<dt>계약번호</dt><dd>'+esc(contract.id)+'</dd>'+
 '<dt>고객명</dt><dd>'+esc(contract.customer)+'</dd>'+
 '<dt>계약금액</dt><dd>'+esc(money)+'원</dd>'+
 '<dt>서명일시</dt><dd>'+esc(info.signedAt)+'</dd>'+
 '<dt>본인확인</dt><dd>'+esc(info.identityStatus)+'</dd></dl>'+
 '<h2>품목</h2><pre>'+esc(contract.item)+'</pre>'+
 '<h2>계약조건</h2><pre>'+esc(contract.standardTerms)+'</pre>'+
 '<h2>특약</h2><pre>'+esc(contract.specialTerms)+'</pre>'+
 '<h2>고객 서명</h2><img alt="고객 전자서명" width="300" src="'+esc(info.signatureDataUrl)+'">'+
 '</main></body></html>';
}
async function publicRoute(req,res,u,store,origin,readBody,limit){
 const p=u.pathname,m=req.method;
 const match=p.match(/^\/(sign|receipt|api\/sign)\/(ob-[a-f0-9]{40})(?:\/(complete))?$/);
 if(!match)return false;
 const type=match[1],id=match[2],complete=match[3],token=u.searchParams.get('token')||'';
 check((type==='sign'||type==='receipt'||(type==='api/sign'&&!complete))?m==='GET':m==='POST',405,'지원하지 않는 요청입니다.');
 limit(req,'first-party-sign-request:'+id,150,3600000);
 const {row,contract}=lookup(store,id,token);
 if(type==='sign'){
  const nonce=crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  send(res,200,HTML.replaceAll('__CSP_NONCE__',nonce),'text/html; charset=utf-8');return true;
 }
 if(type==='receipt'){
  check(row.signed_info,409,'아직 서명이 완료되지 않았습니다.');
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:; frame-ancestors 'none'; base-uri 'none';");
  send(res,200,receipt(contract,store.open(row.signed_info)),'text/html; charset=utf-8');return true;
 }
 if(!complete){
  const result=publicContract(contract,row,origin);
  if(row.signed_info)result.receiptUrl=origin+'/receipt/'+id+'?token='+token;
  send(res,200,{ok:true,contract:result});return true;
 }
 check(req.headers.origin===origin,403,'허용되지 않은 출처입니다.');
 check(!row.signed_info,409,'이미 체결된 계약서입니다.');
 limit(req,'first-party-sign-complete:'+row.token_hash,8,30*60000);
 const b=await readBody(req);
 check(b.agreeContract===true&&b.agreeSign===true,400,'계약 확인과 전자서명 동의가 필요합니다.');
 check(String(b.signerName||'').trim().normalize('NFC')===String(contract.customer).trim().normalize('NFC'),400,'고객 이름을 확인해 주세요.');
 const expected=String(contract.phone).replace(/\D/g,'').slice(-4);
 check(/^\d{4}$/.test(String(b.phoneLast4||''))&&String(b.phoneLast4)===expected,400,'연락처 뒤 4자리를 확인해 주세요.');
 const sig=String(b.signatureDataUrl||'');
 check(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig)&&sig.length<1400000,400,'서명 이미지 형식이 올바르지 않습니다.');
 const bytes=Buffer.from(sig.slice('data:image/png;base64,'.length),'base64');
 check(bytes.length>=70&&bytes.length<1048576&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),400,'서명 이미지를 확인해 주세요.');
 const signedAt=new Date().toISOString(),info={
  signatureName:String(contract.customer),signedAt,signatureDataUrl:sig,consentAccepted:true,
  identityStatus:'고객명·전화번호 끝 4자리 대조(본인인증 아님)'
 };
 const updated=store.run("UPDATE guest_local_sign_links SET signed_info=? WHERE provider_id=? AND token_hash=? AND signed_info=''",
  store.seal(info),id,row.token_hash);
 check(updated.changes===1,409,'서명이 이미 처리되었습니다.');
 send(res,200,{ok:true,signedAt,receiptUrl:origin+'/receipt/'+id+'?token='+token});
 return true;
}
module.exports={create,status,publicRoute};

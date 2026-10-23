'use strict';
const crypto=require('node:crypto');
const {check}=require('./security');
const websign=require('./websign-bridge');
const TTL=30*86400000;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;

// Only an opaque token leaves ONEBIZ. The provider URL remains encrypted in
// websign_links and is resolved only while the original contract is current.
function create(store,origin,userId,contract,link,now=Date.now()){
 const digest=websign.fingerprint(contract,userId);
 websign.verifyUrl(link.signUrl);
 check(link.providerId===websign.providerId(userId,contract.id,digest),409,'현재 계약서의 서명 링크를 다시 생성해 주세요.');
 const token=crypto.randomBytes(32).toString('base64url'),expires=now+TTL;
 const url=origin+'/s/'+token;
 check(Buffer.byteLength(url,'utf8')<=100,503,'서명 링크 주소 길이 설정을 확인해 주세요.');
 store.run('INSERT INTO sign_redirect_links(token_hash,user_id,contract_id,payload_hash,provider_id,expires,created) VALUES(?,?,?,?,?,?,?)',store.hash(token),userId,String(contract.id),digest,link.providerId,expires,now);
 return {url,expiresAt:expires};
}
function resolve(store,token,now=Date.now()){
 check(TOKEN.test(String(token)),404,'서명 링크를 찾을 수 없습니다.');
 const link=store.one('SELECT * FROM sign_redirect_links WHERE token_hash=?',store.hash(token));
 check(link,404,'서명 링크를 찾을 수 없습니다.');
 check(link.expires>now,410,'서명 링크가 만료되었습니다. 새 서명 요청을 받아 주세요.');
 const user=store.one('SELECT status FROM users WHERE id=?',link.user_id);
 const snapshot=store.one('SELECT body FROM snapshots WHERE user_id=?',link.user_id);
 check(user?.status==='active'&&snapshot,410,'현재 사용할 수 없는 서명 링크입니다.');
 const contract=(store.open(snapshot.body).data?.contracts||[]).find(c=>String(c.id)===link.contract_id);
 check(contract&&websign.fingerprint(contract,link.user_id)===link.payload_hash,410,'계약 내용이 변경되었습니다. 새 서명 요청을 받아 주세요.');
 const saved=store.one('SELECT provider_id,sign_url,payload_hash FROM websign_links WHERE user_id=? AND contract_id=?',link.user_id,link.contract_id);
 check(saved&&saved.provider_id===link.provider_id&&saved.payload_hash===link.payload_hash,410,'서명 링크가 변경되었습니다. 새 서명 요청을 받아 주세요.');
 return websign.verifyUrl(store.open(saved.sign_url));
}
function variable(origin,value){
 let url;
 try{url=new URL('https://'+String(value||'').replace(/^https?:\/\//,''));}catch{check(false,400,'서명 링크가 올바르지 않습니다.');}
 const short=url.origin===origin&&/^\/s\/[A-Za-z0-9_-]{43}$/.test(url.pathname)&&!url.search;
 check(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(url.origin===websign.BASE||short),400,'서명 링크가 올바르지 않습니다.');
 check(Buffer.byteLength(url.href,'utf8')<=100,400,'알림톡 서명 주소는 100자 이하여야 합니다. 짧은 서명 링크를 생성해 주세요.');
 return url.href.slice(8);
}
module.exports={create,resolve,variable,TTL};

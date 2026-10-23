'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createStore}=require('../lib/store');
const websign=require('../lib/websign-bridge');
const links=require('../lib/sign-short-links');
const {failureSummary}=require('../lib/solapi-template-inspector');
const origin='https://onebiz-pc-web.onrender.com';
function fixture(t){
 const store=createStore(':memory:','33'.repeat(32));t.after(()=>store.db.close());
 const user='test-member',now=Date.now(),contract={id:'C-TEST-005',customer:'테스트 고객',phone:'01000000000',amount:250000,item:'시스템에어컨'};
 const digest=websign.fingerprint(contract,user),link={providerId:websign.providerId(user,contract.id,digest),signUrl:websign.BASE+'/sign/'+('a'.repeat(180))};
 store.run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)',user,store.seal({}),'{}',now,now);
 store.run('INSERT INTO snapshots(user_id,revision,body,counts,updated) VALUES(?,?,?,?,?)',user,1,store.seal({data:{contracts:[contract]}}),'{}',now);
 store.run('INSERT INTO websign_links(user_id,contract_id,provider_id,sign_url,payload_hash,created) VALUES(?,?,?,?,?,?)',user,contract.id,link.providerId,store.seal(link.signUrl),digest,now);
 return {store,user,now,contract,link};
}
test('100자 초과 서명 URL을 100자 이하의 불투명 링크로 연결한다',t=>{
 const f=fixture(t),short=links.create(f.store,origin,f.user,f.contract,f.link,f.now),token=new URL(short.url).pathname.slice(3);
 assert.ok(f.link.signUrl.length>100);assert.ok(short.url.length<=100);assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.ok(!short.url.includes(f.contract.id));assert.ok(!short.url.includes(f.contract.phone));
 assert.equal(links.resolve(f.store,token,f.now),f.link.signUrl);
 const row=f.store.one('SELECT * FROM sign_redirect_links');assert.notEqual(row.token_hash,token);assert.ok(!JSON.stringify(row).includes(f.link.signUrl));
 assert.equal('https://'+links.variable(origin,short.url),short.url);
});
test('다른 계약 또는 생성 시점의 오래된 서명 링크를 등록하지 않는다',t=>{
 const f=fixture(t);assert.throws(()=>links.create(f.store,origin,f.user,{...f.contract,amount:300000},f.link,f.now),e=>e.status===409);
});
test('계약 내용 변경 후 기존 짧은 링크는 열리지 않는다',t=>{
 const f=fixture(t),short=links.create(f.store,origin,f.user,f.contract,f.link,f.now),token=new URL(short.url).pathname.slice(3);
 f.store.run('UPDATE snapshots SET body=? WHERE user_id=?',f.store.seal({data:{contracts:[{...f.contract,amount:300000}]}}),f.user);
 assert.throws(()=>links.resolve(f.store,token,f.now),e=>e.status===410);
});
test('만료된 링크와 존재하지 않는 토큰을 거부한다',t=>{
 const f=fixture(t),short=links.create(f.store,origin,f.user,f.contract,f.link,f.now),token=new URL(short.url).pathname.slice(3);
 assert.throws(()=>links.resolve(f.store,token,short.expiresAt),e=>e.status===410);
 assert.throws(()=>links.resolve(f.store,'b'.repeat(43),f.now),e=>e.status===404);
 assert.throws(()=>links.resolve(f.store,'not-a-token',f.now),e=>e.status===404);
});
test('계정 이용정지 또는 전자서명 연결 변경 시 링크를 거부한다',t=>{
 const f=fixture(t),short=links.create(f.store,origin,f.user,f.contract,f.link,f.now),token=new URL(short.url).pathname.slice(3);
 f.store.run('UPDATE users SET status=? WHERE id=?','suspended',f.user);
 assert.throws(()=>links.resolve(f.store,token,f.now),e=>e.status===410);
 f.store.run('UPDATE users SET status=? WHERE id=?','active',f.user);
 f.store.run('UPDATE websign_links SET provider_id=? WHERE user_id=?','changed',f.user);
 assert.throws(()=>links.resolve(f.store,token,f.now),e=>e.status===410);
});
test('저장된 외부 URL을 변조해도 다른 도메인으로 이동하지 않는다',t=>{
 const f=fixture(t),short=links.create(f.store,origin,f.user,f.contract,f.link,f.now),token=new URL(short.url).pathname.slice(3);
 f.store.run('UPDATE websign_links SET sign_url=? WHERE user_id=?',f.store.seal('https://example.com/sign'),f.user);
 assert.throws(()=>links.resolve(f.store,token,f.now));
 for(const value of ['https://example.com/s/'+token,origin+'/s/'+token+'?redirect=https://example.com',origin+'/s/'+token+'#x',f.link.signUrl])assert.throws(()=>links.variable(origin,value),e=>e.status===400);
});
test('HTTP 200의 개별 접수 실패 코드와 사유를 보존하되 URL 및 전화번호는 가린다',()=>{
 const failure=failureSummary({ok:false,status:200,result:{failedMessageList:[{statusCode:'1048',statusMessage:'버튼 URL 값은 최대 100자까지 사용 가능합니다. https://example.com/private 010-0000-0000'}]}});
 assert.equal(failure.providerCode,'1048');assert.ok(failure.providerError.includes('최대 100자'));assert.ok(!failure.providerError.includes('example.com'));assert.ok(!failure.providerError.includes('010-0000'));
 assert.deepEqual(failureSummary({ok:true}),{providerCode:'',providerError:''});
});

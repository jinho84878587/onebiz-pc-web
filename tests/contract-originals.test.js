'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('../lib/store'),originals=require('../lib/contract-originals'),websign=require('../lib/websign-bridge');
const origin='https://onebiz-pc-web.onrender.com',now=1792735200000;
function fixture(t,onsite=false){
 const s=createStore(':memory:','33'.repeat(32));t.after(()=>s.db.close());
 const c={id:'C-SIGNED',customer:'테스트 고객',phone:'01000000000',amount:250000,paidAmount:50000,signed:true,signatureName:'테스트 고객',signatureMethod:onsite?'현장 직접 전자서명':'카카오톡 웹서명',signedAt:'2026-10-23T05:30:58Z',standardTerms:'원본 조건',specialTerms:'특약 원문',signaturePath:onsite?'0,0;10,20|5,6;7,8':''};
 s.run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)','u',s.seal({businessName:'테스트 업체',phone:'01000000001'}),'{}',now,now);
 s.run('INSERT INTO snapshots VALUES(?,?,?,?,?)','u',1,s.seal({data:{contracts:[c]}}),'{}',now);
 const digest=websign.fingerprint(c,'u'),url=websign.BASE+'/sign/'+'s'.repeat(180);
 if(!onsite)s.run('INSERT INTO websign_links VALUES(?,?,?,?,?,?)','u',c.id,websign.providerId('u',c.id,digest),s.seal(url),digest,now);
 return {s,c,url};
}
const template={templateId:'approved-done',content:'#{고객명} #{업체명} #{계약금액}',buttons:[{linkMo:origin+'/contract/#{계약서토큰}',linkPc:origin+'/contract/#{계약서토큰}'}]};
test('웹서명 완료 원본을 암호화 보관하고 100자 이하 확인 링크를 발행한다',t=>{
 const {s,c,url}=fixture(t),info=originals.source(s,'u',c.id),link=originals.create(s,origin,info,now);
 assert.ok(link.url.length<=100);assert.equal(link.token.length,43);assert.equal(info.originalUrl,url);
 const stored=s.one('SELECT * FROM signed_contract_links');assert.ok(!stored.body.includes('원본 조건'));assert.ok(!stored.body.includes(url));assert.notEqual(stored.token_hash,link.token);
 assert.equal(originals.resolve(s,link.token,now+1).originalUrl,url);
});
test('현장 서명·조건·특약을 보관하며 이후 변경이나 삭제로 원본이 바뀌지 않는다',t=>{
 const {s,c}=fixture(t,true),info=originals.source(s,'u',c.id),link=originals.create(s,origin,info,now);
 s.run('UPDATE snapshots SET body=? WHERE user_id=?',s.seal({data:{contracts:[{...c,amount:1,standardTerms:'수정됨'}]}}),'u');
 let result=originals.resolve(s,link.token,now+1);assert.equal(result.contract.amount,250000);assert.equal(result.contract.standardTerms,'원본 조건');assert.equal(result.contract.specialTerms,'특약 원문');assert.equal(result.contract.receivable,200000);assert.deepEqual(result.contract.signatureStrokes,[[[0,0],[10,20]],[[5,6],[7,8]]]);
 s.run('DELETE FROM snapshots WHERE user_id=?','u');result=originals.resolve(s,link.token,now+2);assert.equal(result.contract.signatureName,c.customer);
});
test('미서명·타 계정·서명 이후 내용 변경·서명 원본 누락을 차단한다',t=>{
 const {s,c}=fixture(t);assert.throws(()=>originals.source(s,'other',c.id));
 for(const changed of [{...c,signed:false},{...c,amount:1}]){s.run('UPDATE snapshots SET body=?',s.seal({data:{contracts:[changed]}}));assert.throws(()=>originals.source(s,'u',c.id));}
 s.run('UPDATE snapshots SET body=?',s.seal({data:{contracts:[c]}}));s.run('DELETE FROM websign_links');assert.throws(()=>originals.source(s,'u',c.id));
});
test('만료·이용정지·변조된 외부 원본 URL을 차단한다',t=>{
 const {s,c}=fixture(t),link=originals.create(s,origin,originals.source(s,'u',c.id),now);
 assert.throws(()=>originals.resolve(s,link.token,link.expiresAt));
 s.run("UPDATE users SET status='suspended'");assert.throws(()=>originals.resolve(s,link.token,now));s.run("UPDATE users SET status='active'");
 const data=originals.resolve(s,link.token,now);data.originalUrl='https://evil.example/';s.run('UPDATE signed_contract_links SET body=?',s.seal(data));assert.throws(()=>originals.resolve(s,link.token,now));
});
test('완료 안내는 승인된 원본 버튼과 정확한 변수만 사용한다',t=>{
 const {s,c}=fixture(t),info=originals.source(s,'u',c.id),message=originals.message(info,template,'a'.repeat(43),origin);
 assert.equal(message.to,'01000000000');assert.equal(message.options.disableSms,true);assert.equal(message.options.variables['#{계약금액}'],'250,000');assert.equal(Object.keys(message.options.variables).length,4);
 assert.throws(()=>originals.message(info,{...template,buttons:[{linkMo:'https://evil.example/contract/#{계약서토큰}'}]},'a'.repeat(43),origin));
 assert.throws(()=>originals.message(info,{...template,content:template.content+' #{미등록변수}'},'a'.repeat(43),origin));
});

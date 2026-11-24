'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createStore}=require('../lib/store');
test('first-party guest signing: create, isolated access, privacy, consent, signed original',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-firstparty-'));
 const file=path.join(temp,'test.sqlite'),key='6a'.repeat(32);
 const store=createStore(file,key);
 const origin='http://127.0.0.1:19893';
 const server=cp.spawn(process.execPath,['server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,APP_MODE:'test',PORT:'19893',PUBLIC_ORIGIN:origin,
   DATA_FILE:file,DATA_KEY_HEX:key,ONEBIZ_GUEST_SIGN_ENABLED:'true',
   ONEBIZ_GUEST_SIGN_SELFHOSTED:'true',DOCUMENT_TRACKING_POLL_ENABLED:'false',
   HIWON_SIGN_APP_KEY:'',SOLAPI_SEND_ENABLED:'false'},
  stdio:'pipe'
 });
 t.after(()=>{server.kill('SIGTERM');store.db.close();fs.rmSync(temp,{recursive:true,force:true});});
 let ready=false;
 for(let i=0;i<80;i++){
  await new Promise(r=>setTimeout(r,80));
  try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}
 }
 assert.ok(ready,'guest local test server should start');
 const key1=crypto.randomBytes(32).toString('base64url'),key2=crypto.randomBytes(32).toString('base64url');
 const contract={id:'C-2026-91002',customer:'테스트 전자계약',phone:'01023456789',amount:320000,
  contractDate:'2026-11-23',workDate:'2026-11-30',item:'테스트 장비',standardTerms:'시험용 계약조건',
  specialTerms:'시험용 특약',supplier:{businessName:'하이원시스템',representative:'시험공급자',registrationNo:'1234567890',phone:'01098765432',address:'경기도 수원시 테스트로',addressDetail:'101호'},signed:false};
 async function guest(route,secret,data=contract,confirm=true){
  const response=await fetch(origin+route,{method:'POST',
   headers:{'Content-Type':'application/json','X-Onebiz-Client':'android','X-Onebiz-Guest-Sign-Key':secret},
   body:JSON.stringify({contract:data,confirm})});
  return {status:response.status,body:await response.json()};
 }
 assert.equal((await guest('/api/guest-sign/link',key1,contract,false)).status,400);
 const created=await guest('/api/guest-sign/link',key1);
 assert.equal(created.status,200,JSON.stringify(created.body));
 assert.ok(created.body.signUrl.startsWith(origin+'/sign/ob-'));
 const old=store.one('SELECT * FROM guest_local_sign_links WHERE contract_id=?',contract.id);
 assert.ok(old,'encrypted local signing row should exist');
 assert.ok(!old.contract_body.includes('시험용 특약'));
 assert.ok(!old.sign_url.includes('sign/ob-'));
 assert.equal((await guest('/api/guest-sign/status',key2)).body.exists,false);
 assert.equal((await guest('/api/guest-sign/status',key1)).body.signed,false);
 assert.equal((await guest('/api/guest-sign/link',key1,{...contract,amount:999999})).status,409);
 assert.equal((await guest('/api/guest-sign/link',key1)).body.signUrl,created.body.signUrl);
 const url=new URL(created.body.signUrl);
 const landing=await fetch(url);
 assert.equal(landing.status,200);
 assert.match(landing.headers.get('content-security-policy')||'',/nonce-/);
 assert.ok(!(await landing.text()).includes(contract.customer));
 const publicRoute='/api/sign'+url.pathname.slice('/sign'.length)+url.search;
 const before=await fetch(origin+publicRoute);
 assert.equal(before.status,200);
 const details=(await before.json()).contract;
 assert.equal(details.customer,contract.customer);
 assert.equal(details.phoneMasked,'010-****-6789');
 assert.ok(!JSON.stringify(details).includes('01023456789'));
 assert.ok(!JSON.stringify(details).includes('phoneLast4'));
 const complete='/api/sign'+url.pathname.slice('/sign'.length)+'/complete'+url.search;
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABGCAIAAAAGgExhAAAC/ElEQVR4nO2c23LkIAxE7fz/P3sfnMpSXMxNLSTo85qaxBIHucfD5H6e5yJEmp/VF0D2hGIRCBSLQKBYBALFIhAoFoFAsQgEikUgUCwCgWIRCBSL5Lnve+blFItkeK2acYtikZjQp2G3KNZ/5repd+77jsofPvxCsX4JrTrTrbTqmSNVFOu6cj09za10UE0e1KNYRYfOcUvq9hdytFjVSLG9W4KhKkJJLIPZpTT8z3FLNlTFv1zhzDtoT8xQvSSD1ywLukD4xDKYi1t6uvfcUtg2x2Ws9p7u6pbOMMaKFdYQFrBqkXp7uplbuKieAhSrZFX6UwWGe5q65VQvaFRPQYmV7f6qATD59G/5rphH/PlnFYhYH7NB3y2R4Z+uhCO3lrzDlRerWobmW3fZnrpzSzNURWDDe6kMnSCP6Kkjt5RDVYSwWN+BveVViCvpupgqLtzSD1URkmJ1WYVbHoX5b9wtCx8biIk10FzE8qjtVLNuWbDqkhJruBjZspV7as2thVE9RUCsyWKkgvySntpxa21UTxEO7/PFjK3Nwp1qwa3lUT1lVqyxt4ERk2uzfP6vdWt5+VmmxBKxKvvyxrWxkyrsfFql83erjIsl3rveplib/8pu2dlUWQbFApXUHuRt9lTNLWtRPWVELLVFLS2MTateFNyyNqqzzIZ3/Yfalq16gbplv/yXbrEEA3uJj4Xx0lbQhwpeyr96xVKwqvTLfbX1knbLfqiK6Pj6l/66lhbDeE9DRITwtaNeWieWndpctPWP+WPNdjrfRZNYq2pbe/pUipljzU6tugbCu3JtT/C1d0dtTel1y12mjKhnLLXAfgKNrriL6imViUWrZGmZWy6ef1b5Emv5ybUt+XbL9e0v5EussCq/FRok65b3UBVRuRVukJptUr0neu+5xv/HIiWyYWOPFTnu3xiZYo8HdVko1mK2eVAXwVshgcCJRSBQLAKBYhEIFItAoFgEAsUiECgWgUCxCASKRSBQLAKBYhEIFItAoFgEAsUiEP4BBmz+mX8+/TkAAAAASUVORK5CYII=';
 async function sign(data,originHeader=origin){
  const r=await fetch(origin+complete,{method:'POST',headers:{'Content-Type':'application/json',Origin:originHeader},body:JSON.stringify(data)});
  return {status:r.status,body:await r.json()};
 }
 const candidate={signerName:contract.customer,phoneLast4:'6789',agreeContract:true,agreeSign:true,signatureDataUrl:png};
 assert.equal((await sign(candidate,'https://evil.example')).status,403);
 assert.equal((await sign({...candidate,phoneLast4:'0000'})).status,400);
 const signed=await sign(candidate);
 assert.equal(signed.status,200,JSON.stringify(signed.body));
 assert.match(signed.body.receiptUrl,/\/receipt\/ob-/);
 const signedRow=store.one('SELECT * FROM guest_local_sign_links WHERE contract_id=?',contract.id);
 assert.ok(!signedRow.signed_info.includes(png));
 assert.equal(store.open(signedRow.signed_info).signatureDataUrl,png);
 assert.equal((await sign(candidate)).status,409);
 const checked=await guest('/api/guest-sign/status',key1);
 assert.equal(checked.status,200);
 assert.equal(checked.body.signed,true);
 assert.equal(checked.body.signatureName,contract.customer);
 const receipt=await fetch(signed.body.receiptUrl);
 assert.equal(receipt.status,200);
 const receiptHtml=await receipt.text();
 assert.ok(receiptHtml.includes('시험용 특약'));
 assert.ok(receiptHtml.includes('시험용 계약조건'));
 assert.ok(receiptHtml.includes('<h1>하이원시스템</h1>'),'existing app PDF starts with supplier name');
 assert.ok(receiptHtml.includes('공급자 정보'));
 assert.ok(receiptHtml.includes('계약 상대방'));
 assert.ok(receiptHtml.includes('계약내용'));
 assert.ok(receiptHtml.includes('지급조건'));
 assert.ok(receiptHtml.includes('현장 특약사항'));
 assert.ok(receiptHtml.includes('1234567890'));
 assert.ok(receiptHtml.includes('계약금'));
 assert.ok(receiptHtml.includes('중도금'));
 assert.ok(receiptHtml.includes('잔금'));
 assert.ok(receiptHtml.includes('고객(갑) 전자서명'));
 assert.ok(receiptHtml.includes('contract-receipt.css'));
 assert.equal((receiptHtml.match(/class="sheet"/g)||[]).length,2,'two printable A4 pages');
 assert.ok(receiptHtml.includes('data:image/png;base64'));
 const after=await fetch(origin+publicRoute);
 assert.equal((await after.json()).contract.signed,true);
});

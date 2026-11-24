'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const render=require('../lib/guest-signed-contract');

test('completed contract uses Korea local-time display without changing saved agreement',()=>{
 const contract={
  id:'C-2026-999',quoteId:'Q-2026-999',
  customer:'테스트 고객',phone:'01012345678',contractType:'공사·설치',
  item:'시스템에어컨 실내기 18평+6평+6평',amount:5900000,
  contractDate:'2026-11-24',workDate:'',
  depositAmount:0,middleAmount:0,balanceAmount:5900000,
  specialTerms:'특약 원문 <그대로>',standardTerms:'제1조 [계약 목적]\n제2조 [계약금액]',
  supplier:{businessName:'하이원시스템',representative:'대표',registrationNo:''}
 };
 const signature={signatureName:'테스트 고객',signedAt:'2026-11-24T04:53:13.447Z',
  identityStatus:'고객명·전화번호 끝 4자리 대조(본인인증 아님)',
  signatureDataUrl:'data:image/png;base64,AAAA'};
 const snapshot=JSON.stringify({contract,signature});
 const html=render(contract,signature);
 assert.equal((html.match(/class="sheet"/g)||[]).length,2);
 assert.ok(html.includes('제1조 [계약 목적]'));
 assert.ok(html.includes('특약 원문 &lt;그대로&gt;'));
 assert.ok(html.includes('₩5,900,000'));
 assert.ok(html.includes('13:53')&&html.includes('KST'));
 assert.ok(!html.includes('04:53:13.447Z'));
 assert.ok(html.includes('공급자 서명·날인: 미등록'));
 assert.ok(html.includes('임의 직인 생성하지 않음'));
 assert.ok(html.includes('고객(갑) 전자서명'));
 assert.equal(JSON.stringify({contract,signature}),snapshot,'signed original data must remain unchanged');
});

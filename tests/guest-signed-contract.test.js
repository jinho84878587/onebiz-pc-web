'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const render=require('../lib/guest-signed-contract');
const fs=require('node:fs'),path=require('node:path');
const printCss=fs.readFileSync(path.join(__dirname,'..','public','contract-receipt.css'),'utf8');
test('A4 print stylesheet keeps 2-page layout and does not clip terms',()=>{
 assert.match(printCss,/@page\s*\{size:A4 portrait/);
 assert.match(printCss,/white-space:pre-wrap/);
 assert.match(printCss,/break-after:page/);
});
test('completed contract A4 print keeps supplier, payments, immutable terms, and signer image',()=>{
 const terms='제1조 목적\n제2조 [분쟁] 기존 문구 그대로 <법률 원문>\n제11조 소유권 유보';
 const special='특약 1: 고객 동의\n특약 2: 금액 변경 금지';
 const customer='테스트 고객';
 const contract={
  id:'C-2026-1001',quoteId:'Q-2026-2001',customer,phone:'01012345678',
  address:'경기도 수원시',siteAddress:'경기도 화성시',siteAddressDetail:'101동',
  contractType:'공사·설치',item:'시스템에어컨 18+6+6',amount:4700000,
  contractDate:'2026-11-24',workDate:'2026-12-01',
  depositAmount:1000000,depositDueDate:'2026-11-24',
  middleAmount:2000000,middleDueDate:'2026-11-30',
  balanceAmount:1700000,balanceDueDate:'2026-12-02',
  standardTerms:terms,specialTerms:special,
  supplier:{businessName:'하이원시스템',representative:'시험담당',registrationNo:'1112223333',
    phone:'01087654321',address:'경기도 수원시',addressDetail:'102호'}
 };
 const signature='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9SAAAAAASUVORK5CYII=';
 const original=structuredClone(contract);
 const html=render(contract,{signatureName:customer,signedAt:'2026-11-24T02:00:00Z',
  identityStatus:'고객명 및 연락처 끝자리 대조',signatureDataUrl:signature});
 assert.equal((html.match(/class="sheet"/g)||[]).length,2);
 assert.ok(html.includes('/contract-receipt.css'));
 assert.ok(html.includes('하이원시스템'));
 assert.ok(html.includes('1112223333'));
 for(const val of ['1,000,000','2,000,000','1,700,000','4,700,000',
  '2026-11-24','2026-11-30','2026-12-02','18+6+6',
  '특약 1: 고객 동의','특약 2: 금액 변경 금지','제11조 소유권 유보',
  'data:image/png;base64','PDF 저장','A4 210×297 mm'])assert.ok(html.includes(val),val);
 assert.ok(html.includes('&lt;법률 원문&gt;'),'terms must be escaped, not changed');
 assert.deepEqual(contract,original,'never mutate stored contract');
});
test('signed original escapes HTML script fragments and handles legacy snapshots',()=>{
 const c={id:'C-2026-1002',customer:'<script>alert(1)</script>',phone:'010',
  amount:100000,standardTerms:'<img src=x onerror=alert(1)>',specialTerms:'수정 금지'};
 const html=render(c,{signatureName:'테스터',signatureDataUrl:'data:image/png;base64,AA==',signedAt:'2026-11-24'});
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
 assert.ok(html.includes('공급자 정보 미제공'));
 assert.ok(html.includes('수정 금지'));
});

'use strict';
// Complete signed-document display. Uses the immutable contract snapshot sealed when signing link was created.
// Do not modify the wording of standardTerms or specialTerms.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
module.exports=function signedContractReceipt(contract,info){
 const supplier=contract.supplier||{}, blank=v=>String(v??'').trim()||'-', value=v=>esc(blank(v));
 const money=n=>'₩'+Math.round(Number(n)||0).toLocaleString('ko-KR');
 const supplierName=supplier.businessName||'공급자 정보 미제공';
 const supplierAddress=[supplier.address,supplier.addressDetail].filter(Boolean).join(' ');
 const siteAddress=[contract.siteAddress,contract.siteAddressDetail].filter(Boolean).join(' ');
 const row=(name,v)=>'<tr'+(name==='총 계약금액'?' class="total-line"':'')+'><th>'+esc(name)+'</th><td>'+value(v)+'</td></tr>';
 const doubleRow=(a,b,c,d)=>'<tr><th>'+esc(a)+'</th><td>'+value(b)+'</td><th>'+esc(c)+'</th><td>'+value(d)+'</td></tr>';
 const head=(title,subtitle,kind='')=>'<header class="head"><div><h1>'+esc(title)+'</h1>'+(kind?'<div class="contract-kind">'+esc(kind)+'</div>':'')+'</div><div class="ref">'+value(subtitle)+'</div></header>';
 const foot=n=>'<div class="footer"><span>계약번호 '+value(contract.id)+' · 체결된 계약서</span><span>A4 210×297 mm · '+n+'/2</span></div>';
 const payments='<table class="payments"><thead><tr><th>지급 구분</th><th>금액</th><th>지급예정일</th></tr></thead><tbody>'+
 [['계약금',contract.depositAmount,contract.depositDueDate],['중도금',contract.middleAmount,contract.middleDueDate],['잔금',contract.balanceAmount,contract.balanceDueDate]]
 .map(([name,amount,due])=>'<tr><td>'+esc(name)+'</td><td>'+money(amount)+'</td><td>'+value(due||'미정')+'</td></tr>').join('')+'</tbody></table>';
 const title=(contract.contractType||'공사·설치')+' 계약서';
 const page1='<section class="sheet">'+head(supplierName,'계약번호 '+blank(contract.id)+' · 견적번호 '+blank(contract.quoteId),title)+
 '<h2>공급자 정보</h2><table class="details">'+doubleRow('상호',supplierName,'대표자',supplier.representative)+
 doubleRow('사업자번호',supplier.registrationNo,'연락처',supplier.phone)+row('사업장 주소',supplierAddress)+'</table>'+
 '<h2>계약 상대방</h2><table class="details">'+doubleRow('성명',contract.customer,'연락처',contract.phone)+
 doubleRow('주소',contract.address,'현장주소',siteAddress)+'</table>'+
 '<h2>계약내용</h2><table>'+row('계약 유형',contract.contractType||'공사·설치')+
 row('품목·수량·시공 내용',contract.item)+row('총 계약금액',money(contract.amount))+
 doubleRow('계약일',contract.contractDate,'시공예정일',contract.workDate||'미정')+'</table>'+
 '<h2>지급조건</h2>'+payments+
 '<h2>현장 특약사항</h2><div class="terms">'+value(contract.specialTerms||'없음')+'</div>'+
 '<h2>전자서명 확인</h2><div class="signatures">'+
 '<div class="signature-box"><div class="signature-title">공급자(을)</div>'+value(supplierName)+
 '<div class="signature-note">대표자: '+value(supplier.representative)+'\n공급자 서명·날인: 별도 확인 (전자 직인 미첨부)</div></div>'+
 '<div class="signature-box"><div class="signature-title">고객(갑) 전자서명</div><img class="signature-image" alt="고객 전자서명" src="'+esc(info.signatureDataUrl)+'">'+
 '<div class="signature-note">서명자: '+value(info.signatureName)+'\n서명일시: '+value(info.signedAt)+'\n확인 방식: '+value(info.identityStatus)+'</div></div></div>'+
 foot(1)+'</section>';
 const page2='<section class="sheet">'+head('표준 계약조건','계약번호 '+blank(contract.id))+
 '<h2>계약 조항 원문</h2><div class="terms">'+value(contract.standardTerms)+'</div>'+
 '<p class="note">본 화면은 서명 요청 시 암호화 보관한 계약서 내용과 서명 이미지의 표시본입니다. 고객명과 전화번호 끝 4자리 대조는 별도의 공인된 본인인증이 아닙니다.</p>'+
 '<p class="note">계약일: '+value(contract.contractDate)+' · 서명일시: '+value(info.signedAt)+'</p>'+foot(2)+'</section>';
 return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
 '<title>원비즈 체결 계약서 '+value(contract.id)+'</title><link rel="stylesheet" href="/contract-receipt.css"></head><body>'+
 '<div class="toolbar"><b>원비즈 · 체결 계약서</b><span>PDF 저장: 브라우저 인쇄(Ctrl+P) → PDF로 저장</span></div>'+
 page1+page2+'</body></html>';
};

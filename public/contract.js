'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';
const token=location.pathname.split('/').filter(Boolean).pop()||'';
function render(data){
 const s=data.supplier||{},c=data.contract||{};
 $('#status').classList.add('hidden');
 const root=$('#contract');root.classList.remove('hidden');
 root.innerHTML=`<div class="hero"><div><span class="badge">체결완료 계약서</span><h1>계약서</h1><div class="meta"><b>${esc(s.businessName||'ONEBIZ')}</b><br>계약번호 ${esc(c.id||'-')}<br>계약일 ${esc(c.contractDate||'-')}</div></div><div class="amount-box"><span>계약금액</span><strong>${money(c.amount)}</strong><span>${c.signed?'전자서명 완료':'확인 필요'}</span></div></div>
 <div class="section"><h2>계약 당사자</h2><div class="grid"><div class="row"><b>공급자</b><span>${esc(s.businessName||'-')}</span></div><div class="row"><b>고객명</b><span>${esc(c.customer||'-')}</span></div><div class="row"><b>대표자</b><span>${esc(s.representative||'-')}</span></div><div class="row"><b>현장주소</b><span>${esc(c.siteAddress||'-')}</span></div><div class="row"><b>연락처</b><span>${esc(s.phone||'-')}</span></div><div class="row"><b>사업자번호</b><span>${esc(s.registrationNo||'-')}</span></div></div></div>
 <div class="section"><h2>계약 내용</h2><div class="grid"><div class="row"><b>계약내용</b><span>${esc(c.item||'-')}</span></div><div class="row"><b>시공예정일</b><span>${esc(c.workDate||'-')}</span></div></div></div>
 <div class="section"><h2>대금 일정</h2><table class="payments"><thead><tr><th>구분</th><th>예정일</th><th class="num">금액</th></tr></thead><tbody><tr><td>계약금</td><td>${esc(c.depositDueDate||'-')}</td><td class="num">${money(c.depositAmount)}</td></tr><tr><td>중도금</td><td>${esc(c.middleDueDate||'-')}</td><td class="num">${money(c.middleAmount)}</td></tr><tr><td>잔금</td><td>${esc(c.balanceDueDate||'-')}</td><td class="num">${money(c.balanceAmount)}</td></tr></tbody></table><div class="summary"><div><span>입금액</span><b>${money(c.paidAmount)}</b></div><div><span>미수금</span><b>${money(c.receivable)}</b></div><div class="grand"><span>계약금액</span><span>${money(c.amount)}</span></div></div></div>
 <div class="footer-note">본 화면은 ONEBIZ를 통해 체결된 계약의 확인용 페이지입니다. 계약 관련 문의는 계약 상대 업체에 문의해 주세요.</div>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();$('#shareBottom').onclick=share;
}
async function share(){try{if(navigator.share)await navigator.share({title:'ONEBIZ 계약서',text:'체결된 계약서를 확인해 주세요.',url:location.href});else{await navigator.clipboard.writeText(location.href);alert('계약서 링크를 복사했습니다.');}}catch{}}
async function start(){if(!/^[A-Za-z0-9_-]{43}$/.test(token)){ $('#status').textContent='올바르지 않은 계약서 링크입니다.';return;}try{const r=await fetch('/api/public/contract/'+encodeURIComponent(token),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error||'계약서를 불러오지 못했습니다.');render(b);}catch(e){$('#status').innerHTML='<b>계약서를 열 수 없습니다.</b><br>'+esc(e.message);}}
$('#printBtn').onclick=()=>window.print();$('#shareBtn').onclick=share;start();
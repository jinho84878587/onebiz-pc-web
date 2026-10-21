'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';
const token=location.pathname.split('/').filter(Boolean).pop()||'';
function render(data){
 const s=data.supplier||{},r=data.receipt||{};
 $('#status').classList.add('hidden');
 const root=$('#receipt');root.classList.remove('hidden');
 root.innerHTML=`<div class="hero"><div><span class="badge">간이영수증</span><h1>간이영수증</h1><div class="meta"><b>${esc(s.businessName||'ONEBIZ')}</b><br>영수증번호 ${esc(r.id||'-')}<br>발행일 ${esc(r.issuedAt||'-')}</div></div><div class="amount-box"><span>결제금액</span><strong>${money(r.paidAmount)}</strong><span>계약번호 ${esc(r.contractId||'-')}</span></div></div>
 <div class="section"><h2>거래 정보</h2><div class="grid"><div class="row"><b>공급자</b><span>${esc(s.businessName||'-')}</span></div><div class="row"><b>고객명</b><span>${esc(r.customer||'-')}</span></div><div class="row"><b>대표자</b><span>${esc(s.representative||'-')}</span></div><div class="row"><b>계약일</b><span>${esc(r.contractDate||'-')}</span></div><div class="row"><b>사업자번호</b><span>${esc(s.registrationNo||'-')}</span></div><div class="row"><b>현장주소</b><span>${esc(r.siteAddress||'-')}</span></div></div></div>
 <div class="section"><h2>영수 내역</h2><div class="receipt-box"><div class="receipt-line"><span>거래 내용</span><b>${esc(r.item||'계약대금')}</b></div><div class="receipt-line"><span>계약금액</span><b>${money(r.contractAmount)}</b></div><div class="receipt-line total"><span>누적 입금액</span><span>${money(r.paidAmount)}</span></div><div class="receipt-line"><span>잔여 미수금</span><b>${money(r.receivable)}</b></div></div></div>
 <div class="footer-note">본 문서는 거래대금 수납 사실을 간단히 확인하는 용도이며, 세금계산서·현금영수증 등 법정 증빙을 대체하지 않습니다.</div>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();$('#shareBottom').onclick=share;
}
async function share(){try{if(navigator.share)await navigator.share({title:'ONEBIZ 간이영수증',text:'간이영수증을 확인해 주세요.',url:location.href});else{await navigator.clipboard.writeText(location.href);alert('간이영수증 링크를 복사했습니다.');}}catch{}}
async function start(){if(!/^[A-Za-z0-9_-]{43}$/.test(token)){ $('#status').textContent='올바르지 않은 간이영수증 링크입니다.';return;}try{const r=await fetch('/api/public/receipt/'+encodeURIComponent(token),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error||'간이영수증을 불러오지 못했습니다.');render(b);}catch(e){$('#status').innerHTML='<b>간이영수증을 열 수 없습니다.</b><br>'+esc(e.message);}}
$('#printBtn').onclick=()=>window.print();$('#shareBtn').onclick=share;start();
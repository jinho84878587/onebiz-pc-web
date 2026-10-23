'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';
const token=location.pathname.split('/').filter(Boolean).pop()||'';
function render(data){
 const s=data.supplier||{},d=data.statement||{},items=Array.isArray(d.items)?d.items:[];
 $('#status').classList.add('hidden');
 const root=$('#statement');root.classList.remove('hidden');
 root.innerHTML=`<div class="hero"><div><span class="badge">거래명세서</span><h1>거래명세서</h1><div class="meta"><b>${esc(s.businessName||'ONEBIZ')}</b><br>명세서번호 ${esc(d.id||'-')}<br>발행일 ${esc(d.issuedAt||'-')}</div></div><div class="amount-box"><span>거래금액</span><strong>${money(d.total)}</strong><span>${d.source==='quote'?'견적번호':'계약번호'} ${esc(d.quoteId||d.contractId||'-')}</span></div></div>
 <div class="section"><h2>거래 정보</h2><div class="grid"><div class="row"><b>공급자</b><span>${esc(s.businessName||'-')}</span></div><div class="row"><b>거래처</b><span>${esc(d.customer||'-')}</span></div><div class="row"><b>대표자</b><span>${esc(s.representative||'-')}</span></div><div class="row"><b>현장주소</b><span>${esc(d.siteAddress||'-')}</span></div><div class="row"><b>사업자번호</b><span>${esc(s.registrationNo||'-')}</span></div><div class="row"><b>연락처</b><span>${esc(s.phone||'-')}</span></div></div></div>
 <div class="section"><h2>거래 내역</h2><table class="items"><thead><tr><th>품목</th><th>규격</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(i.name||'-')}</td><td>${esc(i.spec||'-')}</td><td class="num">${Number(i.qty)||0}</td><td class="num">${money(i.unitPrice)}</td><td class="num">${money(i.amount)}</td></tr>`).join('')}</tbody></table><div class="summary"><div><span>공급가액</span><b>${money(d.supply)}</b></div><div><span>부가세</span><b>${money(d.vat)}</b></div><div class="grand"><span>합계금액</span><span>${money(d.total)}</span></div></div>${d.source==='quote'?'':'<div class="payment"><span>입금액 <b>'+money(d.paidAmount)+'</b></span><span>미수금 <b>'+money(d.receivable)+'</b></span></div>'}</div>
 <div class="footer-note">본 문서는 거래 내역 확인용 명세서입니다. 세금계산서 또는 현금영수증을 대체하지 않습니다.</div>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();$('#shareBottom').onclick=share;
}
async function share(){try{if(navigator.share)await navigator.share({title:'ONEBIZ 거래명세서',text:'거래명세서를 확인해 주세요.',url:location.href});else{await navigator.clipboard.writeText(location.href);alert('거래명세서 링크를 복사했습니다.');}}catch{}}
async function start(){if(!/^[A-Za-z0-9_-]{43}$/.test(token)){ $('#status').textContent='올바르지 않은 거래명세서 링크입니다.';return;}try{const r=await fetch('/api/public/statement/'+encodeURIComponent(token),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error||'거래명세서를 불러오지 못했습니다.');render(b);}catch(e){$('#status').innerHTML='<b>거래명세서를 열 수 없습니다.</b><br>'+esc(e.message);}}
$('#printBtn').onclick=()=>window.print();$('#shareBtn').onclick=share;start();
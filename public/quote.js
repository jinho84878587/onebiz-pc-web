'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';
const date=v=>{if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('ko-KR');};
const token=location.pathname.split('/').filter(Boolean).pop()||'';
function render(data){
 const s=data.supplier||{},q=data.quote||{},expired=Number(q.validUntil||0)<=Date.now();
 $('#status').classList.add('hidden');
 const root=$('#quote');root.classList.remove('hidden');
 root.innerHTML=`<div class="hero"><div><h1>견적서</h1><div class="meta"><b>${esc(s.businessName||'ONEBIZ')}</b><br>견적번호 ${esc(q.id||'-')}<br>작성일 ${esc(q.createdAt||'-')}</div></div><div class="amount-box"><span>최종 견적금액</span><strong>${money(q.total)}</strong><span class="${expired?'expired':''}">${expired?'유효기간 만료':'유효기한 '+date(q.validUntil)}</span></div></div>
 <div class="section"><h2>공급자 / 고객</h2><div class="grid">
 <div class="row"><b>공급자</b><span>${esc(s.businessName||'-')}</span></div>
 <div class="row"><b>고객명</b><span>${esc(q.customer||'-')}</span></div>
 <div class="row"><b>대표자</b><span>${esc(s.representative||'-')}</span></div>
 <div class="row"><b>현장주소</b><span>${esc(q.siteAddress||'-')}</span></div>
 <div class="row"><b>연락처</b><span>${esc(s.phone||'-')}</span></div>
 <div class="row"><b>사업자번호</b><span>${esc(s.registrationNo||'-')}</span></div>
 </div></div>
 <div class="section"><h2>견적 품목</h2><table class="items"><thead><tr><th>품목명</th><th>규격</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th></tr></thead><tbody>${(q.items||[]).map(i=>`<tr><td>${esc(i.name||'-')}</td><td>${esc(i.spec||'-')}</td><td class="num">${Number(i.qty)||0}</td><td class="num">${money(i.unitPrice)}</td><td class="num">${money(i.amount)}</td></tr>`).join('')}</tbody></table><div class="totals"><div><span>공급가액</span><b>${money(q.supply)}</b></div><div><span>할인</span><b>-${money(q.discountAmount)}</b></div><div><span>부가세</span><b>${q.vatEnabled?money(q.vat):'별도'}</b></div><div class="grand"><span>견적금액</span><span>${money(q.total)}</span></div></div></div>
 <div class="section"><h2>안내사항</h2><div class="notice">${esc(q.note||'별도 특이사항이 없습니다.')}</div></div>
 <div class="footer-note">본 견적서는 ONEBIZ를 통해 발행된 온라인 확인용 견적서입니다. 견적 내용 변경이 필요한 경우 발행 업체에 문의해 주세요.</div>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();$('#shareBottom').onclick=share;
}
async function share(){try{if(navigator.share)await navigator.share({title:'ONEBIZ 견적서',text:'견적서를 확인해 주세요.',url:location.href});else{await navigator.clipboard.writeText(location.href);alert('견적서 링크를 복사했습니다.');}}catch{}}
async function start(){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)){ $('#status').textContent='올바르지 않은 견적 링크입니다.'; return; }
 try{const r=await fetch('/api/public/quote/'+encodeURIComponent(token),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error||'견적서를 불러오지 못했습니다.');render(b);}catch(e){$('#status').innerHTML='<b>견적서를 열 수 없습니다.</b><br>'+esc(e.message);}
}
$('#printBtn').onclick=()=>window.print();$('#shareBtn').onclick=share;start();
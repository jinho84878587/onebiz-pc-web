'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';
const token=location.pathname.split('/').filter(Boolean).pop()||'';
function render(data){
 const s=data.supplier||{},d=data.statement||{},items=Array.isArray(d.items)?d.items:[];
 $('#status').classList.add('hidden');
 const root=$('#statement');root.classList.remove('hidden');
 const cell=(name,value)=>`<div class="detail-row"><span class="key">${esc(name)}</span><span class="value">${esc(value||'-')}</span></div>`;
 const stamp=`<div class="stamp" aria-label="공급자 확인">원비즈<br>발행확인</div>`;
 const totalValue=Number(d.total)||0,vatValue=Number(d.vat)||0,netValue=Number(d.supply)||0;
 const rowParts=items.slice(0,22).map(i=>{
  const amount=Number(i.amount)||0;
  const vatPart=totalValue>0?Math.round(vatValue*amount/totalValue):0;
  const netPart=amount-vatPart;
  return `<tr><td>${esc(d.issuedAt||'-')}</td><td class="item-name">${esc(i.name||'-')}</td><td>${esc(i.spec||'-')}</td><td class="num">${esc(i.qty||0)}</td><td class="num">${money(i.unitPrice)}</td><td class="num">${money(netPart)}</td><td class="num">${money(vatPart)}</td><td class="num emphasis">${money(amount)}</td></tr>`;
 }).join('');
 root.innerHTML=`<div class="document-head">
  <div class="document-brand">ONEBIZ <span>원비즈</span></div>
  <h1>거 래 명 세 서</h1>
  <div class="subtitle">거래내역 확인 및 대금 정산용</div>
  <div class="number-line"><span><b>거래번호</b>${esc(d.id||'-')}</span><span><b>작성일</b>${esc(d.issuedAt||'-')}</span></div>
 </div>
 <div class="doc-body">
  <h2 class="section-caption">공급자 · 공급받는 자 정보</h2>
  <div class="parties">
   <div class="party"><h3>공급자</h3>
    ${cell('사업자번호',s.registrationNo)}
    ${cell('상호',s.businessName)}
    ${cell('대표자',s.representative)}
    ${cell('사업장 주소',s.address)}
    ${cell('연락처',s.phone)}
    ${cell('입금계좌',[s.bankName,s.accountNumber,s.accountHolder].filter(Boolean).join(' '))}
   </div>
   <div class="party"><h3>공급받는 자</h3>
    ${cell('상호·성명',d.customer)}
    ${cell('연락처',d.phone)}
    ${cell('현장 주소',d.siteAddress)}
    ${cell('견적번호',d.quoteId||d.contractId)}
    ${cell('거래금액',money(totalValue))}
    ${cell('비고','')}
   </div>
  </div>
  <h2 class="section-caption">거래 내역</h2>
  <div class="table-scroll"><table class="ledger"><colgroup><col style="width:12%"><col style="width:20%"><col style="width:10%"><col style="width:7%"><col style="width:11%"><col style="width:13%"><col style="width:11%"><col style="width:16%"></colgroup>
   <thead><tr><th>거래일</th><th>품목명</th><th>규격</th><th>수량</th><th>단가</th><th>공급가액</th><th>부가세</th><th>합계</th></tr></thead>
   <tbody>${rowParts||'<tr><td colspan="8">거래 품목 없음</td></tr>'}</tbody>
  </table></div>
  <div class="settlement">
   <div class="bank-note"><h2 class="section-caption">확인 사항</h2><p>상기 거래내역과 금액을 확인합니다.</p><p>발행구분 : 거래명세서</p><p>견적서 정보를 기준으로 작성되었습니다.</p></div>
   <div class="totals"><div><span>공급가액 합계</span><strong>${money(netValue)}</strong></div><div><span>부가가치세</span><strong>${money(vatValue)}</strong></div><div class="grand"><span>총 거래금액</span><strong>${money(totalValue)}</strong></div></div>
  </div>
  <div class="confirmations"><div class="confirm-title">공급자 확인</div><div class="confirm-title">공급받는 자 확인</div>
   <div class="confirm-box"><span>${esc([s.businessName,s.representative].filter(Boolean).join(' · '))}</span>${stamp}</div>
   <div class="confirm-box"><span>${esc(d.customer||'-')} (확인)</span></div>
  </div>
  <footer class="legal">본 거래명세서는 거래내역 확인용이며 세금계산서나 현금영수증을 대신하지 않습니다.<small>ONEBIZ | 원비즈</small></footer>
 </div>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();$('#shareBottom').onclick=share;
}
async function share(){try{if(navigator.share)await navigator.share({title:'ONEBIZ 거래명세서',text:'거래명세서를 확인해 주세요.',url:location.href});else{await navigator.clipboard.writeText(location.href);alert('거래명세서 링크를 복사했습니다.');}}catch{}}
async function start(){if(!/^[A-Za-z0-9_-]{43}$/.test(token)){ $('#status').textContent='올바르지 않은 거래명세서 링크입니다.';return;}try{const r=await fetch('/api/public/statement/'+encodeURIComponent(token),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error||'거래명세서를 불러오지 못했습니다.');render(b);}catch(e){$('#status').innerHTML='<b>거래명세서를 열 수 없습니다.</b><br>'+esc(e.message);}}
$('#printBtn').onclick=()=>window.print();$('#shareBtn').onclick=share;start();
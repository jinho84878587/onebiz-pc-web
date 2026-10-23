'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';
const token=location.pathname.split('/').filter(Boolean).pop()||'';
function koreanReceiptAmount(amount){
 const num=Math.round(Number(amount)||0);
 if(num<=0)return '영원';
 const digits=['','일','이','삼','사','오','육','칠','팔','구'],units=['','십','백','천'],big=['','만','억','조'];
 const pieces=[];
 let rem=num,group=0;
 while(rem>0&&group<big.length){
  const part=rem%10000;
  if(part>0){
   let str='';
   for(let j=3;j>=0;j--){
    const d=Math.floor(part/10**j)%10;
    if(d)str+=(d===1&&j>0?'':digits[d])+units[j];
   }
   pieces.unshift(str+big[group]);
  }
  rem=Math.floor(rem/10000);group++;
 }
 return pieces.join('')+'원';
}
function render(data){
 const s=data.supplier||{},r=data.receipt||{},paid=Math.max(0,Number(r.paidAmount)||0);
 const vat=r.vatIncluded===false?0:Math.floor(paid/11),supply=paid-vat;
 const item=String(r.item||'견적 거래금액 수령');
 $('#status').classList.add('hidden');
 const root=$('#receipt');root.classList.remove('hidden');
 const detail=(key,value)=>`<div class="supplier-item"><span>${esc(key)}</span><b>${esc(value||'-')}</b></div>`;
 root.innerHTML=`<div class="receipt-document">
  <div class="document-head">
   <div class="document-brand">ONEBIZ <span>원비즈</span></div>
   <h1>간 이 영 수 증</h1><small>SIMPLE RECEIPT</small>
  </div>
  <div class="doc-body">
   <div class="receipt-meta"><span><b>영수증 번호</b>${esc(r.id||'-')}</span><span><b>발행일</b>${esc(r.issuedAt||'-')}</span></div>
   <div class="to-customer"><b>받는 분</b><strong>${esc(r.customer||'-')} 귀하</strong></div>
   <div class="received-highlight"><div>영수금액</div><div class="amount-line"><strong>일금 ${esc(koreanReceiptAmount(paid))}정</strong><b>${money(paid)}</b></div><p>상기 금액을 아래 거래내역과 같이 정히 영수하였습니다.</p></div>
   <h2 class="section-caption">거래 내역</h2>
   <div class="table-scroll"><table class="receipt-items"><thead><tr><th>거래일</th><th>품목명</th><th>규격</th><th>수량</th><th>단가</th><th>영수금액</th></tr></thead>
    <tbody><tr><td>${esc(r.issuedAt||'-')}</td><td class="item-name">${esc(item)}</td><td>—</td><td class="num">1</td><td class="num">${money(paid)}</td><td class="num emphasis">${money(paid)}</td></tr></tbody>
   </table></div>
   <div class="payment-info">
    <div class="method-note"><div><b>결제방법</b><span>□ 현금　□ 계좌이체　□ 카드</span></div><div><b>비고</b><span>${r.vatIncluded===false?'부가세 별도': '영수금액 기준'}</span></div></div>
    <div class="money-calc"><div><span>공급가액</span><b>${money(supply)}</b></div><div><span>부가가치세</span><b>${money(vat)}</b></div><div class="total"><span>합계금액</span><strong>${money(paid)}</strong></div></div>
   </div>
   <h2 class="section-caption">공급자 정보</h2>
   <div class="supplier-grid">${detail('사업자등록번호',s.registrationNo)}${detail('상호',s.businessName)}${detail('대표자',s.representative)}${detail('연락처',s.phone)}${detail('사업장 주소',s.address)}${detail('견적번호',r.quoteId||r.contractId)}</div>
   <div class="signature"><p>위 금액을 수령하였음을 확인합니다.</p><div><b>${esc([s.businessName,s.representative].filter(Boolean).join(' · '))}</b><span class="seal">발행<br>확인</span></div></div>
   <footer class="legal">본 간이영수증은 거래 및 대금 수령 확인용이며 세금계산서·현금영수증을 대신하지 않습니다.<small>ONEBIZ | 원비즈</small></footer>
  </div>
 </div>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();$('#shareBottom').onclick=share;
}
async function share(){try{if(navigator.share)await navigator.share({title:'ONEBIZ 간이영수증',text:'간이영수증을 확인해 주세요.',url:location.href});else{await navigator.clipboard.writeText(location.href);alert('간이영수증 링크를 복사했습니다.');}}catch{}}
async function start(){if(!/^[A-Za-z0-9_-]{43}$/.test(token)){ $('#status').textContent='올바르지 않은 간이영수증 링크입니다.';return;}try{const r=await fetch('/api/public/receipt/'+encodeURIComponent(token),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error||'간이영수증을 불러오지 못했습니다.');render(b);}catch(e){$('#status').innerHTML='<b>간이영수증을 열 수 없습니다.</b><br>'+esc(e.message);}}
$('#printBtn').onclick=()=>window.print();$('#shareBtn').onclick=share;start();
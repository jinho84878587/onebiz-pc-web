'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,digits=2)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:digits}).format(Number(v)||0);
const pad=v=>String(v).padStart(2,'0');
const dateOnly=value=>{
 if(!value)return '-';
 const s=String(value);
 if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
 const d=new Date(value);
 if(Number.isNaN(d.getTime()))return s;
 const local=new Date(d.getTime()+9*3600000);
 return local.getUTCFullYear()+'-'+pad(local.getUTCMonth()+1)+'-'+pad(local.getUTCDate());
};
const token=location.pathname.split('/').filter(Boolean).pop()||'';
let currentQuote=null;
function render(data){
 const supplier=data.supplier||{},q=data.quote||{};
 currentQuote={supplier,quote:q};
 const expired=Number(q.validUntil||0)<=Date.now();
 const company=esc(supplier.businessName||'사업자 정보 미등록');
 const vendorInfo=[
  '공급자  '+(supplier.businessName||'미등록'),
  '대표 '+(supplier.representative||'-'),
  '사업자번호 '+(supplier.registrationNo||'-')
 ].join(' · ');
 const items=Array.isArray(q.items)?q.items:[];
 const itemRows=items.map(item=>`<tr>
   <td class="item-name">${esc(item.name||'-')}${item.spec?`<small>규격: ${esc(item.spec)}</small>`:''}</td>
   <td class="center">${number(item.qty)}</td>
   <td class="num">${number(item.unitPrice)}</td>
   <td class="num">${number(item.amount,4)}</td>
  </tr>`).join('');
 $('#status').classList.add('hidden');
 const root=$('#quote');root.classList.remove('hidden');
 root.innerHTML=`<div class="document-main">
  <div class="doc-head">
   <div><h1>${company}</h1><strong class="doc-type">견적서</strong></div>
   <div class="doc-reference"><span>${esc(q.id||'-')}</span><span>${esc(dateOnly(q.createdAt))}</span></div>
  </div>
  <div class="blue-rule"></div>
  <section class="supplier-block">
   <p>${esc(vendorInfo)}</p>
   ${supplier.address?`<p>사업장  ${esc(supplier.address)}</p>`:''}
  </section>
  <section class="customer-block">
   <strong>고객명  ${esc(q.customer||'-')}</strong>
   <p>연락처  ${esc(q.phone||'-')}</p>
   <p>현장주소  ${esc(q.siteAddress||'미등록')}</p>
  </section>
  <table class="items">
   <colgroup><col class="col-item"><col class="col-qty"><col class="col-unit"><col class="col-total"></colgroup>
   <thead><tr><th>품목</th><th class="center">수량</th><th class="num">단가</th><th class="num">금액</th></tr></thead>
   <tbody>${itemRows||'<tr><td colspan="4" class="empty-items">등록된 품목이 없습니다.</td></tr>'}</tbody>
  </table>
  <div class="total-panel">
   ${Number(q.discountAmount)>0?`<div class="total-line"><span>할인</span><span>-${number(q.discountAmount)}</span></div>`:''}
   <div class="total-line"><span>공급가액</span><span>${number(q.supply)}</span></div>
   ${q.vatEnabled===true?`<div class="total-line"><span>부가세</span><span>${number(q.vat)}</span></div>`:''}
   <div class="total-line total-main"><strong>총 견적금액</strong><strong>${number(q.total)}</strong></div>
   ${q.vatEnabled===false?'<div class="vat-separate">부가세 별도</div>':''}
  </div>
  <div class="document-end">
   <p>수량·단가의 소수 입력값을 반영하며, 최종 정산 금액은 원 단위로 반올림합니다.</p>
   <p class="validity ${expired?'is-expired':''}">견적 유효기간: ${esc(q.validUntilDate||dateOnly(q.validUntil))}${expired?' (만료)':''}</p>
   ${q.note?`<p class="special-note">특이사항: ${esc(q.note)}</p>`:''}
  </div>
 </div>
 <footer class="doc-footer">${company} · A4 인쇄용 · 기본형</footer>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();
 $('#shareBottom').onclick=share;
}
async function share(){
 const q=currentQuote?.quote||{},supplier=currentQuote?.supplier||{};
 const title=(supplier.businessName||'ONEBIZ')+' 견적서 '+(q.id||'');
 try{
  const url=window.OnebizDocumentAccess.shareUrl();
  if(navigator.share)await navigator.share({title,text:'견적서를 확인해 주세요.',url});
  else{await navigator.clipboard.writeText(url);alert('견적서 링크를 복사했습니다.');}
 }catch{}
}
async function start(){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)){$('#status').textContent='올바르지 않은 견적 링크입니다.';return;}
 try{
  const r=await fetch('/api/public/quote/'+encodeURIComponent(token),{cache:'no-store'});
  const b=await r.json();
  if(!r.ok)throw new Error(b.error||'견적서를 불러오지 못했습니다.');
  render(b);
 }catch(e){ throw e; }
}
$('#printBtn').onclick=()=>window.print();
$('#shareBtn').onclick=share;
if(window.OnebizDocumentAccess)window.OnebizDocumentAccess.mount({kind:'quote',token,onOpen:start});

'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Math.round(Number(v)||0))+'원';
const token=location.pathname.split('/').filter(Boolean).pop()||'';
function render(data){
 const s=data.supplier||{},c=data.contract||{};
 if(data.originalUrl){location.replace(data.originalUrl);return;}
 $('#status').classList.add('hidden');
 const root=$('#contract');root.classList.remove('hidden');
 root.innerHTML=`<div class="hero"><div><span class="badge">체결완료 계약서</span><h1>계약서</h1><div class="meta"><b>${esc(s.businessName||'ONEBIZ')}</b><br>계약번호 ${esc(c.id||'-')}<br>계약일 ${esc(c.contractDate||'-')}</div></div><div class="amount-box"><span>계약금액</span><strong>${money(c.amount)}</strong><span>${c.signed?'전자서명 완료':'확인 필요'}</span></div></div>
 <div class="section"><h2>계약 당사자</h2><div class="grid"><div class="row"><b>공급자</b><span>${esc(s.businessName||'-')}</span></div><div class="row"><b>고객명</b><span>${esc(c.customer||'-')}</span></div><div class="row"><b>대표자</b><span>${esc(s.representative||'-')}</span></div><div class="row"><b>현장주소</b><span>${esc(c.siteAddress||'-')}</span></div><div class="row"><b>연락처</b><span>${esc(s.phone||'-')}</span></div><div class="row"><b>사업자번호</b><span>${esc(s.registrationNo||'-')}</span></div></div></div>
 <div class="section"><h2>계약 내용</h2><div class="grid"><div class="row"><b>계약내용</b><span>${esc(c.item||'-')}</span></div><div class="row"><b>시공예정일</b><span>${esc(c.workDate||'-')}</span></div></div></div>
 <div class="section"><h2>대금 일정</h2><table class="payments"><thead><tr><th>구분</th><th>예정일</th><th class="num">금액</th></tr></thead><tbody><tr><td>계약금</td><td>${esc(c.depositDueDate||'-')}</td><td class="num">${money(c.depositAmount)}</td></tr><tr><td>중도금</td><td>${esc(c.middleDueDate||'-')}</td><td class="num">${money(c.middleAmount)}</td></tr><tr><td>잔금</td><td>${esc(c.balanceDueDate||'-')}</td><td class="num">${money(c.balanceAmount)}</td></tr></tbody></table><div class="summary"><div><span>입금액</span><b>${money(c.paidAmount)}</b></div><div><span>미수금</span><b>${money(c.receivable)}</b></div><div class="grand"><span>계약금액</span><span>${money(c.amount)}</span></div></div></div>
 ${data.source?`<div class="section"><h2>계약 정보</h2><div class="grid"><div class="row"><b>계약 유형</b><span>${esc(c.contractType||"-")}</span></div><div class="row"><b>고객 연락처</b><span>${esc(c.phone||"-")}</span></div><div class="row"><b>고객 주소</b><span>${esc(c.address||"-")}</span></div><div class="row"><b>공급자 주소</b><span>${esc(s.address||"-")}</span></div></div></div><div class="section"><h2>서명 확인</h2><div class="grid"><div class="row"><b>서명자</b><span>${esc(c.signatureName||c.customer)}</span></div><div class="row"><b>서명 일시</b><span>${esc(c.signedAt||'-')}</span></div><div class="row"><b>서명 방식</b><span>${esc(c.signatureMethod||'-')}</span></div><div class="row"><b>본인확인</b><span>${esc(c.identityStatus||'-')}</span></div></div>${c.signatureDataUrl?`<img id="signatureImage" src="${esc(c.signatureDataUrl)}" alt="고객이 계약서에 작성한 서명">`:`<canvas id="signature" width="720" height="220" aria-label="고객이 계약서에 작성한 서명"></canvas>`}</div><div class="section"><h2>표준 계약조건</h2><div class="terms">${esc(c.standardTerms||'등록된 표준 계약조건이 없습니다.')}</div></div>${c.specialTerms?`<div class="section"><h2>특약사항</h2><div class="terms">${esc(c.specialTerms)}</div></div>`:''}`:''}
 <div class="footer-note">${data.source?'서명과 계약조건이 포함된 체결 계약서입니다. 발송 이후 앱에서 내용을 수정해도 이 문서의 내용은 바뀌지 않습니다.':'본 화면은 ONEBIZ를 통해 체결된 계약의 확인용 페이지입니다.'} 계약 관련 문의는 계약 상대 업체에 문의해 주세요.</div>
 <div class="actions"><button class="ghost" id="shareBottom" type="button">공유</button><button id="printBottom" type="button">PDF 저장/인쇄</button></div>`;
 $('#printBottom').onclick=()=>window.print();$('#shareBottom').onclick=share;
 if(data.source)drawSignature(c.signatureStrokes||[]);
}
function drawSignature(strokes){
 const canvas=$('#signature');if(!canvas)return;
 const points=strokes.flat().filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));if(!points.length)return;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const [x,y] of points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY),scale=Math.min((canvas.width-40)/width,(canvas.height-40)/height);
 const ctx=canvas.getContext('2d');ctx.strokeStyle='#17243c';ctx.lineWidth=2.5;ctx.lineCap='round';
 for(const stroke of strokes){ctx.beginPath();stroke.forEach((p,i)=>{const x=20+(p[0]-minX)*scale,y=20+(p[1]-minY)*scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
}
async function share(){try{if(navigator.share)await navigator.share({title:'ONEBIZ 계약서',text:'체결된 계약서를 확인해 주세요.',url:location.href});else{await navigator.clipboard.writeText(location.href);alert('계약서 링크를 복사했습니다.');}}catch{}}
async function start(){if(!/^[A-Za-z0-9_-]{43}$/.test(token)){ $('#status').textContent='올바르지 않은 계약서 링크입니다.';return;}try{const r=await fetch('/api/public/contract/'+encodeURIComponent(token),{cache:'no-store'}),b=await r.json();if(!r.ok)throw new Error(b.error||'계약서를 불러오지 못했습니다.');render(b);}catch(e){$('#status').innerHTML='<b>계약서를 열 수 없습니다.</b><br>'+esc(e.message);}}
$('#printBtn').onclick=()=>window.print();$('#shareBtn').onclick=share;start();

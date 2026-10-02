let csrf='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function call(p,m='GET',b){
 const r=await fetch('/api/admin/'+p,{method:m,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Onebiz-Client':'web','X-CSRF-Token':csrf},...(b?{body:JSON.stringify(b)}:{})});
 const d=await r.json(); if(!r.ok)throw new Error(d.error||('HTTP '+r.status)); return d;
}
async function load(){
 try{
  const me=await call('me'); csrf=me.csrf;
  const d=await call('devices');
  const list=document.getElementById('list'),status=document.getElementById('status');
  status.textContent=d.items.length?'앱의 연결코드와 일치하는 항목을 확인하세요.':'승인 대기 중인 Android 기기가 없습니다.';
  list.innerHTML=d.items.map(x=>'<div class="pair-row"><div><div class="code">'+esc(x.phrase)+'</div><div class="muted2">만료: '+new Date(x.expiresAt).toLocaleString('ko-KR')+(x.approved?' · 승인됨':'')+'</div></div>'+(x.approved?'<strong>승인완료</strong>':'<button class="pair-btn" data-id="'+esc(x.id)+'">이 기기 승인</button>')+'</div>').join('');
  document.querySelectorAll('[data-id]').forEach(btn=>btn.onclick=async()=>{if(!confirm('앱 화면의 6자리 연결코드와 정확히 일치합니까?'))return;btn.disabled=true;try{await call('devices/'+btn.dataset.id+'/approve','POST',{});await load();}catch(e){alert(e.message);btn.disabled=false;}});
 }catch(e){document.getElementById('status').innerHTML='관리자 로그인이 필요하거나 요청을 불러오지 못했습니다. <a href="/admin">관리센터 로그인</a><br>'+esc(e.message);}
}
load(); setInterval(load,10000);
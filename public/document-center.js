(function (global) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kinds = {quote:'견적서',contract:'계약서',statement:'거래명세서',receipt:'간이영수증'};
  const deliveryLabels = {pending:'발송 처리 중',accepted:'발송 접수',unknown:'결과 미확인',delivered:'전달 완료',failed:'발송 실패',unavailable:'전달 확인 불가',not_sent:'링크 발행'};
  const eventLabels = {created:'문서 준비',sent:'발송 요청',accepted:'발송 접수',unknown:'결과 미확인',delivered:'전달 완료',failed:'발송 실패',opened:'문서 링크 열림',first_opened:'문서 링크 첫 열림',signed:'서명 완료',sign_link_opened:'서명 페이지 이동',original_link_opened:'원본 링크 열림',legacy:'이전 발송 기록'};
  const validTime = value => Number.isFinite(Number(value)) && Number(value) > 0;
  const dateTime = value => validTime(value) ? new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(Number(value))) : '기록 없음';
  const money = value => value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value)) ? new Intl.NumberFormat('ko-KR').format(Math.round(Number(value))) + '원' : '금액 기록 없음';
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const icons = {
    files:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>',
    arrow:'<path d="m9 5 7 7-7 7"/>',
    back:'<path d="m15 5-7 7 7 7"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
    send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.files) + '</svg>';
  function previewUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value), global.location.origin);
      if (url.origin !== global.location.origin || url.username || url.password || !/^\/(quote|contract|statement|receipt|s)\/[A-Za-z0-9_-]{43}$/.test(url.pathname)) return '';
      return url.pathname + url.search;
    } catch { return ''; }
  }
  function describeDocument(doc) {
    return {
      kind:kinds[doc.kind] || '문서',
      delivery:deliveryLabels[doc.deliveryStatus] || '결과 미확인',
      opened:validTime(doc.firstOpenedAt),
      signed:validTime(doc.signedAt),
      signLinkOpened:validTime(doc.signLinkOpenedAt),
      originalLinkOpened:validTime(doc.originalLinkOpenedAt),
      preview:previewUrl(doc.previewUrl)
    };
  }
  function mount(options) {
    const root = options.root, request = options.request, notify = options.notify || (() => {}), onUnread = options.onUnread || (() => {});
    let alive = true, busy = false, data = null, error = '', selected = null, selectedDetail = null, limit = 50;
    let tab = ['documents','notifications','settings'].includes(options.tab) ? options.tab : 'documents';
    const header = () => '<div class="dc-heading"><div><span class="dc-eyebrow">ONEBIZ · 문서 진행 현황</span><h2>' + (tab === 'notifications' ? '알림함' : tab === 'settings' ? '알림 설정' : '보낸 문서') + '</h2><p>발송 접수, 전달 결과, 링크 열림과 서명을 따로 확인하세요.</p></div><button class="dc-icon-button" type="button" data-dc-action="refresh" aria-label="문서와 알림 새로고침" ' + (busy?'disabled':'') + '>' + icon('refresh') + '</button></div>';
    function navigation() {
      const unread = count(data?.unreadCount);
      return '<nav class="dc-tabs" aria-label="문서와 알림 메뉴">' + [['documents','files','보낸 문서'],['notifications','bell','알림함'],['settings','settings','알림 설정']].map(([id,i,label]) => '<button type="button" data-dc-tab="' + id + '" ' + (tab===id?'aria-current="page"':'') + '>' + icon(i) + '<span>' + label + '</span>' + (id==='notifications'&&unread?'<span class="dc-count">'+(unread>99?'99+':unread)+'</span>':'') + '</button>').join('') + '</nav>';
    }
    const badge = (label, tone='') => '<span class="dc-badge '+tone+'">'+escape(label)+'</span>';
    function badges(doc) {
      const d=describeDocument(doc),tone=doc.deliveryStatus==='failed'?'failed':doc.deliveryStatus==='delivered'?'delivered':'';
      return badge(d.delivery,tone)+(d.opened?badge('링크 열림','opened'):'')+(d.originalLinkOpened?badge('원본 링크 열림','opened'):'')+(d.signLinkOpened?badge('서명 페이지 이동','subtle'):'')+(d.signed?badge('서명 완료','signed'):'');
    }
    function documentList() {
      const docs=data.documents,opened=docs.filter(d=>validTime(d.firstOpenedAt)).length,failed=docs.filter(d=>d.deliveryStatus==='failed').length;
      return '<div class="dc-summary"><span>표시 중 <b>'+docs.length+'건</b></span><span>문서 링크 열림 <b>'+opened+'건</b></span><span>발송 실패 <b>'+failed+'건</b></span></div>'+
        '<div class="dc-section-head"><h3>최근 발송 내역</h3><span>'+dateTime(data.refreshedAt)+' 기준</span></div>'+
        (docs.length?'<div class="dc-document-grid">'+docs.map(doc=>{
          const d=describeDocument(doc);
          return '<button type="button" class="dc-document" data-dc-document="'+escape(doc.id)+'"><div class="dc-document-top"><span class="dc-document-icon">'+icon('files')+'</span><div class="dc-document-name"><strong>'+escape(doc.customer||'고객명 미등록')+' · '+d.kind+'</strong><span>'+escape(doc.sourceId||doc.title||'')+'</span></div>'+icon('arrow')+'</div><div class="dc-badges">'+badges(doc)+'</div><div class="dc-document-bottom"><strong>'+money(doc.amount)+'</strong><span>'+dateTime(doc.sentAt||doc.createdAt)+'</span></div></button>';
        }).join('')+'</div>':'<div class="dc-empty">'+icon('files')+'<h3>아직 보낸 문서가 없습니다.</h3><p>원비즈에서 문서를 발송하면 진행 내역이 여기에 표시됩니다.</p></div>')+
        (data.hasMore?'<div class="dc-more">'+(limit<100?'<button type="button" class="dc-secondary" data-dc-action="more">최근 100건 보기</button>':'<p>최근 100건을 표시하고 있습니다.</p>')+'</div>':'')+
        '<p class="dc-note">링크 열림은 해당 링크에서 문서 열기 버튼을 누른 기록입니다. 수신자의 신원이나 계약 동의를 확인한 기록은 아닙니다.</p>';
    }
    function documentDetail(doc) {
      const d=describeDocument(doc),events=Array.isArray(doc.events)?doc.events.filter(e=>validTime(e.at)).sort((a,b)=>Number(a.at)-Number(b.at)):[];
      const openedText=d.opened?dateTime(doc.firstOpenedAt):d.originalLinkOpened?'원본 링크 이동만 기록됨':d.signLinkOpened?'서명 페이지 이동만 기록됨':'아직 문서 열림 기록 없음';
      return '<button type="button" class="dc-back" data-dc-action="back">'+icon('back')+'목록으로</button><div class="dc-detail-grid"><section class="dc-panel dc-document-detail"><span class="dc-eyebrow">'+d.kind+(doc.variant==='sign_request'?' · 서명 요청':doc.variant==='completed'?' · 체결 원본':'')+'</span><h3>'+escape(doc.customer||'고객명 미등록')+'</h3><p class="dc-subtitle">'+escape(doc.title||doc.sourceId||d.kind)+'</p><strong class="dc-amount">'+money(doc.amount)+'</strong><div class="dc-badges">'+badges(doc)+'</div><dl class="dc-fields"><div><dt>문서번호</dt><dd>'+escape(doc.sourceId||'-')+'</dd></div><div><dt>수신번호</dt><dd>'+escape(doc.phoneMask||'미등록')+'</dd></div><div><dt>발송 요청</dt><dd>'+dateTime(doc.sentAt||doc.createdAt)+'</dd></div><div><dt>전달 결과</dt><dd>'+escape(d.delivery)+(validTime(doc.deliveredAt)?'<small>'+dateTime(doc.deliveredAt)+'</small>':'')+'</dd></div><div><dt>첫 문서 열림</dt><dd>'+openedText+'</dd></div>'+(d.opened?'<div><dt>최근 문서 열림</dt><dd>'+dateTime(doc.lastOpenedAt)+'</dd></div><div><dt>문서 열림 횟수</dt><dd>'+count(doc.openCount)+'회</dd></div>':'')+(d.signLinkOpened?'<div><dt>서명 페이지 이동</dt><dd>'+dateTime(doc.signLinkOpenedAt)+'</dd></div>':'')+(d.originalLinkOpened?'<div><dt>원본 링크 이동</dt><dd>'+dateTime(doc.originalLinkOpenedAt)+'</dd></div>':'')+(doc.kind==='contract'?'<div><dt>서명 완료</dt><dd>'+(d.signed?dateTime(doc.signedAt):'서명 완료 기록 없음')+'</dd></div>':'')+'</dl>'+(doc.metadataNotice?'<p class="dc-note">'+escape(doc.metadataNotice)+'</p>':'')+(doc.providerCheckNotice?'<p class="dc-note">'+escape(doc.providerCheckNotice)+'</p>':'')+(doc.failureReason?'<p class="dc-failure">'+escape(doc.failureReason)+'</p>':'')+(d.preview?'<a class="dc-primary" href="'+escape(d.preview)+'" target="_blank" rel="noopener noreferrer">'+icon('eye')+'내 문서 미리보기</a><p class="dc-note">로그인한 발행자의 미리보기는 고객 열림 기록에서 제외됩니다.</p>':'<p class="dc-note">이 발송 내역에서는 원본 미리보기를 제공하지 않습니다.</p>')+'</section><section class="dc-panel dc-timeline"><h3>진행 이력</h3>'+(events.length?'<ol>'+events.map(e=>{
        const tone=['opened','first_opened','original_link_opened'].includes(e.type)?'opened':e.type==='signed'?'signed':e.type==='failed'?'failed':'';
        const i=tone==='failed'?'alert':tone==='signed'?'check':tone==='opened'?'eye':'send';
        return '<li><span class="dc-event-icon '+tone+'">'+icon(i)+'</span><div><strong>'+escape(e.message||eventLabels[e.type]||'진행 상태 변경')+'</strong><time>'+dateTime(e.at)+'</time></div></li>';
      }).join('')+'</ol>':'<p class="dc-empty-small">아직 기록된 진행 이력이 없습니다.</p>')+'<p class="dc-note">발송 접수는 전달 완료와 다릅니다. 링크 열림과 서명 완료도 별도 기록입니다.</p></section></div>';
    }
    function notifications() {
      const rows=data.notifications;
      return '<div class="dc-section-head"><h3>미확인 <b>'+count(data.unreadCount)+'개</b></h3><button type="button" class="dc-link-button" data-dc-action="read-all" '+(busy||!count(data.unreadCount)?'disabled':'')+'>모두 확인</button></div>'+(rows.length?'<div class="dc-notifications">'+rows.map(n=>{
        const tone=n.kind==='signed'?'signed':n.kind==='failed'?'failed':['opened','original_link_opened'].includes(n.kind)?'opened':'';
        return '<button type="button" class="dc-notification '+(!n.readAt?'unread':'')+'" data-dc-notification="'+escape(n.id)+'"><span class="dc-event-icon '+tone+'">'+icon(tone==='failed'?'alert':tone==='signed'?'check':tone==='opened'?'eye':'bell')+'</span><span class="dc-notification-text"><strong>'+escape(n.title||'문서 알림')+'</strong><span>'+escape(n.body||'')+'</span><time>'+dateTime(n.createdAt)+'</time></span>'+(!n.readAt?'<span class="dc-unread-dot" aria-label="미확인"></span>':'')+'</button>';
      }).join('')+'</div>':'<div class="dc-empty">'+icon('bell')+'<h3>새로운 진행 알림이 없습니다.</h3><p>문서 열림, 서명과 전달 결과를 이곳에서 확인할 수 있습니다.</p></div>')+(data.hasMoreNotifications?'<p class="dc-note">최근 알림을 표시하고 있습니다. 전체 미확인 개수는 상단 숫자에 반영됩니다.</p>':'');
    }
    function settings() {
      const prefs=data.settings||{};
      const row=(key,title,description)=>'<label class="dc-setting"><span><strong>'+title+'</strong><small>'+description+'</small></span><input type="checkbox" class="dc-switch" data-dc-setting="'+key+'" '+(prefs[key]===true?'checked':'')+' '+(busy?'disabled':'')+' aria-label="'+title+'"></label>';
      return '<p class="dc-settings-intro">받을 휴대폰 알림을 선택하세요. 알림함에서는 모든 진행 내역을 계속 확인할 수 있습니다.</p><section class="dc-panel dc-settings">'+row('firstOpen','문서 링크 첫 열림','고객에게 보낸 문서 또는 원본 링크가 처음 열렸을 때')+row('signatureComplete','서명 완료','계약서에 서명이 완료됐을 때')+row('deliveryFailure','전달 실패','문서 안내 메시지의 전달 실패가 확인됐을 때')+row('deliveryComplete','전달 완료','문서 안내 메시지의 전달 완료가 확인됐을 때')+'</section><h3 class="dc-settings-heading">알림 받는 방법</h3><section class="dc-panel dc-settings">'+row('mobileNotifications','휴대폰 알림 · 주기 확인','기기별 수신은 원비즈 앱에서 켜고 알림 권한을 허용해 주세요.')+'<div class="dc-setting"><span><strong>즉시 푸시 알림</strong><small>앱을 닫아도 즉시 받는 푸시는 아직 연결되지 않았습니다.</small></span><span class="dc-unavailable">미연결</span></div><div class="dc-setting"><span><strong>내게 알림톡</strong><small>내 카카오톡으로 받는 알림은 아직 연결되지 않았습니다.</small></span><span class="dc-unavailable">미연결</span></div></section><p class="dc-note">휴대폰 알림은 백그라운드에서 최소 15분 간격으로 확인하며, 절전 상태에 따라 더 늦어질 수 있습니다. 고객에게 보내는 문서 안내 알림톡과 내게 오는 알림은 별도입니다.</p>';
    }
    function render() {
      if(!alive)return;
      root.classList.add('dc-host');
      const chosen=selected&&(data?.documents.find(d=>String(d.id)===selected)||(String(selectedDetail?.id)===selected?selectedDetail:null));
      root.innerHTML='<div class="document-center">'+header()+navigation()+(error?'<div class="dc-error" role="alert">'+escape(error)+'<button type="button" data-dc-action="reload">다시 불러오기</button></div>':'')+(!data?'<div class="dc-empty" role="status">'+(busy?'내 문서와 알림을 불러오는 중입니다.':'문서 내역을 불러오지 못했습니다.')+'</div>':chosen?documentDetail(chosen):tab==='notifications'?notifications():tab==='settings'?settings():documentList())+'<p class="dc-loading" role="status" aria-live="polite">'+(busy&&data?'상태를 확인하는 중입니다.':'')+'</p></div>';
    }
    async function load(refresh=false) {
      if(busy||!alive)return;
      busy=true;error='';render();
      try {
        const result=await request('/api/document-center'+(refresh?'/refresh':'?limit='+limit),refresh?{method:'POST',body:'{}'}:{});
        if(!alive)return;
        data={...result,documents:Array.isArray(result.documents)?result.documents:[],notifications:Array.isArray(result.notifications)?result.notifications:[],settings:result.settings||{},capabilities:result.capabilities||{}};
        onUnread(count(data.unreadCount));
        if(refresh)notify('문서와 알림 상태를 새로 확인했습니다.');
      } catch(e) { if(alive)error=e.message||'내역을 불러오지 못했습니다.'; }
      finally {busy=false;render();}
    }
    async function readNotification(id,all=false) {
      if(busy||!data)return;
      busy=true;error='';render();
      try {
        const result=await request('/api/document-center/notifications/read',{method:'POST',body:JSON.stringify(all?{all:true}:{ids:[id]})});
        if(!alive)return;
        data.notifications=data.notifications.map(n=>all||String(n.id)===id?{...n,readAt:n.readAt||Date.now()}:n);
        data.unreadCount=count(result.unreadCount);onUnread(data.unreadCount);
        if(!all){
          const n=data.notifications.find(n=>String(n.id)===id);
          if(n?.documentId){
            const documentId=String(n.documentId);
            if(!data.documents.some(d=>String(d.id)===documentId)){
              const detail=await request('/api/document-center/documents/'+encodeURIComponent(documentId));
              if(!alive)return;
              if(!detail.document||String(detail.document.id)!==documentId)throw new Error('알림에 연결된 문서를 확인할 수 없습니다.');
              selectedDetail=detail.document;
            }
            selected=documentId;tab='documents';
          }else notify('알림을 확인했습니다.');
        }
      }catch(e){if(alive)error=e.message||'알림 확인을 저장하지 못했습니다.';}
      finally{busy=false;render();}
    }
    async function changeSetting(key,value) {
      if(busy||!data)return;
      busy=true;error='';render();
      try {
        const result=await request('/api/document-center/settings',{method:'PUT',body:JSON.stringify({[key]:value})});
        if(!alive)return;
        data.settings=result.settings||data.settings;notify('알림 설정을 저장했습니다.');
      }catch(e){if(alive)error=e.message||'설정을 저장하지 못했습니다.';}
      finally{busy=false;render();}
    }
    function click(event) {
      const button=event.target.closest('[data-dc-tab],[data-dc-action],[data-dc-document],[data-dc-notification]');
      if(!button||!root.contains(button)||button.disabled)return;
      if(button.dataset.dcTab){tab=button.dataset.dcTab;selected=null;render();return;}
      if(button.dataset.dcDocument){selected=button.dataset.dcDocument;render();return;}
      if(button.dataset.dcNotification){void readNotification(button.dataset.dcNotification);return;}
      const action=button.dataset.dcAction;
      if(action==='refresh')void load(true);
      else if(action==='reload')void load();
      else if(action==='read-all')void readNotification('',true);
      else if(action==='back'){selected=null;render();}
      else if(action==='more'){limit=100;void load();}
    }
    function change(event){const input=event.target;if(input.dataset?.dcSetting)void changeSetting(input.dataset.dcSetting,input.checked===true);}
    root.addEventListener('click',click);root.addEventListener('change',change);void load();
    return {destroy(){alive=false;root.removeEventListener('click',click);root.removeEventListener('change',change);root.classList.remove('dc-host');}};
  }
  global.OnebizDocumentCenter=Object.freeze({mount,describeDocument});
})(window);

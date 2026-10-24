(function (global) {
  'use strict';
  const names={quote:'견적서',contract:'계약서',statement:'거래명세서',receipt:'간이영수증',sign:'서명 요청 문서'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function allowedRedirect(value){
    try{
      const url=new URL(String(value),global.location.origin);
      if(url.username||url.password||url.hash)return '';
      if(url.origin==='https://hiwon-websign-server.onrender.com')return url.href;
      if(url.origin===global.location.origin&&/^\/(quote|contract|statement|receipt|s)\/[A-Za-z0-9_-]{43}$/.test(url.pathname))return url.href;
    }catch{}
    return '';
  }
  function mount(options){
    const kind=options.kind,token=options.token,status=global.document.querySelector('#status');
    if(!status)return;
    if(!names[kind]||!/^[A-Za-z0-9_-]{43}$/.test(String(token||''))){status.textContent='올바르지 않은 문서 링크입니다.';return;}
    const title=options.title||names[kind],sign=kind==='sign';
    global.document.body.classList.add('document-awaiting-open');
    status.classList.add('document-access');
    status.innerHTML='<div class="document-access-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg></div><span class="document-access-brand">ONEBIZ · 원비즈</span><h1>'+escape(title)+'</h1><p>'+(sign?'계약 내용을 확인한 뒤 서명을 진행해 주세요.':'아래 버튼을 눌러 문서 내용을 확인하세요.')+'</p><button id="documentOpenBtn" type="button">'+(sign?'서명 문서 열기':'문서 열기')+'</button><p class="document-access-notice">'+(sign?'버튼을 누르면 발행자에게 서명 페이지 이동 여부가 표시됩니다.':'문서를 열면 발행자에게 링크 열림 여부가 표시됩니다.')+'</p><p class="document-access-preview">발행자가 로그인한 상태로 미리 보면 고객 열림 기록에 포함되지 않습니다.</p><p id="documentOpenError" class="document-access-error" role="status" aria-live="polite"></p>';
    const button=global.document.querySelector('#documentOpenBtn'),error=global.document.querySelector('#documentOpenError');
    const feedback=global.document.createElement('p');
    feedback.className='document-access-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    status.insertAdjacentElement('afterend',feedback);
    let opening=false,opened=false;
    async function post(path,payload){
      const response=await global.fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Onebiz-Client':'web'},body:JSON.stringify(payload)});
      let data;try{data=await response.json();}catch{throw new Error('문서 확인 응답을 받지 못했습니다. 다시 시도해 주세요.');}
      if(!response.ok||data.ok===false)throw new Error(data.error||'문서를 열 수 없습니다. 다시 시도해 주세요.');
      return data;
    }
    const prefix='/api/public/document-access/'+encodeURIComponent(kind)+'/'+encodeURIComponent(token);
    const previewToken=new URLSearchParams(global.location.search||'').get('preview')||'';
    const challenge=()=>post(prefix+'/challenge',{previewToken});
    function visible(){
      if(global.document.visibilityState!=='hidden')return Promise.resolve();
      return new Promise(resolve=>{
        const changed=()=>{if(global.document.visibilityState!=='hidden'){global.document.removeEventListener('visibilitychange',changed);resolve();}};
        global.document.addEventListener('visibilitychange',changed);
      });
    }
    async function record(grant){
      await visible();
      return post(prefix+'/open',{challenge:grant.challenge||null,previewToken});
    }
    function trackingFailed(){
      feedback.textContent='문서는 열렸지만 열림 상태를 저장하지 못했습니다. ';
      const retry=global.document.createElement('button');retry.type='button';retry.textContent='다시 저장';
      retry.onclick=async event=>{
        if(event?.isTrusted===false||retry.disabled)return;
        retry.disabled=true;
        try{const grant=await challenge();await record(grant);feedback.textContent=grant.mode==='owner_preview'?'발행자 미리보기입니다. 고객 열림 기록에 포함되지 않습니다.':'';}
        catch{retry.disabled=false;}
      };
      feedback.append(retry);
    }
    button.onclick=async event=>{
      // Browser-generated clicks include keyboard activation. Scripted previews do not count.
      if(event?.isTrusted===false||opening||opened)return;
      opening=true;button.disabled=true;button.textContent='문서를 확인하는 중입니다.';error.textContent='';
      try{
        let grant,challengeError;
        try{grant=await challenge();}catch(e){challengeError=e;}
        const rendered=typeof options.onOpen==='function'?await options.onOpen():{redirect:true};
        if(rendered?.redirect){
          if(challengeError)throw challengeError;
          const result=await record(grant);
          const redirect=allowedRedirect(result.redirectUrl);
          if(!redirect)throw new Error('문서 연결 주소를 확인할 수 없습니다. 발행자에게 문의해 주세요.');
          opened=true;global.location.assign(redirect);return;
        }
        status.classList.remove('document-access');
        opened=true;
        global.document.body.classList.remove('document-awaiting-open');
        if(challengeError){trackingFailed();return;}
        try{await record(grant);feedback.textContent=grant.mode==='owner_preview'?'발행자 미리보기입니다. 고객 열림 기록에 포함되지 않습니다.':'';}
        catch{trackingFailed();}
      }catch(e){
        status.classList.remove('hidden');status.classList.add('document-access');
        const sheet=global.document.querySelector('#'+kind);if(sheet)sheet.classList.add('hidden');
        error.textContent=e.message||'문서를 열지 못했습니다. 다시 시도해 주세요.';
        button.disabled=false;button.textContent=sign?'서명 문서 열기':'문서 열기';
      }finally{opening=false;}
    };
  }
  const shareUrl=()=>global.location.origin+global.location.pathname;
  global.OnebizDocumentAccess=Object.freeze({mount,shareUrl});
})(window);

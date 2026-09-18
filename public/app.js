(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const loginView = $('#loginView');
  const appShell = $('#appShell');
  const content = $('#content');
  const modal = $('#modal');
  const toastEl = $('#toast');
  const pageTitle = $('#pageTitle');
  const pageSubtitle = $('#pageSubtitle');
  const syncBadge = $('#syncBadge');
  const sideNav = $('#sideNav');
  const mobileNav = $('#mobileNav');
  const printArea = $('#printArea');

  const navItems = [
    ['home', '홈', '⌂', '대시보드', '오늘의 사업 현황을 한눈에 확인하세요.'],
    ['customers', '고객', '👤', '고객관리', '고객 연락처와 현장 정보를 관리합니다.'],
    ['quotes', '견적', '▤', '견적서', '견적 작성·수정·출력을 PC에서 빠르게 처리합니다.'],
    ['contracts', '계약', '✎', '계약서', '계약 조건과 전자서명 상태를 관리합니다.'],
    ['payments', '대금', '₩', '대금관리', '입금과 미수금을 한눈에 확인합니다.'],
    ['employees', '직원', '👥', '직원관리', '직원·근로계약·급여 정보를 관리합니다.'],
    ['settings', '더보기', '•••', 'ONEBIZ 설정', '사업자 정보와 PC·모바일 웹 연동 상태를 확인합니다.']
  ];

  let route = 'home';
  let token = sessionStorage.getItem('onebiz_token') || '';
  let memberId = sessionStorage.getItem('onebiz_member_id') || '';
  let snapshot = null;
  let saveTimer = null;
  let demoMode = false;

  function emptySnapshot() {
    return { profile: {}, data: { customers: [], quotes: [], contracts: [] }, employees: [], updatedAt: null };
  }
  function normalizeSnapshot(s) {
    const out = s && typeof s === 'object' ? s : emptySnapshot();
    out.profile = out.profile || {};
    out.data = out.data || {};
    out.data.customers = Array.isArray(out.data.customers) ? out.data.customers : [];
    out.data.quotes = Array.isArray(out.data.quotes) ? out.data.quotes : [];
    out.data.contracts = Array.isArray(out.data.contracts) ? out.data.contracts : [];
    out.employees = Array.isArray(out.employees) ? out.employees : [];
    return out;
  }
  function esc(v) {
    return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function num(v) { return Number(String(v ?? '').replace(/[^0-9-]/g, '')) || 0; }
  function won(v) { return new Intl.NumberFormat('ko-KR').format(num(v)) + '원'; }
  function phone(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`;
    return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  }
  function today() { return new Date().toISOString().slice(0,10); }
  function fullAddr(a, b) { return [a,b].map(x => String(x || '').trim()).filter(Boolean).join(' '); }
  function quoteSupply(q) { return (q.items || []).reduce((s,i) => s + num(i.qty) * num(i.unitPrice), 0); }
  function quoteDiscounted(q) { return Math.max(0, quoteSupply(q) - num(q.discountAmount)); }
  function quoteVat(q) { return q.vatEnabled === false ? 0 : Math.round(quoteDiscounted(q) * .1); }
  function quoteTotal(q) { return quoteDiscounted(q) + quoteVat(q); }
  function receivable(c) { return Math.max(0, num(c.amount) - num(c.paidAmount)); }
  function nextId(prefix, list) {
    const year = new Date().getFullYear();
    const max = list.reduce((m, x) => {
      const n = parseInt(String(x.id || '').split('-').pop(), 10);
      return Number.isFinite(n) ? Math.max(m,n) : m;
    }, 0);
    return `${prefix}-${year}-${String(max + 1).padStart(3,'0')}`;
  }
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  function setSync(state, text) {
    syncBadge.className = 'sync-badge' + (state ? ` ${state}` : '');
    syncBadge.textContent = text;
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...options, headers });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/v1/session') {
      logout('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      throw new Error(body.error || '로그인이 만료되었습니다.');
    }
    if (!res.ok) throw new Error(body.error || `서버 오류 ${res.status}`);
    return body;
  }

  async function loadSnapshot() {
    if (demoMode) { setSync('ok','미리보기'); render(); return; }
    setSync('busy','불러오는 중');
    const body = await api('/api/v1/snapshot');
    snapshot = normalizeSnapshot(body);
    memberId = body.memberId || memberId;
    sessionStorage.setItem('onebiz_member_id', memberId);
    $('#sidebarMemberId').textContent = memberId;
    setSync('ok', body.updatedAt ? '동기화됨' : '연결됨');
    render();
  }

  async function saveSnapshot() {
    if (!snapshot) return;
    if (demoMode) { localStorage.setItem('onebiz_demo_snapshot', JSON.stringify(snapshot)); setSync('ok','미리보기 저장'); return; }
    setSync('busy','저장 중');
    try {
      const body = await api('/api/v1/snapshot', {
        method: 'PUT',
        body: JSON.stringify({ profile: snapshot.profile, data: snapshot.data, employees: snapshot.employees })
      });
      snapshot.updatedAt = body.updatedAt;
      setSync('ok','동기화됨');
    } catch (e) {
      setSync('error','저장 실패');
      showToast(e.message);
    }
  }
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSnapshot, 250);
  }
  function mutate(message) {
    render();
    queueSave();
    if (message) showToast(message);
  }

  function renderNav() {
    sideNav.innerHTML = navItems.map(([id,label,icon]) => `<button class="nav-item ${route===id?'active':''}" data-route="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join('');
    mobileNav.innerHTML = navItems.slice(0,6).map(([id,label,icon]) => `<button class="${route===id?'active':''}" data-route="${id}"><span>${icon}</span><span>${label}</span></button>`).join('');
    $$('#sideNav [data-route], #mobileNav [data-route]').forEach(b => b.onclick = () => { route = b.dataset.route; render(); });
  }
  function render() {
    if (!snapshot) return;
    renderNav();
    const item = navItems.find(n => n[0] === route) || navItems[0];
    pageTitle.textContent = item[3];
    pageSubtitle.textContent = item[4];
    if (route === 'home') renderHome();
    else if (route === 'customers') renderCustomers();
    else if (route === 'quotes') renderQuotes();
    else if (route === 'contracts') renderContracts();
    else if (route === 'payments') renderPayments();
    else if (route === 'employees') renderEmployees();
    else renderSettings();
  }

  function renderHome() {
    const { customers, quotes, contracts } = snapshot.data;
    const signed = contracts.filter(c => c.signed);
    const recv = signed.reduce((s,c) => s + receivable(c), 0);
    const recent = [...quotes.map(q => ({kind:'견적', id:q.id, name:q.customer, amount:quoteTotal(q), status:q.status || '작성중', date:q.createdAt})),
                    ...contracts.map(c => ({kind:'계약', id:c.id, name:c.customer, amount:c.amount, status:c.signed?'체결완료':'서명대기', date:c.contractDate}))]
                    .sort((a,b) => String(b.date||'').localeCompare(String(a.date||''))).slice(0,6);
    content.innerHTML = `
      <div class="metrics">
        <div class="metric primary-metric"><span class="label">미수금</span><span class="value">${won(recv)}</span><span class="sub">체결된 계약 기준</span></div>
        <div class="metric"><span class="label">고객</span><span class="value">${customers.length}명</span><span class="sub">등록 고객</span></div>
        <div class="metric"><span class="label">견적서</span><span class="value">${quotes.length}건</span><span class="sub">전체 견적</span></div>
        <div class="metric"><span class="label">계약서</span><span class="value">${contracts.length}건</span><span class="sub">체결 ${signed.length}건</span></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-header"><div><h3>최근 업무</h3><p>견적·계약 최신 기록</p></div></div>
          ${recent.length ? `<div class="summary-list">${recent.map(r => `<div class="summary-row"><div class="summary-icon">${r.kind==='견적'?'Q':'C'}</div><div class="grow"><b>${esc(r.id)} · ${esc(r.name)}</b><small>${esc(r.kind)} · ${esc(r.status)}</small></div><span class="amount">${won(r.amount)}</span></div>`).join('')}</div>` : `<div class="empty">아직 작성된 문서가 없습니다.</div>`}
        </div>
        <div class="panel"><div class="panel-header"><div><h3>빠른 실행</h3><p>자주 쓰는 기능</p></div></div>
          <div class="quick-grid">
            <button class="quick-card" id="quickQuote"><strong>+ 견적서 작성</strong><span>고객 선택부터 금액 계산까지</span></button>
            <button class="quick-card" id="quickCustomer"><strong>+ 고객 등록</strong><span>전화·주소 저장</span></button>
            <button class="quick-card" data-go="payments"><strong>대금 확인</strong><span>미수금과 입금 관리</span></button>
            <button class="quick-card" data-go="employees"><strong>직원 관리</strong><span>근로계약·급여 정보</span></button>
          </div>
        </div>
      </div>`;
    $('#quickQuote').onclick = () => openQuoteModal();
    $('#quickCustomer').onclick = () => openCustomerModal();
    $$('[data-go]').forEach(b => b.onclick = () => { route = b.dataset.go; render(); });
  }

  function pageTop(searchPlaceholder, addLabel, addFn) {
    return `<div class="page-actions"><button class="primary" id="pageAdd">+ ${addLabel}</button></div><div class="search-row"><input id="pageSearch" placeholder="${searchPlaceholder}" /></div>`;
  }

  function renderCustomers() {
    const rows = snapshot.data.customers;
    content.innerHTML = pageTop('이름·전화번호·주소 검색','고객 등록') + `<div id="customerResults"></div>`;
    $('#pageAdd').onclick = () => openCustomerModal();
    $('#pageSearch').oninput = renderCustomerRows;
    renderCustomerRows();
  }
  function renderCustomerRows() {
    const q = ($('#pageSearch')?.value || '').trim().toLowerCase();
    const rows = snapshot.data.customers.filter(c => !q || [c.name,c.phone,c.address,c.addressDetail].join(' ').toLowerCase().includes(q));
    const wrap = $('#customerResults');
    wrap.innerHTML = rows.length ? `
      <div class="table-wrap"><table class="data-table"><thead><tr><th>고객명</th><th>휴대폰</th><th>주소</th><th></th></tr></thead><tbody>${rows.map((c,i)=>`<tr><td><b>${esc(c.name)}</b></td><td>${esc(phone(c.phone))}</td><td>${esc(fullAddr(c.address,c.addressDetail)||'-')}</td><td class="actions"><button class="pill-button" data-edit-customer="${i}">수정</button><button class="pill-button" data-quote-customer="${i}">견적</button></td></tr>`).join('')}</tbody></table></div>
      <div class="cards-mobile">${rows.map((c,i)=>`<div class="card-row"><div class="head"><b>${esc(c.name)}</b><span>${esc(phone(c.phone))}</span></div><div class="meta"><span>${esc(fullAddr(c.address,c.addressDetail)||'주소 미등록')}</span></div><div class="card-actions"><button class="ghost" data-edit-customer="${i}">수정</button><button class="primary" data-quote-customer="${i}">견적 작성</button></div></div>`).join('')}</div>` : `<div class="empty">등록된 고객이 없습니다.</div>`;
    $$('[data-edit-customer]').forEach(b => b.onclick = () => openCustomerModal(rows[+b.dataset.editCustomer]));
    $$('[data-quote-customer]').forEach(b => b.onclick = () => openQuoteModal(null, rows[+b.dataset.quoteCustomer]));
  }

  function openCustomerModal(customer = null) {
    const editing = customer ? snapshot.data.customers.indexOf(customer) : -1;
    openModal(customer?'고객정보 수정':'고객 등록','휴대폰 번호는 자동으로 하이픈 형식으로 저장됩니다.', `
      <div class="form-grid">
        <div class="field"><label>고객명<input id="fName" value="${esc(customer?.name||'')}" required></label></div>
        <div class="field"><label>휴대폰<input id="fPhone" inputmode="tel" value="${esc(customer?.phone||'')}" placeholder="010-0000-0000"></label></div>
        <div class="field full"><label>주소<input id="fAddress" value="${esc(customer?.address||'')}" placeholder="도로명 또는 지번 주소"></label></div>
        <div class="field full"><label>상세주소<input id="fAddressDetail" value="${esc(customer?.addressDetail||'')}" placeholder="동·호수, 층 등"></label></div>
        ${customer?'<div class="field full danger-zone"><button type="button" id="deleteCustomer" class="danger">고객 삭제</button><span class="help">기존 견적·계약은 삭제되지 않습니다.</span></div>':''}
      </div>`, () => {
        const name = $('#fName',modal).value.trim();
        if (!name) return showToast('고객명을 입력해 주세요.'), false;
        const value = { name, phone: phone($('#fPhone',modal).value), address: $('#fAddress',modal).value.trim(), addressDetail: $('#fAddressDetail',modal).value.trim() };
        if (editing >= 0) snapshot.data.customers[editing] = value; else snapshot.data.customers.push(value);
        mutate(customer?'고객정보를 수정했습니다.':'고객을 등록했습니다.');
        return true;
      });
    if (customer) $('#deleteCustomer',modal).onclick = () => {
      if (confirm(`${customer.name} 고객을 삭제할까요?`)) {
        snapshot.data.customers = snapshot.data.customers.filter(c => c !== customer);
        modal.close(); mutate('고객을 삭제했습니다.');
      }
    };
  }

  function renderQuotes() {
    content.innerHTML = pageTop('견적번호·고객명·품목 검색','새 견적 작성') + `<div id="quoteResults"></div>`;
    $('#pageAdd').onclick = () => openQuoteModal();
    $('#pageSearch').oninput = renderQuoteRows;
    renderQuoteRows();
  }
  function renderQuoteRows() {
    const q = ($('#pageSearch')?.value || '').trim().toLowerCase();
    const rows = snapshot.data.quotes.filter(x => !q || [x.id,x.customer,(x.items||[]).map(i=>i.name).join(' ')].join(' ').toLowerCase().includes(q));
    const wrap = $('#quoteResults');
    wrap.innerHTML = rows.length ? `
      <div class="table-wrap"><table class="data-table"><thead><tr><th>견적번호</th><th>고객</th><th>품목</th><th>금액</th><th>상태</th><th></th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td><b>${esc(x.id)}</b><br><small>${esc(x.createdAt||'')}</small></td><td>${esc(x.customer)}</td><td>${esc(x.items?.[0]?.name||'-')}</td><td class="amount">${won(quoteTotal(x))}</td><td><span class="status ${String(x.status).includes('발송')?'good':'warn'}">${esc(x.status||'작성중')}</span></td><td class="actions"><button class="pill-button" data-edit-quote="${i}">수정</button><button class="pill-button" data-print-quote="${i}">출력</button><button class="pill-button" data-contract-quote="${i}">계약</button></td></tr>`).join('')}</tbody></table></div>
      <div class="cards-mobile">${rows.map((x,i)=>`<div class="card-row"><div class="head"><div><b>${esc(x.id)}</b><div>${esc(x.customer)}</div></div><span class="status ${String(x.status).includes('발송')?'good':'warn'}">${esc(x.status||'작성중')}</span></div><div class="meta"><span>${esc(x.items?.[0]?.name||'-')}</span><strong class="amount">${won(quoteTotal(x))}</strong></div><div class="card-actions"><button class="ghost" data-edit-quote="${i}">수정</button><button class="ghost" data-print-quote="${i}">출력</button><button class="primary" data-contract-quote="${i}">계약</button></div></div>`).join('')}</div>` : `<div class="empty">작성된 견적서가 없습니다.</div>`;
    $$('[data-edit-quote]').forEach(b => b.onclick = () => openQuoteModal(rows[+b.dataset.editQuote]));
    $$('[data-print-quote]').forEach(b => b.onclick = () => printQuote(rows[+b.dataset.printQuote]));
    $$('[data-contract-quote]').forEach(b => b.onclick = () => convertQuote(rows[+b.dataset.contractQuote]));
  }

  function openQuoteModal(quote = null, presetCustomer = null) {
    const editing = quote ? snapshot.data.quotes.indexOf(quote) : -1;
    const customers = snapshot.data.customers;
    let draft = quote ? JSON.parse(JSON.stringify(quote)) : {
      id: nextId('Q',snapshot.data.quotes), customer:presetCustomer?.name||'', phone:presetCustomer?.phone||'', address:presetCustomer?.address||'', customerAddressDetail:presetCustomer?.addressDetail||'', siteAddress:presetCustomer?.address||'', siteAddressDetail:presetCustomer?.addressDetail||'', items:[{name:'',spec:'',qty:1,unitPrice:0}], vatEnabled:true, discountAmount:0, validityDays:15, note:'', status:'작성중', createdAt:today(), template:'CLASSIC'
    };
    const customerOptions = `<option value="">직접 입력</option>` + customers.map((c,i)=>`<option value="${i}" ${c.name===draft.customer?'selected':''}>${esc(c.name)} · ${esc(phone(c.phone))}</option>`).join('');
    openModal(quote?'견적서 수정':'새 견적서 작성',`${draft.id} · A4 견적서 출력 지원`, `
      <div class="form-grid">
        <div class="field"><label>등록 고객<select id="qCustomerSelect">${customerOptions}</select></label></div>
        <div class="field"><label>고객명<input id="qCustomer" value="${esc(draft.customer)}"></label></div>
        <div class="field"><label>휴대폰<input id="qPhone" value="${esc(draft.phone)}"></label></div>
        <div class="field"><label>작성일<input id="qDate" type="date" value="${esc(draft.createdAt||today())}"></label></div>
        <div class="field full"><label>현장주소<input id="qSite" value="${esc(draft.siteAddress||'')}"></label></div>
        <div class="field full"><label>상세주소<input id="qSiteDetail" value="${esc(draft.siteAddressDetail||'')}"></label></div>
        <div class="section-title">품목</div>
        <div class="item-editor"><div class="item-head"><span>품목명</span><span>규격</span><span>수량</span><span>단가</span><span></span></div><div id="quoteItems"></div><div style="padding:9px"><button type="button" id="addQuoteItem" class="secondary">+ 품목 추가</button></div></div>
        <div class="field"><label>할인금액<input id="qDiscount" inputmode="numeric" value="${num(draft.discountAmount)}"></label></div>
        <div class="field"><label>유효기간(일)<input id="qValidity" type="number" min="1" value="${num(draft.validityDays)||15}"></label></div>
        <div class="field"><label>상태<select id="qStatus"><option>작성중</option><option>발송</option><option>발송완료</option><option>계약완료</option></select></label></div>
        <div class="field"><label>부가세<div class="switch-row"><input id="qVat" type="checkbox" ${draft.vatEnabled===false?'':'checked'}><span>부가세 포함 계산</span></div></label></div>
        <div class="field full"><label>비고<textarea id="qNote">${esc(draft.note||'')}</textarea></label></div>
        <div id="quoteTotals" class="totals"></div>
        ${quote?'<div class="field full danger-zone"><button type="button" id="deleteQuote" class="danger">견적서 삭제</button></div>':''}
      </div>`, () => {
        syncQuoteDraft();
        if (!draft.customer.trim()) return showToast('고객명을 입력해 주세요.'), false;
        if (!draft.items.length || draft.items.some(i => !String(i.name||'').trim())) return showToast('품목명을 입력해 주세요.'), false;
        if (editing >= 0) snapshot.data.quotes[editing] = draft; else snapshot.data.quotes.push(draft);
        mutate(quote?'견적서를 수정했습니다.':'견적서를 저장했습니다.');
        return true;
      }, '견적서 저장');
    $('#qStatus',modal).value = draft.status || '작성중';
    const itemHost = $('#quoteItems',modal);
    function renderItems() {
      itemHost.innerHTML = draft.items.map((i,index)=>`<div class="item-row" data-item="${index}"><input data-k="name" value="${esc(i.name||'')}" placeholder="품목명"><input data-k="spec" value="${esc(i.spec||'')}" placeholder="규격"><input data-k="qty" inputmode="numeric" value="${num(i.qty)||1}" placeholder="수량"><input data-k="unitPrice" inputmode="numeric" value="${num(i.unitPrice)}" placeholder="단가"><button type="button" class="item-remove" data-remove="${index}">×</button></div>`).join('');
      $$('[data-remove]',modal).forEach(b => b.onclick = () => { if (draft.items.length>1) { draft.items.splice(+b.dataset.remove,1); renderItems(); calc(); } });
      $$('.item-row input',modal).forEach(inp => inp.oninput = calc);
      calc();
    }
    function syncQuoteDraft() {
      draft.customer = $('#qCustomer',modal).value.trim();
      draft.phone = phone($('#qPhone',modal).value);
      draft.createdAt = $('#qDate',modal).value || today();
      draft.siteAddress = $('#qSite',modal).value.trim();
      draft.siteAddressDetail = $('#qSiteDetail',modal).value.trim();
      draft.discountAmount = num($('#qDiscount',modal).value);
      draft.validityDays = Math.max(1,num($('#qValidity',modal).value)||15);
      draft.status = $('#qStatus',modal).value;
      draft.vatEnabled = $('#qVat',modal).checked;
      draft.note = $('#qNote',modal).value;
      draft.items = $$('.item-row',modal).map(row => ({
        name:$('[data-k="name"]',row).value.trim(), spec:$('[data-k="spec"]',row).value.trim(), qty:Math.max(1,num($('[data-k="qty"]',row).value)||1), unitPrice:num($('[data-k="unitPrice"]',row).value)
      }));
    }
    function calc() {
      syncQuoteDraft();
      $('#quoteTotals',modal).innerHTML = `<div><span>공급가액</span><b>${won(quoteSupply(draft))}</b></div><div><span>할인</span><b>-${won(draft.discountAmount)}</b></div><div><span>부가세</span><b>${won(quoteVat(draft))}</b></div><div class="grand"><span>합계</span><span>${won(quoteTotal(draft))}</span></div>`;
    }
    $('#addQuoteItem',modal).onclick = () => { syncQuoteDraft(); draft.items.push({name:'',spec:'',qty:1,unitPrice:0}); renderItems(); };
    $('#qCustomerSelect',modal).onchange = e => {
      const c = customers[Number(e.target.value)];
      if (!c) return;
      $('#qCustomer',modal).value=c.name; $('#qPhone',modal).value=c.phone; $('#qSite',modal).value=c.address; $('#qSiteDetail',modal).value=c.addressDetail||''; calc();
    };
    ['qDiscount','qValidity','qVat'].forEach(id => $(`#${id}`,modal).oninput = calc);
    if (quote) $('#deleteQuote',modal).onclick = () => { if(confirm(`${quote.id} 견적서를 삭제할까요?`)){ snapshot.data.quotes = snapshot.data.quotes.filter(x=>x!==quote); modal.close(); mutate('견적서를 삭제했습니다.'); } };
    renderItems();
  }

  function printQuote(q) {
    const p = snapshot.profile || {};
    printArea.innerHTML = `<div class="print-sheet"><div class="print-head"><div><h1>견적서</h1><div>${esc(p.businessName||'ONEBIZ')}</div></div><div class="print-meta">견적번호 ${esc(q.id)}<br>작성일 ${esc(q.createdAt||'')}</div></div><div class="print-party"><div class="print-box"><b>공급자</b><br>${esc(p.businessName||'-')}<br>대표 ${esc(p.representative||'-')}<br>${esc(p.phone||'')}</div><div class="print-box"><b>고객</b><br>${esc(q.customer)}<br>${esc(phone(q.phone))}<br>${esc(fullAddr(q.siteAddress,q.siteAddressDetail)||'-')}</div></div><table class="print-table"><thead><tr><th>품목명</th><th>규격</th><th>수량</th><th>단가</th><th>금액</th></tr></thead><tbody>${(q.items||[]).map(i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.spec||'')}</td><td>${num(i.qty)}</td><td>${won(i.unitPrice)}</td><td>${won(num(i.qty)*num(i.unitPrice))}</td></tr>`).join('')}</tbody></table><div class="print-total">합계 ${won(quoteTotal(q))}</div><div class="print-note">${esc(q.note||'')}\n견적 유효기간: ${num(q.validityDays)||15}일${q.vatEnabled===false?' · 부가세 별도':''}</div><div class="print-footer">${esc(p.businessName||'ONEBIZ')}</div></div>`;
    window.print();
  }

  function convertQuote(q) {
    let c = snapshot.data.contracts.find(x => x.quoteId === q.id && !x.signed);
    if (!c) {
      c = { id:nextId('C',snapshot.data.contracts), quoteId:q.id, customer:q.customer, item:q.items?.[0]?.name||'견적 계약', amount:quoteTotal(q), signed:false, paidAmount:0, phone:q.phone||'', address:fullAddr(q.address,q.customerAddressDetail), siteAddress:q.siteAddress||'', siteAddressDetail:q.siteAddressDetail||'', contractDate:today(), workDate:'', depositAmount:0, depositDueDate:'', middleAmount:0, middleDueDate:'', balanceAmount:quoteTotal(q), balanceDueDate:'', standardTerms:defaultTerms(), specialTerms:'', paymentHidden:false, debtStatus:'미수' };
      snapshot.data.contracts.push(c);
    }
    openContractModal(c, true);
  }
  function defaultTerms() { return '제1조 [계약 목적] 본 계약은 계약서 및 견적서에 기재된 공사·용역을 약정된 조건에 따라 수행하는 것을 목적으로 합니다.\n제2조 [공사 범위] 작업 범위와 품목·수량·금액은 연결된 견적서를 기준으로 합니다.\n제3조 [계약금액 및 지급] 계약금·중도금·잔금은 계약서 기재내용에 따릅니다.\n제4조 [시공 일정] 현장 여건 등에 따라 상호 협의하여 변경할 수 있습니다.\n제5조 [추가·변경공사] 추가 작업은 사전 협의합니다.\n제6조 [분쟁 처리] 관계 법령 및 관할 법원의 절차에 따릅니다.'; }

  function renderContracts() {
    content.innerHTML = pageTop('계약번호·고객명·품목 검색','계약서 직접 작성') + `<div id="contractResults"></div>`;
    $('#pageAdd').onclick = () => openContractModal(null);
    $('#pageSearch').oninput = renderContractRows;
    renderContractRows();
  }
  function renderContractRows() {
    const q = ($('#pageSearch')?.value || '').trim().toLowerCase();
    const rows = snapshot.data.contracts.filter(x => !q || [x.id,x.customer,x.item].join(' ').toLowerCase().includes(q));
    const wrap = $('#contractResults');
    wrap.innerHTML = rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>계약번호</th><th>고객</th><th>계약내용</th><th>계약금액</th><th>서명</th><th>미수금</th><th></th></tr></thead><tbody>${rows.map((c,i)=>`<tr><td><b>${esc(c.id)}</b><br><small>${esc(c.contractDate||'')}</small></td><td>${esc(c.customer)}</td><td>${esc(c.item||'-')}</td><td class="amount">${won(c.amount)}</td><td><span class="status ${c.signed?'good':'warn'}">${c.signed?'체결완료':'서명대기'}</span></td><td class="amount">${won(receivable(c))}</td><td class="actions"><button class="pill-button" data-edit-contract="${i}">수정</button></td></tr>`).join('')}</tbody></table></div><div class="cards-mobile">${rows.map((c,i)=>`<div class="card-row"><div class="head"><div><b>${esc(c.id)}</b><div>${esc(c.customer)}</div></div><span class="status ${c.signed?'good':'warn'}">${c.signed?'체결완료':'서명대기'}</span></div><div class="meta"><span>${esc(c.item||'-')}</span><strong>${won(c.amount)}</strong><span>미수 ${won(receivable(c))}</span></div><div class="card-actions"><button class="primary" data-edit-contract="${i}">계약서 열기</button></div></div>`).join('')}</div>` : `<div class="empty">작성된 계약서가 없습니다.</div>`;
    $$('[data-edit-contract]').forEach(b => b.onclick = () => openContractModal(rows[+b.dataset.editContract]));
  }

  function openContractModal(contract = null, newlyConverted = false) {
    const editing = contract ? snapshot.data.contracts.indexOf(contract) : -1;
    const c = contract ? JSON.parse(JSON.stringify(contract)) : { id:nextId('C',snapshot.data.contracts), quoteId:'', customer:'', item:'', amount:0,signed:false,paidAmount:0,phone:'',address:'',siteAddress:'',siteAddressDetail:'',contractDate:today(),workDate:'',depositAmount:0,depositDueDate:'',middleAmount:0,middleDueDate:'',balanceAmount:0,balanceDueDate:'',standardTerms:defaultTerms(),specialTerms:'',paymentHidden:false,debtStatus:'미수' };
    openModal(newlyConverted?'견적 → 계약 전환':(contract?'계약서 수정':'계약서 작성'), `${c.id} · 전자서명 발송은 Android 앱에서도 이어서 사용할 수 있습니다.`, `<div class="form-grid">
      <div class="field"><label>고객명<input id="cCustomer" value="${esc(c.customer)}"></label></div><div class="field"><label>휴대폰<input id="cPhone" value="${esc(c.phone||'')}"></label></div>
      <div class="field full"><label>계약내용<input id="cItem" value="${esc(c.item||'')}"></label></div>
      <div class="field"><label>계약금액<input id="cAmount" inputmode="numeric" value="${num(c.amount)}"></label></div><div class="field"><label>계약일<input id="cDate" type="date" value="${esc(c.contractDate||today())}"></label></div>
      <div class="field"><label>시공예정일<input id="cWorkDate" type="date" value="${esc(c.workDate||'')}"></label></div><div class="field"><label>서명상태<select id="cSigned"><option value="false">서명대기</option><option value="true">체결완료</option></select></label></div>
      <div class="section-title">대금 일정</div>
      <div class="field"><label>계약금<input id="cDeposit" inputmode="numeric" value="${num(c.depositAmount)}"></label></div><div class="field"><label>계약금 예정일<input id="cDepositDate" type="date" value="${esc(c.depositDueDate||'')}"></label></div>
      <div class="field"><label>중도금<input id="cMiddle" inputmode="numeric" value="${num(c.middleAmount)}"></label></div><div class="field"><label>중도금 예정일<input id="cMiddleDate" type="date" value="${esc(c.middleDueDate||'')}"></label></div>
      <div class="field"><label>잔금<input id="cBalance" inputmode="numeric" value="${num(c.balanceAmount || c.amount)}"></label></div><div class="field"><label>잔금 예정일<input id="cBalanceDate" type="date" value="${esc(c.balanceDueDate||'')}"></label></div>
      <div class="section-title">계약 조건</div><div class="field full"><label>표준 계약조건<textarea id="cTerms">${esc(c.standardTerms||defaultTerms())}</textarea></label></div><div class="field full"><label>특약사항<textarea id="cSpecial">${esc(c.specialTerms||'')}</textarea></label></div>
      ${contract?'<div class="field full danger-zone"><button type="button" id="deleteContract" class="danger">계약서 삭제</button></div>':''}
    </div>`, () => {
      c.customer=$('#cCustomer',modal).value.trim(); c.phone=phone($('#cPhone',modal).value); c.item=$('#cItem',modal).value.trim(); c.amount=num($('#cAmount',modal).value); c.contractDate=$('#cDate',modal).value||today(); c.workDate=$('#cWorkDate',modal).value; c.signed=$('#cSigned',modal).value==='true'; c.depositAmount=num($('#cDeposit',modal).value); c.depositDueDate=$('#cDepositDate',modal).value; c.middleAmount=num($('#cMiddle',modal).value); c.middleDueDate=$('#cMiddleDate',modal).value; c.balanceAmount=num($('#cBalance',modal).value); c.balanceDueDate=$('#cBalanceDate',modal).value; c.standardTerms=$('#cTerms',modal).value; c.specialTerms=$('#cSpecial',modal).value; c.debtStatus=receivable(c)>0?'미수':'완납';
      if(!c.customer||!c.item||c.amount<=0) return showToast('고객명·계약내용·계약금액을 확인해 주세요.'),false;
      if(editing>=0) snapshot.data.contracts[editing]=c; else snapshot.data.contracts.push(c);
      mutate('계약서를 저장했습니다.'); return true;
    }, '계약서 저장');
    $('#cSigned',modal).value = String(!!c.signed);
    $('#cAmount',modal).oninput = () => { const amount=num($('#cAmount',modal).value); const dep=num($('#cDeposit',modal).value); const mid=num($('#cMiddle',modal).value); $('#cBalance',modal).value=Math.max(0,amount-dep-mid); };
    $('#cDeposit',modal).oninput = $('#cMiddle',modal).oninput = $('#cAmount',modal).oninput;
    if(contract) $('#deleteContract',modal).onclick=()=>{ if(confirm(`${contract.id} 계약서를 삭제할까요?`)){snapshot.data.contracts=snapshot.data.contracts.filter(x=>x!==contract);modal.close();mutate('계약서를 삭제했습니다.');}};
  }

  function renderPayments() {
    const contracts = snapshot.data.contracts.filter(c => !c.paymentHidden);
    const total = contracts.reduce((s,c)=>s+receivable(c),0);
    content.innerHTML = `<div class="metrics"><div class="metric primary-metric"><span class="label">총 미수금</span><span class="value">${won(total)}</span><span class="sub">전체 계약 기준</span></div><div class="metric"><span class="label">미수 계약</span><span class="value">${contracts.filter(c=>receivable(c)>0).length}건</span><span class="sub">입금 확인 필요</span></div><div class="metric"><span class="label">완납</span><span class="value">${contracts.filter(c=>receivable(c)===0).length}건</span><span class="sub">대금 완료</span></div><div class="metric"><span class="label">계약 총액</span><span class="value">${won(contracts.reduce((s,c)=>s+num(c.amount),0))}</span><span class="sub">누적 계약금액</span></div></div><div style="height:16px"></div><div id="paymentResults"></div>`;
    const wrap=$('#paymentResults');
    wrap.innerHTML=contracts.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>계약번호</th><th>고객</th><th>계약금액</th><th>입금액</th><th>미수금</th><th>상태</th><th></th></tr></thead><tbody>${contracts.map((c,i)=>`<tr><td><b>${esc(c.id)}</b></td><td>${esc(c.customer)}</td><td>${won(c.amount)}</td><td>${won(c.paidAmount)}</td><td class="amount">${won(receivable(c))}</td><td><span class="status ${receivable(c)===0?'good':'bad'}">${receivable(c)===0?'완납':'미수'}</span></td><td class="actions"><button class="pill-button" data-pay="${i}">입금</button></td></tr>`).join('')}</tbody></table></div><div class="cards-mobile">${contracts.map((c,i)=>`<div class="card-row"><div class="head"><b>${esc(c.customer)}</b><span class="status ${receivable(c)===0?'good':'bad'}">${receivable(c)===0?'완납':'미수'}</span></div><div class="meta"><span>${esc(c.id)}</span><span>계약 ${won(c.amount)} · 입금 ${won(c.paidAmount)}</span><strong>미수 ${won(receivable(c))}</strong></div><div class="card-actions"><button class="primary" data-pay="${i}">입금 등록</button></div></div>`).join('')}</div>`:`<div class="empty">대금 관리할 계약이 없습니다.</div>`;
    $$('[data-pay]').forEach(b=>b.onclick=()=>openPaymentModal(contracts[+b.dataset.pay]));
  }
  function openPaymentModal(c){openModal('입금 등록',`${c.id} · ${c.customer}`,`<div class="form-grid"><div class="field full"><label>현재 미수금<input value="${won(receivable(c))}" disabled></label></div><div class="field full"><label>이번 입금액<input id="payAmount" inputmode="numeric" value="${receivable(c)}"></label></div></div>`,()=>{const amount=Math.max(0,num($('#payAmount',modal).value));if(amount<=0)return showToast('입금액을 입력해 주세요.'),false;c.paidAmount=Math.min(num(c.amount),num(c.paidAmount)+amount);c.debtStatus=receivable(c)>0?'미수':'완납';mutate('입금액을 반영했습니다.');return true;},'입금 반영');}

  function renderEmployees() {
    const rows=snapshot.employees;
    content.innerHTML=pageTop('직원명·연락처·직책 검색','직원 추가')+`<div id="employeeResults"></div>`;
    $('#pageAdd').onclick=()=>openEmployeeModal(); $('#pageSearch').oninput=renderEmployeeRows; renderEmployeeRows();
  }
  function renderEmployeeRows(){const q=($('#pageSearch')?.value||'').trim().toLowerCase();const rows=snapshot.employees.filter(e=>!q||[e.name,e.phone,e.position].join(' ').toLowerCase().includes(q));const wrap=$('#employeeResults');wrap.innerHTML=rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>직원</th><th>연락처</th><th>직책</th><th>입사일</th><th>급여</th><th>계약</th><th></th></tr></thead><tbody>${rows.map((e,i)=>`<tr><td><b>${esc(e.name)}</b></td><td>${esc(phone(e.phone))}</td><td>${esc(e.position||'-')}</td><td>${esc(e.joinDate||'-')}</td><td class="amount">${won(num(e.baseSalary)+num(e.allowance)+num(e.mealAllowance)+num(e.bonus)-num(e.deductions))}</td><td><span class="status ${e.contractSigned?'good':'warn'}">${e.contractSigned?'체결':'미작성'}</span></td><td class="actions"><button class="pill-button" data-edit-employee="${i}">수정</button></td></tr>`).join('')}</tbody></table></div><div class="cards-mobile">${rows.map((e,i)=>`<div class="card-row"><div class="head"><b>${esc(e.name)}</b><span class="status ${e.contractSigned?'good':'warn'}">${e.contractSigned?'계약체결':'계약미작성'}</span></div><div class="meta"><span>${esc(e.position||'-')} · ${esc(phone(e.phone))}</span><span>입사 ${esc(e.joinDate||'-')}</span><strong>실지급 ${won(num(e.baseSalary)+num(e.allowance)+num(e.mealAllowance)+num(e.bonus)-num(e.deductions))}</strong></div><div class="card-actions"><button class="primary" data-edit-employee="${i}">직원정보</button></div></div>`).join('')}</div>`:`<div class="empty">등록된 직원이 없습니다.</div>`;$$('[data-edit-employee]').forEach(b=>b.onclick=()=>openEmployeeModal(rows[+b.dataset.editEmployee]));}
  function openEmployeeModal(employee=null){const editing=employee?snapshot.employees.indexOf(employee):-1;const e=employee?JSON.parse(JSON.stringify(employee)):{id:crypto.randomUUID?crypto.randomUUID():`E-${Date.now()}`,name:'',phone:'',position:'',joinDate:today(),status:'근무중',address:'',addressDetail:'',memo:'',contractStart:'',contractEnd:'',workplace:'',duty:'',workHours:'09:00~18:00',breakTime:'12:00~13:00',baseSalary:0,allowance:0,mealAllowance:0,bonus:0,deductions:0,payday:25,employmentTerms:'',contractSigned:false,lastPayrollMonth:'',payrollPaid:false};openModal(employee?'직원정보 수정':'직원 추가','근로계약·급여 기본정보',`<div class="form-grid"><div class="field"><label>이름<input id="eName" value="${esc(e.name)}"></label></div><div class="field"><label>휴대폰<input id="ePhone" value="${esc(e.phone)}"></label></div><div class="field"><label>직책<input id="ePosition" value="${esc(e.position||'')}"></label></div><div class="field"><label>입사일<input id="eJoin" type="date" value="${esc(e.joinDate||today())}"></label></div><div class="field full"><label>주소<input id="eAddress" value="${esc(e.address||'')}"></label></div><div class="field full"><label>상세주소<input id="eDetail" value="${esc(e.addressDetail||'')}"></label></div><div class="section-title">급여</div><div class="field"><label>기본급<input id="eBase" inputmode="numeric" value="${num(e.baseSalary)}"></label></div><div class="field"><label>기타수당<input id="eAllowance" inputmode="numeric" value="${num(e.allowance)}"></label></div><div class="field"><label>식대<input id="eMeal" inputmode="numeric" value="${num(e.mealAllowance)}"></label></div><div class="field"><label>상여금<input id="eBonus" inputmode="numeric" value="${num(e.bonus)}"></label></div><div class="field"><label>공제금<input id="eDeduct" inputmode="numeric" value="${num(e.deductions)}"></label></div><div class="field"><label>급여일<input id="ePayday" type="number" min="1" max="31" value="${num(e.payday)||25}"></label></div><div class="field full"><label>근로계약 상태<select id="eSigned"><option value="false">미작성</option><option value="true">체결완료</option></select></label></div>${employee?'<div class="field full danger-zone"><button type="button" id="deleteEmployee" class="danger">직원 삭제</button></div>':''}</div>`,()=>{e.name=$('#eName',modal).value.trim();e.phone=phone($('#ePhone',modal).value);e.position=$('#ePosition',modal).value.trim();e.joinDate=$('#eJoin',modal).value;e.address=$('#eAddress',modal).value.trim();e.addressDetail=$('#eDetail',modal).value.trim();e.baseSalary=num($('#eBase',modal).value);e.allowance=num($('#eAllowance',modal).value);e.mealAllowance=num($('#eMeal',modal).value);e.bonus=num($('#eBonus',modal).value);e.deductions=num($('#eDeduct',modal).value);e.payday=Math.min(31,Math.max(1,num($('#ePayday',modal).value)||25));e.contractSigned=$('#eSigned',modal).value==='true';if(!e.name)return showToast('직원 이름을 입력해 주세요.'),false;if(editing>=0)snapshot.employees[editing]=e;else snapshot.employees.push(e);mutate('직원 정보를 저장했습니다.');return true;},'직원 저장');$('#eSigned',modal).value=String(!!e.contractSigned);if(employee)$('#deleteEmployee',modal).onclick=()=>{if(confirm(`${employee.name} 직원을 삭제할까요?`)){snapshot.employees=snapshot.employees.filter(x=>x!==employee);modal.close();mutate('직원을 삭제했습니다.');}};}

  function renderSettings(){const p=snapshot.profile||{};content.innerHTML=`<div class="settings-grid"><div class="panel"><div class="panel-header"><div><h3>내 사업자 정보</h3><p>견적서·계약서 공급자 정보에 사용됩니다.</p></div><button class="secondary" id="editProfile">수정</button></div><div class="summary-list"><div class="summary-row"><div class="grow"><small>상호</small><b>${esc(p.businessName||'미등록')}</b></div></div><div class="summary-row"><div class="grow"><small>대표자</small><b>${esc(p.representative||'-')}</b></div></div><div class="summary-row"><div class="grow"><small>사업자번호</small><b>${esc(p.registrationNo||'-')}</b></div></div><div class="summary-row"><div class="grow"><small>주소</small><b>${esc(fullAddr(p.address,p.addressDetail)||'-')}</b></div></div><div class="summary-row"><div class="grow"><small>연락처</small><b>${esc(phone(p.phone)||'-')}</b></div></div></div></div><div class="panel"><div class="panel-header"><div><h3>PC · 모바일 웹 연결</h3><p>Android 앱과 같은 회원 공간을 사용합니다.</p></div></div><div class="notice">웹에서 수정한 내용은 서버에 즉시 저장됩니다. Android 앱에서는 더보기 → PC 웹 연동 → “PC에서 가져오기”를 누르면 반영됩니다.</div><div style="height:12px"></div><small>회원 ID</small><div class="code-box">${esc(memberId)}</div><div style="height:12px"></div><small>마지막 서버 저장</small><div class="code-box">${snapshot.updatedAt?new Date(snapshot.updatedAt).toLocaleString('ko-KR'):'-'}</div><div style="height:12px"></div><button class="secondary" id="manualRefresh">서버 데이터 다시 불러오기</button></div></div><div style="height:16px"></div><div class="panel"><div class="panel-header"><div><h3>데이터 현황</h3><p>현재 웹에 동기화된 데이터</p></div></div><div class="metrics"><div class="metric"><span class="label">고객</span><span class="value">${snapshot.data.customers.length}</span></div><div class="metric"><span class="label">견적</span><span class="value">${snapshot.data.quotes.length}</span></div><div class="metric"><span class="label">계약</span><span class="value">${snapshot.data.contracts.length}</span></div><div class="metric"><span class="label">직원</span><span class="value">${snapshot.employees.length}</span></div></div></div>`;$('#editProfile').onclick=()=>openProfileModal();$('#manualRefresh').onclick=()=>loadSnapshot().catch(e=>showToast(e.message));}
  function openProfileModal(){const p=snapshot.profile||{};openModal('사업자 정보','견적서·계약서에 표시될 기본정보입니다.',`<div class="form-grid"><div class="field"><label>상호<input id="pBusiness" value="${esc(p.businessName||'')}"></label></div><div class="field"><label>대표자<input id="pRep" value="${esc(p.representative||'')}"></label></div><div class="field"><label>사업자등록번호<input id="pReg" value="${esc(p.registrationNo||'')}"></label></div><div class="field"><label>전화번호<input id="pPhone" value="${esc(p.phone||'')}"></label></div><div class="field full"><label>주소<input id="pAddr" value="${esc(p.address||'')}"></label></div><div class="field full"><label>상세주소<input id="pDetail" value="${esc(p.addressDetail||'')}"></label></div><div class="field"><label>이메일<input id="pEmail" type="email" value="${esc(p.email||'')}"></label></div><div class="field"><label>은행<input id="pBank" value="${esc(p.bankName||'')}"></label></div><div class="field"><label>계좌번호<input id="pAccount" value="${esc(p.accountNumber||'')}"></label></div><div class="field"><label>예금주<input id="pHolder" value="${esc(p.accountHolder||'')}"></label></div></div>`,()=>{snapshot.profile={...p,businessName:$('#pBusiness',modal).value.trim(),representative:$('#pRep',modal).value.trim(),registrationNo:$('#pReg',modal).value.trim(),phone:phone($('#pPhone',modal).value),address:$('#pAddr',modal).value.trim(),addressDetail:$('#pDetail',modal).value.trim(),email:$('#pEmail',modal).value.trim(),bankName:$('#pBank',modal).value.trim(),accountNumber:$('#pAccount',modal).value.trim(),accountHolder:$('#pHolder',modal).value.trim(),profileType:p.profileType||'BUSINESS'};mutate('사업자 정보를 저장했습니다.');return true;},'저장');}

  function openModal(title, subtitle, body, onSave, saveLabel='저장') {
    $('#modalTitle').textContent=title; $('#modalSubtitle').textContent=subtitle||''; $('#modalBody').innerHTML=body; $('#modalFooter').innerHTML=`<button type="button" class="ghost" id="modalCancel">취소</button><button type="button" class="primary" id="modalSave">${saveLabel}</button>`;$('#modalCancel').onclick=()=>modal.close();$('#modalSave').onclick=()=>{const ok=onSave?.();if(ok!==false)modal.close();};if(!modal.open)modal.showModal();
  }

  function logout(message='') { token='';memberId='';snapshot=null;sessionStorage.removeItem('onebiz_token');sessionStorage.removeItem('onebiz_member_id');appShell.classList.add('hidden');loginView.classList.remove('hidden');if(message)$('#loginError').textContent=message; }

  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const id=$('#memberIdInput').value.trim(); const pin=$('#pinInput').value.trim(); $('#loginError').textContent=''; try{const body=await api('/api/v1/session',{method:'POST',body:JSON.stringify({memberId:id,pin})});token=body.token;memberId=body.memberId;sessionStorage.setItem('onebiz_token',token);sessionStorage.setItem('onebiz_member_id',memberId);loginView.classList.add('hidden');appShell.classList.remove('hidden');$('#sidebarMemberId').textContent=memberId;await loadSnapshot();}catch(err){$('#loginError').textContent=err.message;} });
  $('#demoBtn').onclick=()=>{
    demoMode=true; token='demo'; memberId='U-DEMO-ONEBIZ';
    snapshot=normalizeSnapshot(JSON.parse(localStorage.getItem('onebiz_demo_snapshot')||'null')||{profile:{businessName:'하이원시스템',representative:'김진호',registrationNo:'',phone:'010-0000-0000',address:'경기도 수원시'},data:{customers:[{name:'김민수',phone:'010-1234-5678',address:'화성시 봉담읍',addressDetail:''},{name:'박지영',phone:'010-2222-8899',address:'수원시 권선구',addressDetail:''}],quotes:[{id:'Q-2026-001',customer:'김민수',phone:'010-1234-5678',siteAddress:'화성시 봉담읍',siteAddressDetail:'',items:[{name:'LG 시스템에어컨 설치',spec:'',qty:1,unitPrice:2227273}],vatEnabled:true,discountAmount:0,validityDays:15,note:'기본 설치 포함',status:'발송완료',createdAt:'2026-09-18'}],contracts:[{id:'C-2026-001',quoteId:'Q-2026-001',customer:'김민수',item:'LG 시스템에어컨 설치',amount:2450000,signed:true,paidAmount:1450000,contractDate:'2026-09-18'}]},employees:[]});
    loginView.classList.add('hidden');appShell.classList.remove('hidden');$('#sidebarMemberId').textContent=memberId;setSync('ok','미리보기');render();
  };
  $('#logoutBtn').onclick=()=>logout();
  $('#refreshBtn').onclick=()=>loadSnapshot().catch(e=>showToast(e.message));
  $('#profileBtn').onclick=()=>{route='settings';render();};

  async function boot(){if(!token){logout();return;}loginView.classList.add('hidden');appShell.classList.remove('hidden');$('#sidebarMemberId').textContent=memberId;try{await loadSnapshot();}catch(e){logout(e.message);}}
  if (new URLSearchParams(location.search).get('demo') === '1') $('#demoBtn').click(); else boot();
})();

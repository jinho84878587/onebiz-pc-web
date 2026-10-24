'use strict';
(() => {
  const parts=location.pathname.split('/').filter(Boolean);
  const kind=parts[0]==='s'?'sign':parts[0];
  window.OnebizDocumentAccess.mount({kind,token:parts[1]||''});
})();

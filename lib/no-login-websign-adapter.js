'use strict';
// Account-free WebSign adapter. Only use after actionGate has consumed a
// document-scoped sign.request grant. This module does not expose HTTP routes.
const FINGERPRINT=/^[a-f0-9]{64}$/;
function createGuestWebsignAdapter(store,registry,websign,{appKey}={}){
 if(!store?.db||!store?.one||!store?.run||!store?.seal||!store?.open||
    typeof registry?.ownerCheck!=='function'||typeof registry?.current!=='function'||
    typeof registry?.freezeByVerifiedProvider!=='function'||
    typeof websign?.createLink!=='function'||typeof websign?.verifyUrl!=='function'||
    typeof websign?.status!=='function'||typeof websign?.originalSignature!=='function')
  throw new TypeError('Trusted dependencies are required');
 store.db.exec("CREATE TABLE IF NOT EXISTS no_login_websign_links ("+
  "document_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, fingerprint TEXT NOT NULL,"+
  "sign_url TEXT NOT NULL, created_at INTEGER NOT NULL);"+
  "CREATE TABLE IF NOT EXISTS no_login_websign_originals ("+
  "document_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);");
 const getLink=(documentId)=>store.one('SELECT * FROM no_login_websign_links WHERE document_id=?',documentId);
 function ownerLink({documentId,ownerSecret}){
  if(!registry.ownerCheck(documentId,ownerSecret))return null;
  const entry=getLink(documentId),current=registry.current(documentId);
  if(!entry||!current||entry.fingerprint!==current.fingerprint)return null;
  return {providerId:entry.provider_id,signUrl:websign.verifyUrl(store.open(entry.sign_url))};
 }
 async function dispatch({documentId,scope,fingerprint,document}){
  if(scope!=='sign.request'||!FINGERPRINT.test(fingerprint||'')||!document||document.id!==documentId)
   return {state:'failed'};
  const current=registry.current(documentId);
  if(!current||current.frozen_at!=null||current.fingerprint!==fingerprint||!appKey)
   return {state:'failed'};
  const created=await websign.createLink(document,documentId,appKey);
  const url=websign.verifyUrl(created.signUrl);
  const latest=registry.current(documentId);
  if(!latest||latest.fingerprint!==fingerprint||latest.frozen_at!=null)return {state:'unknown'};
  store.run('INSERT OR REPLACE INTO no_login_websign_links '+
   '(document_id,provider_id,fingerprint,sign_url,created_at) VALUES(?,?,?,?,?)',
   documentId,created.providerId,fingerprint,store.seal(url),Date.now());
  return {state:'accepted'};
 }
 async function status({documentId,ownerSecret}){
  if(!registry.ownerCheck(documentId,ownerSecret))return {exists:false,signed:false};
  const current=registry.current(documentId),entry=getLink(documentId);
  if(!current||!entry||current.fingerprint!==entry.fingerprint)return {exists:false,signed:false};
  const archived=store.one('SELECT body FROM no_login_websign_originals WHERE document_id=?',documentId);
  if(archived){const snap=store.open(archived.body);return {exists:true,signed:true,signedAt:snap.signedAt,signatureName:snap.signatureName};}
  if(!appKey)throw new Error('전자서명 서버 연결키가 없습니다.');
  const result=await websign.status(entry.provider_id,appKey);
  if(!result.signed)return {exists:true,signed:false};
  const signUrl=websign.verifyUrl(store.open(entry.sign_url));
  const signatureDataUrl=await websign.originalSignature(signUrl);
  if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureDataUrl))throw new Error('서명 원본 형식이 올바르지 않습니다.');
  const latest=registry.current(documentId);
  if(!latest||latest.fingerprint!==entry.fingerprint)return {exists:false,signed:false};
  const source=store.one('SELECT fingerprint,body,expires_at FROM no_login_document_payloads WHERE document_id=?',documentId);
  if(!source||source.fingerprint!==entry.fingerprint||source.expires_at<=Date.now())
   throw new Error('서명된 계약서 원문을 확인할 수 없어 완료 처리를 보류했습니다.');
  const contract=store.open(source.body);
  if(contract.id!==documentId)throw new Error('계약서 원문 식별자가 다릅니다.');
  const snap={contract,signedAt:String(result.signedAt||''),signatureName:String(result.signatureName||''),
   identityStatus:String(result.identityStatus||''),signatureDataUrl};
  store.run('INSERT OR IGNORE INTO no_login_websign_originals(document_id,fingerprint,body,created_at) VALUES(?,?,?,?)',
   documentId,entry.fingerprint,store.seal(snap),Date.now());
  registry.freezeByVerifiedProvider({documentId,expectedFingerprint:entry.fingerprint});
  return {exists:true,signed:true,signedAt:snap.signedAt,signatureName:snap.signatureName};
 }
 function originalForOwner({documentId,ownerSecret}){
  if(!registry.ownerCheck(documentId,ownerSecret))return null;
  const current=registry.current(documentId),row=store.one('SELECT fingerprint,body FROM no_login_websign_originals WHERE document_id=?',documentId);
  return current&&row&&current.fingerprint===row.fingerprint?store.open(row.body):null;
 }
 return {dispatch,ownerLink,status,originalForOwner};
}
module.exports={createGuestWebsignAdapter};

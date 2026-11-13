'use strict';
// Staging-only encrypted payload store for account-free document actions.
// This module does not create login sessions, send messages or expose an HTTP API.
const crypto=require('node:crypto');
const MAX_DAYS=30, DAY=86400000;
const PHONE=/^01[016789]\d{7,8}$/;
const TEXT_LIMITS=Object.freeze({
  quoteId:100,customer:80,phone:20,address:300,siteAddress:300,
  siteAddressDetail:300,item:300,contractDate:24,workDate:24,
  depositDueDate:24,middleDueDate:24,balanceDueDate:24,
  standardTerms:12000,specialTerms:12000,contractType:100
});
const AMOUNT_FIELDS=['amount','depositAmount','middleAmount','balanceAmount'];
function normalizeContract(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('계약서 내용이 올바르지 않습니다.');
 const out={};
 for(const [key,max] of Object.entries(TEXT_LIMITS)){
  const val=input[key]==null?'':String(input[key]);
  if(val.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(val))throw new RangeError('계약서 입력 길이를 확인해 주세요: '+key);
  out[key]=val.trim();
 }
 const p=out.phone.replace(/\D/g,'');
 if(!out.customer||!PHONE.test(p))throw new TypeError('고객명과 연락처를 확인해 주세요.');
 out.phone=p;
 for(const key of AMOUNT_FIELDS){
  const n=Number(input[key]??0);
  if(!Number.isSafeInteger(n)||n<0||n>10_000_000_000)throw new RangeError('금액이 올바르지 않습니다: '+key);
  out[key]=n;
 }
 if(!out.item||out.amount===0)throw new TypeError('계약 품목과 금액이 필요합니다.');
 return out;
}
function fingerprint(contract){return crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');}
function createGuestDocumentVault(store,registry){
 if(!store?.db||!store?.tx||!store?.seal||!store?.open||!store?.run||!store?.one||
    typeof registry?.register!=='function'||typeof registry?.current!=='function'||typeof registry?.ownerCheck!=='function')
   throw new TypeError('암호화 저장소와 문서 권한 관리자가 필요합니다.');
 store.db.exec("CREATE TABLE IF NOT EXISTS no_login_document_payloads ("+
  "document_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, body TEXT NOT NULL,"+
  "expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);"+
  "CREATE INDEX IF NOT EXISTS no_login_document_payloads_expiry ON no_login_document_payloads(expires_at);");
 function save({ownerSecret,contract,consent=false,now=Date.now()}){
  if(consent!==true)throw new Error('고객정보 저장에 대한 확인이 필요합니다.');
  if(!Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-MAX_DAYS*DAY)throw new RangeError('시간 오류');
  const normalized=normalizeContract(contract),fp=fingerprint(normalized);
  const until=now+MAX_DAYS*DAY;
  return store.tx(()=>{
   const saved=registry.register({secret:ownerSecret,fingerprint:fp,now});
   const body=store.seal({...normalized,id:saved.documentId});
   store.run('INSERT INTO no_login_document_payloads(document_id,fingerprint,body,expires_at,created_at) VALUES(?,?,?,?,?)',
     saved.documentId,fp,body,until,now);
   return {documentId:saved.documentId,fingerprint:fp,expiresAt:until};
  });
 }
 function loadForAction(documentId,now=Date.now()){
  if(typeof documentId!=='string'||!Number.isSafeInteger(now)||now<0)return null;
  const registryRow=registry.current(documentId);
  if(!registryRow||registryRow.frozen_at!=null)return null;
  const row=store.one('SELECT fingerprint,body,expires_at FROM no_login_document_payloads WHERE document_id=?',documentId);
  if(!row||row.expires_at<=now||row.fingerprint!==registryRow.fingerprint)return null;
  const document=store.open(row.body);
  if(document.id!==documentId||fingerprint(normalizeContract(document))!==row.fingerprint)return null;
  return {fingerprint:row.fingerprint,document};
 }
 function retrieveForOwner({documentId,ownerSecret,now=Date.now()}){
  if(!registry.ownerCheck(documentId,ownerSecret))return null;
  return loadForAction(documentId,now);
 }
 return {save,loadForAction,retrieveForOwner};
}
module.exports={normalizeContract,fingerprint,createGuestDocumentVault};

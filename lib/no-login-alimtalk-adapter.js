'use strict';
// Bridge to existing approved SOLAPI template checks. The server must enforce
// financial/abuse limits before any real provider call.
const FP=/^[a-f0-9]{64}$/;
function createGuestAlimtalkAdapter(store,websign,{preview,send}={}){
 if(!store?.one||!store?.open||typeof websign?.verifyUrl!=='function'||
    typeof preview!=='function'||typeof send!=='function')throw new TypeError('Trusted provider adapters required');
 async function prepare({documentId,scope,document,fingerprint}){
  if(scope!=='alimtalk.send'||!FP.test(fingerprint||'')||document?.id!==documentId||
     !document.supplierName||!document.customer||!document.phone||!Number.isSafeInteger(document.amount)||document.amount<=0)return null;
  const row=store.one('SELECT sign_url,fingerprint FROM no_login_websign_links WHERE document_id=?',documentId);
  if(!row||row.fingerprint!==fingerprint)return null;
  // Existing alimtalkPreview validates approved template/channel and the short
  // URL length restriction. Never bypass the provider validation for guests.
  const signUrl=websign.verifyUrl(store.open(row.sign_url));
  const message=await preview({kind:'contractSign',to:document.phone,variables:{
   '고객명':document.customer,'업체명':document.supplierName,
   '계약금액':document.amount.toLocaleString('ko-KR'),'서명링크':signUrl
  }});
  if(message?.kind!=='contractSign'||message.to!==document.phone||!message.templateId||
     !message.options?.variables?.['#{서명링크}'])return null;
  return message;
 }
 async function dispatch(args){
  let message;
  try{message=await prepare(args);}catch{return {state:'failed'};}
  if(!message)return {state:'failed'};
  try{
   const result=await send(message);
   if(result?.ok===true)return {state:'accepted'};
   if(result?.status&&result.status>=400&&result.status<500)return {state:'failed'};
   return {state:'unknown'};
  }catch{return {state:'unknown'};}
 }
 return {prepare,dispatch};
}
module.exports={createGuestAlimtalkAdapter};

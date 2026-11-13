'use strict';
// Bridge to existing approved SOLAPI template checks. The server must enforce
// financial/abuse limits before any real provider call.
const FP=/^[a-f0-9]{64}$/;
function createGuestAlimtalkAdapter(store,websign,{preview,send,makeShortLink,publicOrigin}={}){
 if(!store?.one||!store?.open||typeof websign?.verifyUrl!=='function'||
    typeof preview!=='function'||typeof send!=='function'||typeof makeShortLink!=='function')throw new TypeError('Trusted provider adapters and short-link maker required');
 let approvedOrigin;try{approvedOrigin=new URL(publicOrigin);}catch{throw new TypeError('Approved public origin required');}
 if(approvedOrigin.protocol!=='https:'||approvedOrigin.username||approvedOrigin.password||approvedOrigin.pathname!=='/'||approvedOrigin.search||approvedOrigin.hash)throw new TypeError('Approved HTTPS origin required');
 async function prepare({documentId,scope,document,fingerprint}){
  if(scope!=='alimtalk.send'||!FP.test(fingerprint||'')||document?.id!==documentId||
     !document.supplierName||!document.customer||!document.phone||!Number.isSafeInteger(document.amount)||document.amount<=0)return null;
  const row=store.one('SELECT sign_url,fingerprint FROM no_login_websign_links WHERE document_id=?',documentId);
  if(!row||row.fingerprint!==fingerprint)return null;
  // Existing alimtalkPreview validates approved template/channel and the short
  // URL length restriction. Never bypass the provider validation for guests.
  websign.verifyUrl(store.open(row.sign_url));
  const shortLink=await makeShortLink({documentId,fingerprint});
  const urlValue=typeof shortLink==='string'?shortLink:shortLink?.url;
  let shortUrl;try{shortUrl=new URL(urlValue);}catch{return null;}
  if(shortUrl.protocol!=='https:'||shortUrl.origin!==approvedOrigin.origin||shortUrl.username||shortUrl.password||shortUrl.hash||shortUrl.search||
      !/^\/s\/[A-Za-z0-9_-]{43}$/.test(shortUrl.pathname)||Buffer.byteLength(shortUrl.href,'utf8')>100)return null;
  const message=await preview({kind:'contractSign',to:document.phone,variables:{
   '고객명':document.customer,'업체명':document.supplierName,
   '계약금액':document.amount.toLocaleString('ko-KR'),'서명링크':shortUrl.href
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

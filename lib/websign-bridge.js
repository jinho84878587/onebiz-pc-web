'use strict';
const crypto=require('node:crypto');
const BASE='https://hiwon-websign-server.onrender.com';
function providerId(userId,contractId,fingerprint=''){
 return 'ob-'+crypto.createHash('sha256').update(userId+':'+contractId+':'+fingerprint).digest('hex').slice(0,40);
}
function verifyUrl(value){
 const u=new URL(String(value||''));
 if(u.origin!==BASE||!u.pathname.startsWith('/')||u.username||u.password||u.hash)throw Error('전자서명 링크의 발신 서버를 확인할 수 없습니다.');
 return u.toString();
}
function payload(contract,actor){
 return {
 id:providerId(actor,contract.id),quoteId:String(contract.quoteId||''),customer:String(contract.customer||''),
 phone:String(contract.phone||''),address:String(contract.address||''),siteAddress:[contract.siteAddress,contract.siteAddressDetail].filter(Boolean).join(' '),
 item:String(contract.item||''),amount:Number(contract.amount)||0,
 contractDate:String(contract.contractDate||''),workDate:String(contract.workDate||''),
 depositAmount:Number(contract.depositAmount)||0,depositDueDate:String(contract.depositDueDate||''),
 middleAmount:Number(contract.middleAmount)||0,middleDueDate:String(contract.middleDueDate||''),
 balanceAmount:Number(contract.balanceAmount)||0,balanceDueDate:String(contract.balanceDueDate||''),
 standardTerms:String(contract.standardTerms||''),contractType:String(contract.contractType||''),
 specialTerms:String(contract.specialTerms||'')
 };
}
function fingerprint(contract,userId){return crypto.createHash('sha256').update(JSON.stringify(payload(contract,userId))).digest('hex');}
async function request(basePath,appKey,method,data){
 if(!appKey||!String(appKey).trim())throw Error('전자서명 서버 연결키가 원비즈 서버에 등록되지 않았습니다.');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),13000);
 try{
  const response=await fetch(BASE+basePath,{
   method,headers:{'X-App-Key':String(appKey).trim(),...(data?{'Content-Type':'application/json; charset=utf-8'}:{})},
   ...(data?{body:JSON.stringify(data)}:{}),
   signal:controller.signal
  });
  let value={};
  try{value=await response.json();}catch{}
  if(!response.ok){
    const error=new Error('전자서명 서버에서 요청을 처리하지 못했습니다. HTTP '+response.status);
    error.status=response.status;
    throw error;
  }
  return value;
 }finally{clearTimeout(timeout);}
}
async function createLink(contract,userId,key){
 const data=payload(contract,userId),digest=fingerprint(contract,userId);
 data.id=providerId(userId,contract.id,digest);
 const result=await request('/api/contracts',key,'POST',data);
 return {providerId:data.id,signUrl:verifyUrl(result.signUrl),fingerprint:digest};
}
async function status(providerId,key){
 if(!/^ob-[a-f0-9]{40}$/.test(String(providerId)))throw Error('전자서명 계약 식별자가 올바르지 않습니다.');
 const data=await request('/api/contracts/'+encodeURIComponent(providerId)+'/status',key,'GET');
 return {
  signed:data.status==='signed',
  ...(data.status==='signed'?{
   signatureName:String(data.signerName||'').slice(0,80),
   identityStatus:String(data.identityStatus||'본인확인 완료').slice(0,80),
   signedAt:String(data.signedAt||'').slice(0,40)
  }:{})
 };
}
module.exports={BASE,providerId,fingerprint,verifyUrl,payload,createLink,status};

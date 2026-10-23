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
 const timeout=setTimeout(()=>controller.abort(),45000);
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
async function originalSignature(signUrl){
 const url=new URL(verifyUrl(signUrl));
 if(!/^\/sign\/ob-[a-f0-9]{40}$/.test(url.pathname)||!url.searchParams.get('token'))throw Error('서명 원본 주소를 확인할 수 없습니다.');
 url.pathname=url.pathname.replace('/sign/','/receipt/');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(url,{signal:controller.signal,redirect:'error'});
  if(!response.ok){const error=new Error('서명된 원본을 보관할 수 없습니다. HTTP '+response.status);error.status=response.status;throw error;}
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>3*1024*1024)throw Error('서명 원본 크기를 확인해 주세요.');chunks.push(chunk);}
  const html=Buffer.concat(chunks).toString('utf8'),match=html.match(/<img\b[^>]*\bsrc=["'](data:image\/png;base64,[A-Za-z0-9+/=]+)["']/i);
  if(!match)throw Error('완료된 원본의 서명 이미지를 확인할 수 없습니다.');
  const png=Buffer.from(match[1].slice(22),'base64');
  if(png.length<8||png.length>2*1024*1024||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('원본 서명 이미지 형식이 올바르지 않습니다.');
  return match[1];
 }finally{clearTimeout(timer);}
}
module.exports={BASE,providerId,fingerprint,verifyUrl,payload,createLink,status,originalSignature};

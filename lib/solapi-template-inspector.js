'use strict';
// Read-only SOLAPI template verification. No message can be sent from this module.
const {HttpError}=require('./security');
const {isIP}=require('node:net');
let cache={at:0,list:[]};
let healthState={checkedAt:0,access:'unchecked',httpStatus:null,count:0};
function health(){return {...healthState};}

// Opt-in diagnosis for matching the running server to the correct SOLAPI key.
// Never log the full API Key, Secret, authorization header, or raw provider body.
let lastIpDiagnostic='';
function logIpDiagnostic(response,data){
 if(process.env.SOLAPI_IP_DIAGNOSTICS!=='true'||response.status!==403)return;
 const rawMessage=String(data?.errorMessage||data?.message||'');
 const match=rawMessage.match(/허용되지 않은\s*IP\s*\(([^)]+)\)/i);
 const deniedIp=match&&isIP(match[1].trim())?match[1].trim():null;
 if(!deniedIp)return;
 const key=String(process.env.SOLAPI_API_KEY||'').trim().replace(/^["']|["']$/g,'').trim();
 const apiKeySuffix=key.length>=8?key.slice(-4):null;
 const event={httpStatus:403,apiKeySuffix,deniedIp};
 const signature=JSON.stringify(event);
 if(signature===lastIpDiagnostic)return;
 lastIpDiagnostic=signature;
 console.warn('solapi_ip_access_diagnostic',signature);
}

// Retain the provider's reason, but never return credentials, account identifiers,
// personal information, or successful response bodies in diagnostic logs.
function safeReason(value){
 let result=typeof value==='string'?value:'';
 for(const key of ['SOLAPI_API_KEY','SOLAPI_API_SECRET']){
  const raw=String(process.env[key]||'');
  for(const secret of [raw,raw.trim(),raw.trim().replace(/^[\"']|[\"']$/g,'')]){
   if(secret.length>=4)result=result.split(secret).join('[redacted]');
  }
 }
 return result.replace(/[\r\n\t]+/g,' ')
  .replace(/https?:\/\/\S+/gi,'[url]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[ip]')
  .replace(/\b[A-Za-z0-9_-]{20,}\b/g,'[identifier]')
  .replace(/\d[\d .()-]{6,}\d/g,'[number]')
  .slice(0,450);
}
async function failureDetails(response){
 let data={};
 try{data=await response.json();}catch{}
 logIpDiagnostic(response,data);
 const code=String(data?.errorCode||data?.code||'unknown').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
 const message=safeReason(data?.errorMessage||data?.message||'');
 return {errorCode:code,...(message?{reason:message}:{})};
}
async function sendable(authHeader){
 if(cache.at && Date.now()-cache.at<300000)return cache.list;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch('https://api.solapi.com/kakao/v2/templates/sendable',{
   method:'GET',headers:{Authorization:authHeader(),Accept:'application/json'},signal:controller.signal
  });
  if(!response.ok){
   const details=await failureDetails(response);
   healthState={checkedAt:Date.now(),access:'blocked',httpStatus:response.status,count:0};
   throw new HttpError(502,'SOLAPI 승인 템플릿 조회 실패 (HTTP '+response.status+', code '+details.errorCode+')'+(details.reason?' · '+details.reason:''));
  }
  const data=await response.json();
  if(!Array.isArray(data))throw new HttpError(502,'SOLAPI 템플릿 조회 응답을 확인할 수 없습니다.');
  cache={at:Date.now(),list:data};healthState={checkedAt:Date.now(),access:'ok',httpStatus:200,count:data.length};return data;
 }catch(e){if(e instanceof HttpError)throw e;healthState={checkedAt:Date.now(),access:'network_error',httpStatus:0,count:0};throw new HttpError(502,'SOLAPI 승인 템플릿을 불러올 수 없습니다.');}
 finally{clearTimeout(timeout);}
}
function variables(record){
 const set=new Set();
 if(Array.isArray(record.variables))for(const x of record.variables)if(typeof x?.name==='string')set.add(x.name);
 function collect(value){
  if(typeof value==='string'){for(const m of value.matchAll(/#\{([^}]{1,80})\}/g))set.add(m[1]);return;}
  if(Array.isArray(value)){for(const v of value)collect(v);return;}
  if(value&&typeof value==='object')for(const [key,v] of Object.entries(value))if(!['accountId','templateId','channelId','comments','dateCreated','dateUpdated'].includes(key))collect(v);
 }
 collect({content:record.content,buttons:record.buttons,quickReplies:record.quickReplies,
  emphasizeTitle:record.emphasizeTitle,emphasizeSubtitle:record.emphasizeSubtitle,header:record.header,
  highlight:record.highlight,item:record.item});
 return [...set].sort((a,b)=>a.localeCompare(b,'ko')).slice(0,60);
}
function inspect(registry,sendableList,env){
 const found=new Map(sendableList.filter(x=>x&&typeof x.templateId==='string').map(x=>[x.templateId,x]));
 return registry.map(t=>{
  const templateId=env[t.envKey]||'',obj=found.get(templateId);
  const names=obj?variables(obj):[];
  const expected=t.fields?[...t.fields].sort((a,b)=>a.localeCompare(b,'ko')):null;
  const matches=!!(obj&&expected&&expected.length===names.length&&expected.every((x,i)=>x===names[i]));
  return {kind:t.kind,name:t.name,registered:!!templateId,reportedStatus:t.reviewStatus,
   providerSendable:!!obj,providerStatus:obj?.status||null,
   content:obj?String(obj.content||'').slice(0,3000):'',
   variables:names,expectedFields:expected,
   variableMatch:expected?(obj?(matches?'match':'mismatch'):'unavailable'):'not_mapped',
   buttons:obj&&Array.isArray(obj.buttons)?obj.buttons.map(b=>({
    name:String(b.buttonName||'').slice(0,100),type:String(b.buttonType||'').slice(0,20),
    linkMo:String(b.linkMo||'').slice(0,400),linkPc:String(b.linkPc||'').slice(0,400)
   })):[]};
 });
}
// GET requests only. Success bodies are discarded except documented status enums.
async function diagnose(authHeader){
 const checks=[
  ['messageList','/messages/v4/list?limit=1'],
  ['channelList','/kakao/v2/channels?limit=1'],
  ['templateList','/kakao/v2/templates?limit=1'],
  ['sendable','/kakao/v2/templates/sendable'],
  ['businessVerificationRequest','/iam/v1/verifications/accounts/business/request',true],
  ['businessVerification','/iam/v1/verifications/accounts/business',true],
  ['memberVerification','/iam/v1/verifications/members/person',true]
 ];
 const out=[];
 for(const [name,path,verification] of checks){
  // Stay below the documented unverified-account limit, including the initial check.
  await new Promise(resolve=>setTimeout(resolve,1300));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch('https://api.solapi.com'+path,{method:'GET',headers:{Authorization:authHeader(),Accept:'application/json'},signal:controller.signal});
   const item={name,status:response.status};
   if(!response.ok){Object.assign(item,await failureDetails(response));}
   else if(verification){
    const data=await response.json();
    const allowed=new Set(['PENDING','REVIEWING','APPROVED','REJECTED','EXPIRED','ACTIVE','INACTIVE','UNVERIFIED','NOT_VERIFIED','VERIFIED']);
    if(allowed.has(data?.status))item.verificationStatus=data.status;
    if(allowed.has(data?.verificationResult))item.verificationResult=data.verificationResult;
   }else await response.arrayBuffer();
   out.push(item);
  }catch{out.push({name,status:0,errorCode:'network_error'});}
  finally{clearTimeout(timer);}
 }
 return out;
}
module.exports={sendable,inspect,diagnose,health};

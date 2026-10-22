'use strict';
// Read-only SOLAPI template verification. No message can be sent from this module.
const {HttpError}=require('./security');
let cache={at:0,list:[]};
let healthState={checkedAt:0,access:'unchecked',httpStatus:null,count:0};
function health(){return {...healthState};}
async function sendable(authHeader){
 if(cache.at && Date.now()-cache.at<300000)return cache.list;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch('https://api.solapi.com/kakao/v2/templates/sendable',{
   method:'GET',headers:{Authorization:authHeader(),Accept:'application/json'},signal:controller.signal
  });
  if(!response.ok){
   let code='unknown';
   try{const err=await response.json();code=String(err.errorCode||err.code||err.message||err.errorMessage||'unknown').slice(0,100).replace(/[^a-zA-Z0-9가-힣 _():.-]/g,'');}catch{}
   healthState={checkedAt:Date.now(),access:'blocked',httpStatus:response.status,count:0};
   throw new HttpError(502,'SOLAPI 승인 템플릿 조회 실패 (HTTP '+response.status+', code '+code+')');
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
// Diagnostic checks only: discard all successful response bodies; do not expose account data.
async function diagnose(authHeader){
 const checks=[['messageList','/messages/v4/list?limit=1'],['channelList','/kakao/v2/channels?limit=1'],['templateList','/kakao/v2/templates?limit=1'],['sendable','/kakao/v2/templates/sendable']];
 const out=[];
 for(const [name,path] of checks){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch('https://api.solapi.com'+path,{method:'GET',headers:{Authorization:authHeader(),Accept:'application/json'},signal:controller.signal});
   let errorCode='';
   if(!response.ok){
    try{const b=await response.json();errorCode=String(b.errorCode||b.code||'unknown').replace(/[^A-Za-z0-9_-]/g,'').slice(0,60);}catch{errorCode='unknown';}
   }else await response.arrayBuffer();
   out.push({name,status:response.status,...(errorCode?{errorCode}:{})});
  }catch{out.push({name,status:0,errorCode:'network_error'});}
  finally{clearTimeout(timer);}
 }
 return out;
}
module.exports={sendable,inspect,diagnose,health};

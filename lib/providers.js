'use strict';
const crypto=require('node:crypto');const {check,sha}=require('./security');
const providers={
 kakao:{auth:'https://kauth.kakao.com/oauth/authorize',token:'https://kauth.kakao.com/oauth/token',info:'https://kapi.kakao.com/v2/user/me',scope:''},
 naver:{auth:'https://nid.naver.com/oauth2.0/authorize',token:'https://nid.naver.com/oauth2.0/token',info:'https://openapi.naver.com/v1/nid/me',scope:''},
 google:{auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',info:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid profile'}
};
async function getJson(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});check(r.ok,502,'외부 인증 서비스 요청에 실패했습니다. 다시 시도해 주세요.');return r.json();}
function configured(env,p){return !!(providers[p]&&env[p.toUpperCase()+'_CLIENT_ID']&&env[p.toUpperCase()+'_CLIENT_SECRET']);}
function authUrl(env,p,origin,state,verifier,nonce){const c=providers[p],u=new URL(c.auth);u.search=new URLSearchParams({response_type:'code',client_id:env[p.toUpperCase()+'_CLIENT_ID'],redirect_uri:origin+'/auth/callback/'+p,state}).toString();if(c.scope)u.searchParams.set('scope',c.scope);if(p==='google'){u.searchParams.set('code_challenge',sha(verifier));u.searchParams.set('code_challenge_method','S256');u.searchParams.set('nonce',nonce);}return u.toString();}
async function exchange(env,p,origin,code,state,verifier,nonce){
 const c=providers[p],client=env[p.toUpperCase()+'_CLIENT_ID'];
 const body={grant_type:'authorization_code',client_id:client,client_secret:env[p.toUpperCase()+'_CLIENT_SECRET'],redirect_uri:origin+'/auth/callback/'+p,code,state};if(p==='google')body.code_verifier=verifier;
 const t=await getJson(c.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
 check(typeof t.access_token==='string'&&!t.error,401,'소셜 로그인 승인이 확인되지 않았습니다.');
 if(p==='google'){
   check(typeof t.id_token==='string',401,'ID 토큰이 없습니다.');const [h,b,s]=t.id_token.split('.');
   const header=JSON.parse(Buffer.from(h,'base64url')),claims=JSON.parse(Buffer.from(b,'base64url'));
   check(header.alg==='RS256',401,'인증 서명이 올바르지 않습니다.');const jwks=await getJson('https://www.googleapis.com/oauth2/v3/certs');
   const jwk=jwks.keys.find(k=>k.kid===header.kid&&k.kty==='RSA');check(jwk,401,'서명 키를 찾지 못했습니다.');
   check(crypto.verify('RSA-SHA256',Buffer.from(h+'.'+b),crypto.createPublicKey({key:jwk,format:'jwk'}),Buffer.from(s,'base64url')),401,'인증 서명이 올바르지 않습니다.');
   check(['https://accounts.google.com','accounts.google.com'].includes(claims.iss)&&claims.aud===client&&claims.exp*1000>Date.now()&&claims.nonce===nonce&&typeof claims.sub==='string',401,'ID 토큰 검증에 실패했습니다.');
   return {subject:claims.sub,name:claims.name||''};
 }
 const u=await getJson(c.info,{headers:{Authorization:'Bearer '+t.access_token}});
 if(p==='kakao'){check(u.id&&(typeof u.id==='string'||Number.isSafeInteger(u.id)),401,'카카오 회원번호를 확인하지 못했습니다.');return {subject:String(u.id),name:u.properties?.nickname||''};}
 check(u.resultcode==='00'&&u.response?.id,401,'네이버 회원번호를 확인하지 못했습니다.');return {subject:String(u.response.id),name:u.response.name||u.response.nickname||''};
}
async function sendSMS(env,phone,code){
 const uri='/sms/v2/services/'+encodeURIComponent(env.NCP_SERVICE_ID)+'/messages',time=String(Date.now());
 const signature=crypto.createHmac('sha256',env.NCP_SECRET_KEY).update('POST '+uri+'\n'+time+'\n'+env.NCP_ACCESS_KEY).digest('base64');
 const r=await getJson('https://sens.apigw.ntruss.com'+uri,{method:'POST',headers:{'Content-Type':'application/json','x-ncp-apigw-timestamp':time,'x-ncp-iam-access-key':env.NCP_ACCESS_KEY,'x-ncp-apigw-signature-v2':signature},body:JSON.stringify({type:'SMS',contentType:'COMM',countryCode:'82',from:env.NCP_SENDER,content:`[ONEBIZ] 인증번호 ${code} (5분). 타인에게 알려주지 마세요.`,messages:[{to:phone}]})});
 check(String(r.statusCode)==='202',502,'문자 발송 요청이 접수되지 않았습니다.');
}
module.exports={configured,authUrl,exchange,sendSMS};

'use strict';
const crypto=require('node:crypto');
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const check=(yes,status,message)=>{if(!yes)throw new HttpError(status,message);};
const random=()=>crypto.randomBytes(32).toString('base64url');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const sha=v=>crypto.createHash('sha256').update(v).digest('base64url');
function phone(v){let d=String(v||'').replace(/[^\d+]/g,'');if(d.startsWith('+82'))d='0'+d.slice(3);check(/^010\d{8}$/.test(d),400,'010으로 시작하는 휴대폰번호를 확인해 주세요.');return d;}
const text=(v,max=200)=>String(v??'').trim().slice(0,max);
function passwordHash(v,salt){return crypto.scryptSync(v,salt,64).toString('hex');}
function decode32(s){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of s.toUpperCase().replace(/=+$/,'')){const i=alphabet.indexOf(c);if(i<0)throw Error('Invalid TOTP secret');bits+=i.toString(2).padStart(5,'0');}const a=[];for(let i=0;i+8<=bits.length;i+=8)a.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(a);}
function totp(secret,step=Math.floor(Date.now()/30000)){const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',decode32(secret)).update(b).digest();const o=h[h.length-1]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0');}
module.exports={HttpError,check,random,equal,sha,phone,text,passwordHash,totp};

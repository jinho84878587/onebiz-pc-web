'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDocumentRegistry}=require('../lib/no-login-document-registry');
const {createGuestDocumentVault}=require('../lib/no-login-document-vault');
const {createActionGate}=require('../lib/no-login-action-gate');
const {createGuestWebsignAdapter}=require('../lib/no-login-websign-adapter');
const {createGuestAlimtalkAdapter}=require('../lib/no-login-alimtalk-adapter');
const {createGuestSignShortLinks}=require('../lib/no-login-sign-short-links');
const now=1800000000000;
function setup(){
 const db=new DatabaseSync(':memory:'),secret=crypto.randomBytes(32).toString('base64url'),key=crypto.randomBytes(32);
 const seal=x=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(JSON.stringify(x)),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),data.toString('base64')].join('.')};
 const open=x=>{const [iv,tag,data]=x.split('.'),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString())};
 const store={db,seal,open,hash:v=>crypto.createHmac('sha256',key).update(v).digest('hex'),one:(q,...a)=>db.prepare(q).get(...a),run:(q,...a)=>db.prepare(q).run(...a),tx(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const registry=createDocumentRegistry(store),vault=createGuestDocumentVault(store,registry);
 const doc=vault.save({ownerSecret:secret,contract:{supplierName:'하이원시스템',customer:'테스트 고객',phone:'01012345678',item:'시스템에어컨 설치',amount:4900000},consent:true,now});
 const signUrl='https://hiwon-websign-server.onrender.com/sign/ob-'+'a'.repeat(40);let websignCalls=0,solapiCalls=0;
 const provider={createLink:async()=>{websignCalls++;return {providerId:'ob-'+'a'.repeat(40),signUrl}},verifyUrl:s=>{if(s!==signUrl)throw Error('wrong url');return s},status:async()=>({signed:true,signedAt:'2026-11-13',signatureName:'가상 고객',identityStatus:'confirmed'}),originalSignature:async()=> 'data:image/png;base64,'+Buffer.from('TESTPNG').toString('base64')};
 const web=createGuestWebsignAdapter(store,registry,provider,{appKey:'TEST-ONLY'});
 const short=createGuestSignShortLinks(store,registry,provider,'https://onebiz-pc-web.onrender.com');
 let lastShortToken='';
 const alim=createGuestAlimtalkAdapter(store,provider,{publicOrigin:'https://onebiz-pc-web.onrender.com',makeShortLink:async args=>{const result=short.makeForAction({...args,now});lastShortToken=result.token;return result;},preview:async({kind,to,variables})=>{
  if(kind!=='contractSign'||to!=='01012345678'||!/^https:\/\/onebiz-pc-web\.onrender\.com\/s\/[A-Za-z0-9_-]{43}$/.test(variables['서명링크'])||variables['업체명']!=='하이원시스템')throw Error('invalid request');
  return {kind,to,templateId:'mock-template-approved',options:{variables:{'#{서명링크}':'https://onebiz-pc-web.onrender.com/s/'+lastShortToken}}};
 },send:async()=>{solapiCalls++;return {ok:true,status:200}}});
 const gate=createActionGate(store,registry,id=>vault.loadForAction(id,now),async req=>req.scope==='sign.request'?web.dispatch(req):alim.dispatch(req));
 const send=async scope=>{const g=registry.issue({documentId:doc.documentId,ownerSecret:secret,scope,now,ttlMs:60000});return gate.execute({documentId:doc.documentId,token:g.token,scope,now});};
 return {db,secret,doc,registry,vault,web,short,signUrl,shortToken:()=>lastShortToken,send,websignCalls:()=>websignCalls,solapiCalls:()=>solapiCalls};
}
test('full mock chain: encrypted contract, signing link, Kakao message, signed original',async()=>{
 const f=setup();assert.equal((await f.send('sign.request')).state,'accepted');
 assert.equal((await f.send('alimtalk.send')).state,'accepted');
 assert.equal(f.websignCalls(),1);assert.equal(f.solapiCalls(),1);
 assert.equal(f.short.resolve(f.shortToken(),now),f.signUrl);
 assert.equal((await f.web.status({documentId:f.doc.documentId,ownerSecret:f.secret})).signed,true);
 const signed=f.web.originalForOwner({documentId:f.doc.documentId,ownerSecret:f.secret});
 assert.equal(signed.contract.amount,4900000);assert.match(signed.signatureDataUrl,/^data:image\/png/);
 assert.notEqual(f.registry.current(f.doc.documentId).frozen_at,null);
 assert.equal(f.short.resolve(f.shortToken(),now),null);f.db.close();
});
test('completed document cannot start a new unsigned signing request',async()=>{
 const f=setup();await f.send('sign.request');await f.web.status({documentId:f.doc.documentId,ownerSecret:f.secret});
 await assert.rejects(()=>f.send('sign.request'),/immutable/);assert.equal(f.websignCalls(),1);f.db.close();
});

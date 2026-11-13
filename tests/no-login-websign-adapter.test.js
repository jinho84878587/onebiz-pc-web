'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDocumentRegistry}=require('../lib/no-login-document-registry');
const {createGuestDocumentVault}=require('../lib/no-login-document-vault');
const {createActionGate}=require('../lib/no-login-action-gate');
const {createGuestWebsignAdapter}=require('../lib/no-login-websign-adapter');
const now=1800000000000;
function fixture({signed=false,goodSignature=true}={}){
 const db=new DatabaseSync(':memory:'),key=crypto.randomBytes(32),secret=crypto.randomBytes(32).toString('base64url');
 const seal=v=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),d=Buffer.concat([c.update(JSON.stringify(v)),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),d.toString('base64')].join('.')};
 const open=s=>{const [iv,t,data]=s.split('.'),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(t,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString());};
 const store={db,seal,open,one:(s,...a)=>db.prepare(s).get(...a),run:(s,...a)=>db.prepare(s).run(...a),tx(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const registry=createDocumentRegistry(store),vault=createGuestDocumentVault(store,registry);let createdCount=0,statusCount=0,originalCount=0;
 const link='https://hiwon-websign-server.onrender.com/sign/ob-'+'a'.repeat(40)+'?token=example';
 const websign={createLink:async doc=>{createdCount++;return {providerId:'ob-'+'a'.repeat(40),signUrl:link};},
   verifyUrl:u=>{if(u!==link)throw Error('Untrusted URL');return u;},
   status:async()=>{statusCount++;return signed?{signed:true,signedAt:'2026-11-13',signatureName:'가상서명자',identityStatus:'verified'}:{signed:false};},
   originalSignature:async()=>{originalCount++;return goodSignature?'data:image/png;base64,'+Buffer.from('fake_png_signature').toString('base64'):'broken';}};
 const adapter=createGuestWebsignAdapter(store,registry,websign,{appKey:'dummy-testing-only'});
 const doc=vault.save({ownerSecret:secret,consent:true,now,contract:{customer:'테스트 고객',phone:'01012345678',item:'시스템에어컨',amount:4900000}});
 const gate=createActionGate(store,registry,id=>vault.loadForAction(id,now),args=>adapter.dispatch(args));
 async function issueAndSend(){const grant=registry.issue({documentId:doc.documentId,ownerSecret:secret,scope:'sign.request',now,ttlMs:60000});return gate.execute({documentId:doc.documentId,token:grant.token,scope:'sign.request',now});}
 return {db,registry,vault,secret,doc,adapter,issueAndSend,createdCount:()=>createdCount,statusCount:()=>statusCount,originalCount:()=>originalCount};
}
test('mock WebSign creates a link, accessible only with owner secret',async()=>{
 const f=fixture(),result=await f.issueAndSend();assert.equal(result.state,'accepted');assert.equal(f.createdCount(),1);
 assert.equal(f.adapter.ownerLink({documentId:f.doc.documentId,ownerSecret:'bad'}),null);
 assert.match(f.adapter.ownerLink({documentId:f.doc.documentId,ownerSecret:f.secret}).signUrl,/hiwon-websign-server/);
 const row=f.db.prepare('SELECT sign_url FROM no_login_websign_links').get();
 assert.equal(row.sign_url.includes('hiwon-websign-server'),false);f.db.close();
});
test('unsigned provider status does not freeze contract',async()=>{
 const f=fixture();await f.issueAndSend();const res=await f.adapter.status({documentId:f.doc.documentId,ownerSecret:f.secret});
 assert.deepEqual(res,{exists:true,signed:false});assert.equal(f.registry.current(f.doc.documentId).frozen_at,null);f.db.close();
});
test('signed status is confirmed only after encrypted original archival',async()=>{
 const f=fixture({signed:true});await f.issueAndSend();const res=await f.adapter.status({documentId:f.doc.documentId,ownerSecret:f.secret});
 assert.equal(res.signed,true);assert.notEqual(f.registry.current(f.doc.documentId).frozen_at,null);
 assert.equal(f.adapter.originalForOwner({documentId:f.doc.documentId,ownerSecret:'bad'}),null);
 assert.match(f.adapter.originalForOwner({documentId:f.doc.documentId,ownerSecret:f.secret}).signatureDataUrl,/^data:image\/png/);
 assert.equal(f.adapter.originalForOwner({documentId:f.doc.documentId,ownerSecret:f.secret}).contract.amount,4900000);
 assert.equal((await f.adapter.status({documentId:f.doc.documentId,ownerSecret:f.secret})).signed,true);
 assert.equal(f.statusCount(),1);f.db.close();
});
test('unverified original does not mark document signed',async()=>{
 const f=fixture({signed:true,goodSignature:false});await f.issueAndSend();await assert.rejects(()=>f.adapter.status({documentId:f.doc.documentId,ownerSecret:f.secret}),/형식/);
 assert.equal(f.registry.current(f.doc.documentId).frozen_at,null);f.db.close();
});
test('wrong action scope never calls WebSign',async()=>{
 const f=fixture(),saved=f.vault.retrieveForOwner({documentId:f.doc.documentId,ownerSecret:f.secret,now});
 assert.equal((await f.adapter.dispatch({scope:'alimtalk.send',documentId:f.doc.documentId,document:saved.document,fingerprint:saved.fingerprint})).state,'failed');
 assert.equal(f.createdCount(),0);f.db.close();
});

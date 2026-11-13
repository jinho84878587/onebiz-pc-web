'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDocumentRegistry}=require('../lib/no-login-document-registry');
const {createGuestDocumentVault}=require('../lib/no-login-document-vault');
const {createActionGate}=require('../lib/no-login-action-gate');
const {createGuestAlimtalkAdapter}=require('../lib/no-login-alimtalk-adapter');
const now=1800000000000;
function fixture({link=true,badPreview=false,sendResult={ok:true,status:200}}={}){
 const db=new DatabaseSync(':memory:'),key=crypto.randomBytes(32),secret=crypto.randomBytes(32).toString('base64url');
 const seal=v=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(JSON.stringify(v)),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),data.toString('base64')].join('.')};
 const open=s=>{const [iv,tag,data]=s.split('.'),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString());};
 const store={db,seal,open,one:(s,...a)=>db.prepare(s).get(...a),run:(s,...a)=>db.prepare(s).run(...a),tx(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const registry=createDocumentRegistry(store),vault=createGuestDocumentVault(store,registry);
 const d=vault.save({ownerSecret:secret,now,consent:true,contract:{supplierName:'하이원시스템',customer:'홍길동',phone:'01012345678',amount:4800000,item:'시스템에어컨'}});
 db.exec('CREATE TABLE no_login_websign_links(document_id TEXT PRIMARY KEY,sign_url TEXT,fingerprint TEXT)');
 const signUrl='https://hiwon-websign-server.onrender.com/sign/ob-'+'a'.repeat(40);
 if(link)store.run('INSERT INTO no_login_websign_links(document_id,sign_url,fingerprint) VALUES(?,?,?)',d.documentId,seal(signUrl),d.fingerprint);
 let sendCalls=0,previewCalls=0;
 const preview=async x=>{previewCalls++;return {kind:'contractSign',to:badPreview?'01099998888':x.to,templateId:'fake-approved-template',options:{variables:{'#{서명링크}':signUrl}}};};
 const bridge=createGuestAlimtalkAdapter(store,{verifyUrl:u=>{if(u!==signUrl)throw Error('bad url');return u}},{preview,send:async()=>{sendCalls++;return sendResult}});
 const gate=createActionGate(store,registry,id=>vault.loadForAction(id,now),args=>bridge.dispatch(args));
 const run=async()=>{const g=registry.issue({documentId:d.documentId,ownerSecret:secret,scope:'alimtalk.send',now,ttlMs:60000});return gate.execute({documentId:d.documentId,token:g.token,scope:'alimtalk.send',now});};
 return {db,bridge,registry,vault,secret,docId:d.documentId,run,sendCalls:()=>sendCalls,previewCalls:()=>previewCalls};
}
test('prepared message uses verified document phone and supplier',async()=>{
 const f=fixture(),doc=f.vault.retrieveForOwner({documentId:f.docId,ownerSecret:f.secret,now});
 const msg=await f.bridge.prepare({documentId:f.docId,document:doc.document,fingerprint:doc.fingerprint,scope:'alimtalk.send'});
 assert.equal(msg.to,'01012345678');assert.equal(f.sendCalls(),0);f.db.close();
});
test('approved mock SOLAPI dispatch returns accepted',async()=>{
 const f=fixture();assert.equal((await f.run()).state,'accepted');assert.equal(f.sendCalls(),1);f.db.close();
});
test('missing original signing link prevents sending',async()=>{
 const f=fixture({link:false});assert.equal((await f.run()).state,'failed');assert.equal(f.sendCalls(),0);f.db.close();
});
test('recipient mismatch in template preview prevents sending',async()=>{
 const f=fixture({badPreview:true});assert.equal((await f.run()).state,'failed');assert.equal(f.sendCalls(),0);f.db.close();
});
test('uncertain provider response is not accepted',async()=>{
 const f=fixture({sendResult:{ok:false,status:503}});assert.equal((await f.run()).state,'unknown');f.db.close();
});

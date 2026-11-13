'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDocumentRegistry}=require('../lib/no-login-document-registry');
const {createGuestDocumentVault}=require('../lib/no-login-document-vault');
const {createActionGate}=require('../lib/no-login-action-gate');
const now=1800000000000;
const contract={customer:'홍길동',phone:'010-1234-5678',item:'시스템에어컨',amount:4800000,standardTerms:'조건',specialTerms:'특약'};
function fixture(provider=async()=>({state:'accepted'})){
 const db=new DatabaseSync(':memory:'),key=crypto.randomBytes(32);
 const seal=v=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const d=Buffer.concat([c.update(JSON.stringify(v)),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),d.toString('base64')].join('.')};
 const open=s=>{const [iv,tag,data]=s.split('.'),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString());};
 const store={db,seal,open,one:(sql,...a)=>db.prepare(sql).get(...a),run:(sql,...a)=>db.prepare(sql).run(...a),tx(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const registry=createDocumentRegistry(store),vault=createGuestDocumentVault(store,registry),ownerSecret=crypto.randomBytes(32).toString('base64url');
 const gate=createActionGate(store,registry,id=>vault.loadForAction(id,now),provider);
 return {db,store,registry,vault,ownerSecret,gate};
}
test('document is encrypted and only owner can retrieve',()=>{
 const f=fixture(),doc=f.vault.save({ownerSecret:f.ownerSecret,contract,consent:true,now});
 const row=f.store.one('SELECT body FROM no_login_document_payloads WHERE document_id=?',doc.documentId);
 assert.equal(row.body.includes('홍길동'),false);
 assert.equal(f.vault.retrieveForOwner({documentId:doc.documentId,ownerSecret:'x',now}),null);
 const read=f.vault.retrieveForOwner({documentId:doc.documentId,ownerSecret:f.ownerSecret,now});
 assert.equal(read.document.phone,'01012345678');assert.equal(read.document.id,doc.documentId);
 assert.equal(read.fingerprint,doc.fingerprint);f.db.close();
});
test('personal data upload requires explicit consent',()=>{
 const f=fixture();assert.throws(()=>f.vault.save({ownerSecret:f.ownerSecret,contract,now}),/확인/);
 assert.equal(f.store.one('SELECT COUNT(*) n FROM no_login_document_payloads').n,0);f.db.close();
});
test('invalid recipients, negative amounts and oversized payload are rejected',()=>{
 const f=fixture();
 for(const c of [{...contract,phone:'010123'},{...contract,amount:-1},{...contract,specialTerms:'x'.repeat(20000)}])
  assert.throws(()=>f.vault.save({ownerSecret:f.ownerSecret,contract:c,consent:true,now}));
 f.db.close();
});
test('expired, tampered or signed documents cannot be dispatched',()=>{
 const f=fixture(),d=f.vault.save({ownerSecret:f.ownerSecret,contract,consent:true,now});
 assert.equal(f.vault.loadForAction(d.documentId,now+30*86400000),null);
 f.store.run('UPDATE no_login_document_payloads SET fingerprint=? WHERE document_id=?','f'.repeat(64),d.documentId);
 assert.equal(f.vault.loadForAction(d.documentId,now),null);
 f.store.run('UPDATE no_login_document_payloads SET fingerprint=? WHERE document_id=?',d.fingerprint,d.documentId);
 assert.equal(f.registry.freezeByVerifiedProvider({documentId:d.documentId,expectedFingerprint:d.fingerprint,now}),true);
 assert.equal(f.vault.loadForAction(d.documentId,now),null);f.db.close();
});
test('encrypted contract -> request grant -> single mock signing dispatch',async()=>{
 let count=0,got;const f=fixture(async x=>{count++;got=x.document;return {state:'accepted'}});
 const d=f.vault.save({ownerSecret:f.ownerSecret,contract,consent:true,now});
 const g=f.registry.issue({documentId:d.documentId,ownerSecret:f.ownerSecret,scope:'sign.request',ttlMs:60000,now});
 const a=await f.gate.execute({documentId:d.documentId,token:g.token,scope:'sign.request',now});
 assert.equal(a.state,'accepted');assert.equal(got.phone,'01012345678');assert.equal(got.amount,4800000);
 assert.equal((await f.gate.execute({documentId:d.documentId,token:g.token,scope:'sign.request',now})).code,'not_authorized');
 assert.equal(count,1);f.db.close();
});
test('revoking a document prevents future dispatch',()=>{
 const f=fixture(),d=f.vault.save({ownerSecret:f.ownerSecret,contract,consent:true,now});
 assert.equal(f.registry.revokeDocument({documentId:d.documentId,secret:f.ownerSecret,now:now+1}),true);
 assert.equal(f.vault.loadForAction(d.documentId,now+1),null);f.db.close();
});

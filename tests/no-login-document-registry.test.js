'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDocumentRegistry}=require('../lib/no-login-document-registry');
const fp1='a'.repeat(64),fp2='b'.repeat(64),now=1800000000000;
const secret=()=>crypto.randomBytes(32).toString('base64url');
function fixture(){
 const db=new DatabaseSync(':memory:');
 const store={db,one:(s,...a)=>db.prepare(s).get(...a),run:(s,...a)=>db.prepare(s).run(...a),
   tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}
   catch(e){db.exec('ROLLBACK');throw e;}}};
 return {db,registry:createDocumentRegistry(store)};
}
test('only hashed secret is stored and only its owner may issue messaging grants',()=>{
 const {db,registry}=fixture(),ownerSecret=secret(),doc=registry.register({secret:ownerSecret,fingerprint:fp1,now});
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM no_login_documents').get()).includes(ownerSecret),false);
 assert.throws(()=>registry.issue({documentId:doc.documentId,ownerSecret:secret(),scope:'alimtalk.send',now}),/verification/);
 const g=registry.issue({documentId:doc.documentId,ownerSecret,scope:'alimtalk.send',now});
 assert.equal(registry.validate({documentId:doc.documentId,token:g.token,scope:'alimtalk.send',now}),true);
 assert.equal(registry.consume({documentId:doc.documentId,token:g.token,scope:'alimtalk.send',now}),true);
 assert.equal(registry.consume({documentId:doc.documentId,token:g.token,scope:'alimtalk.send',now}),false);
 db.close();
});
test('editing invalidates old signing grant; new content can obtain a new one',()=>{
 const {db,registry}=fixture(),s=secret(),doc=registry.register({secret:s,fingerprint:fp1,now});
 const g=registry.issue({documentId:doc.documentId,ownerSecret:s,scope:'sign.request',now});
 assert.equal(registry.rotate({documentId:doc.documentId,secret:s,expectedFingerprint:fp1,nextFingerprint:fp2,now:now+1}),true);
 assert.equal(registry.consume({documentId:doc.documentId,token:g.token,scope:'sign.request',now:now+2}),false);
 const newer=registry.issue({documentId:doc.documentId,ownerSecret:s,scope:'sign.request',now:now+3});
 assert.equal(registry.consume({documentId:doc.documentId,token:newer.token,scope:'sign.request',now:now+4}),true);
 db.close();
});
test('document isolation prevents cross-document action and cross-document revocation',()=>{
 const {db,registry}=fixture(),s1=secret(),s2=secret();
 const a=registry.register({secret:s1,fingerprint:fp1,now}),b=registry.register({secret:s2,fingerprint:fp1,now});
 const g=registry.issue({documentId:a.documentId,ownerSecret:s1,scope:'alimtalk.send',now});
 assert.equal(registry.consume({documentId:b.documentId,token:g.token,scope:'alimtalk.send',now}),false);
 assert.equal(registry.revokeGrant({documentId:b.documentId,ownerSecret:s2,token:g.token}),false);
 assert.equal(registry.consume({documentId:a.documentId,token:g.token,scope:'alimtalk.send',now}),true);
 db.close();
});
test('verified signed document freezes future signing and edits',()=>{
 const {db,registry}=fixture(),s=secret(),doc=registry.register({secret:s,fingerprint:fp1,now});
 assert.equal(registry.freezeByVerifiedProvider({documentId:doc.documentId,expectedFingerprint:fp1,now:now+1}),true);
 assert.throws(()=>registry.issue({documentId:doc.documentId,ownerSecret:s,scope:'sign.request',now:now+2}),/immutable/);
 assert.equal(registry.rotate({documentId:doc.documentId,secret:s,expectedFingerprint:fp1,nextFingerprint:fp2,now:now+3}),false);
 db.close();
});
test('revoking document invalidates every grant',()=>{
 const {db,registry}=fixture(),s=secret(),doc=registry.register({secret:s,fingerprint:fp1,now});
 const g=registry.issue({documentId:doc.documentId,ownerSecret:s,scope:'alimtalk.send',now});
 assert.equal(registry.revokeDocument({documentId:doc.documentId,secret:s,now:now+1}),true);
 assert.equal(registry.consume({documentId:doc.documentId,token:g.token,scope:'alimtalk.send',now:now+2}),false);
 db.close();
});
test('invalid registration and invalid scopes are rejected',()=>{
 const {db,registry}=fixture();
 assert.throws(()=>registry.register({secret:'short',fingerprint:fp1,now}),TypeError);
 const s=secret(),doc=registry.register({secret:s,fingerprint:fp1,now});
 assert.throws(()=>registry.issue({documentId:doc.documentId,ownerSecret:s,scope:'admin',now}),TypeError);
 db.close();
});

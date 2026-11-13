'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createGrantStore}=require('../lib/no-login-grants-store');
const doc='CONTRACT-001', fingerprint='f'.repeat(64), now=1800000000000;
function fixture(authorizeIssue=()=>true){
 const db=new DatabaseSync(':memory:');
 const store={
   db,
   one:(sql,...args)=>db.prepare(sql).get(...args),
   run:(sql,...args)=>db.prepare(sql).run(...args),
   tx(fn){db.exec('BEGIN IMMEDIATE'); try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}
 };
 return {db, grants:createGrantStore(store,authorizeIssue)};
}
const args=(scope='alimtalk.send')=>({documentId:doc,scope,fingerprint,ttlMs:60000,now});
const check=(token,scope='alimtalk.send',time=now)=>({token,documentId:doc,scope,fingerprint,now:time});
test('rejects missing authorization, even if document ID is known',()=>{
 const {db,grants}=fixture(()=>false);
 assert.throws(()=>grants.issue(args()),/authorization failed/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM no_login_document_grants').get().n,0);
 db.close();
});
test('issues scoped grant with only token hash stored in SQLite',()=>{
 const {db,grants}=fixture(); const {token}=grants.issue(args());
 const rows=db.prepare('SELECT * FROM no_login_document_grants').all();
 assert.equal(rows.length,1);
 assert.equal(rows[0].one_time,1);
 assert.equal(JSON.stringify(rows).includes(token),false);
 assert.equal(grants.validate(check(token)),true);
 assert.equal(grants.validate(check(token,'sign.request')),false);
 db.close();
});
test('one-time messaging grant cannot trigger a second send',()=>{
 const {db,grants}=fixture(); const {token}=grants.issue(args());
 assert.equal(grants.consume(check(token)),true);
 assert.equal(grants.consume(check(token)),false);
 assert.equal(grants.validate(check(token)),false);
 assert.ok(db.prepare('SELECT consumed_at FROM no_login_document_grants').get().consumed_at!==null);
 db.close();
});
test('document tampering, mismatched fingerprint, expiry are denied',()=>{
 const {db,grants}=fixture(); const {token}=grants.issue(args());
 assert.equal(grants.consume({...check(token),documentId:'OTHER-CONTRACT'}),false);
 assert.equal(grants.consume({...check(token),fingerprint:'e'.repeat(64)}),false);
 assert.equal(grants.consume(check(token,'alimtalk.send',now+60000)),false);
 assert.equal(grants.consume(check(token)),true);
 db.close();
});
test('read-only grant cannot be consumed as an external action',()=>{
 const {db,grants}=fixture(); const {token}=grants.issue(args('document.read'));
 assert.equal(grants.validate(check(token,'document.read')),true);
 assert.equal(grants.consume(check(token,'document.read')),false);
 assert.equal(grants.validate(check(token,'document.read')),true);
 db.close();
});
test('revocation requires ownership approval',()=>{
 let canRevoke=false;
 const {db,grants}=fixture(a=>a.action==='revoke'?canRevoke:true);
 const {token}=grants.issue(args());
 assert.equal(grants.revoke({token}),false);
 assert.equal(grants.validate(check(token)),true);
 canRevoke=true;
 assert.equal(grants.revoke({token}),true);
 assert.equal(grants.validate(check(token)),false);
 assert.equal(grants.consume(check(token)),false);
 db.close();
});
test('SQLite table survives grant repository recreation',()=>{
 const {db,grants}=fixture(); const {token}=grants.issue(args());
 const store={db,one:(sql,...a)=>db.prepare(sql).get(...a),run:(sql,...a)=>db.prepare(sql).run(...a),tx:fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const reopened=createGrantStore(store,()=>false);
 assert.equal(reopened.validate(check(token)),true);
 assert.equal(reopened.consume(check(token)),true);
 db.close();
});
test('rejects malformed or guessed tokens without modifying state',()=>{
 const {db,grants}=fixture();const {token}=grants.issue(args());
 assert.equal(grants.consume({...check(token),token:'short'}),false);
 assert.equal(grants.consume({...check(token),token:'0'.repeat(43)}),false);
 assert.equal(grants.validate(check(token)),true);
 db.close();
});

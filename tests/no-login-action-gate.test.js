'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDocumentRegistry}=require('../lib/no-login-document-registry');
const {createActionGate}=require('../lib/no-login-action-gate');
const fp='b'.repeat(64),fp2='d'.repeat(64),now=1800000000000;
function fixture(action=async()=>({state:'accepted'})){
 const db=new DatabaseSync(':memory:');
 const store={db,one:(s,...a)=>db.prepare(s).get(...a),run:(s,...a)=>db.prepare(s).run(...a),
 tx(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const registry=createDocumentRegistry(store),secret=crypto.randomBytes(32).toString('base64url');
 const doc=registry.register({secret,fingerprint:fp,now});let current=fp,calls=0;
 const gate=createActionGate(store,registry,()=>({fingerprint:current,document:{kind:'contract',amount:120000}}),async args=>{calls++;return action(args);});
 return {db,registry,secret,doc:doc.documentId,gate,setFingerprint:v=>current=v,calls:()=>calls,
 grant:scope=>registry.issue({documentId:doc.documentId,ownerSecret:secret,scope,now,ttlMs:60000})};
}
const req=(f,token,scope='alimtalk.send')=>({documentId:f.doc,token,scope,now});
test('single grant invokes provider once',async()=>{
 const f=fixture(),g=f.grant('alimtalk.send');
 assert.equal((await f.gate.execute(req(f,g.token))).state,'accepted');
 assert.equal((await f.gate.execute(req(f,g.token))).code,'not_authorized');
 assert.equal(f.calls(),1);f.db.close();
});
test('signing and messaging grants are scope restricted',async()=>{
 const f=fixture(),g=f.grant('sign.request');
 assert.equal((await f.gate.execute(req(f,g.token))).code,'not_authorized');
 assert.equal((await f.gate.execute(req(f,g.token,'sign.request'))).state,'accepted');
 assert.equal(f.calls(),1);f.db.close();
});
test('timeout is unknown, never automatic resend',async()=>{
 const f=fixture(async()=>{throw Error('timeout');}),g=f.grant('alimtalk.send');
 assert.equal((await f.gate.execute(req(f,g.token))).state,'unknown');
 assert.equal((await f.gate.execute(req(f,g.token))).code,'not_authorized');
 assert.equal(f.gate.status(g.token).state,'unknown');assert.equal(f.calls(),1);f.db.close();
});
test('changed stored content prevents dispatch',async()=>{
 const f=fixture(),g=f.grant('alimtalk.send');f.setFingerprint(fp2);
 assert.equal((await f.gate.execute(req(f,g.token))).code,'document_changed');
 assert.equal(f.calls(),0);f.db.close();
});
test('editing revokes prior signing grant',async()=>{
 const f=fixture(),g=f.grant('sign.request');
 assert.equal(f.registry.rotate({documentId:f.doc,secret:f.secret,expectedFingerprint:fp,nextFingerprint:fp2,now:now+1}),true);
 f.setFingerprint(fp2);
 assert.equal((await f.gate.execute(req(f,g.token,'sign.request'))).code,'not_authorized');
 assert.equal(f.calls(),0);f.db.close();
});
test('revocation blocks dispatch',async()=>{
 const f=fixture(),g=f.grant('alimtalk.send');
 assert.equal(f.registry.revokeDocument({documentId:f.doc,secret:f.secret,now:now+1}),true);
 assert.equal((await f.gate.execute(req(f,g.token))).code,'unavailable');
 assert.equal(f.calls(),0);f.db.close();
});
test('signed frozen document blocks new requests',async()=>{
 const f=fixture(),g=f.grant('alimtalk.send');
 assert.equal(f.registry.freezeByVerifiedProvider({documentId:f.doc,expectedFingerprint:fp,now:now+1}),true);
 assert.equal((await f.gate.execute(req(f,g.token))).code,'unavailable');
 assert.equal(f.calls(),0);f.db.close();
});
test('concurrent duplicate action only invokes provider once',async()=>{
 const f=fixture(async()=>{await new Promise(resolve=>setTimeout(resolve,30));return {state:'accepted'};});
 const g=f.grant('alimtalk.send');
 const results=await Promise.all([f.gate.execute(req(f,g.token)),f.gate.execute(req(f,g.token))]);
 assert.equal(results.filter(x=>x.state==='accepted').length,1);
 assert.equal(f.calls(),1);f.db.close();
});
test('read grant cannot pay or sign',async()=>{
 const f=fixture(),g=f.grant('document.read');
 assert.equal((await f.gate.execute(req(f,g.token))).code,'not_authorized');
 assert.equal(f.calls(),0);f.db.close();
});
test('provider failure not retried automatically',async()=>{
 const f=fixture(async()=>({state:'failed'})),g=f.grant('alimtalk.send');
 assert.equal((await f.gate.execute(req(f,g.token))).state,'failed');
 assert.equal(f.gate.status(g.token).state,'failed');
 assert.equal((await f.gate.execute(req(f,g.token))).code,'not_authorized');
 assert.equal(f.calls(),1);f.db.close();
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../lib/store'),documents=require('../lib/payment-documents');
function fixture(t){
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-document-unit-')),'db.sqlite'),key='56'.repeat(32),store=createStore(file,key);
 store.run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)','owner',store.seal({}),'{}',Date.now(),Date.now());
 t.after(()=>store.db.close());return {store,file,key};
}
test('issued archive is encrypted, write-once and independent of source data',t=>{
 const {store}=fixture(t),link={token_hash:'hashed-token',user_id:'owner',expires:Date.now()+600000};
 const payload={supplier:{businessName:'Private supplier'},statement:{customer:'Private customer',total:100000}};
 documents.archive(store,link,'statement',payload);
 documents.archive(store,link,'statement',{statement:{total:0}});
 assert.equal(documents.read(store,link,'statement',()=>{throw Error('must not read source');}).statement.total,100000);
 assert.equal(documents.read(store,link,'statement',()=>null).archive.originalAtIssue,true);
 const raw=store.one('SELECT body FROM payment_document_archives').body;
 assert.ok(!raw.includes('Private'));
 assert.throws(()=>documents.read(store,{...link,expires:Date.now()-1},'statement',()=>null),{status:410});
});
test('legacy documents are explicitly marked and their first preserved contents do not drift',t=>{
 const {store}=fixture(t),link={token_hash:'legacy-token',user_id:'owner',expires:Date.now()+600000};
 let calls=0;
 const first=documents.read(store,link,'receipt',()=>{calls++;return {receipt:{paidAmount:50000}};});
 const second=documents.read(store,link,'receipt',()=>{calls++;return {receipt:{paidAmount:99999}};});
 assert.equal(first.archive.originalAtIssue,false);assert.ok(first.archive.notice.includes('최초 발행 당시 원본'));
 assert.equal(second.receipt.paidAmount,50000);assert.equal(calls,1);
});
test('send reservation survives another SQLite connection and permits retry only after definite failure or cooldown',t=>{
 const {store,file,key}=fixture(t),now=Date.now(),reservation=documents.reserve(store,'owner','statement','quote:Q',now);
 const another=createStore(file,key);t.after(()=>another.db.close());
 assert.throws(()=>documents.reserve(another,'owner','statement','quote:Q',now+1),{status:429});
 documents.finish(store,reservation,'failed',now+2);
 assert.equal(documents.reserve(another,'owner','statement','quote:Q',now+3),reservation);
 documents.finish(store,reservation,'unknown',now+4);
 assert.throws(()=>documents.reserve(another,'owner','statement','quote:Q',now+5),{status:429});
 assert.equal(documents.reserve(another,'owner','statement','quote:Q',now+600005),reservation);
 assert.throws(()=>documents.reserve(store,'owner','statement','quote:Q',now+600006),{status:429});
});
test('provider timeout, malformed receipt and server errors are not treated as definite rejection',()=>{
 assert.equal(documents.outcome({ok:true,status:200}),'accepted');
 assert.equal(documents.outcome({ok:false,status:200,result:{groupInfo:{count:{registeredSuccess:0,registeredFailed:1}},failedMessageList:[{}]}}),'failed');
 assert.equal(documents.outcome({ok:false,status:401}),'failed');
 for(const status of [0,200,408,500,502])assert.equal(documents.outcome({ok:false,status,result:{}}),'unknown');
});

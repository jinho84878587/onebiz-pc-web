'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../lib/store');
const {createTracking,providerIds,deliveryResult,automatedRequest}=require('../lib/document-tracking');
function fixture(t){
 const s=createStore(':memory:','71'.repeat(32));t.after(()=>s.db.close());const now=Date.now();
 for(const actor of ['owner','other']){s.run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)',actor,s.seal({}),'{}',now,now);s.run('INSERT INTO snapshots VALUES(?,?,?,?,?)',actor,7,s.seal({data:{quotes:[],contracts:[]}}),'{}',now);}
 const tracker=createTracking(s,'https://onebiz-pc-web.onrender.com',{providerConfigured:true});
 const input={actor:'owner',kind:'quote',sourceId:'Q-private',customer:'비공개 고객',phoneMask:'010-****-0051',recipient:'01000000051',amount:12345,token:'a'.repeat(43),expires:now+86400000,payload:{quote:{customer:'비공개 고객',total:12345}}};
 const id=tracker.create(input,now);return {s,tracker,input,id,now};
}
const accepted={ok:true,status:200,result:{groupInfo:{groupId:'G4V-test'},messageList:{'M4V-test':{groupId:'G4V-test',to:'01000000051'}},failedMessageList:[]}};
test('provider identity parsing and delivery completion do not equate registration or queue success to delivery',()=>{
 assert.deepEqual(providerIds(accepted),{groupId:'G4V-test',messageId:'M4V-test'});
 assert.deepEqual(providerIds({result:{groupId:'G',messageList:[{messageId:'M'}]}}),{groupId:'G',messageId:'M'});
 assert.equal(deliveryResult({status:'PENDING',statusCode:'2000'}).status,'accepted');
 assert.equal(deliveryResult({status:'SENDING',statusCode:'4000'}).status,'accepted');
 assert.equal(deliveryResult({status:'COMPLETE',statusCode:'4000'}).status,'delivered');
 assert.equal(deliveryResult({status:'COMPLETE',statusCode:'3001',queues:[{statusCode:'4000'}]}).status,'failed');
 assert.equal(deliveryResult({status:'COMPLETE',statusCode:null}).status,'accepted');
});
test('outbox metadata is encrypted, fixed at issuance, account scoped and independent from snapshot revision',t=>{
 const {s,tracker,input,id}=fixture(t);tracker.complete(id,accepted,'accepted','log-1');
 const raw=s.one('SELECT * FROM document_outbox WHERE id=?',id);assert.ok(!raw.body.includes(input.customer));assert.ok(!raw.body.includes(input.token));assert.ok(!raw.body.includes(input.recipient));
 assert.equal(raw.provider_group_id,'G4V-test');assert.equal(raw.provider_message_id,'M4V-test');
 assert.equal(tracker.center('owner').documents[0].customer,input.customer);assert.equal(tracker.center('other').documents.length,0);
 assert.throws(()=>tracker.document('other',id),e=>e.status===404);
 assert.equal(tracker.document('owner',id).document.amount,12345);
 assert.equal(s.one('SELECT revision FROM snapshots WHERE user_id=?','owner').revision,7);
 assert.equal(tracker.create({...input,id:'different-id',customer:'replacement'}),id);
 assert.equal(tracker.document('owner',id).document.customer,input.customer);
 const proof=new URL(tracker.document('owner',id).document.previewUrl).searchParams.get('preview');
 assert.ok(tracker.isOwnerPreview(raw,null,proof));assert.ok(!tracker.isOwnerPreview(raw,'other','fake'));
});
test('explicit opens require a browser-bound expiring single-use challenge, dedupe repeats, and notify once per version',t=>{
 const {s,tracker,id,now}=fixture(t),record=tracker.row(id),visitor='visitor-a';
 assert.equal(tracker.opened(record,visitor,null,'owner_preview','opened',now).recorded,false);
 assert.equal(tracker.opened(record,visitor,null,'automated','opened',now).recorded,false);
 const grant=tracker.challenge(record,visitor,'customer',now);
 assert.throws(()=>tracker.opened(record,'other-browser',grant.challenge,'customer','opened',now+1),e=>e.status===400);
 assert.throws(()=>tracker.opened(record,visitor,grant.challenge,'customer','opened',now+300001),e=>e.status===400);
 assert.equal(tracker.opened(record,visitor,grant.challenge,'customer','opened',now+1).openCount,1);
 assert.equal(tracker.opened(record,visitor,grant.challenge,'customer','opened',now+2).reason,'already_used');
 const duplicate=tracker.challenge(record,visitor,'customer',now+10);assert.equal(tracker.opened(record,visitor,duplicate.challenge,'customer','opened',now+11).reason,'duplicate');
 const next=tracker.challenge(record,visitor,'customer',now+1800010);assert.equal(tracker.opened(record,visitor,next.challenge,'customer','opened',now+1800011).openCount,2);
 const center=tracker.center('owner');assert.equal(center.notifications.length,1);assert.equal(center.notifications[0].kind,'opened');assert.equal(center.documents[0].firstOpenedAt,now+1);assert.equal(center.documents[0].events.filter(e=>e.type==='opened').length,1);
 assert.equal(s.one('SELECT revision FROM snapshots WHERE user_id=?','owner').revision,7);
});
test('sign-page and external-original movements are separate from document opens; signature events are idempotent',t=>{
 const {s,tracker,input,now}=fixture(t);
 const id=tracker.create({...input,kind:'contract',variant:'sign_request',publicKind:'sign',sourceType:'contract',sourceId:'C1',token:'b'.repeat(43),signProviderId:'ob-test',signPayloadHash:'fingerprint'}),record=tracker.row(id);
 const grant=tracker.challenge(record,'v','customer');tracker.opened(record,'v',grant.challenge,'customer','sign_link_opened');
 let doc=tracker.document('owner',id).document;assert.equal(doc.firstOpenedAt,null);assert.equal(doc.openCount,0);assert.equal(doc.signLinkOpenCount,1);assert.equal(tracker.center('owner').notifications.length,0);
 tracker.signed('owner','C1','ob-test','different',new Date(now).toISOString());assert.equal(tracker.document('owner',id).document.signedAt,null);
 tracker.signed('owner','C1','ob-test','fingerprint',new Date(now).toISOString());tracker.signed('owner','C1','ob-test','fingerprint',new Date(now).toISOString());
 assert.equal(tracker.center('owner').notifications.filter(n=>n.kind==='signed').length,1);
 const otherId=tracker.create({...input,token:'c'.repeat(43),kind:'contract',variant:'completed'}),r=tracker.row(otherId),g=tracker.challenge(r,'v','customer');tracker.opened(r,'v',g.challenge,'customer','original_link_opened');
 doc=tracker.document('owner',otherId).document;assert.equal(doc.firstOpenedAt,null);assert.ok(doc.originalLinkOpenedAt);assert.equal(tracker.center('owner').notifications.filter(n=>n.kind==='original_link_opened').length,1);
 assert.equal(s.one('SELECT revision FROM snapshots WHERE user_id=?','owner').revision,7);
});
test('provider polling verifies identity, preserves terminal results, records failures once, and exposes read outages',async t=>{
 const {s,tracker,id,now,input}=fixture(t);tracker.complete(id,accepted,'accepted','log-1');
 await tracker.pollDelivery(tracker.row(id),async()=>({messageList:{other:{groupId:'G4V-test',status:'COMPLETE',statusCode:'4000'}}}),now+1);
 assert.equal(tracker.document('owner',id).document.deliveryStatus,'accepted');assert.ok(tracker.document('owner',id).document.providerCheckNotice);
 const delivered=async()=>({messageList:{'M4V-test':{groupId:'G4V-test',status:'COMPLETE',statusCode:'4000',dateReceived:new Date(now).toISOString()}}});
 await tracker.pollDelivery(tracker.row(id),delivered,now+30001);await tracker.pollDelivery(tracker.row(id),delivered,now+60001);
 assert.equal(tracker.document('owner',id).document.deliveryStatus,'delivered');assert.equal(tracker.document('owner',id).document.firstOpenedAt,null);assert.equal(tracker.center('owner').notifications.filter(n=>n.kind==='delivered').length,1);
 const failId=tracker.create({...input,token:'f'.repeat(43)});tracker.complete(failId,accepted,'accepted','log-2');
 await tracker.pollDelivery(tracker.row(failId),async()=>({messageList:{'M4V-test':{status:'COMPLETE',statusCode:'3001',reason:'전달 실패 https://private.example/secret 01000000051'}}}));
 const failure=tracker.document('owner',failId).document;assert.equal(failure.deliveryStatus,'failed');assert.ok(!failure.failureReason.includes('private.example'));assert.ok(!failure.failureReason.includes(input.recipient));
 s.run("UPDATE users SET status='suspended' WHERE id='owner'");assert.deepEqual(tracker.deliveryDue('owner',20,true),[]);
});
test('missing provider IDs stay honestly unavailable in historical backfill without reusing old last_view or generating alerts',t=>{
 const {s,tracker,now}=fixture(t);
 s.run('INSERT INTO alimtalk_logs VALUES(?,?,?,?,?,?,?,?,?)','old-log','owner','quote','quote:OLD','010-****-9999','T','accepted','{}',now-1000);
 s.run('INSERT INTO quote_links VALUES(?,?,?,?,?,?)',s.hash('z'.repeat(43)),'owner','OLD',now+86400000,now-1000,now-10);
 assert.equal(tracker.backfill(),1);assert.equal(tracker.backfill(),0);
 const old=tracker.center('owner').documents.find(d=>d.sourceId==='OLD');assert.equal(old.deliveryStatus,'unavailable');assert.equal(old.customer,'');assert.equal(old.amount,null);assert.equal(old.firstOpenedAt,null);assert.equal(tracker.center('owner').notifications.length,0);
});
test('group-only responses discover the uniquely matching recipient, and never choose an unrelated message',async t=>{
 const {tracker,id,input}=fixture(t);tracker.complete(id,{ok:true,result:{groupInfo:{groupId:'G-group-only'}}},'accepted','group-only');
 await tracker.pollDelivery(tracker.row(id),async()=>({messageList:{foreign:{to:'01099999999',groupId:'G-group-only',status:'COMPLETE',statusCode:'4000'},right:{to:input.recipient,groupId:'G-group-only',status:'COMPLETE',statusCode:'4000'}}}));
 assert.equal(tracker.row(id).provider_message_id,'right');assert.equal(tracker.document('owner',id).document.deliveryStatus,'delivered');
});
test('notification reads, preferences and pagination are owner scoped; disabled alerts preserve event history',t=>{
 const {s,tracker,input,id}=fixture(t),record=tracker.row(id);tracker.event(record,'delivered','success',Date.now(),true);
 const nid=tracker.center('owner').notifications[0].id;tracker.readNotifications('other',{ids:[nid]});tracker.readNotifications('other',{all:true});assert.equal(tracker.center('owner').unreadCount,1);
 tracker.updateSettings('owner',{firstOpen:false,mobileNotifications:true});assert.equal(tracker.settings('other').firstOpen,true);assert.equal(tracker.settings('owner').mobileNotifications,true);
 assert.throws(()=>tracker.updateSettings('owner',{userId:'other'}),e=>e.status===400);assert.throws(()=>tracker.updateSettings('owner',{firstOpen:'false'}),e=>e.status===400);
 tracker.readNotifications('owner',{ids:[nid]});assert.equal(tracker.center('owner').unreadCount,0);assert.equal(tracker.center('owner').notifications.length,1);
 tracker.create({...input,token:'b'.repeat(43)});assert.equal(tracker.center('owner',1).hasMore,true);
 assert.equal(s.one('SELECT revision FROM snapshots WHERE user_id=?','owner').revision,7);
});
test('stale pending sends and exhausted delivery horizon show unknown rather than false failure or permanent acceptance',t=>{
 const {s,tracker,input,id,now}=fixture(t);s.run('UPDATE document_outbox SET created=? WHERE id=?',now-600000,id);tracker.recoverPending(now);assert.equal(tracker.document('owner',id).document.deliveryStatus,'unknown');
 const older=tracker.create({...input,token:'o'.repeat(43)},now-8*86400000);tracker.complete(older,accepted,'accepted','old-accept',now-8*86400000);tracker.recoverPending(now);
 assert.equal(tracker.document('owner',older).document.deliveryStatus,'unknown');assert.ok(tracker.document('owner',older).document.providerCheckNotice.includes('7일'));
});
test('known bots, prefetched links and scripted preview user agents are not treated as human opens',()=>{
 for(const headers of [{'user-agent':'facebookexternalhit/1.1'},{'user-agent':'Slackbot'},{'sec-purpose':'prefetch'},{'user-agent':'curl/8.0'}])assert.equal(automatedRequest({headers}),true);
 assert.equal(automatedRequest({headers:{'user-agent':'Mozilla/5.0 Chrome/130.0'}}),false);
});
test('additive migration 9 upgrades an existing database without changing business rows, historic views, or revisions',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-tracking-migration-')),file=path.join(dir,'legacy.sqlite'),key='75'.repeat(32);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let s=createStore(file,key);const now=Date.now(),body=s.seal({data:{quotes:[{id:'old',customer:'기존 고객'}],contracts:[]}});
 s.run('INSERT INTO users(id,profile,consent,created,last_login) VALUES(?,?,?,?,?)','owner',s.seal({businessName:'기존 업체'}),'{}',now,now);
 s.run('INSERT INTO snapshots VALUES(?,?,?,?,?)','owner',42,body,'{}',now);
 s.run('INSERT INTO quote_links VALUES(?,?,?,?,?,?)',s.hash('a'.repeat(43)),'owner','old',now+86400000,now-10000,now-5000);
 for(const table of ['document_events','document_notifications','document_notification_settings','document_open_challenges','document_open_visitors','document_outbox'])s.run('DROP TABLE '+table);
 s.run('DELETE FROM schema_meta WHERE version=9');s.db.close();
 s=createStore(file,key);try{
  assert.equal(s.one('SELECT revision FROM snapshots').revision,42);assert.equal(s.one('SELECT body FROM snapshots').body,body);assert.equal(s.one('SELECT last_view FROM quote_links').last_view,now-5000);assert.ok(s.one('SELECT version FROM schema_meta WHERE version=9'));
  assert.equal(s.one('SELECT COUNT(*) n FROM document_outbox').n,0);assert.equal(s.one('SELECT COUNT(*) n FROM document_notifications').n,0);
 }finally{s.db.close();}
});

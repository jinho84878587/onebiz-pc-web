'use strict';
const crypto=require('node:crypto');
const {check,text,equal}=require('./security');
const failures=require('./solapi-template-inspector');
const KIND_TITLES={quote:'견적서',contract:'계약서',statement:'거래명세서',receipt:'간이영수증'};
const LABELS={pending:'발송 처리 중',accepted:'발송 접수',unknown:'결과 미확인',delivered:'전달 성공',failed:'발송 실패',unavailable:'전달 확인 불가',not_sent:'링크 발행'};
const DEFAULT_SETTINGS=Object.freeze({firstOpen:true,signatureComplete:true,deliveryFailure:true,deliveryComplete:false,mobileNotifications:false});
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const idValue=value=>/^[A-Za-z0-9_-]{1,128}$/.test(String(value||''))?String(value):'';
const timestamp=(value,fallback=0)=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)&&n>0?n:fallback;};
function messageRows(value){return Array.isArray(value)?value.filter(x=>x&&typeof x==='object'):value&&typeof value==='object'?Object.entries(value).map(([id,row])=>({...row,messageId:row?.messageId||id})):[];}
function providerIds(result){
 const data=result?.result||{},rows=messageRows(data.messageList),message=rows.length===1?rows[0]:null;
 return {groupId:idValue(data.groupInfo?.groupId||data.groupId||message?.groupId),messageId:idValue(message?.messageId)};
}
function deliveryResult(message,now=Date.now()){
 const code=String(message?.statusCode||''),state=String(message?.status||'').toUpperCase();
 // The provider documents 2000 as registration and COMPLETE + 4000 as delivery.
 if(state==='COMPLETE'&&code==='4000')return {status:'delivered',code,at:timestamp(message.dateReceived||message.dateReported||message.dateProcessed,now)};
 if(state==='COMPLETE'&&/^\d{4}$/.test(code)&&code!=='2000')return {status:'failed',code,at:timestamp(message.dateReported||message.dateProcessed,now),reason:failures.failureSummary({ok:false,result:{errorCode:code,errorMessage:message.reason||'전달에 실패했습니다.'}}).providerError};
 return {status:'accepted',code,at:now};
}
function automatedRequest(req){
 const purpose=String(req.headers['sec-purpose']||req.headers.purpose||'');
 const ua=String(req.headers['user-agent']||'');
 return /prefetch|preview/i.test(purpose)||/bot\b|spider|crawler|preview|facebookexternalhit|kakaotalk-scrap|headless|curl\/|wget\//i.test(ua);
}
function createTracking(store,origin,options={}){
 const {one,all,run,seal,open,hash}=store;
 function row(id,actor){return actor?one('SELECT * FROM document_outbox WHERE id=? AND user_id=?',id,actor):one('SELECT * FROM document_outbox WHERE id=?',id);}
 function metadata(record){return open(record.body);}
 function settings(actor){const value=one('SELECT body FROM document_notification_settings WHERE user_id=?',actor);return {...DEFAULT_SETTINGS,...(value?open(value.body):{})};}
 function updateSettings(actor,input){
  const next=settings(actor);check(Object.keys(input).every(k=>Object.hasOwn(DEFAULT_SETTINGS,k)),400,'지원하지 않는 알림 설정입니다.');
  for(const [key,value]of Object.entries(input)){check(typeof value==='boolean',400,'알림 설정은 true 또는 false여야 합니다.');next[key]=value;}
  run('INSERT INTO document_notification_settings(user_id,body,updated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body,updated=excluded.updated',actor,seal(next),Date.now());return next;
 }
 function event(record,type,message,at=Date.now(),notify=false){
  run('INSERT OR IGNORE INTO document_events(id,document_id,user_id,type,at,body) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),record.id,record.user_id,type,at,seal({message}));
  if(notify){
   const meta=metadata(record),customer=meta.customer?meta.customer+' 고객의 ':'';
   const title=type==='signed'?'계약 서명 완료':type==='failed'?'문서 발송 실패':type==='delivered'?'문서 전달 성공':type==='original_link_opened'?'원본 링크 열림':'문서 링크 열림';
   // Discovery time is distinct from the provider event's timestamp. A late
   // delivery/signature result must still appear as a newly received alert.
   run('INSERT OR IGNORE INTO document_notifications(id,document_id,user_id,kind,body,created) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),record.id,record.user_id,type,seal({title,body:customer+(meta.title||KIND_TITLES[record.kind])+' · '+message}),Date.now());
  }
 }
 function create(input,now=Date.now()){
  check(KIND_TITLES[input.kind],500,'문서 유형 오류');
  const id=input.id||crypto.randomUUID(),tokenHash=input.token?hash(input.token):(input.tokenHash||null);
  const signedAt=timestamp(input.signedAt);
  const body={title:input.title||KIND_TITLES[input.kind],customer:text(input.customer,120),phoneMask:text(input.phoneMask,40),amount:Number.isFinite(input.amount)?input.amount:null,
   recipientHash:input.recipient?hash('recipient:'+String(input.recipient).replace(/\D/g,'')):'',token:input.token||'',publicKind:input.publicKind||input.kind,
   payload:input.payload||null,legacy:!!input.legacy,metadataNotice:input.metadataNotice||'',failureReason:'',pollError:''};
  run('INSERT OR IGNORE INTO document_outbox(id,user_id,kind,variant,source_id,source_type,body,token_hash,expires,log_id,delivery_status,sent_at,created,updated,signed_at,sign_provider_id,sign_payload_hash,next_sign_poll_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,input.actor,input.kind,input.variant||'document',String(input.sourceId||''),input.sourceType||'quote',seal(body),tokenHash,input.expires||0,input.logId||null,input.status||'pending',input.status==='not_sent'?0:now,now,now,signedAt,input.signProviderId||'',input.signPayloadHash||'',input.signProviderId&&!signedAt?now+30000:0);
  const saved=(tokenHash?one('SELECT * FROM document_outbox WHERE token_hash=?',tokenHash):null)||row(id)||(input.logId?one('SELECT * FROM document_outbox WHERE log_id=?',input.logId):null);
  check(saved&&saved.user_id===input.actor&&saved.kind===input.kind,409,'이미 등록된 문서의 발행 정보를 확인해 주세요.');
  event(saved,'created',input.legacy?'이전 발송 기록 · 당시 문서 내용은 확인할 수 없습니다.':input.status==='not_sent'?'문서 링크를 발행했습니다.':'고객 문서 발송을 요청했습니다.',now);
  if(signedAt)event(saved,'signed','이미 서명이 완료된 계약 원본입니다.',signedAt,false);
  return saved.id;
 }
 function complete(id,result,status,logId,now=Date.now()){
  const record=row(id);if(!record)return;
  const ids=providerIds(result),meta=metadata(record),failure=failures.failureSummary(result);
  meta.failureReason=status==='failed'?failure.providerError:'';
  run('UPDATE document_outbox SET delivery_status=?,provider_group_id=?,provider_message_id=?,body=?,log_id=?,updated=?,failed_at=?,next_poll_at=?,expires=CASE WHEN ? THEN 0 ELSE expires END WHERE id=?',status,ids.groupId,ids.messageId,seal(meta),logId||null,now,status==='failed'?now:0,ids.groupId&&status!=='failed'?now+15000:0,status==='failed'?1:0,id);
  event(record,status,status==='accepted'?'SOLAPI가 발송 요청을 접수했습니다.':status==='failed'?'발송 접수에 실패했습니다. '+meta.failureReason:'발송 결과를 확인하지 못했습니다. 실제 전달 여부를 확인해 주세요.',now,status==='failed');
 }
 function attachLog(id,logId){run('UPDATE document_outbox SET log_id=? WHERE id=?',logId,id);}
 function backfill(limit=500){
  const logs=all("SELECT a.* FROM alimtalk_logs a JOIN users u ON u.id=a.actor LEFT JOIN document_outbox d ON d.log_id=a.id WHERE d.id IS NULL AND a.kind IN ('quote','contractSign','contractDone','statement','receipt') AND a.target_ref<>'manual-test' ORDER BY a.created LIMIT ?",limit);
  for(const log of logs){
   const kind=log.kind==='contractSign'||log.kind==='contractDone'?'contract':log.kind,sourceId=log.target_ref.replace(/^(?:statement|receipt):quote:/,'').replace(/^(?:quote|contract):/,'');
   const id=create({actor:log.actor,kind,variant:log.kind==='contractSign'?'sign_request':log.kind==='contractDone'?'completed':'document',sourceId,sourceType:kind==='contract'?'contract':'quote',phoneMask:log.phone_mask,legacy:true,logId:log.id,status:log.status==='failed'?'failed':'unavailable'},log.created);
   const saved=row(id);event(saved,'legacy','이전 발송은 제공사 메시지 식별자가 없어 전달 결과를 조회할 수 없습니다.',log.created);
  }
  return logs.length;
 }
 function previewUrl(record,meta){
  if(!meta.token||record.expires<=Date.now())return null;
  const route=meta.publicKind==='sign'?'s':meta.publicKind;
  return origin+'/'+route+'/'+meta.token+'?preview='+hash('document-preview:'+record.id+':'+record.token_hash);
 }
 function isOwnerPreview(record,actor,proof){return actor===record.user_id||!!(proof&&equal(String(proof),hash('document-preview:'+record.id+':'+record.token_hash)));}
 function formatDocument(r){
  const meta=metadata(r);
  return {id:r.id,versionId:r.id,kind:r.kind,variant:r.variant,sourceId:r.source_id,sourceType:r.source_type,title:meta.title,customer:meta.customer,phoneMask:meta.phoneMask,amount:meta.amount,sentAt:r.sent_at||null,createdAt:r.created,lastEventAt:r.updated,deliveryStatus:r.delivery_status,deliveryLabel:LABELS[r.delivery_status]||LABELS.unknown,deliveredAt:r.delivered_at||null,failedAt:r.failed_at||null,failureReason:meta.failureReason||'',providerCheckNotice:meta.pollError||'',deliveryCheckAvailable:!!r.provider_group_id,firstOpenedAt:r.first_opened_at||null,lastOpenedAt:r.last_opened_at||null,openCount:r.open_count,signLinkOpenedAt:r.sign_link_opened_at||null,signLinkOpenCount:r.sign_link_open_count,originalLinkOpenedAt:r.original_link_opened_at||null,originalLinkOpenCount:r.original_link_open_count,signedAt:r.signed_at||null,canRetry:false,previewUrl:previewUrl(r,meta),immutableOriginal:!!meta.payload,legacy:!!meta.legacy,metadataNotice:meta.metadataNotice,events:all('SELECT type,at,body FROM document_events WHERE document_id=? AND user_id=? ORDER BY at,type',r.id,r.user_id).map(e=>({type:e.type,at:e.at,...open(e.body)}))};
 }
 function document(actor,id){const found=row(id,actor);check(found,404,'내 발송 문서에서 찾을 수 없습니다.');return {ok:true,userId:actor,document:formatDocument(found)};}
 function center(actor,limit=50){
  limit=Math.max(1,Math.min(100,Math.floor(Number(limit)||50)));
  const records=all('SELECT * FROM document_outbox WHERE user_id=? ORDER BY created DESC,id DESC LIMIT ?',actor,limit+1);
  const documents=records.slice(0,limit).map(formatDocument);
  const notifications=all('SELECT * FROM document_notifications WHERE user_id=? ORDER BY (read_at=0) DESC,created DESC,id DESC LIMIT ?',actor,limit+1);
  return {ok:true,userId:actor,documents,notifications:notifications.slice(0,limit).map(n=>({id:n.id,documentId:n.document_id,kind:n.kind,...open(n.body),createdAt:n.created,readAt:n.read_at||null})),unreadCount:one('SELECT COUNT(*) n FROM document_notifications WHERE user_id=? AND read_at=0',actor).n,settings:settings(actor),capabilities:{providerDelivery:!!options.providerConfigured,instantPush:false,ownerAlimtalk:false},hasMore:records.length>limit,hasMoreNotifications:notifications.length>limit,refreshedAt:Date.now()};
 }
 function readNotifications(actor,input,now=Date.now()){
  if(input.all===true)run('UPDATE document_notifications SET read_at=? WHERE user_id=? AND read_at=0',now,actor);
  else{check(Array.isArray(input.ids)&&input.ids.length<=100&&input.ids.every(x=>typeof x==='string'&&x.length<=100),400,'알림 목록을 확인해 주세요.');for(const id of input.ids)run('UPDATE document_notifications SET read_at=? WHERE id=? AND user_id=? AND read_at=0',now,id,actor);}
  return one('SELECT COUNT(*) n FROM document_notifications WHERE user_id=? AND read_at=0',actor).n;
 }
 function byToken(token){return TOKEN.test(token)?one('SELECT * FROM document_outbox WHERE token_hash=?',hash(token)):null;}
 function challenge(record,visitor,mode,now=Date.now()){
  if(mode!=='customer')return {ok:true,challenge:null,expiresAt:null,mode,tracked:false,title:metadata(record).title};
  const token=crypto.randomBytes(32).toString('base64url'),expires=now+300000;
  run('INSERT INTO document_open_challenges(hash,document_id,token_hash,visitor_hash,mode,created,expires) VALUES(?,?,?,?,?,?,?)',hash(token),record.id,record.token_hash,hash(visitor),mode,now,expires);
  return {ok:true,challenge:token,expiresAt:expires,mode,tracked:true,title:metadata(record).title};
 }
 function opened(record,visitor,challengeToken,mode,action='opened',now=Date.now()){
  if(mode!=='customer')return {ok:true,recorded:false,reason:mode};
  return store.tx(()=>{
   const c=TOKEN.test(String(challengeToken||''))?one('SELECT * FROM document_open_challenges WHERE hash=?',hash(challengeToken)):null;
   check(c&&c.document_id===record.id&&c.token_hash===record.token_hash&&c.visitor_hash===hash(visitor)&&c.expires>now,400,'문서 열기 확인이 만료되었습니다. 새로고침해 주세요.');
   const summary=()=>{const r=row(record.id);return {firstOpenedAt:r.first_opened_at||null,lastOpenedAt:r.last_opened_at||null,openCount:r.open_count,signLinkOpenedAt:r.sign_link_opened_at||null,originalLinkOpenedAt:r.original_link_opened_at||null};};
   if(c.used_at)return {ok:true,recorded:false,reason:'already_used',...summary()};
   run('UPDATE document_open_challenges SET used_at=? WHERE hash=?',now,c.hash);
   const previous=one('SELECT last_at FROM document_open_visitors WHERE document_id=? AND visitor_hash=? AND action=?',record.id,c.visitor_hash,action);
   if(previous&&now-previous.last_at<1800000)return {ok:true,recorded:false,reason:'duplicate',...summary()};
   run('INSERT INTO document_open_visitors(document_id,visitor_hash,action,last_at) VALUES(?,?,?,?) ON CONFLICT(document_id,visitor_hash,action) DO UPDATE SET last_at=excluded.last_at',record.id,c.visitor_hash,action,now);
   if(action==='sign_link_opened')run('UPDATE document_outbox SET sign_link_opened_at=?,sign_link_open_count=sign_link_open_count+1,updated=? WHERE id=?',now,now,record.id);
   else if(action==='original_link_opened')run('UPDATE document_outbox SET original_link_opened_at=?,original_link_open_count=original_link_open_count+1,updated=? WHERE id=?',now,now,record.id);
   else run('UPDATE document_outbox SET first_opened_at=CASE WHEN first_opened_at=0 THEN ? ELSE first_opened_at END,last_opened_at=?,open_count=open_count+1,updated=? WHERE id=?',now,now,now,record.id);
   event(record,action,action==='sign_link_opened'?'서명 페이지로 이동했습니다.':action==='original_link_opened'?'원본 링크를 열었습니다.':'문서 열기 버튼을 눌렀습니다. 고객 본인 확인을 의미하지 않습니다.',now,action!=='sign_link_opened');
   return {ok:true,recorded:true,reason:action,...summary()};
  });
 }
 function signed(actor,contractId,providerId,payloadHash,signedAt,now=Date.now()){
  const at=timestamp(signedAt,now),records=all('SELECT * FROM document_outbox WHERE user_id=? AND source_id=? AND kind=? AND signed_at=0 AND sign_provider_id=? AND sign_payload_hash=?',actor,String(contractId),'contract',providerId,payloadHash);
  store.tx(()=>{for(const r of records){run('UPDATE document_outbox SET signed_at=?,updated=?,next_sign_poll_at=0 WHERE id=? AND signed_at=0',at,now,r.id);event(r,'signed','고객의 계약 서명 완료를 확인하고 원본을 보관했습니다.',at,true);}});
  return records.length;
 }
 async function pollDelivery(record,fetchGroup,now=Date.now()){
  const meta=metadata(record);run('UPDATE document_outbox SET last_polled_at=?,poll_attempts=poll_attempts+1,next_poll_at=? WHERE id=?',now,now+Math.min(3600000,30000*2**Math.min(7,record.poll_attempts)),record.id);
  try{
   const result=await fetchGroup(record.provider_group_id),rows=messageRows(result?.messageList);
   if(one('SELECT status FROM users WHERE id=?',record.user_id)?.status!=='active')return;
   const matches=rows.filter(m=>(!m.groupId||m.groupId===record.provider_group_id)&&(record.provider_message_id?m.messageId===record.provider_message_id:meta.recipientHash&&hash('recipient:'+String(m.to||'').replace(/\D/g,''))===meta.recipientHash));
   check(matches.length===1,502,'제공사 메시지를 정확히 식별할 수 없습니다.');
   const message=matches[0],outcome=deliveryResult(message,Date.now()),latest=row(record.id);if(!latest||['delivered','failed'].includes(latest.delivery_status))return;
   const currentMeta=metadata(latest);currentMeta.pollError='';if(outcome.status==='failed')currentMeta.failureReason=outcome.reason;
   store.tx(()=>{
    run('UPDATE document_outbox SET provider_message_id=?,provider_status_code=?,delivery_status=?,delivered_at=?,failed_at=?,updated=?,body=?,next_poll_at=CASE WHEN ? THEN 0 ELSE next_poll_at END WHERE id=?',idValue(message.messageId)||record.provider_message_id,outcome.code,outcome.status,outcome.status==='delivered'?outcome.at:0,outcome.status==='failed'?outcome.at:0,Date.now(),seal(currentMeta),['delivered','failed'].includes(outcome.status)?1:0,record.id);
    if(outcome.status==='delivered')event(latest,'delivered','SOLAPI가 전달 성공을 보고했습니다. 메시지 읽음 여부와는 다릅니다.',outcome.at,true);
    if(outcome.status==='failed')event(latest,'failed','전달 실패 · '+outcome.reason,outcome.at,true);
   });
  }catch(error){const latest=row(record.id);if(latest){const current=metadata(latest);current.pollError='전달 결과 조회가 지연되고 있습니다.';run('UPDATE document_outbox SET body=? WHERE id=?',seal(current),record.id);}}
 }
 function deliveryDue(actor,limit=10,force=false,now=Date.now()){
  return all("SELECT d.* FROM document_outbox d JOIN users u ON u.id=d.user_id WHERE u.status='active' AND d.provider_group_id<>'' AND d.delivery_status IN ('accepted','unknown','pending') AND d.created>? AND d.last_polled_at<? AND (?='' OR d.user_id=?) AND (?=1 OR d.next_poll_at<=?) ORDER BY d.next_poll_at,d.created LIMIT ?",now-7*86400000,now-30000,actor||'',actor||'',force?1:0,now,limit);
 }
 function signatureDue(actor,limit=3,force=false,now=Date.now()){
  return all("SELECT d.* FROM document_outbox d JOIN users u ON u.id=d.user_id WHERE u.status='active' AND d.variant='sign_request' AND d.sign_provider_id<>'' AND d.signed_at=0 AND d.delivery_status<>'failed' AND d.created>? AND d.last_sign_polled_at<? AND (?='' OR d.user_id=?) AND d.next_sign_poll_at>0 AND (?=1 OR d.next_sign_poll_at<=?) ORDER BY d.next_sign_poll_at,d.created LIMIT ?",now-30*86400000,now-60000,actor||'',actor||'',force?1:0,now,limit);
 }
 function signatureAttempt(record,now=Date.now()){run('UPDATE document_outbox SET last_sign_polled_at=?,sign_poll_attempts=sign_poll_attempts+1,next_sign_poll_at=? WHERE id=?',now,now+Math.min(3600000,60000*2**Math.min(6,record.sign_poll_attempts)),record.id);}
 function recoverPending(now=Date.now()){
  run("UPDATE document_outbox SET delivery_status='unknown',updated=? WHERE delivery_status='pending' AND created<?",now,now-300000);
  const old=all("SELECT * FROM document_outbox WHERE delivery_status IN ('accepted','unknown') AND provider_group_id<>'' AND created<? AND next_poll_at>0",now-7*86400000);
  for(const record of old){const meta=metadata(record);meta.pollError='7일 동안 최종 전달 결과를 확인하지 못해 자동 조회를 종료했습니다. SOLAPI 발송내역을 확인해 주세요.';run("UPDATE document_outbox SET delivery_status='unknown',next_poll_at=0,updated=?,body=? WHERE id=?",now,seal(meta),record.id);event(record,'unknown',meta.pollError,now);}
 }
 return {create,row,metadata,settings,updateSettings,event,complete,attachLog,backfill,center,document,readNotifications,byToken,isOwnerPreview,challenge,opened,signed,pollDelivery,deliveryDue,signatureDue,signatureAttempt,recoverPending};
}
module.exports={createTracking,providerIds,deliveryResult,automatedRequest,DEFAULT_SETTINGS,TOKEN};

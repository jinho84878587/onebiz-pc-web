'use strict';
const {check}=require('./security');

// Keep issued documents independent of later quote/profile edits. The archive is
// encrypted with the same application key as business data, never a public JSON file.
function archive(store,link,kind,payload,capturedAt=Date.now(),legacy=false){
 const document={...payload,archive:{version:1,capturedAt,originalAtIssue:!legacy,
  ...(legacy?{notice:'이 문서는 이전 버전에서 발행되어 최초 발행 당시 원본을 확인할 수 없습니다. 아래 내용은 '+new Date(capturedAt+9*3600000).toISOString().slice(0,10)+' 확인 시점에 보관한 내용입니다. 정확한 발행 원본은 발행자에게 확인해 주세요.'}:{})}};
 store.run('INSERT OR IGNORE INTO payment_document_archives(token_hash,user_id,kind,body,created,expires) VALUES(?,?,?,?,?,?)',link.token_hash,link.user_id,kind,store.seal(document),capturedAt,link.expires);
 return store.open(store.one('SELECT body FROM payment_document_archives WHERE token_hash=?',link.token_hash).body);
}
function read(store,link,kind,legacyPayload){
 check(link,404,'발행 문서를 찾을 수 없습니다.');
 check(link.expires>Date.now(),410,'문서 링크가 만료되었습니다.');
 const saved=store.one('SELECT user_id,kind,body FROM payment_document_archives WHERE token_hash=?',link.token_hash);
 if(saved){check(saved.user_id===link.user_id&&saved.kind===kind,500,'문서 보관 정보가 일치하지 않습니다.');return store.open(saved.body);}
 // Old releases never stored issuance snapshots. Do not label reconstructed
 // contents as the original: freeze them once and show the limitation in the UI.
 return archive(store,link,kind,legacyPayload(),Date.now(),true);
}

// Durable reservations prevent two requests (or two processes sharing SQLite)
// from both reaching the external provider. Unknown outcomes retain their link
// and the existing ten-minute resend cooldown, because a timeout is not a rejection.
function reserve(store,actor,kind,targetRef,now=Date.now()){
 const key=store.hash(JSON.stringify([actor,kind,targetRef]));
 store.tx(()=>{
  const old=store.one('SELECT status,updated FROM document_send_reservations WHERE reservation_key=?',key);
  if(old&&old.status==='pending'&&now-old.updated<600000)check(false,429,'이 문서의 발송을 처리 중이거나 결과를 확인 중입니다. 발송 내역을 먼저 확인해 주세요. 재요청은 10분 후 가능합니다.');
  check(!old||old.status==='failed'||now-old.updated>=600000,429,'같은 견적서의 재발송은 10분 후 가능합니다.');
  const previous=store.one("SELECT created FROM alimtalk_logs WHERE actor=? AND kind=? AND target_ref=? AND status IN ('accepted','unknown') ORDER BY created DESC LIMIT 1",actor,kind,targetRef);
  check(!previous||now-previous.created>=600000,429,'같은 견적서의 재발송은 10분 후 가능합니다.');
  store.run('INSERT OR REPLACE INTO document_send_reservations(reservation_key,actor,kind,target_ref,status,created,updated) VALUES(?,?,?,?,?,?,?)',key,actor,kind,targetRef,'pending',now,now);
 });
 return key;
}
function finish(store,key,status,now=Date.now()){
 check(['accepted','failed','unknown'].includes(status),500,'Invalid document dispatch outcome');
 store.run('UPDATE document_send_reservations SET status=?,updated=? WHERE reservation_key=?',status,now,key);
}
function outcome(result){
 if(result?.ok)return 'accepted';
 const counts=result?.result?.groupInfo?.count,failed=result?.result?.failedMessageList;
 if(Number(counts?.registeredSuccess)===0&&(Number(counts?.registeredFailed)===1||(Array.isArray(failed)&&failed.length===1)))return 'failed';
 if(result?.status>=400&&result.status<500&&result.status!==408)return 'failed';
 return 'unknown';
}
module.exports={archive,read,reserve,finish,outcome};

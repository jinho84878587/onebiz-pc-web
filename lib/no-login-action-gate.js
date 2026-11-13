'use strict';

/**
 * Fail-closed, single-attempt bridge for account-free document actions.
 * Does not authorize an owner, provide an HTTP endpoint, or call an external
 * provider by itself. Never accept arbitrary client-supplied document payloads.
 */
const {tokenHash}=require('./no-login-grants');
const ACTIONS=new Set(['alimtalk.send','sign.request']);
const FINGERPRINT=/^[a-f0-9]{64}$/;
function createActionGate(store,registry,loadDocument,dispatch) {
  if(!store?.db||!store?.one||!store?.run||!store?.tx||
     typeof registry?.consume!=='function'||typeof registry?.current!=='function'||
     typeof loadDocument!=='function'||typeof dispatch!=='function')
    throw new TypeError('Trusted store, registry, loader and dispatcher are required');
  store.db.exec("CREATE TABLE IF NOT EXISTS no_login_action_attempts ("+
    "token_hash TEXT PRIMARY KEY,document_id TEXT NOT NULL,scope TEXT NOT NULL,"+
    "fingerprint TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','accepted','failed','unknown')),"+
    "created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);"+
    "CREATE INDEX IF NOT EXISTS no_login_action_attempts_document ON no_login_action_attempts(document_id,created_at);");

  function status(token) {
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
    const row=store.one('SELECT state,document_id,scope,created_at,updated_at FROM no_login_action_attempts WHERE token_hash=?',tokenHash(token));
    return row?{state:row.state,documentId:row.document_id,scope:row.scope,updatedAt:row.updated_at}:null;
  }
  async function execute({documentId,token,scope,now=Date.now()}) {
    if(!ACTIONS.has(scope)||!Number.isSafeInteger(now)||now<0||
       typeof documentId!=='string'||typeof token!=='string')
      return {ok:false,code:'invalid_request'};
    const current=registry.current(documentId);
    if(!current||!FINGERPRINT.test(current.fingerprint||'')||current.frozen_at!=null)
      return {ok:false,code:'unavailable'};
    // Document content must be loaded from a trusted server-side store.
    const trusted=loadDocument(documentId);
    if(!trusted||trusted.fingerprint!==current.fingerprint)
      return {ok:false,code:'document_changed'};
    // Claims the one-time grant atomically. A crash never triggers automatic retry.
    if(!registry.consume({documentId,token,scope,now}))
      return {ok:false,code:'not_authorized'};
    const key=tokenHash(token);
    store.run("INSERT INTO no_login_action_attempts "+
      "(token_hash,document_id,scope,fingerprint,state,created_at,updated_at) "+
      "VALUES(?,?,?,?,'reserved',?,?)",
      key,documentId,scope,current.fingerprint,now,now);
    const latest=registry.current(documentId);
    if(!latest||latest.fingerprint!==current.fingerprint||latest.frozen_at!=null) {
      store.run("UPDATE no_login_action_attempts SET state='failed',updated_at=? WHERE token_hash=?",Date.now(),key);
      return {ok:false,code:'document_changed'};
    }
    let state='unknown';
    try {
      // Provider adapter must enforce approved templates, recipient, usage caps
      // and provider idempotency. Unknown acceptance must not cause a resend.
      const result=await dispatch({documentId,scope,fingerprint:current.fingerprint,
        document:trusted.document,attemptId:key});
      if(result&&['accepted','failed','unknown'].includes(result.state))state=result.state;
    }catch(_){state='unknown';}
    store.run('UPDATE no_login_action_attempts SET state=?,updated_at=? WHERE token_hash=?',state,Date.now(),key);
    return {ok:state==='accepted',state,attemptId:key};
  }
  return {execute,status};
}
module.exports={createActionGate};

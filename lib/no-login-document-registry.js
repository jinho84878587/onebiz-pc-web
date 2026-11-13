'use strict';
// Separate, account-free ownership proof for a single document.
// Does not issue an app login session or send paid messages.
const crypto = require('node:crypto');
const {createGrantStore} = require('./no-login-grants-store');
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const FP_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PRIVILEGED_ACTIONS = new Set(['alimtalk.send','sign.request']);
const SCOPES = new Set(['document.read','document.export','sign.request','sign.status','alimtalk.send','alimtalk.status']);
function isSecret(value) { return typeof value==='string' && SECRET_RE.test(value) && Buffer.from(value,'base64url').length===32; }
function isFingerprint(value) { return typeof value==='string' && FP_RE.test(value); }
function secretHash(value) {
  if (!isSecret(value)) throw new TypeError('Invalid secret');
  return crypto.createHash('sha256').update(value).digest('hex');
}
function matchesSecret(given,expected) {
  if (!/^[a-f0-9]{64}$/.test(given||'') || !/^[a-f0-9]{64}$/.test(expected||'')) return false;
  return crypto.timingSafeEqual(Buffer.from(given,'hex'),Buffer.from(expected,'hex'));
}
function validNow(now) {return Number.isSafeInteger(now)&&now>=0;}
function createDocumentRegistry(store) {
  if (!store || typeof store.tx!=='function' || typeof store.run!=='function' ||
      typeof store.one!=='function' || !store.db) throw new TypeError('Store required');
  store.db.exec(
    'CREATE TABLE IF NOT EXISTS no_login_documents ('+
    'document_id TEXT PRIMARY KEY,owner_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,'+
    'created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,frozen_at INTEGER,revoked_at INTEGER)'
  );
  function row(documentId) {
    return typeof documentId==='string' && UUID_RE.test(documentId) ?
      store.one('SELECT * FROM no_login_documents WHERE document_id=?',documentId):null;
  }
  function current(documentId) {
    const r=row(documentId);
    return r && r.revoked_at==null?r:null;
  }
  function ownerCheck(documentId,ownerSecret,fingerprint=null) {
    const r=current(documentId);
    return !!(r && isSecret(ownerSecret) &&
      matchesSecret(secretHash(ownerSecret),r.owner_hash) &&
      (fingerprint===null||fingerprint===r.fingerprint));
  }
  function register({secret,fingerprint,now=Date.now()}) {
    if(!isSecret(secret)||!isFingerprint(fingerprint)||!validNow(now))
      throw new TypeError('Invalid registration');
    const documentId=crypto.randomUUID();
    store.run('INSERT INTO no_login_documents(document_id,owner_hash,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?)',
      documentId,secretHash(secret),fingerprint,now,now);
    return {documentId,fingerprint};
  }
  function authorizeIssue(args) {
    if (args.action==='revoke') return ownerCheck(args.documentId,args.ownerSecret);
    const r=current(args.documentId);
    if(!r||!ownerCheck(args.documentId,args.ownerSecret,args.fingerprint))return false;
    return !PRIVILEGED_ACTIONS.has(args.scope) || r.frozen_at==null;
  }
  const grants=createGrantStore(store,authorizeIssue);
  function issue({documentId,ownerSecret,scope,now=Date.now(),ttlMs=300000}) {
    if(!SCOPES.has(scope)||!validNow(now))throw new TypeError('Invalid capability request');
    const r=current(documentId);
    if(!r||!ownerCheck(documentId,ownerSecret,r.fingerprint))
      throw new Error('Document owner verification failed');
    if(PRIVILEGED_ACTIONS.has(scope)&&r.frozen_at!=null)
      throw new Error('Signed document is immutable');
    return grants.issue({documentId,ownerSecret,scope,fingerprint:r.fingerprint,ttlMs,now});
  }
  function validate({documentId,token,scope,now=Date.now()}) {
    const r=current(documentId);
    return !!(r&&SCOPES.has(scope)&&validNow(now)&&
      grants.validate({documentId,token,scope,fingerprint:r.fingerprint,now}));
  }
  function consume({documentId,token,scope,now=Date.now()}) {
    const r=current(documentId);
    if(!r||!PRIVILEGED_ACTIONS.has(scope)||r.frozen_at!=null||!validNow(now))return false;
    return grants.consume({documentId,token,scope,fingerprint:r.fingerprint,now});
  }
  function rotate({documentId,secret,expectedFingerprint,nextFingerprint,now=Date.now()}) {
    if(!isFingerprint(expectedFingerprint)||!isFingerprint(nextFingerprint)||!validNow(now))return false;
    return store.tx(()=>{
      const r=current(documentId);
      if(!r||r.frozen_at!=null||!ownerCheck(documentId,secret,expectedFingerprint))return false;
      const result=store.run('UPDATE no_login_documents SET fingerprint=?,updated_at=? WHERE document_id=? AND fingerprint=? AND frozen_at IS NULL AND revoked_at IS NULL',
        nextFingerprint,now,documentId,expectedFingerprint);
      if(result.changes!==1)return false;
      store.run('UPDATE no_login_document_grants SET revoked_at=? WHERE document_id=? AND revoked_at IS NULL',now,documentId);
      return true;
    });
  }
  function freezeByVerifiedProvider({documentId,expectedFingerprint,now=Date.now()}) {
    // Only trusted server-side signing verification may invoke this.
    if(!validNow(now)||!isFingerprint(expectedFingerprint))return false;
    return store.run('UPDATE no_login_documents SET frozen_at=? WHERE document_id=? AND fingerprint=? AND frozen_at IS NULL AND revoked_at IS NULL',
      now,documentId,expectedFingerprint).changes===1;
  }
  function revokeDocument({documentId,secret,now=Date.now()}) {
    if(!validNow(now))return false;
    return store.tx(()=>{
      if(!ownerCheck(documentId,secret))return false;
      const result=store.run('UPDATE no_login_documents SET revoked_at=? WHERE document_id=? AND revoked_at IS NULL',now,documentId);
      if(result.changes!==1)return false;
      store.run('UPDATE no_login_document_grants SET revoked_at=? WHERE document_id=? AND revoked_at IS NULL',now,documentId);
      return true;
    });
  }
  function revokeGrant({documentId,ownerSecret,token}) {
    return grants.revoke({documentId,ownerSecret,token});
  }
  return {register,current,ownerCheck,issue,validate,consume,rotate,freezeByVerifiedProvider,revokeDocument,revokeGrant};
}
module.exports={createDocumentRegistry,isSecret,secretHash};

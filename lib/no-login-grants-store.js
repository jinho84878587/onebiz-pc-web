'use strict';
// Backend-only durable bearer grants, intended for signed-document actions.
// Does not create HTTP endpoints or bypass ownership checks. A validated
// document ownership proof must be checked by the caller BEFORE issue().
const {issueGrant, verifyGrant, tokenHash} = require('./no-login-grants');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

function createGrantStore(store, authorizeIssue) {
  if (!store || typeof store.run !== 'function' || typeof store.one !== 'function' ||
      typeof store.tx !== 'function' || typeof authorizeIssue !== 'function') {
    throw new TypeError('Database and ownership authorization callback are required');
  }
  store.db.exec(`CREATE TABLE IF NOT EXISTS no_login_document_grants (
    token_hash TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    one_time INTEGER NOT NULL CHECK(one_time IN (0,1)),
    consumed_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS no_login_document_grants_expiry
    ON no_login_document_grants(expires_at);`);

  function issue(args) {
    // Authorization is mandatory and must not be called from an unauthenticated
    // HTTP handler that allows arbitrary document IDs. `true` alone is only a
    // contract for the integration layer, not evidence of ownership.
    if (authorizeIssue(args) !== true) throw new Error('Document authorization failed');
    const grant = issueGrant(args);
    store.run(`INSERT INTO no_login_document_grants
      (token_hash,document_id,scope,fingerprint,expires_at,one_time,consumed_at,revoked_at,created_at)
      VALUES(?,?,?,?,?,?,NULL,NULL,?)`,
      grant.record.token_hash,grant.record.document_id,grant.record.scope,
      grant.record.fingerprint,grant.record.expires_at,grant.record.one_time,
      args.now === undefined ? Date.now() : args.now);
    return {token:grant.token,expiresAt:grant.record.expires_at};
  }

  function getValidRecord(args) {
    if (!TOKEN_RE.test(args.token || '') || !FINGERPRINT_RE.test(args.fingerprint || '')) return null;
    const record=store.one('SELECT * FROM no_login_document_grants WHERE token_hash=?',tokenHash(args.token));
    if (!record || record.revoked_at != null) return null;
    return verifyGrant({...args,record})?record:null;
  }

  function validate(args) { return !!getValidRecord(args); }

  // For external side effects, the one-time action must be claimed atomically.
  // A refused, spent or expired grant is *not* retried automatically.
  function consume(args) {
    if (!TOKEN_RE.test(args.token || '') || !FINGERPRINT_RE.test(args.fingerprint || '')) return false;
    const now=args.now===undefined?Date.now():args.now;
    if (!Number.isSafeInteger(now) || now < 0) return false;
    return store.tx(() => {
      const record=getValidRecord({...args,now});
      if (!record || record.one_time !== 1) return false;
      const result=store.run(`UPDATE no_login_document_grants SET consumed_at=?
        WHERE token_hash=? AND document_id=? AND scope=? AND fingerprint=?
          AND one_time=1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?`,
        now,record.token_hash,args.documentId,args.scope,args.fingerprint,now);
      return result.changes === 1;
    });
  }

  function revoke(args) {
    if (!TOKEN_RE.test(args.token || '')) return false;
    if (authorizeIssue({...args,action:'revoke'}) !== true) return false;
    return store.run('UPDATE no_login_document_grants SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL',
      Date.now(),tokenHash(args.token)).changes === 1;
  }

  return {issue, validate, consume, revoke};
}
module.exports={createGrantStore};

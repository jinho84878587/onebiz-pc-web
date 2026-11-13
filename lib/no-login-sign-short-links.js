'use strict';
// Tokenized short links for account-free WebSign contracts.
// Issuance MUST follow ownership verification or a consumed action grant.
const crypto = require('node:crypto');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const FP = /^[a-f0-9]{64}$/;
const TTL = 30*86400000;
function createGuestSignShortLinks(store, registry, websign, origin) {
  if (!store?.db || !store?.one || !store?.run || !store?.seal || !store?.open || !store?.hash ||
      typeof registry?.ownerCheck !== 'function' || typeof registry?.current !== 'function' ||
      typeof websign?.verifyUrl !== 'function') throw new TypeError('Trusted dependencies required');
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash || base.pathname !== '/') throw new TypeError('Invalid public origin');
  store.db.exec("CREATE TABLE IF NOT EXISTS no_login_sign_short_links ("+
    "document_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, token_sealed TEXT NOT NULL,"+
    "fingerprint TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)");
  function compatible(documentId, fingerprint, now) {
    if (typeof documentId !== 'string' || !FP.test(fingerprint || '')) return false;
    const doc=registry.current(documentId);
    if (!doc || doc.fingerprint !== fingerprint || doc.frozen_at != null) return false;
    const source=store.one('SELECT fingerprint,expires_at FROM no_login_document_payloads WHERE document_id=?',documentId);
    if (!source || source.fingerprint !== fingerprint || source.expires_at <= now) return false;
    const sign=store.one('SELECT fingerprint,sign_url FROM no_login_websign_links WHERE document_id=?',documentId);
    if (!sign || sign.fingerprint !== fingerprint) return false;
    try {websign.verifyUrl(store.open(sign.sign_url));} catch {return false;}
    return true;
  }
  function make({documentId,fingerprint,now=Date.now(),ownerSecret}={}) {
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - TTL)
      throw new RangeError('Invalid time');
    if (ownerSecret !== undefined && !registry.ownerCheck(documentId,ownerSecret,fingerprint))
      throw new Error('Document owner verification failed');
    if (!compatible(documentId,fingerprint,now)) throw new Error('Document or signing link unavailable');
    const existing=store.one('SELECT * FROM no_login_sign_short_links WHERE document_id=?',documentId);
    if (existing?.fingerprint === fingerprint && existing.expires_at > now) {
      const token=store.open(existing.token_sealed);
      if (TOKEN.test(token) && store.hash(token) === existing.token_hash) {
        return {url:base.origin+'/s/'+token,token,expiresAt:existing.expires_at};
      }
    }
    const token=crypto.randomBytes(32).toString('base64url');
    const expiresAt=Math.min(now+TTL,store.one('SELECT expires_at FROM no_login_document_payloads WHERE document_id=?',documentId).expires_at);
    const url=base.origin+'/s/'+token;
    if (Buffer.byteLength(url,'utf8')>100) throw new Error('Short link exceeds 100 bytes');
    store.run("INSERT OR REPLACE INTO no_login_sign_short_links "+
      "(document_id,token_hash,token_sealed,fingerprint,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      documentId,store.hash(token),store.seal(token),fingerprint,expiresAt,now);
    return {url,token,expiresAt};
  }
  function makeForOwner({documentId,ownerSecret,now=Date.now()}={}) {
    const doc=registry.current(documentId);
    if (!doc || !registry.ownerCheck(documentId,ownerSecret,doc.fingerprint))
      throw new Error('Document owner verification failed');
    return make({documentId,fingerprint:doc.fingerprint,ownerSecret,now});
  }
  // Internal use only, after one-time send grant has been consumed.
  function makeForAction({documentId,fingerprint,now=Date.now()}={}) {
    return make({documentId,fingerprint,now});
  }
  function has(token) {
    return TOKEN.test(token||'') && !!store.one('SELECT document_id FROM no_login_sign_short_links WHERE token_hash=?',store.hash(token));
  }
  function resolve(token,now=Date.now()) {
    if (!TOKEN.test(token||'') || !Number.isSafeInteger(now) || now<0) return null;
    const link=store.one('SELECT * FROM no_login_sign_short_links WHERE token_hash=?',store.hash(token));
    if (!link || link.expires_at<=now || !compatible(link.document_id,link.fingerprint,now)) return null;
    const sign=store.one('SELECT sign_url,fingerprint FROM no_login_websign_links WHERE document_id=?',link.document_id);
    if (!sign || sign.fingerprint!==link.fingerprint) return null;
    return websign.verifyUrl(store.open(sign.sign_url));
  }
  return {makeForOwner,makeForAction,has,resolve};
}
module.exports={createGuestSignShortLinks};

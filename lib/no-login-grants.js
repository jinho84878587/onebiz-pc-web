'use strict';

// A narrow building block for account-free document workflows. It is not a
// stand-alone authentication or anti-abuse system and does not send messages.
const crypto = require('node:crypto');

const SCOPES = Object.freeze([
  'document.read',
  'document.export',
  'sign.request',
  'sign.status',
  'alimtalk.send',
  'alimtalk.status'
]);
const ALLOWED = new Set(SCOPES);
const ACTIONS = new Set(['sign.request', 'alimtalk.send']);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;
const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const ACTION_MAX_TTL_MS = 10 * 60 * 1000;

function tokenHash(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function isValidDocumentId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 150 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id);
}

function issueGrant({documentId, scope, fingerprint, ttlMs, now = Date.now()}) {
  if (!isValidDocumentId(documentId)) throw new TypeError('Invalid documentId');
  if (!ALLOWED.has(scope)) throw new TypeError('Unsupported grant scope');
  if (!FINGERPRINT_RE.test(fingerprint || '')) throw new TypeError('Invalid document fingerprint');
  const maxTtl = ACTIONS.has(scope) ? ACTION_MAX_TTL_MS : MAX_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > maxTtl) {
    throw new RangeError('Grant lifetime is out of bounds');
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - ttlMs) {
    throw new RangeError('Invalid issue time');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    record: {
      token_hash: tokenHash(token),
      document_id: documentId,
      scope,
      fingerprint,
      expires_at: now + ttlMs,
      one_time: ACTIONS.has(scope) ? 1 : 0,
      consumed_at: null
    }
  };
}

function verifyGrant({token, record, documentId, scope, fingerprint, now = Date.now()}) {
  if (!TOKEN_RE.test(token || '') || !record || !isValidDocumentId(documentId) || !ALLOWED.has(scope)) {
    return false;
  }
  if (!FINGERPRINT_RE.test(fingerprint || '') || !FINGERPRINT_RE.test(record.token_hash || '')) {
    return false;
  }
  const actual = Buffer.from(tokenHash(token), 'hex');
  const expected = Buffer.from(record.token_hash, 'hex');
  if (!crypto.timingSafeEqual(actual, expected)) return false;
  if (record.document_id !== documentId || record.scope !== scope || record.fingerprint !== fingerprint) {
    return false;
  }
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(record.expires_at) || now >= record.expires_at) {
    return false;
  }
  if (record.one_time && record.consumed_at != null) return false;
  return true;
}

// For one-time actions, callers MUST perform an atomic UPDATE that succeeds
// only when consumed_at IS NULL and expires_at > now, before side effects.
// A read-then-write check is unsafe when concurrent requests race.
module.exports = {SCOPES, tokenHash, issueGrant, verifyGrant};

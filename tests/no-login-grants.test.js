'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {SCOPES, issueGrant, verifyGrant, tokenHash} = require('../lib/no-login-grants');
const now = 1_800_000_000_000;
const fingerprint = 'c'.repeat(64);
const otherFingerprint = 'd'.repeat(64);
function grant(scope = 'alimtalk.send', ttlMs = 60_000) {
  return issueGrant({documentId:'contract-001',scope,fingerprint,ttlMs,now});
}
test('scope enum includes messaging and signing but no admin wildcard', () => {
  assert.ok(SCOPES.includes('sign.request'));
  assert.ok(SCOPES.includes('alimtalk.send'));
  assert.equal(SCOPES.includes('admin'),false);
});
test('issue creates a random 256-bit opaque token and stores only its hash', () => {
  const a = grant(), b = grant();
  assert.equal(a.token.length,43);
  assert.notEqual(a.token,b.token);
  assert.equal(tokenHash(a.token),a.record.token_hash);
  assert.equal(Object.values(a.record).includes(a.token),false);
  assert.equal(a.record.one_time,1);
});
test('token works for its own document, scope, and content only', () => {
  const a = grant();
  assert.equal(verifyGrant({...a,documentId:'contract-001',scope:'alimtalk.send',fingerprint,now}),true);
  assert.equal(verifyGrant({...a,documentId:'contract-002',scope:'alimtalk.send',fingerprint,now}),false);
  assert.equal(verifyGrant({...a,documentId:'contract-001',scope:'sign.request',fingerprint,now}),false);
  assert.equal(verifyGrant({...a,documentId:'contract-001',scope:'alimtalk.send',fingerprint:otherFingerprint,now}),false);
});
test('cannot use an action grant after expiry or consumption', () => {
  const a = grant();
  assert.equal(verifyGrant({...a,documentId:'contract-001',scope:'alimtalk.send',fingerprint,now:now+60_000}),false);
  a.record.consumed_at=now+1;
  assert.equal(verifyGrant({...a,documentId:'contract-001',scope:'alimtalk.send',fingerprint,now:now+1}),false);
});
test('read grants are reusable but scoped and expire', () => {
  const a=grant('document.read',365*86400000);
  assert.equal(a.record.one_time,0);
  assert.equal(verifyGrant({...a,documentId:'contract-001',scope:'document.read',fingerprint,now:now+50}),true);
  assert.equal(verifyGrant({...a,documentId:'contract-001',scope:'document.read',fingerprint,now:now+365*86400000}),false);
});
test('wrong secrets and invalid parameters are rejected', () => {
  const a=grant();
  assert.equal(verifyGrant({...a,token:grant().token,documentId:'contract-001',scope:'alimtalk.send',fingerprint,now}),false);
  assert.throws(()=>issueGrant({documentId:'x',scope:'admin',fingerprint,ttlMs:100,now}),TypeError);
  assert.throws(()=>issueGrant({documentId:'x',scope:'alimtalk.send',fingerprint,ttlMs:11*60_000,now}),RangeError);
  assert.throws(()=>issueGrant({documentId:'x',scope:'sign.request',fingerprint:'x',ttlMs:100,now}),TypeError);
  assert.equal(verifyGrant({token:'bogus',record:a.record,documentId:'contract-001',scope:'alimtalk.send',fingerprint,now}),false);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createDocumentRegistry}=require('../lib/no-login-document-registry');
const {createGuestDocumentVault}=require('../lib/no-login-document-vault');
const {createGuestSignShortLinks}=require('../lib/no-login-sign-short-links');
const now=1800000000000;
function fixture(){
 const db=new DatabaseSync(':memory:'),key=crypto.randomBytes(32);
 const seal=v=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),d=Buffer.concat([c.update(JSON.stringify(v)),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),d.toString('base64')].join('.')};
 const open=s=>{const [iv,tag,data]=s.split('.'),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString());};
 const store={db,seal,open,hash:v=>crypto.createHmac('sha256',key).update(v).digest('hex'),one:(q,...a)=>db.prepare(q).get(...a),run:(q,...a)=>db.prepare(q).run(...a),tx(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const registry=createDocumentRegistry(store),vault=createGuestDocumentVault(store,registry),ownerSecret=crypto.randomBytes(32).toString('base64url');
 const doc=vault.save({ownerSecret,contract:{supplierName:'하이원시스템',customer:'테스트',phone:'01012345678',item:'에어컨',amount:4900000},consent:true,now});
 const signUrl='https://hiwon-websign-server.onrender.com/sign/ob-'+'a'.repeat(40)+'?token=123456';
 db.exec('CREATE TABLE no_login_websign_links(document_id TEXT PRIMARY KEY, fingerprint TEXT, sign_url TEXT)');
 store.run('INSERT INTO no_login_websign_links VALUES(?,?,?)',doc.documentId,doc.fingerprint,seal(signUrl));
 const origin='https://onebiz-pc-web.onrender.com';
 const websign={verifyUrl:s=>{if(s!==signUrl)throw Error('Unexpected URL');return s;}};
 const short=createGuestSignShortLinks(store,registry,websign,origin);
 return {db,store,registry,ownerSecret,doc,signUrl,short,origin};
}
test('creates 43-character tokenized URL within approved 100-byte limit',()=>{
 const f=fixture(),link=f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:f.ownerSecret,now});
 assert.match(link.url,/^https:\/\/onebiz-pc-web\.onrender\.com\/s\/[A-Za-z0-9_-]{43}$/);
 assert.ok(Buffer.byteLength(link.url)<=100);assert.equal(f.short.resolve(link.token,now),f.signUrl);
 const row=f.store.one('SELECT * FROM no_login_sign_short_links');
 assert.equal(JSON.stringify(row).includes(link.token),false);assert.equal(JSON.stringify(row).includes(f.signUrl),false);
 f.db.close();
});
test('reissues same URL for same document and fingerprint',()=>{
 const f=fixture(),first=f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:f.ownerSecret,now});
 assert.equal(first.token,f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:f.ownerSecret,now:now+1000}).token);
 assert.equal(f.store.one('SELECT COUNT(*) n FROM no_login_sign_short_links').n,1);f.db.close();
});
test('only correct document owner may create a link',()=>{
 const f=fixture();assert.throws(()=>f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:crypto.randomBytes(32).toString('base64url'),now}),/owner/);f.db.close();
});
test('expired and fake tokens never resolve',()=>{
 const f=fixture(),link=f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:f.ownerSecret,now});
 assert.equal(f.short.resolve(link.token,link.expiresAt),null);
 assert.equal(f.short.resolve(crypto.randomBytes(32).toString('base64url'),now),null);f.db.close();
});
test('modified contract revokes previous short URL',()=>{
 const f=fixture(),link=f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:f.ownerSecret,now});
 assert.equal(f.registry.rotate({documentId:f.doc.documentId,secret:f.ownerSecret,expectedFingerprint:f.doc.fingerprint,nextFingerprint:'a'.repeat(64),now:now+1}),true);
 assert.equal(f.short.resolve(link.token,now+2),null);f.db.close();
});
test('signed contract cannot reuse prior request URL',()=>{
 const f=fixture(),link=f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:f.ownerSecret,now});
 assert.equal(f.registry.freezeByVerifiedProvider({documentId:f.doc.documentId,expectedFingerprint:f.doc.fingerprint,now:now+1}),true);
 assert.equal(f.short.resolve(link.token,now+2),null);f.db.close();
});
test('untrusted WebSign destination is never shortened',()=>{
 const f=fixture();
 f.store.run('UPDATE no_login_websign_links SET sign_url=? WHERE document_id=?',f.store.seal('https://bad.example/redirect'),f.doc.documentId);
 assert.throws(()=>f.short.makeForOwner({documentId:f.doc.documentId,ownerSecret:f.ownerSecret,now}),/unavailable/);f.db.close();
});

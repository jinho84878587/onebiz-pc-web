'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto');
function createStore(file,keyHex){
 if(!/^[a-f0-9]{64}$/i.test(keyHex)) throw Error('DATA_KEY_HEX must be 64 hex characters.');
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const db=new DatabaseSync(file); try{fs.chmodSync(file,0o600);}catch{}
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'active',profile TEXT NOT NULL,profile_rev INTEGER DEFAULT 0,complete INTEGER DEFAULT 0,consent TEXT NOT NULL,created INTEGER NOT NULL,last_login INTEGER NOT NULL,subscription TEXT DEFAULT 'free');
 CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,subject_hash TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),UNIQUE(provider,subject_hash));
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,actor TEXT NOT NULL,kind TEXT NOT NULL,role TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,totp TEXT,role TEXT NOT NULL,last_step INTEGER DEFAULT -1);
 CREATE TABLE IF NOT EXISTS otp(id TEXT PRIMARY KEY,phone TEXT NOT NULL,phone_hash TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER DEFAULT 0,used INTEGER DEFAULT 0,consent TEXT NOT NULL,link_user TEXT);
 CREATE TABLE IF NOT EXISTS rates(k TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS oauth(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,binding TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,consent TEXT NOT NULL,link_user TEXT);
 CREATE TABLE IF NOT EXISTS snapshots(user_id TEXT PRIMARY KEY REFERENCES users(id),revision INTEGER NOT NULL,body TEXT NOT NULL,counts TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,challenge TEXT NOT NULL,user_id TEXT,phrase TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS dispatch(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,target TEXT NOT NULL,starts INTEGER NOT NULL,ends INTEGER NOT NULL,important INTEGER DEFAULT 0,active INTEGER DEFAULT 1,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO schema_meta VALUES(2);`);
 const key=Buffer.from(keyHex,'hex');
 const hash=v=>crypto.createHmac('sha256',key).update(String(v)).digest('hex');
 function seal(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),data.toString('base64')].join('.');}
 function open(value){const parts=value.split('.');if(parts.length!==3||parts.some(s=>Buffer.from(s,'base64').toString('base64')!==s))throw Error('Invalid encrypted record');const [a,b,c]=parts;if(Buffer.from(a,'base64').length!==12||Buffer.from(b,'base64').length!==16)throw Error('Invalid encryption header');const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(a,'base64'));d.setAuthTag(Buffer.from(b,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(c,'base64')),d.final()]).toString('utf8'));}
 const one=(sql,...v)=>db.prepare(sql).get(...v);const all=(sql,...v)=>db.prepare(sql).all(...v);const run=(sql,...v)=>db.prepare(sql).run(...v);
 function tx(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}
 function log(actor,action,target='',detail={}){run('INSERT INTO audit(actor,action,target,detail,at) VALUES(?,?,?,?,?)',actor,action,target,JSON.stringify(detail),Date.now());}
 function rate(k,limit,ms){const now=Date.now(),h=hash(k);return tx(()=>{const row=one('SELECT * FROM rates WHERE k=?',h);if(!row||row.expires<=now){run('INSERT OR REPLACE INTO rates VALUES(?,?,?)',h,1,now+ms);return true;}if(row.n>=limit)return false;run('UPDATE rates SET n=n+1 WHERE k=?',h);return true;});}
 // Never recover corrupted databases by replacing them with an empty store.
 return {db,one,all,run,tx,log,rate,hash,seal,open};
}
module.exports={createStore};

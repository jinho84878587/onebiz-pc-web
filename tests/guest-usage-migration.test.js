'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createStore}=require('../lib/store');
test('existing guest counters migrate to test group without modifying counts or member records',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-guest-migrate-'));
 const file=path.join(dir,'legacy.sqlite'),secret='ed'.repeat(32),db=new DatabaseSync(file);
 try {
  db.exec('CREATE TABLE guest_usage_counters(device_hash TEXT PRIMARY KEY, counts TEXT NOT NULL, updated INTEGER NOT NULL)');
  const old={customers:2,quotes:3,contracts:1,signed:0,employees:0},stamp=Date.now();
  db.prepare('INSERT INTO guest_usage_counters VALUES(?,?,?)').run('legacy-device',JSON.stringify(old),stamp);
  db.close();
  const upgraded=createStore(file,secret);
  try{
   assert.equal(upgraded.one("SELECT channel FROM guest_usage_counters WHERE device_hash='legacy-device'").channel,'test');
   assert.equal(upgraded.one("SELECT counts FROM guest_usage_counters WHERE device_hash='legacy-device'").counts,JSON.stringify(old));
   assert.equal(upgraded.one("SELECT COUNT(*) n FROM users").n,0);
   const integrity=upgraded.db.prepare('PRAGMA integrity_check').get();
   assert.equal(integrity.integrity_check,'ok');
  } finally {upgraded.db.close();}
 }finally{try{db.close()}catch{}fs.rmSync(dir,{recursive:true,force:true});}
});

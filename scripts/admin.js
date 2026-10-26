'use strict';
const crypto=require('node:crypto'),path=require('node:path');const {createStore}=require('../lib/store');const {passwordHash}=require('../lib/security');
const env=process.env;const username=(env.ADMIN_USERNAME||'').trim().toLowerCase(),password=env.ADMIN_PASSWORD||'',role=env.ADMIN_ROLE||'owner';
if(!username||password.length<14||!['owner','operator','viewer'].includes(role)){
 console.error('ADMIN_USERNAME, 14자 이상 ADMIN_PASSWORD, DATA_KEY_HEX를 환경변수로 설정하세요. ADMIN_ROLE=owner|operator|viewer');process.exit(1);
}
const s=createStore(env.DATA_FILE||path.join(__dirname,'..','data','onebiz.sqlite'),env.DATA_KEY_HEX),salt=crypto.randomBytes(16).toString('hex');
if(s.one('SELECT id FROM admins WHERE username=?',username)){console.error('이미 존재하는 관리자입니다. 기존 계정을 덮어쓰지 않았습니다.');process.exit(1);}
s.run('INSERT INTO admins(id,username,salt,password,totp,role) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),username,salt,passwordHash(password,salt),null,role);
s.log('bootstrap','admin.create',username,{role});s.db.close();console.log('관리자를 생성했습니다. 비밀번호는 안전하게 보관하고 다른 서비스에서 재사용하지 마세요.');

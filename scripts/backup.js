'use strict';
const fs=require('node:fs'),path=require('node:path');const {createStore}=require('../lib/store');
const source=process.env.DATA_FILE||path.join(__dirname,'..','data','onebiz.sqlite');
if(!fs.existsSync(source))throw Error('백업할 DB 파일이 없습니다.');
const s=createStore(source,process.env.DATA_KEY_HEX),dest=path.resolve(process.env.BACKUP_DIR||path.join(__dirname,'..','backups'));
fs.mkdirSync(dest,{recursive:true,mode:0o700});const file=path.join(dest,'onebiz-'+Date.now()+'.sqlite');
s.db.exec("VACUUM INTO '"+file.replace(/'/g,"''")+"'");fs.chmodSync(file,0o600);s.db.close();console.log('백업 완료: '+file+'\nDATA_KEY_HEX는 별도 안전한 장소에서 보존해야 복원할 수 있습니다.');

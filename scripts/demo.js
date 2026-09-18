'use strict';
const crypto=require('node:crypto'),path=require('node:path'),cp=require('node:child_process');
const {createStore}=require('../lib/store');const {passwordHash}=require('../lib/security');
const file=path.join(__dirname,'..','.demo','demo.sqlite'),key='11'.repeat(32),s=createStore(file,key);
let pass=process.env.DEMO_ADMIN_PASSWORD||crypto.randomBytes(10).toString('base64url');
const username='demo-admin',salt=crypto.randomBytes(16).toString('hex'),id='DEMO-ADMIN';
s.run('INSERT OR REPLACE INTO admins(id,username,salt,password,totp,role) VALUES(?,?,?,?,?,?)',id,username,salt,passwordHash(pass,salt),null,'owner');
s.run("DELETE FROM sessions WHERE kind='admin'");
if(s.one('SELECT COUNT(*) n FROM users').n===0){
 const uid=crypto.randomUUID(),now=Date.now(),profile={profileType:'BUSINESS',representative:'예시 사용자',businessName:'테스트 설치점',registrationNo:'0000000000',phone:'01000000000',address:'예시시 예시구 (가상 데이터)'};
 s.run('INSERT INTO users(id,profile,complete,consent,created,last_login) VALUES(?,?,?,?,?,?)',uid,s.seal(profile),1,JSON.stringify({demo:true}),now,now);
 s.run('INSERT INTO identities VALUES(?,?,?)','phone',s.hash('phone:01000000000'),uid);
 s.run('INSERT INTO snapshots VALUES(?,?,?,?,?)',uid,1,s.seal({data:{customers:[{name:'가상 고객',phone:'01000000000',address:'예시 주소'}],quotes:[],contracts:[]},employees:[]}),JSON.stringify({customers:1,quotes:0,contracts:0,signed:0,employees:0}),now);
 s.run('INSERT INTO dispatch(id,user_id,body,status,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),uid,s.seal({equipment:'사다리차',date:new Date(now+86400000).toISOString().slice(0,10),address:'예시시 예시구 가상현장',phone:'01000000000',goods:'가상 자재',floor:'3',minutes:30}),'접수대기',now);
 s.run('INSERT INTO notices VALUES(?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),'원비즈 통합회원 테스트 안내','이것은 데모 공지입니다. 실고객 정보를 입력하지 마세요.','all',now-60000,now+30*86400000,1,1,now);
}
s.db.close();
const port=process.env.PORT||'10000',origin='http://127.0.0.1:'+port;
console.log('\n[LOCAL DEMO ONLY]\n사용자: '+origin+'\n관리센터: '+origin+'/admin\n관리자 아이디: '+username+'\n이번 실행의 관리자 비밀번호: '+pass+'\n데모 2단계 인증: 비워두기\n휴대폰 인증: 화면에 개발용 코드 표시 / 문자 미발송\n실제 개인정보를 넣지 마세요.\n');
const child=cp.spawn(process.execPath,[path.join(__dirname,'..','server.js')],{stdio:'inherit',env:{...process.env,APP_MODE:'demo',DATA_FILE:file,DATA_KEY_HEX:key,PUBLIC_ORIGIN:origin,PORT:port}});
if(process.env.OPEN_BROWSER==='1')setTimeout(()=>{const args=process.platform==='win32'?['cmd',['/c','start','',origin]]:process.platform==='darwin'?['open',[origin]]:['xdg-open',[origin]];cp.spawn(...args,{stdio:'ignore'}).on('error',()=>{});},1500);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code||0));

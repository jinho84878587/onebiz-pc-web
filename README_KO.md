# 시험서버 실행·연결 가이드

## 1. 로컬 데모 — 비용/외부 서비스 없이

Node.js **22.16 이상 22.x**를 사용합니다. 이 패키지는 Node 내장 SQLite를 사용합니다. 외부 npm 런타임 의존성은 없습니다.

Windows에서 `cloud-v2/START_DEMO.bat`을 더블클릭하거나 터미널에서:

```sh
cd cloud-v2
npm run demo
```

콘솔에 사용자 URL과 `/admin` URL, 데모 관리자 아이디 `demo-admin`, **실행 때 생성되는 무작위 비밀번호**가 출력됩니다. 데모에서는 관리자 TOTP 칸을 비워둡니다. 127.0.0.1에서만 실행합니다. 네트워크 공개용으로 바꾸지 마세요.

휴대폰 인증번호는 문자로 보내지 않고 화면에 개발용으로 표시합니다. 가짜 테스트 번호만 입력하세요. 소셜 로그인을 흉내 낸 성공 버튼은 제공하지 않습니다. 키가 없으면 설정 전 표시입니다.

`.demo/demo.sqlite`는 데모 데이터 전용이며 알려진 개발용 암호화 키를 사용합니다. 실개인정보를 보관하면 안 됩니다. 운영 서버는 이 파일이나 개발용 설정을 사용하지 마세요.

## 2. 새 HTTPS 시험서버

기존 ONEBIZ 서버를 교체하지 말고 새로운 별도 시험서비스를 만드세요. `cloud-v2/render.yaml`은 신규 저장소의 최상위가 `cloud-v2` 내용인 경우의 예시입니다. 전체 통합 저장소로 올리면 Root Directory를 `cloud-v2`로 설정하는 등 실제 저장소 구조를 맞춰야 합니다.

이 작업에서는 유료 서비스 생성·배포를 실행하지 않았습니다. Render 유료 디스크/플랜 비용은 생성 전에 콘솔에서 확인하세요.

- Node 22.16 이상 22.x
- Build command: `npm ci --ignore-scripts`
- Start command: `node server.js`
- Health check: `/health`
- `APP_MODE=production` — 실제 외부 접근 시험은 데모 모드가 아님
- `PUBLIC_ORIGIN=https://실제-시험서버-주소` — 끝 `/`와 경로 없음
- `DATA_FILE=/var/data/onebiz.sqlite` — 영구 디스크 필요
- `DATA_KEY_HEX` — 다음으로 새 32바이트 키 생성, 서버 환경변수로만 저장

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

이 키를 잃으면 암호화된 사용자 데이터·연동 식별자를 읽을 수 없습니다. DB와 별도로 안전하게 백업하세요. 운영 중 키 변경은 별도 데이터 마이그레이션 없이는 불가합니다. 비밀값을 이 채팅, 저장소, 앱 BuildConfig에 넣지 마세요.

- `POLICIES_APPROVED=true`는 **실제 서비스 약관/개인정보 문서를 먼저 확정·교체한 다음에만** 설정합니다. `public/terms.html`, `privacy.html`은 초안입니다. 오류를 없애려는 목적만으로 true로 바꾸지 마세요.
- `TRUST_PROXY=0` 기본은 보수적 설정입니다. 실제 프록시 체인에서 IP 헤더를 어떻게 덮어쓰는지 검증한 다음 조정합니다.
- 단일 인스턴스 SQLite 모델입니다. 여러 서버가 각각 로컬 DB를 가지는 오토스케일 구성으로 사용하지 마세요. 다중 서버 운영 전 PostgreSQL 등 별도 DB 전환과 성능 검증이 필요합니다.

프로덕션 HTTPS 쿠키·리디렉션·CSRF 동작을 실제 URL에서 검증해야 합니다. 현재 로컬 API 테스트만으로 대신할 수 없습니다.

## 3. 문자 인증 연결 (Naver Cloud SENS 어댑터)

서버 환경변수: `NCP_SERVICE_ID`, `NCP_ACCESS_KEY`, `NCP_SECRET_KEY`, `NCP_SENDER`.

발신번호 등록 및 발송 권한/잔액/과금 설정은 서비스 콘솔에서 준비합니다. `SMS_DAILY_LIMIT=100`은 기본 전역 발송요청 제한입니다. 실제 발송 성공과 사용자 수신은 다를 수 있으므로 시험번호로 전달 여부·지연·오류를 검증하세요.

SMS는 전화번호 소유 확인용입니다. PASS/CI/DI 기반 실명 본인확인이나 계약 당사자 신원확인을 구현한 것이 아닙니다.

인증번호 유효시간 5분, 최대 입력 5회, 재사용 금지, 60초 재전송 제한, 번호/IP/전체 요청 제한을 적용했습니다. SMS 폭주·전화번호 재사용·계정복구 정책에 대한 추가 운영 검증도 필요합니다.

## 4. 소셜 로그인 연결

| 제공자 | 환경변수 | 등록할 callback 경로 |
|---|---|---|
| 카카오 | KAKAO_CLIENT_ID, KAKAO_CLIENT_SECRET | /auth/callback/kakao |
| 네이버 | NAVER_CLIENT_ID, NAVER_CLIENT_SECRET | /auth/callback/naver |
| Google | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | /auth/callback/google |

각 callback은 `PUBLIC_ORIGIN + 경로`의 **완전한 HTTPS 주소**로 제공자 콘솔에 등록합니다. 앱 사용 설정, 테스트 사용자/검수 조건, 동의항목, 도메인 등록을 실제 제공자 콘솔에서 확인하세요.

현재 코드는 서버에서 인가코드를 교환합니다. Google은 PKCE/nonce 및 ID토큰 서명·발급자·대상·만료 검증을 포함합니다. Naver/Kakao는 서버 토큰 교환 뒤 해당 토큰으로 회원 식별자를 조회합니다. 이메일이나 이름만으로 계정을 찾거나 합치지 않습니다.

Android는 외부 브라우저 인증 후 앱 화면의 요청 숫자를 비교하고 승인하는 방식입니다. 이 개발본은 카카오톡 자동 간편로그인 SDK나 Android용 Google 네이티브 로그인 SDK를 별도로 넣지 않았습니다.

공식 참고문서 (2026-09-18 구현 참고):
- Kakao: https://developers.kakao.com/docs/ko/kakaologin/rest-api
- Naver: https://developers.naver.com/docs/login/api/api.md
- Google: https://developers.google.com/identity/openid-connect/openid-connect
- NCP SENS: https://api.ncloud-docs.com/docs/ko/ai-application-service-sens-smsv2

## 5. 관리자 생성

인터넷에 열린 관리자 회원가입은 없습니다. 신뢰할 수 있는 서버 터미널에서 환경변수를 설정해 실행합니다.

```sh
npm run admin:create
```

필수 환경변수는 `ADMIN_USERNAME`, 14자 이상 `ADMIN_PASSWORD`, 32자 이상 Base32 `ADMIN_TOTP_SECRET`, `ADMIN_ROLE=owner`, 그리고 서버와 같은 `DATA_FILE`, `DATA_KEY_HEX`입니다. TOTP 시크릿은 인증 앱으로 안전하게 등록합니다. 데모 계정은 운영 계정이 아닙니다.

권한은 owner / operator / viewer로 나눕니다. 운영에서는 TOTP가 필수이며 사용한 TOTP를 재사용할 수 없습니다. 생성용 비밀번호·시크릿 환경변수는 계정 생성 후 제거하세요. 관리자가 잠긴 경우의 조직 내부 복구 절차도 정해야 합니다.

## 6. Android 연결

`android/local.properties`에는 SDK 경로와 다음 공개 서버주소만 추가합니다.

```properties
ONEBIZ_CLOUD_V2_URL=https://실제-시험서버-주소
```

앱에 운영 관리자 비밀번호, 문자·소셜 client secret, DATA_KEY_HEX를 넣으면 안 됩니다. `ONEBIZ_SYNC_KEY`는 이전 별도 연동의 흔적이며 통합회원 V2 인증에 사용하지 않습니다. 새 시험 연동에는 채우지 마세요.

Android Studio에서 debug로 빌드하면 `com.hiwon.mvp.authdev`로 별도 설치합니다. Play 앱과 데이터가 분리됩니다. Android SDK 36·AGP 8.9.1·Gradle 8.11.1 설정이 있으나 **실제 빌드/기기 테스트는 여기서 하지 못했습니다.**

앱 → 간편인증 시작 → 브라우저에서 가입/프로필 등록 → 화면의 연결 숫자 비교/승인 → 앱으로 복귀 → 서버에서 가져오기 → 앱 사용 순으로 검증합니다. 자동 실시간 동기화는 아닙니다.

## 7. 백업/복원

`DATA_FILE`, `DATA_KEY_HEX`가 설정된 환경에서 `npm run backup`을 실행합니다. 결과 파일은 권한 제한된 별도 저장소에 옮기고 키는 다른 안전한 장소에 보관합니다. 새 시험서버에서 복원 및 복호화·자료 수를 대조하는 훈련 후 운영 전환하세요. 라이브 SQLite WAL 파일 하나만 복사해 백업했다고 처리하지 마세요.

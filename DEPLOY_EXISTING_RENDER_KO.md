# ONEBIZ 4.5.18 — 기존 Render onebiz-pc-web 배포 준비

대상 서비스
- Render workspace: Hiwon
- 서비스: onebiz-pc-web
- URL: https://onebiz-pc-web.onrender.com
- GitHub: jinho84878587/onebiz-pc-web / main
- Runtime: Docker
- 영구 디스크: 1GB, /var/data

## 안전 원칙

1. 현재 Google Play 검토 중인 Android 4.5.16은 변경하지 않습니다.
2. 기존 V1 데이터 파일을 덮어쓰지 않습니다.
3. V2 시험 데이터는 `/var/data/onebiz-v2-staging.sqlite`를 사용합니다.
4. `DATA_KEY_HEX`, 소셜 client secret, SMS secret, 관리자 비밀번호/TOTP는 GitHub에 넣지 않습니다.
5. 실제 약관/개인정보처리방침 확정 전에는 `POLICIES_APPROVED=true`로 바꾸지 않습니다.

## GitHub 반영

이 ZIP의 내용이 `onebiz-pc-web` 저장소 루트가 되도록 업로드합니다.
Render는 main 커밋 자동배포가 켜져 있으므로 커밋 후 자동 배포됩니다.

## 배포 전에 Render Environment에 필요한 값

공개값:
- APP_MODE=production
- PUBLIC_ORIGIN=https://onebiz-pc-web.onrender.com
- DATA_FILE=/var/data/onebiz-v2-staging.sqlite
- TRUST_PROXY=0
- SMS_DAILY_LIMIT=100

비밀값(저장소에 넣지 않음):
- DATA_KEY_HEX=64자리 hex(32 bytes)
- KAKAO_CLIENT_ID / KAKAO_CLIENT_SECRET
- NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
- NCP_SERVICE_ID / NCP_ACCESS_KEY / NCP_SECRET_KEY / NCP_SENDER

정책 확인 후에만:
- POLICIES_APPROVED=true

## 관리자

관리자 웹은 같은 서비스의 `/admin` 경로입니다.
운영 관리자 계정은 `npm run admin:create`로 생성하며 owner/operator/viewer 권한을 구분합니다.
기존 `onebiz-admin-center`는 새 통합관리센터 검증이 끝날 때까지 그대로 유지합니다.

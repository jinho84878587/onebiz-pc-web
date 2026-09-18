# ONEBIZ PC · 모바일 웹 V1

ONEBIZ Android 앱과 같은 고객·견적·계약·대금·직원 데이터를 PC 브라우저와 모바일 브라우저에서 사용할 수 있도록 만든 1차 통합 웹 버전입니다.

## 포함 기능

- 반응형 PC / 태블릿 / 모바일 웹 UI
- 회원 ID + 6자리 연결 PIN 로그인
- 대시보드
- 고객 등록·수정·삭제
- 견적서 작성·수정·삭제·A4 인쇄
- 견적 → 계약 전환
- 계약서 작성·수정
- 대금 / 미수금 / 입금 관리
- 직원 기본정보·급여 관리
- 사업자 정보 관리
- Android ↔ 웹 JSON 스냅샷 동기화 API
- 웹에서 수정 시 서버 자동 저장

## 중요한 버전 구분

- Google Play 검토 중인 현재 버전: ONEBIZ 4.5.16 / versionCode 32
- PC 웹 동기화가 추가된 Android 개발본: ONEBIZ 4.5.17 / versionCode 33

4.5.16 검토에는 영향을 주지 않도록 4.5.17을 별도 개발본으로 구성했습니다.

## 로컬 실행

Node.js 20 이상이 필요합니다.

```bash
ONEBIZ_DEVICE_KEY=my-secret-device-key \
ONEBIZ_TOKEN_SECRET=my-long-random-secret \
PORT=10000 \
node server.js
```

브라우저에서 `http://localhost:10000` 접속.

## Render 배포

이 폴더의 `render.yaml`을 사용하거나 새 Web Service를 만들 수 있습니다.

필수 환경변수:

- `ONEBIZ_DEVICE_KEY`: Android 앱의 `ONEBIZ_CLOUD_KEY`와 동일한 긴 임의 문자열
- `ONEBIZ_TOKEN_SECRET`: 웹 로그인 토큰 서명용 긴 임의 문자열
- `ONEBIZ_DATA_FILE`: 기본값을 쓰거나 `/var/data/onebiz-cloud.json`

데이터 유지를 위해 Render Persistent Disk 또는 운영용 DB 사용을 권장합니다. `render.yaml`은 1GB `/var/data` 디스크를 사용하는 예시입니다.

## Android 4.5.17 개발본 연결

Android 프로젝트 `local.properties`에 다음 값을 추가합니다.

```properties
ONEBIZ_CLOUD_BASE_URL=https://배포한-주소.onrender.com
ONEBIZ_CLOUD_KEY=Render의_ONEBIZ_DEVICE_KEY와_동일한_값
```

앱에서:

1. 더보기 → `PC · 모바일 웹 연동`
2. `PC로 보내기`
3. 화면의 `회원 ID`와 `6자리 PIN` 확인
4. PC 웹 로그인
5. PC에서 수정 후 앱에서 `PC에서 가져오기`

## 데이터 동기화 방식 V1

V1은 충돌을 피하기 위해 명시적 동기화 방식입니다.

- 앱 → 웹: `PC로 보내기`
- 웹 → 앱: `PC에서 가져오기`
- 웹 내부 수정: 즉시 서버 저장

향후 V2에서는 로그인 계정 기반 실시간 양방향 동기화와 PostgreSQL/Supabase 같은 운영 DB를 적용하는 것을 권장합니다.

## 보안

- 웹 로그인 PIN은 서버에 평문으로 저장하지 않고 scrypt 해시로 저장합니다.
- 웹 세션은 HMAC 서명 토큰을 사용합니다.
- Android 기기 동기화 API는 `X-Onebiz-Key` 인증을 사용합니다.
- 운영 전에는 반드시 HTTPS, 강한 `ONEBIZ_DEVICE_KEY`, 강한 `ONEBIZ_TOKEN_SECRET`을 사용하세요.

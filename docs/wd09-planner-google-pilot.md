# 기존 설계사허브 Google 회원가입 검수

이 브랜치는 현재 설계사허브와 SARA_INSURANCE에 Google 회원가입을 추가하는 검수본입니다. 대표님과 형민님은 기존 사번 로그인과 프로젝트를 계속 사용합니다. 신규 가입자마다 SARA_INSURANCE 안에 별도의 설계사 ID가 생기며, Google Drive는 가입한 계정으로 연결합니다.

## 연결 순서

1. 실제 서비스 프로젝트에서 변경하기 전에 `20261113130000_wd09_planner_onboarding.sql`의 적용을 확인받습니다. 이 변경안은 기존 프로젝트에 사용자별 정책을 추가합니다. 기존 고객 데이터는 이동하지 않습니다. 기존 상담 제약 조건은 대표님 코드와 새 설계사 코드 형식을 허용합니다. 예전 빈 DB용 마이그레이션과 함께 적용하지 않습니다.
2. Google Cloud의 설계사허브 웹 OAuth 클라이언트에 SARA_INSURANCE의 `/auth/v1/callback` 주소를 등록하고, 해당 프로젝트 Auth에서 Google 공급자를 설정합니다. 비밀키는 Google Cloud와 Supabase 설정 화면에서 다룹니다. Supabase의 Redirect URLs에는 `https://admin.wdwave.kr/wd-insurance-hub-simple-test.html?wd09_google=1`을 등록합니다.
3. 처음 검수할 Google 이메일은 기존 사번 로그인과 연결되지 않은 주소를 사용합니다. 두 개의 신규 검수 계정에서 서로의 고객·상담·첨부파일을 조회하거나 수정할 수 없는지 확인합니다. 기존 사번 계정도 로그인과 저장을 재검수합니다.
4. Google OAuth와 신규 계정 정책 확인 후 HTML의 `pilotEnabled`를 켭니다. 신규 계정에서 Google 가입 → 본인 Drive 승인 → 보험폴더 생성 → 파일 저장 및 재조회까지 확인합니다.

# 설계사허브 Google 회원가입 TEST

신규 설계사는 로그인 화면에서 **Google로 회원가입 · 로그인**을 누릅니다. 확인된 Google 계정으로 최초 접속하면 설계사 계정이 생성됩니다. 재접속 시 같은 계정을 사용합니다. Drive는 허브에 로그인한 Google 계정을 선택하고 권한을 허용합니다.

## TEST 환경 연결

1. 신규 가입 전용 Supabase 프로젝트를 준비하고, `supabase/migrations/20261113130000_wd09_planner_onboarding.sql`을 적용합니다. 기존 보험 프로젝트에는 적용하지 않습니다.
2. Google Cloud에 이 프로젝트의 Supabase 콜백 주소를 등록하고 Supabase에서 Google Auth 공급자와 신규 가입을 활성화합니다. Supabase Redirect URLs에 실제 TEST 사이트의 설계사허브 주소와 쿼리 `?wd09_google=1`을 추가합니다. Drive용 Google OAuth 웹 클라이언트에는 실제 TEST 사이트의 HTTPS origin을 등록합니다. Google 앱이 테스트 모드라면 검수 계정을 Google Cloud 테스트 사용자에 등록합니다.
3. HTML의 `googleConfig`에 별도 TEST 프로젝트 URL과 publishable key를 설정하고 CSP `connect-src`에 그 origin을 추가합니다.

## 확인할 동작

- 로그아웃 상태에서 보험사 연락처, 보험메모장, 코드관리 버튼이 보이지 않습니다.
- 서로 다른 두 Google 계정에서 초대 없이 가입합니다. 같은 계정으로 재로그인하면 동일한 설계사 ID를 돌려받습니다.
- 각 계정에서 자기 고객자료와 파일을 저장하고 재조회합니다. 상대 계정의 데이터 및 파일에 접근할 수 없어야 합니다.
- 다른 Google 계정의 Drive를 선택하면 연결이 거절됩니다. 본인 계정에서는 폴더를 생성하고 파일을 저장할 수 있습니다.
- 대표님과 형민님의 사번 로그인은 각각의 기존 프로젝트로 연결됩니다.

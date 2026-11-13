# 설계사허브 신규 가입 TEST

이 브랜치는 신규 가입 전용 Supabase가 설정되면 Google 로그인 버튼을 활성화합니다. 대표님과 형민님은 기존 사번 로그인으로 각자의 보험 DB에 접속합니다. 새 설계사는 별도 프로젝트에서 하나의 계정을 받고 자기 자료만 다룹니다. 기존 고객자료의 복사나 이전은 필요하지 않습니다.

## 연결 순서

1. 비어 있는 TEST 전용 Supabase 프로젝트에 마이그레이션 `20261113130000_wd09_planner_onboarding.sql`을 적용합니다. 운영 프로젝트에는 적용하지 않습니다.
2. TEST 프로젝트의 SQL Editor에서 실제 관리자 이메일을 소문자로 넣어 관리자 초대 행을 한 번 생성합니다.

   ```sql
   insert into wd09_private.planner_access (email, display_name, planner_uid, can_invite)
   values ('<관리자 Google 이메일>', '<관리자 이름>', 'WDTESTADMIN', true);
   ```

3. TEST 프로젝트에서 Google Auth 공급자를 설정합니다. Google Cloud의 OAuth 설정에 이 TEST 프로젝트의 Supabase 콜백 주소를 추가하고, Supabase의 Redirect URLs에 TEST 설계사허브 주소의 `?wd09_google=1` 경로를 추가합니다. 외부 앱이 테스트 모드라면 관리자와 검수 계정을 Google Cloud 테스트 사용자에도 등록합니다. 기존 Drive OAuth 웹 클라이언트에는 이 TEST 사이트의 실제 HTTPS origin이 등록되어 있어야 합니다.
4. Auth의 Before User Created Hook으로 `wd09_private.allow_google_signup`을 활성화합니다. 이 설정은 등록된 Google 이메일의 가입만 허용합니다. `wd09_activate_planner`는 확인된 Google 이메일과 해당 계정의 Supabase 사용자 ID를 묶습니다.
5. HTML의 `googleConfig`에 **별도 TEST 프로젝트** URL과 publishable key를 설정합니다. HTML의 CSP `connect-src`에 같은 프로젝트 origin을 추가합니다.
6. TEST 관리자가 Google 로그인 후 **마이페이지 → 설계사 추가**에서 이름과 이메일을 등록합니다. 초대 대상에게 TEST 주소를 전달합니다. 신규 설계사는 해당 Google 계정으로 로그인하고 Drive 권한을 허용한 뒤 앱의 안내에 따라 본인 보험 폴더를 만듭니다.

## 완료 확인

- 초대된 계정 두 개로 첫 로그인과 재로그인을 확인합니다. 미등록 계정은 Supabase 가입 및 허브 진입이 거절되어야 합니다.
- 관리자는 설계사를 추가할 수 있습니다. 일반 설계사는 등록 메뉴가 없으며 직접 RPC를 호출해도 거절되어야 합니다.
- 설계사 두 계정에서 테스트 고객을 각각 저장합니다. 서로의 고객과 첨부파일을 직접 읽거나 수정할 수 없는지 확인합니다.
- 다른 Google 계정을 Drive에서 선택하면 폴더가 만들어지기 전에 연결이 거절되는지 확인합니다. 올바른 계정에서는 폴더 생성, 파일 저장 및 재조회까지 확인합니다.
- 기존 대표님·형민님 사번 로그인 경로와 현재 프로젝트 연결을 확인합니다.

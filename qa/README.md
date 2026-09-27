# WD WAVE TEST 자동 QA

라이브오피스 TEST 화면을 수정하지 않고 외부에서 검수하는 수동 실행형 Playwright 환경입니다.

## GitHub Actions 실행

1. GitHub 저장소의 **Actions** 탭을 엽니다.
2. **WD LIVE OFFICE 수동 QA**를 선택합니다.
3. **Run workflow**를 누릅니다.
4. 기존 주소는 그대로 두고, 현재 TEST 번호만 입력해 실행합니다. 현재는 06입니다.
5. 완료 후 실행 화면 아래의 QA artifact 파일을 받습니다.

자동 반복 실행과 예약 실행은 없습니다. 대표님이나 작업 AI가 필요할 때만 수동으로 실행합니다.

## 결과물

- qa-artifacts/qa-summary.md: 화면크기별 PASS / FAIL, 오류와 재현명령
- qa-artifacts/qa-results.json: 기계 판독용 결과
- qa-artifacts/test-results/: 각 상태·화면크기별 스크린샷과 실패 trace
- playwright-report/: 상세 HTML 보고서

검수 화면은 PC 1440, 768, 430, 390입니다. 로그인 전, 로그인 직후 로딩, 실데이터 성공 모의, 읽기 실패 모의 상태를 각각 검수합니다.

## 보안 방식

현재 자동 QA는 실제 계정이나 비밀번호를 사용하지 않습니다. 브라우저에서 Supabase 읽기 응답만 모의하며 저장·수정·완료처리·외부발송 요청을 만들지 않습니다.

실제 로그인 자동화는 대표 승인 전 연결하지 않습니다.

### 실제 로그인 자동화가 필요할 때의 승인 계획

1. **계정 방식**: 대표·수진 계정이 아닌 전용 읽기전용 QA 계정 1개
2. **보안 저장 위치**: GitHub qa Environment의 암호화 Secret
   - WD_QA_LOGIN_ID
   - WD_QA_PASSWORD
3. **읽기전용 범위**: work_tasks SELECT만 허용하고 쓰기 요청은 테스트 코드에서 차단
4. **대표님이 한 번만 할 설정**
   - QA 계정 생성과 읽기전용 정책 변경을 별도로 승인
   - GitHub qa Environment 생성
   - 위 Secret 두 개를 GitHub 화면에서 직접 입력
   - 필요하면 Environment 실행 전 대표 승인 규칙 설정
5. **보호 규칙**
   - 비밀번호를 코드·로그·스크린샷·artifact에 출력하지 않음
   - 로그인 입력칸은 스크린샷에서 마스킹
   - 실패 로그도 인증값을 제거한 뒤 저장
   - 실제 쓰기 API가 감지되면 즉시 FAIL

이 계획은 문서만 작성한 상태이며 QA 계정·Secret·Auth·DB·RLS는 만들거나 변경하지 않았습니다.

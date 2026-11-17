# WD ADMIN 파일 안내

WD WAVE 본진과 업무센터, 관련 TEST 화면을 관리하는 저장소입니다.

GitHub 파일 목록 오른쪽 문구는 해당 파일의 최근 변경 제목입니다. 새 변경 제목에는 파일이나 기능 이름과 바뀐 내용을 한국어로 적습니다.

## 주요 화면

| 파일 | 용도 |
| --- | --- |
| `index.html` | WD WAVE 본진 첫 화면 |
| `wd-work-center.html` | WD 업무센터 |
| `wd-work-center-test.html` | 직원 업무지시·업무보고 TEST |
| `wd-insurance-hub-simple-test.html` | 단순화한 설계사허브 TEST |
| `wd-insurance-hub-test.html` | 지안 2.0 설계사허브 TEST |
| `consulting_center_app.html` | 퍼스널브랜딩센터 상담·업무 화면 |
| `wd-personal-branding-center-test.html` | 퍼스널브랜딩센터 TEST |
| `lecture_center.html` | 강의센터 |
| `wd-production-center.html` | 제작센터 |

## 공용 파일과 배포 주소

| 파일 또는 폴더 | 용도 |
| --- | --- |
| `assets/` | 화면에서 사용하는 공용 이미지 |
| `wd-sticky-notes.css` | 본진·업무센터 스티커노트 디자인 |
| `wd-sticky-notes.js` | 본진·업무센터 스티커노트 기능 |
| `wd-talk-backup.js` | 본진·업무센터 TALK 백업 기능 |
| `CNAME` | GitHub Pages 주소 `admin.wdwave.kr` 연결 |

## 자동 화면 검수

| 파일 또는 폴더 | 용도 |
| --- | --- |
| `package.json` | 자동 화면 검수용 실행 명령과 도구 |
| `playwright.config.js` | 자동 화면 검수용 브라우저·화면 크기·보고서 설정 |
| `qa/` | 자동 화면 검수용 테스트 코드 및 사용 안내 |
| `.github/workflows/live-office-qa.yml` | GitHub Actions에서 라이브오피스 화면 검수 실행 |

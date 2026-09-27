const fs = require('fs');
const path = require('path');

class WdQaReporter {
  constructor() {
    this.results = [];
    this.startedAt = new Date().toISOString();
  }

  onTestEnd(test, result) {
    const diagnostics = result.attachments
      .filter((item) => item.name === 'console-runtime-errors' && item.body)
      .flatMap((item) => {
        try { return JSON.parse(item.body.toString('utf8')); }
        catch (_) { return ['진단 첨부파일을 읽지 못했습니다.']; }
      });

    this.results.push({
      screen: test.parent && test.parent.project ? test.parent.project().name : 'unknown',
      test: test.title,
      status: result.status,
      durationMs: result.duration,
      errors: result.errors.map((error) => error.message || String(error)),
      consoleRuntimeErrors: diagnostics
    });
  }

  onEnd() {
    const dir = path.resolve('qa-artifacts');
    fs.mkdirSync(dir, { recursive: true });

    const passed = this.results.filter((item) => item.status === 'passed').length;
    const failed = this.results.filter((item) => item.status !== 'passed').length;
    const lines = [
      '# WD WAVE 라이브오피스 자동 QA 결과',
      '',
      '- 실행시각: ' + this.startedAt,
      '- PASS: ' + passed,
      '- FAIL: ' + failed,
      '',
      '## PASS / FAIL 목록',
      ''
    ];

    for (const item of this.results) {
      const ok = item.status === 'passed';
      lines.push('- ' + (ok ? 'PASS' : 'FAIL') + ' · ' + item.screen + ' · ' + item.test);
      if (!ok) {
        const safeTitle = item.test.replace(/"/g, '\\\\"');
        lines.push('  - 재현: npx playwright test qa/live-office.spec.js --project="' + item.screen + '" -g "' + safeTitle + '"');
        item.errors.forEach((error) => lines.push('  - 오류: ' + error.replace(/\\s+/g, ' ').slice(0, 500)));
      }
      item.consoleRuntimeErrors.forEach((error) => lines.push('  - 콘솔/런타임: ' + String(error).replace(/\\s+/g, ' ').slice(0, 500)));
    }

    lines.push(
      '',
      '## 대표님 직접 확인 항목',
      '',
      '- 실제 대표·수진 계정 로그인과 실제 work_tasks 데이터 정확성',
      '- 실제 태블릿·휴대전화의 글꼴·터치·브라우저별 체감',
      '- 운영반영 여부의 최종 승인',
      '',
      '※ 이번 자동 QA는 비밀번호 없이 모의 Supabase 응답으로 로그인 전·로딩·성공·읽기 실패 UI를 검수합니다.'
    );

    fs.writeFileSync(path.join(dir, 'qa-summary.md'), lines.join('\\n') + '\\n');
    fs.writeFileSync(path.join(dir, 'qa-results.json'), JSON.stringify({
      startedAt: this.startedAt,
      passed,
      failed,
      results: this.results
    }, null, 2));
  }
}

module.exports = WdQaReporter;

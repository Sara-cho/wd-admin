const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const LONG_TITLE = [
  '라이브오피스 자동 QA 긴 업무명',
  'https://example.invalid/first/really/long/path?source=wdwave',
  'https://example.invalid/second/really/long/path?state=success',
  'https://example.invalid/third/really/long/path?viewport=tablet',
  'https://example.invalid/fourth/really/long/path?guaranteed=overflow',
  'https://example.invalid/fifth/really/long/path?screen=desktop-and-tablet',
  '원지시자·현재담당·다음행동 접근성을 함께 확인'
].join(' · ');

function mockSupabaseScript(mode) {
  const row = {
    id: 'qa-long-task',
    user_id: 'qa-user',
    category: 'QA',
    content: LONG_TITLE,
    status: '진행중',
    request_date: '2026-09-27',
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T01:00:00Z',
    requester_name: '대표님',
    idea_status: null,
    raw_content: '자동 QA용 읽기전용 모의 데이터',
    core_content: '긴 업무명 상세 모달 확인',
    next_action: '전체 보기와 접기 확인',
    assignee_name: '지안',
    worker_name: '지안',
    worker_key: 'jian',
    result_url: '설계사허브 고객기록',
    result_note: '모의 응답',
    blocked_note: null
  };

  return [
    'window.supabase={createClient:function(){return{',
    'auth:{signInWithPassword:async function(){return {data:{session:{user:{id:"qa-user",email:"qa@invalid.local"}}},error:null}},signOut:async function(){return {error:null}}},',
    'from:function(){return{select:function(){return this},order:function(){return this},limit:function(){',
    mode === 'loading' ? 'return new Promise(function(){})' :
      (mode === 'error' ? 'return Promise.resolve({data:null,error:{message:"QA forced read failure"}})' :
        'return Promise.resolve({data:[' + JSON.stringify(row) + '],error:null})'),
    '}}}}}};'
  ].join('');
}

async function prepare(page, mode) {
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push('console.error: ' + message.text());
  });
  page.on('pageerror', (error) => diagnostics.push('pageerror: ' + error.message));
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!url.includes('favicon')) {
      const failure = request.failure();
      diagnostics.push('requestfailed: ' + request.method() + ' ' + url + ' · ' + (failure ? failure.errorText : 'unknown'));
    }
  });

  await page.route('**/supabase-js@2/dist/umd/supabase.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: mockSupabaseScript(mode || 'success')
    });
  });
  await page.goto(process.env.WD_QA_URL || 'https://admin.wdwave.kr/wd-live-office-test.html', {
    waitUntil: 'domcontentloaded'
  });
  return diagnostics;
}

async function attachDiagnostics(testInfo, diagnostics) {
  await testInfo.attach('console-runtime-errors', {
    body: Buffer.from(JSON.stringify(diagnostics), 'utf8'),
    contentType: 'application/json'
  });
}

async function takeScreenshot(page, testInfo, name) {
  const file = testInfo.outputPath('screenshots', name + '.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
}

async function expectCommonLayout(page) {
  const expectedTest = process.env.WD_EXPECTED_TEST || '06';
  expect(await page.title(), '페이지 제목의 TEST 번호 불일치').toContain('TEST ' + expectedTest);
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  expect(sizes.scroll, '문서 가로스크롤 발생').toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.body, '본문 가로스크롤 발생').toBeLessThanOrEqual(sizes.viewport + 1);
}

async function login(page) {
  await page.locator('#loginPassword').fill('qa-not-a-real-secret');
  await page.locator('#loginBtn').click();
}

async function expectModalInsideViewport(page) {
  const result = await page.locator('#batonDialog').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const close = dialog.querySelector('.dlg-close').getBoundingClientRect();
    const title = dialog.querySelector('#batonDialogTitle').getBoundingClientRect();
    const overlap = !(title.right <= close.left || title.left >= close.right || title.bottom <= close.top || title.top >= close.bottom);
    return {
      dialogInside: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
      closeInside: close.left >= 0 && close.right <= innerWidth && close.top >= 0 && close.bottom <= innerHeight,
      titleCloseOverlap: overlap
    };
  });
  expect(result.dialogInside, '모달이 화면 밖으로 이탈').toBeTruthy();
  expect(result.closeInside, '닫기 버튼이 화면 밖이거나 접근 불가').toBeTruthy();
  expect(result.titleCloseOverlap, '상단 제목과 닫기 버튼 겹침').toBeFalsy();
}

test('로그인 전 TEST 예시와 기본 레이아웃', async ({ page }, testInfo) => {
  const diagnostics = await prepare(page, 'success');
  await expectCommonLayout(page);
  await expect(page.locator('#batonDemoBanner')).toBeVisible();
  await expect(page.locator('#batonSourceLabel')).toContainText('TEST 예시');
  await page.locator('[data-baton-id="test-example"]').click();
  await expect(page.locator('#batonDialog')).toBeVisible();
  await expect(page.locator('#batonTaskNameToggle')).toBeHidden();
  await expectModalInsideViewport(page);
  await takeScreenshot(page, testInfo, 'login-before-demo');
  await page.locator('#batonDialog .dlg-close').click();
  await expect(page.locator('#batonDialog')).not.toBeVisible();
  await attachDiagnostics(testInfo, diagnostics);
  expect(diagnostics, '예상하지 못한 콘솔·런타임 오류').toEqual([]);
});

test('로그인 직후 로딩 상태에서 TEST 예시 제거', async ({ page }, testInfo) => {
  const diagnostics = await prepare(page, 'loading');
  await login(page);
  await expect(page.locator('#batonSourceLabel')).toContainText('불러오는 중');
  await expect(page.locator('#batonDemoBanner')).toBeHidden();
  await expect(page.locator('#batonTaskGrid')).not.toContainText('김OO 청구 후속확인');
  await expect(page.locator('#batonTaskGrid')).toContainText('실데이터를 불러오는 중');
  await expectCommonLayout(page);
  await takeScreenshot(page, testInfo, 'login-loading');
  await attachDiagnostics(testInfo, diagnostics);
  expect(diagnostics, '예상하지 못한 콘솔·런타임 오류').toEqual([]);
});

test('실데이터 성공 모의 상태와 긴 업무명 상세 모달', async ({ page }, testInfo) => {
  const diagnostics = await prepare(page, 'success');
  await login(page);
  await expect(page.locator('#batonSourceLabel')).toContainText('실데이터');
  await expect(page.locator('#batonDemoBanner')).toBeHidden();
  await expect(page.locator('#batonTaskGrid')).not.toContainText('김OO 청구 후속확인');
  await page.locator('[data-baton-id="qa-long-task"]').click();
  await expect(page.locator('#batonDialog')).toBeVisible();

  const header = await page.locator('#batonDialogTitle').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clamp: style.webkitLineClamp,
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight)
    };
  });
  expect(header.clamp, '상단 제목 2줄 제한 누락').toBe('2');
  expect(header.height, '상단 제목이 2줄 높이를 초과').toBeLessThanOrEqual(header.lineHeight * 2 + 2);

  const bodyName = page.locator('#batonTaskNameValue');
  const toggle = page.locator('#batonTaskNameToggle');
  await expect(bodyName).toHaveText(LONG_TITLE);
  await expect(toggle).toBeVisible();
  const collapsed = await bodyName.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    text: element.textContent
  }));
  expect(collapsed.scrollHeight, '긴 본문 업무명이 기본 상태에서 줄어들지 않음').toBeGreaterThan(collapsed.clientHeight);
  expect(collapsed.text, '전체 원문이 DOM에 보존되지 않음').toBe(LONG_TITLE);
  await expect(page.locator('#batonDetail')).toContainText('원지시자');
  await expect(page.locator('#batonDetail')).toContainText('현재 담당');
  await expect(page.locator('#batonDetail')).toContainText('현재상태');
  await expect(page.locator('#batonDetail')).toContainText('다음 행동 1개');

  await expectModalInsideViewport(page);
  await takeScreenshot(page, testInfo, 'long-task-collapsed');
  await toggle.click();
  await expect(toggle).toHaveText('접기');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(bodyName).toHaveClass(/expanded/);
  const expanded = await bodyName.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(expanded.clientHeight, '전체 보기 후 원문이 펼쳐지지 않음').toBeGreaterThanOrEqual(expanded.scrollHeight - 1);
  await takeScreenshot(page, testInfo, 'long-task-expanded');
  await toggle.click();
  await expect(toggle).toHaveText('전체 보기');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#batonDialog .dlg-close').click();
  await expect(page.locator('#batonDialog')).not.toBeVisible();

  await expectCommonLayout(page);
  await attachDiagnostics(testInfo, diagnostics);
  expect(diagnostics, '예상하지 못한 콘솔·런타임 오류').toEqual([]);
});

test('읽기 실패 상태에서 TEST 예시가 다시 나타나지 않음', async ({ page }, testInfo) => {
  const diagnostics = await prepare(page, 'error');
  await login(page);
  await expect(page.locator('#batonSourceLabel')).toContainText('읽기 실패');
  await expect(page.locator('#batonDemoBanner')).toBeHidden();
  await expect(page.locator('#batonTaskGrid')).not.toContainText('김OO 청구 후속확인');
  await expect(page.locator('#batonTaskGrid')).toContainText('읽기에 실패');
  await expectCommonLayout(page);
  await takeScreenshot(page, testInfo, 'read-error');
  await attachDiagnostics(testInfo, diagnostics);
  expect(
    diagnostics.some((item) => item.includes('QA forced read failure')),
    '읽기 실패 오류가 콘솔 진단에 기록되지 않음'
  ).toBeTruthy();
});

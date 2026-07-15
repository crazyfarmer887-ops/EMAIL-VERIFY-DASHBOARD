import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { ManageDashboard } from '../src/web/pages/manage.tsx';
import {
  type CookieSet,
  type ManageData,
  AccountRequestLifecycle,
  filterManageData,
  normalizeManageResponse,
  parseCookieSets,
  queryStateReducer,
  viewStateReducer,
} from '../src/web/lib/manage-query.ts';

test('저장된 쿠키는 유효한 배열 항목만 안전하게 허용한다', () => {
  assert.deepEqual(parseCookieSets('{"id":"not-an-array"}'), []);
  assert.deepEqual(parseCookieSets('broken json'), []);
  assert.deepEqual(parseCookieSets(JSON.stringify([
    { id: 'a', label: '업무용', AWSALB: 'one', AWSALBCORS: 'two', JSESSIONID: 'three' },
    { id: 'missing-secret', label: '제외', AWSALB: 'one' },
    null,
  ])), [
    { id: 'a', label: '업무용', AWSALB: 'one', AWSALBCORS: 'two', JSESSIONID: 'three' },
  ]);
});

test('중복 쿠키 id는 첫 번째 유효 항목만 유지해 계정 identity를 단일화한다', () => {
  const first = { id: 'same', label: '첫 계정', AWSALB: 'one', AWSALBCORS: 'two', JSESSIONID: 'three' };
  const duplicate = { id: 'same', label: '뒤 계정', AWSALB: 'changed', AWSALBCORS: 'changed', JSESSIONID: 'changed' };
  assert.deepEqual(parseCookieSets(JSON.stringify([first, duplicate])), [first]);
});

const member = (name: string, status: string) => ({
  dealUsid: `${name}-${status}`, name, status, statusName: status, price: '1,000원',
  purePrice: 1000, realizedSum: 0, progressRatio: '50%', startDateTime: null,
  endDateTime: null, remainderDays: 0, source: 'after' as const,
});

const sampleData = {
  services: [{
    serviceType: 'Netflix', totalUsingMembers: 1, totalActiveMembers: 2,
    totalIncome: 1000, totalRealized: 0,
    accounts: [{
      email: 'team@example.com', serviceType: 'Netflix', usingCount: 1, activeCount: 2,
      totalSlots: 4, totalIncome: 1000, totalRealizedIncome: 0, expiryDate: null,
      members: [member('김사용', 'Using'), member('박완료', 'NormalFinished')],
    }],
  }],
  summary: { totalUsingMembers: 1, totalActiveMembers: 2, totalIncome: 1000, totalRealized: 0, totalAccounts: 1 },
  updatedAt: '2026-07-15T10:00:00.000Z',
};

test('응답은 JSON content-type, 성공 status, 데이터 shape를 모두 검증한다', async () => {
  await assert.rejects(
    normalizeManageResponse(new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } })),
    /JSON 형식/,
  );
  await assert.rejects(
    normalizeManageResponse(new Response(JSON.stringify({ error: '세션 만료' }), { status: 401, headers: { 'content-type': 'application/json' } })),
    /세션 만료/,
  );
  await assert.rejects(
    normalizeManageResponse(new Response(JSON.stringify({ services: 'invalid' }), { status: 200, headers: { 'content-type': 'application/json' } })),
    /응답 형식/,
  );
  assert.deepEqual(await normalizeManageResponse(new Response(JSON.stringify(sampleData), {
    status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
  })), sampleData);
});

test('응답 validator는 중복 identity와 잘못된 nested member·summary shape를 거부한다', async () => {
  const response = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  const duplicateService = { ...sampleData, services: [sampleData.services[0], sampleData.services[0]] };
  const invalidMember = structuredClone(sampleData) as any;
  invalidMember.services[0].accounts[0].members[0].purePrice = Number.POSITIVE_INFINITY;
  const invalidSummary = { ...sampleData, summary: { ...sampleData.summary, totalAccounts: '1' } };
  const wrongParentService = structuredClone(sampleData) as any;
  wrongParentService.services[0].accounts[0].serviceType = 'Wavve';
  const duplicateGlobalMember = structuredClone(sampleData) as any;
  duplicateGlobalMember.services[0].accounts.push({
    ...structuredClone(duplicateGlobalMember.services[0].accounts[0]),
    email: 'other@example.com',
  });
  await assert.rejects(normalizeManageResponse(response(duplicateService)), /응답 형식/);
  await assert.rejects(normalizeManageResponse(response(invalidMember)), /응답 형식/);
  await assert.rejects(normalizeManageResponse(response(invalidSummary)), /응답 형식/);
  await assert.rejects(normalizeManageResponse(response(wrongParentService)), /응답 형식/);
  await assert.rejects(normalizeManageResponse(response(duplicateGlobalMember)), /응답 형식/);
});

test('통합 검색과 상태 필터는 서비스·이메일·파티원 이름을 정확히 교차 적용한다', () => {
  assert.equal(filterManageData(sampleData, 'using', '박완료').memberCount, 0);
  assert.equal(filterManageData(sampleData, 'all', '박완료').memberCount, 1);
  assert.equal(filterManageData(sampleData, 'using', 'netflix').memberCount, 1);
  assert.equal(filterManageData(sampleData, 'using', 'TEAM@EXAMPLE.COM').memberCount, 1);
});

test('필터 결과의 계정·서비스 count는 표시 중인 members로 재계산하고 수입은 전체 기준임을 유지한다', () => {
  const filtered = filterManageData(sampleData, 'all', '박완료');
  const service = filtered.services[0];
  const account = service.accounts[0];
  assert.equal(account.members.length, 1);
  assert.equal(account.usingCount, 0);
  assert.equal(account.activeCount, 0);
  assert.equal(service.totalUsingMembers, 0);
  assert.equal(service.totalActiveMembers, 0);
  assert.equal(account.totalIncome, sampleData.services[0].accounts[0].totalIncome);
  assert.equal(service.totalIncome, sampleData.services[0].totalIncome);
});

test('계정별 조회 상태는 갱신 중 데이터와 실패 후 데이터를 보존한다', () => {
  const loading = queryStateReducer({}, { type: 'start', accountId: 'a', sequence: 1 });
  const ready = queryStateReducer(loading, { type: 'success', accountId: 'a', sequence: 1, data: sampleData, updatedAt: 10 });
  const refreshing = queryStateReducer(ready, { type: 'start', accountId: 'a', sequence: 2 });
  assert.equal(refreshing.a.status, 'refreshing');
  assert.equal(refreshing.a.data, sampleData);
  const failed = queryStateReducer(refreshing, { type: 'error', accountId: 'a', sequence: 2, error: '네트워크 오류' });
  assert.equal(failed.a.status, 'error');
  assert.equal(failed.a.data, sampleData);
  assert.equal(failed.a.error, '네트워크 오류');
  const other = queryStateReducer(failed, { type: 'start', accountId: 'b', sequence: 1 });
  assert.equal(other.a.data, sampleData);
  assert.equal(other.b.status, 'loading');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const cookie = (id: string): CookieSet => ({ id, label: id, AWSALB: `${id}-1`, AWSALBCORS: `${id}-2`, JSESSIONID: `${id}-3` });

test('실제 request lifecycle은 A→B→A 전환에서 이전 요청을 abort하고 stale 완료를 무시한다', async () => {
  const pending: Array<ReturnType<typeof deferred<ManageData>>> = [];
  const signals: AbortSignal[] = [];
  let state = {} as Record<string, any>;
  const lifecycle = new AccountRequestLifecycle(
    (_cookie, signal) => {
      signals.push(signal);
      const next = deferred<ManageData>();
      pending.push(next);
      return next.promise;
    },
    (action) => { state = queryStateReducer(state, action); },
    () => 99,
  );

  const firstA = lifecycle.request(cookie('a'));
  const requestB = lifecycle.request(cookie('b'));
  const secondA = lifecycle.request(cookie('a'));
  assert.deepEqual(signals.map((signal) => signal.aborted), [true, true, false]);
  pending[0].resolve({ ...sampleData, updatedAt: 'stale-a' });
  pending[1].resolve({ ...sampleData, updatedAt: 'stale-b' });
  pending[2].resolve({ ...sampleData, updatedAt: 'fresh-a' });
  await Promise.all([firstA, requestB, secondA]);
  assert.equal(state.a.data.updatedAt, 'fresh-a');
  assert.equal(state.b?.data ?? null, null);
});

test('request lifecycle dispose는 unmount 중 요청을 abort하고 error를 발표하지 않는다', async () => {
  const pending = deferred<ManageData>();
  const actions: unknown[] = [];
  let signal: AbortSignal | undefined;
  const lifecycle = new AccountRequestLifecycle((_cookie, nextSignal) => {
    signal = nextSignal;
    return pending.promise;
  }, (action) => actions.push(action));
  const request = lifecycle.request(cookie('a'));
  lifecycle.dispose();
  pending.reject(new DOMException('aborted', 'AbortError'));
  await request;
  assert.equal(signal?.aborted, true);
  assert.equal(actions.length, 1);
});

test('검색·필터·열림 상태는 accountId별로 격리되고 복원된다', () => {
  let state = viewStateReducer({}, { type: 'search', accountId: 'a', value: 'netflix' });
  state = viewStateReducer(state, { type: 'filter', accountId: 'a', value: 'all' });
  state = viewStateReducer(state, { type: 'service', accountId: 'a', value: 'Netflix' });
  state = viewStateReducer(state, { type: 'account', accountId: 'a', value: 'team@example.com__Netflix' });
  state = viewStateReducer(state, { type: 'search', accountId: 'b', value: 'wavve' });
  assert.deepEqual(state.a, { search: 'netflix', filter: 'all', openService: 'Netflix', openAccount: 'team@example.com__Netflix' });
  assert.deepEqual(state.b, { search: 'wavve', filter: 'using', openService: null, openAccount: null });
});

test('관리 대시보드는 갱신·검색·필터·아코디언·진행률 접근성 의미를 제공한다', () => {
  const html = renderToStaticMarkup(<ManageDashboard
    cookies={[{ id: 'a', label: '업무 계정', AWSALB: 'x', AWSALBCORS: 'y', JSESSIONID: 'z' }]}
    selectedId="a"
    query={{ data: sampleData, status: 'refreshing', error: null, updatedAt: Date.parse(sampleData.updatedAt), sequence: 2 }}
    view={{ search: 'netflix', filter: 'using', openService: 'Netflix', openAccount: 'team@example.com__Netflix' }}
    onSelect={() => {}}
    onRefresh={() => {}}
    onViewAction={() => {}}
  />);
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('main')?.getAttribute('aria-busy'), 'true');
  const liveRegions = document.querySelectorAll('[role="status"]');
  assert.equal(liveRegions.length, 1);
  assert.equal(liveRegions[0].closest('main'), null);
  assert.match(liveRegions[0].textContent ?? '', /갱신 중/);
  assert.ok(document.querySelector('input[type="search"][aria-label]'));
  assert.ok(document.querySelector('button[aria-label="검색 지우기"]'));
  assert.equal(document.querySelector('.manage-filters button[aria-pressed="true"]')?.textContent, '이용 중');
  const controlledIds = [...document.querySelectorAll('button[aria-controls]')].map((button) => button.getAttribute('aria-controls'));
  assert.ok(controlledIds.every((id) => id?.includes('a')));
  assert.equal(new Set(controlledIds).size, controlledIds.length);
  assert.ok(document.querySelector('button[aria-expanded="true"][aria-controls]'));
  assert.equal(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'), '50');
  assert.equal(document.querySelector('.manage-summary')?.getAttribute('aria-label'), '전체 현황');
  assert.equal(document.querySelector('.manage-service-toggle small')?.textContent, '표시 중 계정 1개 · 이용 중 1명');
  assert.equal(document.querySelector('.manage-service .manage-income')?.textContent, '전체 수입 1,000원');
  assert.equal(document.querySelector('.manage-account-toggle small')?.textContent, '표시 중 1명 / 전체 4슬롯 · 25% 사용');
  assert.equal(document.querySelector('.manage-account-toggle .manage-income')?.textContent, '전체 수입 1,000원');
  assert.match(document.body.textContent ?? '', /업무 계정/);
  assert.match(document.body.textContent ?? '', /기준/);
});

test('ARIA panel ID는 dashboard 인스턴스와 delimiter 입력이 달라도 전역 유일하고 실제 panel을 가리킨다', () => {
  const dataFor = (serviceType: string, email: string): ManageData => ({
    ...structuredClone(sampleData),
    services: [{
      ...structuredClone(sampleData.services[0]),
      serviceType,
      accounts: [{ ...structuredClone(sampleData.services[0].accounts[0]), serviceType, email }],
    }],
  });
  const dashboards = [
    { selectedId: 'a-service-b', serviceType: 'c', email: 'one@example.com' },
    { selectedId: 'a', serviceType: 'b-service-c', email: 'two@example.com' },
  ];
  const html = renderToStaticMarkup(<>{dashboards.map(({ selectedId, serviceType, email }) => <ManageDashboard
    key={selectedId}
    cookies={[{ id: selectedId, label: selectedId, AWSALB: 'x', AWSALBCORS: 'y', JSESSIONID: 'z' }]}
    selectedId={selectedId}
    query={{ data: dataFor(serviceType, email), status: 'success', error: null, updatedAt: 1, sequence: 1 }}
    view={{ search: '', filter: 'all', openService: serviceType, openAccount: `${email}__${serviceType}` }}
    onSelect={() => {}}
    onRefresh={() => {}}
    onViewAction={() => {}}
  />)}</>);
  const document = new JSDOM(html).window.document;
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  const controlledIds = [...document.querySelectorAll<HTMLButtonElement>('button[aria-controls]')]
    .map((button) => button.getAttribute('aria-controls'));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(controlledIds).size, controlledIds.length);
  assert.ok(controlledIds.every((id) => id && document.getElementById(id)));
});

test('manage header CSS는 320px·400% 확대에서 긴 context와 새로고침 버튼 overflow를 차단한다', () => {
  const styles = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.manage-header\s*>\s*div\s*\{[^}]*min-width:\s*0\s*;/s);
  assert.match(styles, /\.manage-context\s*\{[^}]*overflow-wrap:\s*anywhere\s*;/s);
  assert.match(styles, /@media\s*\(max-width:\s*420px\)\s*\{[\s\S]*?\.manage-header\s*\{[^}]*flex-direction:\s*column\s*;[\s\S]*?\.manage-primary\s*\{[^}]*width:\s*100%\s*;/);
});

test('/manage는 lazy route로 등록되고 알 수 없는 경로에는 404 fallback이 있다', () => {
  const source = readFileSync(new URL('../src/web/app.tsx', import.meta.url), 'utf8');
  assert.match(source, /lazy\(\(\) => import\("\.\/pages\/manage"\)\)/);
  assert.match(source, /path="\/manage"/);
  assert.match(source, /페이지를 찾을 수 없습니다/);
});

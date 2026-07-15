import { useCallback, useEffect, useId, useMemo, useReducer, useState } from 'react';
import { AlertCircle, ChevronDown, KeyRound, Mail, RefreshCw, Search, X } from 'lucide-react';
import { apiPath } from '../lib/path';
import {
  ACTIVE_STATUSES,
  AccountRequestLifecycle,
  DEFAULT_VIEW,
  type AccountQueryState,
  type AccountViewState,
  type CookieSet,
  type FilterMode,
  type ManageMember,
  type QueryStateMap,
  type ViewAction,
  filterManageData,
  normalizeManageResponse,
  parseCookieSets,
  queryStateReducer,
  viewStateReducer,
} from '../lib/manage-query';

const STORAGE_KEY = 'graytag_cookies_v2';
const EMPTY_QUERY: AccountQueryState = { data: null, status: 'idle', error: null, updatedAt: null, sequence: 0 };
const FILTERS: Array<{ value: FilterMode; label: string }> = [
  { value: 'using', label: '이용 중' },
  { value: 'active', label: '전체 활성' },
  { value: 'all', label: '전체 내역' },
];

const money = (value: number) => value > 0 ? `${value.toLocaleString()}원` : '-';
const dateTime = (value: number | null) => value
  ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  : '아직 조회하지 않음';
const progress = (value: string) => Math.min(100, Math.max(0, Number.parseFloat(value) || 0));
const statusLabel = (member: ManageMember) => member.statusName || member.status || '상태 미확인';
const idSegment = (value: string) => {
  const encoded = encodeURIComponent(value);
  return `${encoded.length}-${encoded}`;
};

interface DashboardProps {
  cookies: CookieSet[];
  selectedId: string;
  query: AccountQueryState;
  view: AccountViewState;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onViewAction: (action: ViewAction) => void;
}

export function ManageDashboard({ cookies, selectedId, query, view, onSelect, onRefresh, onViewAction }: DashboardProps) {
  const idNamespace = useId();
  const selected = cookies.find((cookie) => cookie.id === selectedId);
  const filtered = useMemo(
    () => query.data ? filterManageData(query.data, view.filter, view.search) : null,
    [query.data, view.filter, view.search],
  );
  const busy = query.status === 'loading' || query.status === 'refreshing';
  const hasSearch = view.search.trim().length > 0;

  if (!cookies.length) {
    return <main className="manage-page"><section className="manage-empty"><KeyRound aria-hidden="true" /><h1>계정 관리</h1><p>내 계정에서 쿠키를 먼저 등록해 주세요.</p></section></main>;
  }

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {query.status === 'loading' && `${selected?.label ?? '계정'} 조회 중`}
        {query.status === 'refreshing' && `${selected?.label ?? '계정'} 데이터를 갱신 중입니다. 기존 결과를 계속 표시합니다.`}
        {query.status === 'success' && `${selected?.label ?? '계정'} 조회 완료`}
      </div>
      <main className="manage-page" aria-busy={busy}>
      <header className="manage-header">
        <div>
          <p className="manage-eyebrow">EMAIL OPERATIONS</p>
          <h1>계정 관리</h1>
          <p className="manage-context"><strong>{selected?.label}</strong> · {dateTime(query.updatedAt)} 기준</p>
        </div>
        <button className="manage-primary" type="button" onClick={onRefresh} disabled={busy}>
          <RefreshCw aria-hidden="true" className={busy ? 'is-spinning' : ''} />
          {query.status === 'refreshing' ? '갱신 중' : query.status === 'loading' ? '조회 중' : '새로고침'}
        </button>
      </header>

      <nav className="manage-account-tabs" aria-label="조회할 계정">
        {cookies.map((cookie) => <button key={cookie.id} type="button" aria-pressed={selectedId === cookie.id} onClick={() => onSelect(cookie.id)}>{cookie.label}</button>)}
      </nav>

      {query.error && <div className="manage-alert" role="alert"><AlertCircle aria-hidden="true" /><div><strong>조회하지 못했습니다.</strong><p>{query.error}</p>{query.data && <p>기존 결과는 그대로 유지했습니다.</p>}</div></div>}
      {query.status === 'loading' && !query.data && <section className="manage-loading"><span className="manage-spinner" aria-hidden="true" />계정 현황을 불러오는 중입니다.</section>}

      {query.data && <>
        <section className="manage-summary" aria-label="전체 현황">
          <div><span>계정</span><strong>{query.data.summary.totalAccounts}개</strong></div>
          <div><span>이용 중</span><strong>{query.data.summary.totalUsingMembers}명</strong></div>
          <div><span>전체 수입</span><strong>{money(query.data.summary.totalIncome)}</strong></div>
          <div><span>정산 완료</span><strong>{money(query.data.summary.totalRealized)}</strong></div>
        </section>

        <section className="manage-tools" aria-label="검색과 필터">
          <div className="manage-search"><Search aria-hidden="true" /><input type="search" value={view.search} aria-label="서비스, 이메일, 파티원 통합 검색" placeholder="서비스 · 이메일 · 파티원 검색" onChange={(event) => onViewAction({ type: 'search', accountId: selectedId, value: event.target.value })} />{hasSearch && <button type="button" aria-label="검색 지우기" onClick={() => onViewAction({ type: 'search', accountId: selectedId, value: '' })}><X aria-hidden="true" /></button>}</div>
          <div className="manage-filters" aria-label="파티원 상태 필터">{FILTERS.map((filter) => <button type="button" key={filter.value} aria-pressed={view.filter === filter.value} onClick={() => onViewAction({ type: 'filter', accountId: selectedId, value: filter.value })}>{filter.label}</button>)}</div>
        </section>

        <p className="manage-result-status">{hasSearch ? `검색 결과 파티원 ${filtered?.memberCount ?? 0}명` : `현재 필터 파티원 ${filtered?.memberCount ?? 0}명`}</p>

        {!filtered?.services.length ? <section className="manage-empty"><Mail aria-hidden="true" /><h2>{hasSearch ? '검색 결과가 없습니다' : '이 필터에 해당하는 내역이 없습니다'}</h2><p>{hasSearch ? '서비스, 이메일 또는 파티원 이름을 다시 확인해 주세요.' : '다른 상태 필터를 선택해 보세요.'}</p></section> :
          <div className="manage-service-grid">{filtered.services.map((service, serviceIndex) => {
            const serviceKey = service.serviceType;
            const serviceOpen = view.openService === serviceKey;
            const serviceIdentity = `${serviceIndex}-${idSegment(serviceKey)}`;
            const servicePanel = `${idNamespace}-manage-${idSegment(selectedId)}-service-${serviceIdentity}`;
            return <section className="manage-service" key={serviceKey}>
              <button type="button" className="manage-service-toggle" aria-expanded={serviceOpen} aria-controls={servicePanel} onClick={() => onViewAction({ type: 'service', accountId: selectedId, value: serviceOpen ? null : serviceKey })}>
                <span><strong>{service.serviceType}</strong><small>표시 중 계정 {service.accounts.length}개 · 이용 중 {service.totalUsingMembers}명</small></span>
                <span className="manage-income"><span>전체 수입</span> {money(service.totalIncome)}</span><ChevronDown aria-hidden="true" />
              </button>
              <div id={servicePanel} hidden={!serviceOpen} className="manage-accounts">{service.accounts.map((account, accountIndex) => {
                const accountKey = `${account.email}__${account.serviceType}`;
                const accountOpen = view.openAccount === accountKey;
                const accountPanel = `${idNamespace}-manage-${idSegment(selectedId)}-service-${serviceIdentity}-account-${accountIndex}-${idSegment(accountKey)}`;
                const slotPercent = Math.round((account.usingCount / Math.max(account.totalSlots, 1)) * 100);
                return <article className="manage-account" key={accountKey}>
                  <button type="button" className="manage-account-toggle" aria-expanded={accountOpen} aria-controls={accountPanel} onClick={() => onViewAction({ type: 'account', accountId: selectedId, value: accountOpen ? null : accountKey })}>
                    <span><strong>{account.email}</strong><small>표시 중 {account.usingCount}명 / 전체 {Math.max(account.totalSlots, 1)}슬롯 · {slotPercent}% 사용</small></span><span className="manage-income"><span>전체 수입</span> {money(account.totalIncome)}</span><ChevronDown aria-hidden="true" />
                  </button>
                  <div id={accountPanel} hidden={!accountOpen} className="manage-members">{account.members.map((member) => {
                    const amount = progress(member.progressRatio);
                    return <div className="manage-member" key={member.dealUsid}><div><div className="manage-member-title"><strong>{member.name || '(이름 미확인)'}</strong><span className={ACTIVE_STATUSES.has(member.status) ? 'status-active' : 'status-muted'}>{statusLabel(member)}</span></div>{member.progressRatio && <div className="manage-progress"><div><span>진행률</span><span>{amount}%</span></div><div role="progressbar" aria-label={`${member.name || '파티원'} 이용 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={amount}><span style={{ width: `${amount}%` }} /></div></div>}</div><strong>{member.price}</strong></div>;
                  })}</div>
                </article>;
              })}</div>
            </section>;
          })}</div>}
      </>}
      </main>
    </>
  );
}

function safeCookies() {
  if (typeof window === 'undefined') return [];
  return parseCookieSets(window.localStorage.getItem(STORAGE_KEY));
}

export default function ManagePage() {
  const [cookies, setCookies] = useState<CookieSet[]>(safeCookies);
  const [selectedId, setSelectedId] = useState(cookies[0]?.id ?? '');
  const [queries, dispatchQuery] = useReducer(queryStateReducer, {} as QueryStateMap);
  const [views, dispatchView] = useReducer(viewStateReducer, {});
  const lifecycle = useMemo(() => new AccountRequestLifecycle(async (cookie, signal) => {
    const response = await fetch(apiPath('/my/management'), {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ AWSALB: cookie.AWSALB, AWSALBCORS: cookie.AWSALBCORS, JSESSIONID: cookie.JSESSIONID }),
    });
    return normalizeManageResponse(response);
  }, dispatchQuery), [dispatchQuery]);

  const request = useCallback((accountId: string) => {
    const cookie = cookies.find((item) => item.id === accountId);
    if (cookie) void lifecycle.request(cookie);
  }, [cookies, lifecycle]);

  useEffect(() => {
    const updateCookies = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      lifecycle.dispose();
      const nextCookies = parseCookieSets(event.newValue);
      setCookies(nextCookies);
      setSelectedId((current) => nextCookies.some((cookie) => cookie.id === current)
        ? current
        : (nextCookies[0]?.id ?? ''));
    };
    window.addEventListener('storage', updateCookies);
    return () => window.removeEventListener('storage', updateCookies);
  }, [lifecycle]);

  useEffect(() => () => lifecycle.dispose(), [lifecycle]);

  useEffect(() => {
    if (selectedId) request(selectedId);
  }, [selectedId, request]);

  return <ManageDashboard cookies={cookies} selectedId={selectedId} query={queries[selectedId] ?? EMPTY_QUERY} view={views[selectedId] ?? DEFAULT_VIEW} onSelect={setSelectedId} onRefresh={() => void request(selectedId)} onViewAction={dispatchView} />;
}

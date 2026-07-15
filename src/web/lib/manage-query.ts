export interface CookieSet {
  id: string;
  label: string;
  AWSALB: string;
  AWSALBCORS: string;
  JSESSIONID: string;
}

export interface ManageMember {
  dealUsid: string;
  name: string | null;
  status: string;
  statusName: string;
  price: string;
  purePrice: number;
  realizedSum: number;
  progressRatio: string;
  startDateTime: string | null;
  endDateTime: string | null;
  remainderDays: number;
  source: 'after' | 'before';
}

export interface ManageAccount {
  email: string;
  serviceType: string;
  members: ManageMember[];
  usingCount: number;
  activeCount: number;
  totalSlots: number;
  totalIncome: number;
  totalRealizedIncome: number;
  expiryDate: string | null;
}

export interface ManageService {
  serviceType: string;
  accounts: ManageAccount[];
  totalUsingMembers: number;
  totalActiveMembers: number;
  totalIncome: number;
  totalRealized: number;
}

export interface ManageData {
  services: ManageService[];
  summary: {
    totalUsingMembers: number;
    totalActiveMembers: number;
    totalIncome: number;
    totalRealized: number;
    totalAccounts: number;
  };
  updatedAt: string;
}

export type FilterMode = 'using' | 'active' | 'all';
export const USING_STATUSES = new Set(['Using', 'UsingNearExpiration']);
export const ACTIVE_STATUSES = new Set([
  'Using', 'UsingNearExpiration', 'Delivered', 'Delivering',
  'DeliveredAndCheckPrepaid', 'LendingAcceptanceWaiting', 'Reserved', 'OnSale',
]);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function parseCookieSets(raw: string | null): CookieSet[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set<string>();
    return parsed.filter((item): item is CookieSet => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      const valid = ['id', 'label', 'AWSALB', 'AWSALBCORS', 'JSESSIONID']
        .every((key) => isNonEmptyString(candidate[key]));
      if (!valid || seenIds.has(candidate.id as string)) return false;
      seenIds.add(candidate.id as string);
      return true;
    });
  } catch {
    return [];
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const hasFiniteNumbers = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => isFiniteNumber(value[key]));
const hasStrings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => typeof value[key] === 'string');

function isManageMember(value: unknown): value is ManageMember {
  if (!value || typeof value !== 'object') return false;
  const member = value as Record<string, unknown>;
  return hasStrings(member, ['dealUsid', 'status', 'statusName', 'price', 'progressRatio'])
    && isStringOrNull(member.name)
    && isStringOrNull(member.startDateTime)
    && isStringOrNull(member.endDateTime)
    && hasFiniteNumbers(member, ['purePrice', 'realizedSum', 'remainderDays'])
    && (member.source === 'after' || member.source === 'before');
}

function hasUniqueKeys<T>(values: T[], keyOf: (value: T) => string) {
  const keys = values.map(keyOf);
  return new Set(keys).size === keys.length;
}

function isManageData(value: unknown): value is ManageData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.services) || !candidate.summary || typeof candidate.summary !== 'object' || typeof candidate.updatedAt !== 'string') return false;
  const summary = candidate.summary as Record<string, unknown>;
  if (!hasFiniteNumbers(summary, ['totalUsingMembers', 'totalActiveMembers', 'totalIncome', 'totalRealized', 'totalAccounts'])) return false;
  if (!hasUniqueKeys(candidate.services, (service) => String((service as Record<string, unknown>)?.serviceType))) return false;
  const accountIdentities = new Set<string>();
  const memberIdentities = new Set<string>();
  return candidate.services.every((service) => {
    if (!service || typeof service !== 'object') return false;
    const item = service as Record<string, unknown>;
    if (typeof item.serviceType !== 'string' || !Array.isArray(item.accounts)
      || !hasFiniteNumbers(item, ['totalUsingMembers', 'totalActiveMembers', 'totalIncome', 'totalRealized'])) return false;
    if (!hasUniqueKeys(item.accounts, (account) => {
      const detail = account as Record<string, unknown>;
      return `${String(detail?.serviceType)}\u0000${String(detail?.email)}`;
    })) return false;
    return item.accounts.every((account) => {
      if (!account || typeof account !== 'object') return false;
      const detail = account as Record<string, unknown>;
      if (!hasStrings(detail, ['email', 'serviceType']) || !Array.isArray(detail.members)
        || !hasFiniteNumbers(detail, ['usingCount', 'activeCount', 'totalSlots', 'totalIncome', 'totalRealizedIncome'])
        || !isStringOrNull(detail.expiryDate)) return false;
      if (detail.serviceType !== item.serviceType) return false;
      const accountIdentity = JSON.stringify([detail.serviceType, detail.email]);
      if (accountIdentities.has(accountIdentity)) return false;
      accountIdentities.add(accountIdentity);
      if (!hasUniqueKeys(detail.members, (member) => String((member as Record<string, unknown>)?.dealUsid))) return false;
      return detail.members.every((member) => {
        if (!isManageMember(member) || memberIdentities.has(member.dealUsid)) return false;
        memberIdentities.add(member.dealUsid);
        return true;
      });
    });
  });
}

export async function normalizeManageResponse(response: Response): Promise<ManageData> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('서버가 JSON 형식으로 응답하지 않았습니다.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('서버 응답을 읽을 수 없습니다.');
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `조회에 실패했습니다. (${response.status})`;
    throw new Error(message);
  }
  if (!isManageData(payload)) throw new Error('서버 응답 형식이 올바르지 않습니다.');
  return payload;
}

function matchesStatus(status: string, filter: FilterMode) {
  if (filter === 'using') return USING_STATUSES.has(status);
  if (filter === 'active') return ACTIVE_STATUSES.has(status);
  return true;
}

export function filterManageData(data: ManageData, filter: FilterMode, search: string) {
  const needle = search.trim().toLocaleLowerCase();
  let memberCount = 0;
  const services = data.services.flatMap((service) => {
    const serviceMatch = service.serviceType.toLocaleLowerCase().includes(needle);
    const accounts = service.accounts.flatMap((account) => {
      const accountMatch = account.email.toLocaleLowerCase().includes(needle);
      const members = account.members.filter((member) => {
        if (!matchesStatus(member.status, filter)) return false;
        const memberMatch = (member.name ?? '').toLocaleLowerCase().includes(needle);
        return !needle || serviceMatch || accountMatch || memberMatch;
      });
      memberCount += members.length;
      const usingCount = members.filter((member) => USING_STATUSES.has(member.status)).length;
      const activeCount = members.filter((member) => ACTIVE_STATUSES.has(member.status)).length;
      return members.length ? [{ ...account, members, usingCount, activeCount }] : [];
    });
    if (!accounts.length) return [];
    return [{
      ...service,
      accounts,
      totalUsingMembers: accounts.reduce((sum, account) => sum + account.usingCount, 0),
      totalActiveMembers: accounts.reduce((sum, account) => sum + account.activeCount, 0),
    }];
  });
  return { services, memberCount };
}

export type QueryStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error';
export interface AccountQueryState {
  data: ManageData | null;
  status: QueryStatus;
  error: string | null;
  updatedAt: number | null;
  sequence: number;
}
export type QueryStateMap = Record<string, AccountQueryState>;
export type QueryAction =
  | { type: 'start'; accountId: string; sequence: number }
  | { type: 'success'; accountId: string; sequence: number; data: ManageData; updatedAt: number }
  | { type: 'error'; accountId: string; sequence: number; error: string };

export function queryStateReducer(state: QueryStateMap, action: QueryAction): QueryStateMap {
  const previous = state[action.accountId] ?? { data: null, status: 'idle', error: null, updatedAt: null, sequence: 0 };
  if (action.type !== 'start' && action.sequence !== previous.sequence) return state;
  if (action.type === 'start') {
    return {
      ...state,
      [action.accountId]: {
        ...previous,
        status: previous.data ? 'refreshing' : 'loading',
        error: null,
        sequence: action.sequence,
      },
    };
  }
  if (action.type === 'success') {
    return { ...state, [action.accountId]: { data: action.data, status: 'success', error: null, updatedAt: action.updatedAt, sequence: action.sequence } };
  }
  return { ...state, [action.accountId]: { ...previous, status: 'error', error: action.error } };
}

export class AccountRequestLifecycle {
  private sequence = 0;
  private controller: AbortController | null = null;

  constructor(
    private readonly run: (cookie: CookieSet, signal: AbortSignal) => Promise<ManageData>,
    private readonly dispatch: (action: QueryAction) => void,
    private readonly now: () => number = Date.now,
  ) {}

  async request(cookie: CookieSet) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const sequence = ++this.sequence;
    this.dispatch({ type: 'start', accountId: cookie.id, sequence });
    try {
      const data = await this.run(cookie, controller.signal);
      if (controller.signal.aborted || this.controller !== controller) return;
      this.dispatch({ type: 'success', accountId: cookie.id, sequence, data, updatedAt: this.now() });
    } catch (error) {
      if (controller.signal.aborted || this.controller !== controller) return;
      this.dispatch({
        type: 'error',
        accountId: cookie.id,
        sequence,
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      });
    }
  }

  dispose() {
    this.controller?.abort();
    this.controller = null;
  }
}

export interface AccountViewState {
  search: string;
  filter: FilterMode;
  openService: string | null;
  openAccount: string | null;
}
export type ViewStateMap = Record<string, AccountViewState>;
export type ViewAction =
  | { type: 'search'; accountId: string; value: string }
  | { type: 'filter'; accountId: string; value: FilterMode }
  | { type: 'service'; accountId: string; value: string | null }
  | { type: 'account'; accountId: string; value: string | null };

export const DEFAULT_VIEW: AccountViewState = { search: '', filter: 'using', openService: null, openAccount: null };

export function viewStateReducer(state: ViewStateMap, action: ViewAction): ViewStateMap {
  const previous = state[action.accountId] ?? DEFAULT_VIEW;
  if (action.type === 'search') return { ...state, [action.accountId]: { ...previous, search: action.value } };
  if (action.type === 'filter') return { ...state, [action.accountId]: { ...previous, filter: action.value } };
  if (action.type === 'service') return { ...state, [action.accountId]: { ...previous, openService: action.value } };
  return { ...state, [action.accountId]: { ...previous, openAccount: action.value } };
}

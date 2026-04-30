export interface EmailBlockInput {
  subject?: string | null;
  text?: string | null;
  text_body?: string | null;
  html?: string | null;
}

export interface EmailBlockResult {
  blocked: boolean;
  reason?: 'account-info-change-request';
  matchedKeyword?: string;
}

export const ACCOUNT_INFO_CHANGE_BLOCK_KEYWORDS = [
  '계정 정보 변경 요청',
  '계정정보 변경 요청',
  '계정 정보 변경',
  '계정정보 변경',
  '계정 변경 요청',
  '로그인 정보 변경 요청',
  '로그인정보 변경 요청',
  '로그인 정보 변경',
  '비밀번호 변경 요청',
  '비번 변경 요청',
  '이메일 변경 요청',
  '메일 변경 요청',
  'account information change request',
  'account info change request',
  'change your account information',
  'change account information',
  'password change request',
  'email change request',
  'login information change',
];

function htmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeForKeywordScan(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s_\-.,:;!?()[\]{}'"`~·•]+/g, ' ')
    .trim();
}

function compactKorean(value: string): string {
  return value.replace(/\s+/g, '');
}

export function isBlockedEmailContent(input: EmailBlockInput): EmailBlockResult {
  const haystack = normalizeForKeywordScan([
    input.subject || '',
    input.text || '',
    input.text_body || '',
    input.html ? htmlToText(input.html) : '',
  ].join('\n'));
  const compact = compactKorean(haystack);

  for (const keyword of ACCOUNT_INFO_CHANGE_BLOCK_KEYWORDS) {
    const normalizedKeyword = normalizeForKeywordScan(keyword);
    if (haystack.includes(normalizedKeyword) || compact.includes(compactKorean(normalizedKeyword))) {
      return { blocked: true, reason: 'account-info-change-request', matchedKeyword: keyword };
    }
  }
  return { blocked: false };
}

export function filterBlockedEmails<T extends EmailBlockInput>(emails: T[]): { allowed: T[]; blockedCount: number } {
  const allowed: T[] = [];
  let blockedCount = 0;
  for (const email of emails) {
    if (isBlockedEmailContent(email).blocked) blockedCount += 1;
    else allowed.push(email);
  }
  return { allowed, blockedCount };
}

export function blockedEmailResponseBody() {
  return {
    blocked: true,
    reason: 'account-info-change-request',
    error: '보안 정책에 따라 이 이메일은 차단됐어요.',
  };
}

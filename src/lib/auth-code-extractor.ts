export type AuthExtractionConfidence = 'high' | 'medium' | 'low' | 'none';
export type AuthExtractionSource = 'subject' | 'text' | 'html' | 'mixed' | 'none';

export interface AuthCodeExtractionInput {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
}

export interface AuthCodeExtraction {
  codes: string[];
  links: string[];
  confidence: AuthExtractionConfidence;
  source: AuthExtractionSource;
  matchedPattern?: string;
}

const AUTH_WORD_RE = /(?:인증\s*(?:번호|코드)|보안\s*(?:번호|코드)|확인\s*(?:번호|코드)|로그인\s*(?:번호|코드)|일회용\s*(?:번호|코드)|otp|one[-\s]?time|verification\s*code|security\s*code|login\s*code|auth(?:entication)?\s*code|confirm(?:ation)?\s*code|code)/iu;
const AUTH_WORD_SOURCE = String.raw`(?:인증\s*(?:번호|코드)|보안\s*(?:번호|코드)|확인\s*(?:번호|코드)|로그인\s*(?:번호|코드)|일회용\s*(?:번호|코드)|otp|one[-\s]?time|verification\s*code|security\s*code|login\s*code|auth(?:entication)?\s*code|confirm(?:ation)?\s*code|code)`;
const CODE_SOURCE = String.raw`(?:^|[^0-9,])([0-9]{4,8})(?![0-9,])`;
const URL_RE = /https?:\/\/[^\s<>'")]+/gi;
const HREF_RE = /href\s*=\s*(["'])(.*?)\1/gi;
const AUTH_URL_HINT_RE = /(?:verify|verification|auth|login|confirm|confirmation|code|otp|token|인증|확인|보안)/i;

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/gi, '/');
}

function normalize(value: string): string {
  return decodeBasicEntities(value).replace(/\s+/g, ' ').trim();
}

function htmlToText(html: string): string {
  return normalize(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function isLikelyFalsePositive(code: string, context: string): boolean {
  const n = Number(code);
  if (code.length === 4 && n >= 1900 && n <= 2099) return true;
  const around = context.toLowerCase();
  if (/([₩$]|krw|usd)\s*$/.test(around) || /^\s*([₩$]|krw|usd|원)/.test(around)) return true;
  if (/(?:주문|order|invoice|상품|product|id|번호)\s*[:#-]?\s*$/.test(around) && !AUTH_WORD_RE.test(around)) return true;
  return false;
}

function addUnique(arr: string[], value: string) {
  if (value && !arr.includes(value)) arr.push(value);
}

function cleanLink(link: string): string {
  return decodeBasicEntities(link).replace(/[.,;:!?]+$/g, '').trim();
}

function extractLinks(raw: string): string[] {
  const out: string[] = [];
  HREF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HREF_RE.exec(raw)) !== null) {
    const link = cleanLink(match[2]);
    if (AUTH_URL_HINT_RE.test(link)) addUnique(out, link);
  }
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(raw)) !== null) {
    const link = cleanLink(match[0]);
    if (AUTH_URL_HINT_RE.test(link)) addUnique(out, link);
  }
  return out;
}

function extractCodesFromText(raw: string): { codes: string[]; pattern?: string; strong: boolean } {
  const text = normalize(raw);
  const codes: string[] = [];
  let pattern: string | undefined;
  let strong = false;

  const authBefore = new RegExp(`${AUTH_WORD_SOURCE}[^0-9]{0,40}${CODE_SOURCE}`, 'giu');
  let match: RegExpExecArray | null;
  while ((match = authBefore.exec(text)) !== null) {
    const code = match[1];
    const context = text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30);
    if (!isLikelyFalsePositive(code, context)) {
      addUnique(codes, code);
      pattern ||= 'auth-word-before-code';
      strong = true;
    }
  }

  const codeBefore = new RegExp(`${CODE_SOURCE}[^\p{L}0-9]{0,40}${AUTH_WORD_SOURCE}`, 'giu');
  while ((match = codeBefore.exec(text)) !== null) {
    const code = match[1];
    const context = text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30);
    if (!isLikelyFalsePositive(code, context)) {
      addUnique(codes, code);
      pattern ||= 'code-before-auth-word';
      strong = true;
    }
  }

  if (codes.length === 0 && AUTH_WORD_RE.test(text)) {
    const anyCode = new RegExp(CODE_SOURCE, 'gu');
    while ((match = anyCode.exec(text)) !== null) {
      const code = match[1];
      const context = text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40);
      if (AUTH_WORD_RE.test(context) && !isLikelyFalsePositive(code, context)) {
        addUnique(codes, code);
        pattern ||= 'nearby-auth-word';
        strong = true;
      }
    }
  }

  return { codes, pattern, strong };
}

export function extractAuthCode(input: AuthCodeExtractionInput): AuthCodeExtraction {
  const buckets: Array<{ source: Exclude<AuthExtractionSource, 'mixed' | 'none'>; raw: string; text: string }> = [];
  if (input.subject?.trim()) buckets.push({ source: 'subject', raw: input.subject, text: input.subject });
  if (input.text?.trim()) buckets.push({ source: 'text', raw: input.text, text: input.text });
  if (input.html?.trim()) buckets.push({ source: 'html', raw: input.html, text: htmlToText(input.html) });

  const codes: string[] = [];
  const links: string[] = [];
  const sources = new Set<Exclude<AuthExtractionSource, 'mixed' | 'none'>>();
  let matchedPattern: string | undefined;
  let strongCode = false;

  for (const bucket of buckets) {
    const extracted = extractCodesFromText(bucket.text);
    for (const code of extracted.codes) {
      addUnique(codes, code);
      sources.add(bucket.source);
    }
    if (extracted.pattern) matchedPattern ||= extracted.pattern;
    if (extracted.strong) strongCode = true;

    const foundLinks = extractLinks(bucket.source === 'html' ? bucket.raw : bucket.text);
    for (const link of foundLinks) {
      addUnique(links, link);
      sources.add(bucket.source);
    }
    if (foundLinks.length) matchedPattern ||= 'auth-url';
  }

  const sourceList = Array.from(sources);
  const source: AuthExtractionSource = sources.size === 0 ? 'none' : sources.size === 1 ? sourceList[0] : 'mixed';
  const confidence: AuthExtractionConfidence = codes.length > 0 && strongCode
    ? 'high'
    : links.length > 0
      ? 'medium'
      : codes.length > 0
        ? 'low'
        : 'none';

  return { codes, links, confidence, source, ...(matchedPattern ? { matchedPattern } : {}) };
}

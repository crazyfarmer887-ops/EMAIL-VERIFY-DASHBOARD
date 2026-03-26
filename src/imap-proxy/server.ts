/**
 * IMAP Proxy Server (Bun HTTP) - PORT 6932
 */
import { ImapFlow } from 'imapflow';

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';

if (!GMAIL_USER || !GMAIL_PASS) {
  console.error('[IMAP] GMAIL_USER, GMAIL_APP_PASSWORD 환경변수 필요');
  process.exit(1);
}

function decodeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _cs, enc, encoded) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(encoded, 'base64').toString('utf-8');
      return encoded.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
    } catch { return encoded; }
  });
}

function decodeBody(body: string, encoding: string, charset = 'utf-8'): string {
  const enc = (encoding || '').toLowerCase().trim();
  const cs = (charset || 'utf-8').toLowerCase().replace(/['"]/g, '').trim() || 'utf-8';
  try {
    if (enc === 'base64') {
      return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8');
    }
    if (enc === 'quoted-printable') {
      // QP 디코딩: =XX 시퀀스를 바이트로 모은 뒤 charset으로 디코딩
      const binaryStr = body
        .replace(/=\r\n/g, '')
        .replace(/=\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      // binary string → Buffer → 올바른 charset으로 디코딩
      const buf = Buffer.from(binaryStr, 'latin1');
      // Node.js는 utf-8, latin1, utf16le 등 지원; euc-kr은 TextDecoder 필요
      if (cs === 'utf-8' || cs === 'utf8') return buf.toString('utf-8');
      if (cs === 'latin1' || cs === 'iso-8859-1') return buf.toString('latin1');
      // euc-kr, ks_c_5601 등은 TextDecoder로
      try {
        const label = cs === 'ks_c_5601-1987' || cs === 'ks_c_5601' ? 'euc-kr' : cs;
        return new TextDecoder(label).decode(buf);
      } catch {
        return buf.toString('utf-8');
      }
    }
  } catch { /**/ }
  return body;
}

function extractCharset(ct: string): string {
  return ct.match(/charset=["']?([^"';\s]+)["']?/i)?.[1] || 'utf-8';
}

function escapeRx(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

interface ParsedEmail {
  subject: string; from: string; originalFrom: string;
  date: string; html: string | null; text: string | null; aliasTo: string;
}

function extractParts(body: string, boundary: string): { ct: string; enc: string; body: string }[] {
  const parts: { ct: string; enc: string; body: string }[] = [];
  const split = body.split(new RegExp(`--${escapeRx(boundary)}(?:--)?(?:\r?\n|$)`));
  for (const part of split) {
    if (!part.trim()) continue;
    const norm = part.replace(/\r\n/g, '\n');
    const sep = norm.indexOf('\n\n');
    if (sep < 0) continue;
    const ph = norm.slice(0, sep).replace(/\n[ \t]+/g, ' ');
    const pb = norm.slice(sep + 2);
    const phMap: Record<string, string> = {};
    for (const l of ph.split('\n')) {
      const c = l.indexOf(':');
      if (c < 0) continue;
      phMap[l.slice(0, c).toLowerCase().trim()] = l.slice(c + 1).trim();
    }
    parts.push({ ct: phMap['content-type'] || '', enc: phMap['content-transfer-encoding'] || '', body: pb });
  }
  return parts;
}

function parseEmailBody(body: string, ct: string, enc: string): { html: string | null; text: string | null } {
  const bm = ct.match(/boundary=["']?([^"';\s]+)["']?/i);
  if (bm) {
    const parts = extractParts(body, bm[1]);
    let html = null, text = null;
    for (const p of parts) {
      const pctLow = p.ct.toLowerCase();
      const subBm = p.ct.match(/boundary=["']?([^"';\s]+)["']?/i);
      if (subBm) {
        const sub = parseEmailBody(p.body, p.ct, p.enc);
        if (!html && sub.html) html = sub.html;
        if (!text && sub.text) text = sub.text;
      } else if (pctLow.includes('text/html') && !html) {
        html = decodeBody(p.body, p.enc, extractCharset(p.ct));
      } else if (pctLow.includes('text/plain') && !text) {
        text = decodeBody(p.body, p.enc, extractCharset(p.ct));
      }
    }
    return { html, text };
  }
  const charset = extractCharset(ct);
  const decoded = decodeBody(body, enc, charset);
  if (ct.toLowerCase().includes('text/html')) return { html: decoded, text: null };
  return { html: null, text: decoded };
}

function parseEmail(raw: string): ParsedEmail {
  const norm = raw.replace(/\r\n/g, '\n');
  const sep = norm.indexOf('\n\n');
  const headerStr = sep >= 0 ? norm.slice(0, sep) : norm;
  const bodyStr = sep >= 0 ? norm.slice(sep + 2) : '';
  const unfolded = headerStr.replace(/\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfolded.split('\n')) {
    const c = line.indexOf(':');
    if (c < 0) continue;
    const k = line.slice(0, c).toLowerCase().trim();
    if (!headers[k]) headers[k] = line.slice(c + 1).trim();
  }
  const subject = decodeHeader(headers['subject'] || '');
  const from = headers['from'] || '';
  const originalFrom = decodeHeader(headers['x-simplelogin-original-from'] || headers['reply-to'] || from);
  const date = headers['date'] || '';
  const aliasTo = headers['x-simplelogin-envelope-to'] || '';
  const mainCT = headers['content-type'] || '';
  const mainEnc = headers['content-transfer-encoding'] || '';
  const { html, text } = parseEmailBody(bodyStr, mainCT, mainEnc);
  return { subject, from, originalFrom, date, html, text, aliasTo };
}

async function fetchEmail(aliasEmail: string, originalFrom: string, timestampSec: number): Promise<ParsedEmail | null> {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const after = new Date((timestampSec - 3600 * 3) * 1000);
    const before = new Date((timestampSec + 3600 * 3) * 1000);
    const uids = await client.search({ since: after, before });
    if (!uids.length) return null;

    const fromEmailMatch = originalFrom.match(/<([^>]+)>/);
    const fromAddr = (fromEmailMatch?.[1] || originalFrom).toLowerCase().trim();

    let bestUid: number | null = null;
    let bestScore = -1;

    // fetchOne으로 각 uid의 헤더 확인
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { headers: true });
      if (!msg) continue;
      const hBuf = (msg as any).headers;
      const h = Buffer.isBuffer(hBuf) ? hBuf.toString() : String(hBuf || '');
      const slType = (h.match(/x-simplelogin-type:\s*(\S+)/i)?.[1] || '').trim();
      if (slType !== 'Forward') continue;

      const slEnvTo = (h.match(/x-simplelogin-envelope-to:\s*([^\r\n]+)/i)?.[1] || '').toLowerCase().trim();
      const slOrigFrom = (h.match(/x-simplelogin-original-from:\s*([^\r\n]+)/i)?.[1] || '').toLowerCase().trim();

      let score = 1; // is Forward
      if (aliasEmail && slEnvTo.includes(aliasEmail.toLowerCase())) score += 10;
      if (fromAddr) {
        const fromUser = fromAddr.split('@')[0];
        const fromDomain = fromAddr.split('@')[1] || '';
        if (slOrigFrom.includes(fromUser)) score += 5;
        if (slOrigFrom.includes(fromDomain)) score += 3;
      }
      if (score > bestScore) { bestScore = score; bestUid = uid; }
      // alias 정확히 매칭되면 바로 사용
      if (score >= 11) break;
    }

    if (bestUid === null || bestScore < 2) return null;
    const fullMsg = await client.fetchOne(String(bestUid), { source: true });
    if (!fullMsg?.source) return null;
    return parseEmail(fullMsg.source.toString());
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

Bun.serve({
  port: 6932,
  async fetch(req) {
    const url = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/ping') return new Response(JSON.stringify({ ok: true }), { headers: cors });
    if (url.pathname === '/email') {
      const alias = url.searchParams.get('alias') || '';
      const from  = url.searchParams.get('from') || '';
      const ts    = Number(url.searchParams.get('ts') || '0');
      if (!ts) return new Response(JSON.stringify({ error: 'ts 파라미터 필요' }), { status: 400, headers: cors });
      try {
        const result = await fetchEmail(alias, from, ts);
        if (!result) return new Response(JSON.stringify({ error: '이메일을 찾을 수 없어요' }), { status: 404, headers: cors });
        return new Response(JSON.stringify(result), { headers: cors });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `IMAP 오류: ${e.message}` }), { status: 500, headers: cors });
      }
    }
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
  },
});

console.log(`[IMAP Proxy] :6932  (${GMAIL_USER})`);

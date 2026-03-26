/**
 * Vite dev 서버 미들웨어로 IMAP 직접 처리
 * /api/email/raw 요청을 Node.js 레이어에서 가로채서 Gmail IMAP 조회
 * Cloudflare Workers 런타임 우회 (TCP 소켓 필요)
 */
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// .env 수동 로드 (Vite 플러그인은 loadEnv 전에 실행될 수 있음)
function loadEnvFile() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /**/ }
}
loadEnvFile();

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
    if (enc === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8');
    if (enc === 'quoted-printable') {
      const bin = body.replace(/=\r\n/g, '').replace(/=\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const buf = Buffer.from(bin, 'latin1');
      if (cs === 'utf-8' || cs === 'utf8') return buf.toString('utf-8');
      if (cs === 'latin1' || cs === 'iso-8859-1') return buf.toString('latin1');
      try {
        const label = cs === 'ks_c_5601-1987' || cs === 'ks_c_5601' ? 'euc-kr' : cs;
        return new TextDecoder(label).decode(buf);
      } catch { return buf.toString('utf-8'); }
    }
  } catch { /**/ }
  return body;
}

function extractCharset(ct: string): string {
  return ct.match(/charset=["']?([^"';\s]+)["']?/i)?.[1] || 'utf-8';
}

function escapeRx(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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
  const decoded = decodeBody(body, enc, extractCharset(ct));
  if (ct.toLowerCase().includes('text/html')) return { html: decoded, text: null };
  return { html: null, text: decoded };
}

function parseEmail(raw: string) {
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
  const { html, text } = parseEmailBody(bodyStr, headers['content-type'] || '', headers['content-transfer-encoding'] || '');
  return { subject, from, originalFrom, date, html, text, aliasTo };
}

async function fetchEmailImap(aliasEmail: string, originalFrom: string, timestampSec: number, user: string, pass: string) {
  // imapflow는 Vite 플러그인(Node.js) 컨텍스트에서 동적 임포트
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user, pass },
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

    const fromMatch = originalFrom.match(/<([^>]+)>/);
    const fromAddr = (fromMatch?.[1] || originalFrom).toLowerCase().trim();

    let bestUid: number | null = null;
    let bestScore = -1;

    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { headers: true });
      if (!msg) continue;
      const hBuf = (msg as any).headers;
      const h = Buffer.isBuffer(hBuf) ? hBuf.toString() : String(hBuf || '');
      if (!(h.match(/x-simplelogin-type:\s*Forward/i))) continue;

      const slEnvTo = (h.match(/x-simplelogin-envelope-to:\s*([^\r\n]+)/i)?.[1] || '').toLowerCase().trim();
      const slOrigFrom = (h.match(/x-simplelogin-original-from:\s*([^\r\n]+)/i)?.[1] || '').toLowerCase().trim();

      let score = 1;
      if (aliasEmail && slEnvTo.includes(aliasEmail.toLowerCase())) score += 10;
      const fromUser = fromAddr.split('@')[0];
      const fromDomain = fromAddr.split('@')[1] || '';
      if (slOrigFrom.includes(fromUser)) score += 5;
      if (slOrigFrom.includes(fromDomain)) score += 3;

      if (score > bestScore) { bestScore = score; bestUid = uid; }
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

function jsonRes(res: ServerResponse, status: number, data: object) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

export default function imapPlugin(): Plugin {
  return {
    name: 'imap-middleware',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/email/raw')) return next();

        const url = new URL(req.url, 'http://localhost');
        const alias = url.searchParams.get('alias') || '';
        const from  = url.searchParams.get('from')  || '';
        const ts    = Number(url.searchParams.get('ts') || '0');

        const user = process.env.GMAIL_USER || '';
        const pass = process.env.GMAIL_APP_PASSWORD || '';

        if (!user || !pass) return jsonRes(res, 503, { error: 'Gmail 환경변수 미설정 (GMAIL_USER, GMAIL_APP_PASSWORD)' });
        if (!ts) return jsonRes(res, 400, { error: 'ts 파라미터 필요' });

        try {
          const result = await fetchEmailImap(alias, from, ts, user, pass);
          if (!result) return jsonRes(res, 404, { error: '이메일을 찾을 수 없어요' });
          jsonRes(res, 200, result);
        } catch (e: any) {
          console.error('[IMAP]', e.message);
          jsonRes(res, 500, { error: `IMAP 오류: ${e.message}` });
        }
      });
    },
  };
}

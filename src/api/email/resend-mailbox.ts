import { createHash } from 'node:crypto';
import { extractAuthCode } from '../../lib/auth-code-extractor.ts';
import type { EmailRow } from './email-store.ts';

type Received = { id: string; to: string[]; from: string; subject: string; created_at: string; text?: string; html?: string; authentication?: { dkim?: string; dmarc?: string }; received_for?: string[] };
export function disneyCodeRow(mail: Received, alias: string, now = Date.now()): EmailRow | null {
  const timestamp = Date.parse(mail.created_at);
  const sender = mail.from.match(/<([^>]+)>/)?.[1] || mail.from;
  if (mail.authentication?.dkim !== 'pass' || mail.authentication?.dmarc !== 'pass'
    || !mail.received_for?.some(x => x.trim().toLowerCase() === alias) || !mail.to.some(x => x.trim().toLowerCase() === alias) || !/^[^@\s]+@(?:[a-z0-9-]+\.)*disneyplus\.com$/i.test(sender)
    || !/^[0-9a-f-]{36}$/i.test(mail.id) || !Number.isFinite(timestamp) || timestamp > now + 60000 || timestamp < now - 15 * 60000
    || /비밀번호|password|reset|재설정/i.test(mail.subject) || !/코드|인증|code|verification/i.test(mail.subject)) return null;
  const extraction = extractAuthCode({subject: mail.subject, text: mail.text, html: mail.html});
  const codes = extraction.codes.filter(x => /^\d{6}$/.test(x));
  if (codes.length !== 1 || !['high', 'medium'].includes(extraction.confidence)) return null;
  // A separate negative UID namespace avoids collisions with positive IMAP UIDs.
  const uid = -parseInt(createHash('sha256').update(`resend:${mail.id}:${alias}`).digest('hex').slice(0, 13), 16);
  return { uid, alias_to: alias, from_addr: sender, original_from: sender, subject: '디즈니+ 이메일 인증 코드',
    html: null, text_body: `디즈니+ 인증 코드: ${codes[0]}\n본인이 요청한 최신 코드만 이용하세요.`,
    date_str: new Date(timestamp).toISOString(), timestamp_sec: Math.floor(timestamp / 1000), fetched_at: now };
}
export function createResendMailboxSync(deps: { fetcher: typeof fetch; upsert: (row: EmailRow) => Promise<void>; now?: () => number }) {
  const flights = new Map<string, Promise<void>>(); const checked = new Map<string, number>();
  return async (alias: string, env = process.env): Promise<void> => {
    alias = alias.trim().toLowerCase();
    const allowed = (env.RESEND_DISNEY_MAILBOXES || '').split(',').map(x => x.trim().toLowerCase());
    if (!env.RESEND_API_KEY || !allowed.includes(alias)) return;
    if (flights.has(alias)) return flights.get(alias);
    const now = (deps.now || Date.now)(); if (now - (checked.get(alias) || 0) < 15000) return;
    const read = async (path: string) => {
      const response = await deps.fetcher(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('이메일 수신 연결을 확인해주세요.');
      return response.json();
    };
    checked.set(alias, now);
    const flight = (async () => {
      const list = await read('/emails/receiving?limit=100') as { data?: Received[] };
      if (!Array.isArray(list.data)) throw new Error('이메일 수신 목록을 확인해주세요.');
      const candidates = list.data.filter(x => Array.isArray(x.to) && x.to.some(t => t.trim().toLowerCase() === alias)
        && Date.parse(x.created_at) >= now - 15 * 60000 && /코드|인증|code|verification/i.test(x.subject)).slice(0, 5);
      for (const item of candidates) {
        if (!/^[0-9a-f-]{36}$/i.test(item.id)) continue;
        const detail = await read(`/emails/receiving/${item.id}`) as Received;
        const row = disneyCodeRow(detail, alias, now); if (row) await deps.upsert(row);
      }
      checked.set(alias, now);
    })();
    flights.set(alias, flight); try { await flight; } finally { flights.delete(alias); }
  };
}

import { Pool } from 'pg';

export const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'emailcache',
  user: 'emailapp',
  password: 'emailapp123',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export interface EmailRow {
  uid: number;
  alias_to: string;
  from_addr: string;
  original_from: string;
  subject: string;
  html: string | null;
  text_body: string | null;
  date_str: string;
  timestamp_sec: number;
  fetched_at: number;
}

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_cache (
      uid            BIGINT PRIMARY KEY,
      alias_to       TEXT NOT NULL DEFAULT '',
      from_addr      TEXT NOT NULL DEFAULT '',
      original_from  TEXT NOT NULL DEFAULT '',
      subject        TEXT NOT NULL DEFAULT '',
      html           TEXT,
      text_body      TEXT,
      date_str       TEXT NOT NULL DEFAULT '',
      timestamp_sec  BIGINT NOT NULL DEFAULT 0,
      fetched_at     BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_email_alias_ts  ON email_cache(alias_to, timestamp_sec);
    CREATE INDEX IF NOT EXISTS idx_email_ts        ON email_cache(timestamp_sec DESC);
  `);
  console.log('[emailstore] DB 초기화 완료');
}

export async function upsertEmail(row: EmailRow) {
  await pool.query(
    `INSERT INTO email_cache
       (uid, alias_to, from_addr, original_from, subject, html, text_body, date_str, timestamp_sec, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (uid) DO UPDATE SET
       alias_to      = EXCLUDED.alias_to,
       subject       = EXCLUDED.subject,
       html          = EXCLUDED.html,
       text_body     = EXCLUDED.text_body,
       fetched_at    = EXCLUDED.fetched_at`,
    [row.uid, row.alias_to, row.from_addr, row.original_from,
     row.subject, row.html, row.text_body, row.date_str,
     row.timestamp_sec, row.fetched_at]
  );
}

export async function bulkUpsertEmails(rows: EmailRow[]) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(
        `INSERT INTO email_cache
           (uid, alias_to, from_addr, original_from, subject, html, text_body, date_str, timestamp_sec, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (uid) DO UPDATE SET
           alias_to   = EXCLUDED.alias_to,
           subject    = EXCLUDED.subject,
           html       = EXCLUDED.html,
           text_body  = EXCLUDED.text_body,
           fetched_at = EXCLUDED.fetched_at`,
        [row.uid, row.alias_to, row.from_addr, row.original_from,
         row.subject, row.html, row.text_body, row.date_str,
         row.timestamp_sec, Date.now()]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getMaxUid(): Promise<number> {
  const res = await pool.query('SELECT COALESCE(MAX(uid), 0) as max_uid FROM email_cache');
  return Number(res.rows[0].max_uid);
}

/**
 * alias + timestamp 범위 내 이메일 조회
 * - 스레드(같은 subject 여러 개) 대응: 범위 내에서 timestamp 차이가 가장 작은 것 반환
 * - rangeSeconds: ±3600(1시간) — SL 포워드 딜레이 최대 1시간 대응
 * - from 도메인으로 1차 매칭, 없으면 alias+시간만으로 2차
 */
export async function findEmail(alias: string, tsSec: number, fromAddr?: string, rangeSeconds = 120): Promise<EmailRow | null> {
  // 1차: alias + from 도메인 + 시간 범위 → 가장 최신
  if (fromAddr) {
    const fromPart = fromAddr.match(/<([^>]+)>/)?.[1] || fromAddr;
    const domain = fromPart.split('@')[1] || '';
    if (domain) {
      const res = await pool.query<EmailRow>(
        `SELECT * FROM email_cache
         WHERE alias_to ILIKE $1
           AND timestamp_sec BETWEEN $2 AND $3
           AND (from_addr ILIKE $4 OR original_from ILIKE $4)
         ORDER BY ABS(timestamp_sec - $5) ASC, timestamp_sec ASC
         LIMIT 1`,
        [`%${alias}%`, tsSec - rangeSeconds, tsSec + rangeSeconds, `%${domain}%`, tsSec]
      );
      if (res.rows[0]) return res.rows[0];
    }
  }

  // 2차: alias + 시간 범위만 → 가장 최신
  const res = await pool.query<EmailRow>(
    `SELECT * FROM email_cache
     WHERE alias_to ILIKE $1
       AND timestamp_sec BETWEEN $2 AND $3
     ORDER BY ABS(timestamp_sec - $4) ASC, timestamp_sec ASC
     LIMIT 1`,
    [`%${alias}%`, tsSec - rangeSeconds, tsSec + rangeSeconds, tsSec]
  );
  return res.rows[0] ?? null;
}

/** alias의 최근 N개 subject 목록 조회 */
export async function getSubjectList(alias: string, limit = 30): Promise<{ timestamp_sec: number; subject: string; from_addr: string }[]> {
  const res = await pool.query(
    `SELECT timestamp_sec, subject, from_addr
     FROM email_cache
     WHERE alias_to ILIKE $1
     ORDER BY timestamp_sec DESC
     LIMIT $2`,
    [`%${alias}%`, limit]
  );
  return res.rows;
}

/** alias의 메일 목록 (최근 10분 내, 제목·발신자 등 포함) */
export async function getEmailList(alias: string, limit = 50): Promise<EmailRow[]> {
  const res = await pool.query<EmailRow>(
    `SELECT * FROM email_cache
     WHERE alias_to ILIKE $1
     ORDER BY timestamp_sec DESC
     LIMIT $2`,
    [`%${alias}%`, limit]
  );
  return res.rows;
}

/** uid로 단일 이메일 조회 (정확한 1:1 매칭) */
export async function getEmailByUid(uid: number): Promise<EmailRow | null> {
  const res = await pool.query<EmailRow>(
    `SELECT * FROM email_cache WHERE uid = $1`,
    [uid]
  );
  return res.rows[0] ?? null;
}

export async function getLatestEmailReceivedAt(): Promise<string | null> {
  const res = await pool.query<{ timestamp_sec: number | string | null }>(
    'SELECT MAX(timestamp_sec) as timestamp_sec FROM email_cache'
  );
  const ts = Number(res.rows[0]?.timestamp_sec || 0);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts * 1000).toISOString();
}

/**
 * 1시간 이전 이메일 삭제 (주기적 호출)
 * 단, 가장 최근 이메일은 각 alias당 최소 10개 보존
 */
export async function pruneOldEmails(): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - 3600; // 1시간 전 unix timestamp

  const res = await pool.query(
    `DELETE FROM email_cache
     WHERE uid IN (
       SELECT uid FROM email_cache ec
       WHERE timestamp_sec < $1
         AND uid NOT IN (
           -- 각 alias별 최근 10개는 보존
           SELECT uid FROM (
             SELECT uid, ROW_NUMBER() OVER (
               PARTITION BY alias_to ORDER BY timestamp_sec DESC
             ) as rn
             FROM email_cache
           ) ranked
           WHERE rn <= 10
         )
     )`,
    [cutoff]
  );
  return res.rowCount ?? 0;
}

/**
 * Vite dev 서버 미들웨어로 원본 이메일 조회를 가로채는 플러그인
 * Cloudflare Workers 전용 IMAP 경로를 Node.js/GWS 기반 조회로 대체한다.
 */
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { fetchRawEmail } from '../../src/api/email/raw-email';

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
        const from = url.searchParams.get('from') || '';
        const ts = Number(url.searchParams.get('ts') || '0');

        if (!ts) return jsonRes(res, 400, { error: 'ts 파라미터 필요' });

        try {
          const result = await fetchRawEmail(alias, from, ts);
          if (!result) return jsonRes(res, 404, { error: '이메일을 찾을 수 없어요' });
          jsonRes(res, 200, result);
        } catch (e: any) {
          jsonRes(res, 500, { error: `메일 조회 실패: ${e.message}` });
        }
      });
    },
  };
}

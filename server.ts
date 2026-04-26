import { serve } from '@hono/node-server';
import { extname, resolve, sep } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import app from './src/api/index';
import { initDB } from './src/api/email/email-store';
import { startImapSync } from './src/api/email/imap-sync';

const port = Number(process.env.PORT || 3000);
const distDir = resolve(process.cwd(), 'dist');
const rawBasePath = process.env.VITE_BASE_PATH || process.env.APP_BASE_PATH || '/email';
const basePath = rawBasePath === '/' ? '' : `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function isInsideDist(filePath: string): boolean {
  const normalized = resolve(filePath);
  return normalized === distDir || normalized.startsWith(distDir + sep);
}

function stripBasePath(pathname: string) {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return pathname;
}

async function readStaticFile(pathname: string): Promise<Response | null> {
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const candidate = resolve(distDir, `.${relPath}`);

  if (!isInsideDist(candidate)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const fileStat = await stat(candidate);
    if (!fileStat.isFile()) return null;

    const body = await readFile(candidate);
    return new Response(body, {
      headers: {
        'Content-Type': MIME_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': candidate.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  } catch {
    return null;
  }
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = stripBasePath(url.pathname);

  if (basePath && pathname === '/' && url.pathname === '/') {
    return Response.redirect(new URL(`${basePath}/`, url.origin), 302);
  }

  if (pathname.startsWith('/api/')) {
    const apiUrl = new URL(req.url);
    apiUrl.pathname = pathname;
    const init: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers: req.headers,
      signal: req.signal,
      redirect: req.redirect,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.clone().arrayBuffer();
      init.duplex = 'half';
    }

    return app.fetch(new Request(apiUrl.toString(), init));
  }

  const asset = await readStaticFile(pathname);
  if (asset) return asset;

  const index = await readStaticFile('/index.html');
  if (index) return index;

  return new Response('Build the app first with "npm run build".', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

serve({
  fetch: handleRequest,
  port,
});

console.log(`[graytag] Node server running on http://localhost:${port}`);

// DB 초기화 + IMAP sync 워커 시작
initDB()
  .then(() => startImapSync())
  .catch(e => console.error('[startup] DB/IMAP 초기화 실패:', e.message));

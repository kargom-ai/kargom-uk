import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROOT = new URL('../../public/', import.meta.url).pathname;
/** Changes on every deploy, so phones never keep yesterday's CSS/JS after an update. */
const BUILD = Date.now().toString(36);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Page routes → HTML file. Everything under /app and /admin is a single-page app. */
function pageFor(pathname: string): string | null {
  if (pathname === '/' || pathname === '/index.html') return 'index.html';
  if (pathname === '/login' || pathname === '/register') return 'login.html';
  if (pathname === '/quotes') return 'quotes.html';
  if (pathname === '/app/send') return 'send.html';
  if (pathname === '/app' || pathname.startsWith('/app/')) return 'app.html';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin.html';
  return null;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://api.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Serve the website. Returns false if nothing matched (the API router then answers 404). */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const page = pageFor(pathname);
  const rel = page ?? (pathname.startsWith('/assets/') || pathname === '/favicon.ico' || pathname === '/robots.txt' ? pathname.slice(1) : null);
  if (!rel) return false;
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return false; // no ../ escapes
  try {
    const st = await stat(file);
    if (!st.isFile()) return false;
    const ext = extname(file);
    const code = ext === '.css' || ext === '.js';
    // Scripts and styles: always re-check with the server (cheap 304 when unchanged).
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (!page && code && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      res.end();
      return true;
    }
    let body: Buffer | string = await readFile(file);
    // Pages point at versioned asset URLs, so a new deploy is picked up straight away.
    if (page) body = body.toString('utf8').replace(/(\/assets\/[\w/.-]+\.(?:css|js))(?=["'])/g, `$1?v=${BUILD}`);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': page || code ? 'no-cache' : 'public, max-age=86400',
      ...(!page && code ? { ETag: etag } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      ...(page ? { 'Content-Security-Policy': CSP } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}

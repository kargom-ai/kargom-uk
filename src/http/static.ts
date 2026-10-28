import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { footer, headTags } from '../seo/render.ts';

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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** What search engines see for the app pages. Pages not listed here are private (noindex). */
const SEO: Record<string, { title: string; description: string; path: string; footer?: boolean; ld?: boolean }> = {
  'index.html': { title: 'Cheap Parcel Delivery UK: Compare Couriers and Save | Kargom', path: '/', footer: true, ld: true,
    description: 'Compare live prices from Royal Mail, Evri, DPD, InPost, Yodel, Parcelforce, UPS and DHL. Book in a minute, print your label and track it. No account needed.' },
  'login.html': { title: 'Sign In or Create an Account | Kargom', path: '/login', footer: true,
    description: 'Sign in to Kargom or create a free account to save addresses, top up a wallet and manage all your parcels in one place.' },
};
const PRIVATE = new Set(['app.html', 'admin.html', 'checkout.html', 'label.html', 'send.html', 'quotes.html']);
const SITE_LD = () => {
  const base = (process.env.PUBLIC_URL || 'https://kargom.co.uk').replace(/\/+$/, '');
  return `<script type="application/ld+json">${JSON.stringify([
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Kargom', url: `${base}/`, logo: `${base}/assets/logo.png` },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Kargom', url: `${base}/` },
  ])}</script>`;
};

function decorate(file: string, html: string): string {
  const meta = SEO[file];
  if (meta) {
    html = html.replace(/<title>[^<]*<\/title>/, headTags(meta) + (meta.ld ? SITE_LD() : ''));
    if (meta.footer) html = html.replace('</head>', '<link rel="stylesheet" href="/assets/foot.css">\n</head>').replace(/<\/body>/, `${footer()}\n</body>`);
  } else if (PRIVATE.has(file)) {
    html = html.replace('</head>', '<meta name="robots" content="noindex, nofollow">\n</head>');
  }
  return html;
}

/** Page routes → HTML file. Everything under /app and /admin is a single-page app. */
function pageFor(pathname: string): string | null {
  if (pathname === '/' || pathname === '/index.html') return 'index.html';
  if (pathname === '/login' || pathname === '/register') return 'login.html';
  if (pathname === '/quotes') return 'quotes.html';
  if (pathname === '/app/send') return 'send.html';
  if (pathname === '/checkout') return 'checkout.html';
  if (pathname.startsWith('/l/')) return 'label.html';
  if (pathname === '/app' || pathname.startsWith('/app/')) return 'app.html';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin.html';
  return null;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com https://*.js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://*.stripe.com",
  "connect-src 'self' https://api.stripe.com https://*.stripe.com",
  "media-src 'self' https:",
  "frame-src 'self' https://www.youtube-nocookie.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://*.stripe.com",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Serve the website. Returns false if nothing matched (the API router then answers 404). */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const page = pageFor(pathname);
  // File names may contain spaces or Turkish letters (arrive as %20, %C3%BC ...).
  let path = pathname;
  try { path = decodeURIComponent(pathname); } catch { return false; }
  if (path.includes('\0')) return false;
  const rel = page ?? (path.startsWith('/assets/') || path === '/favicon.ico' || path === '/robots.txt' ? path.slice(1) : null);
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
    // Videos: stream with byte ranges (Safari and iPhones need this to play at all).
    if (ext === '.mp4' || ext === '.webm' || ext === '.mov' || ext === '.m4v') {
      const size = st.size;
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      let start = 0, end = size - 1, status = 200;
      if (m && (m[1] || m[2])) {
        if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
        else { start = Math.max(0, size - Number(m[2])); }
        if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true; }
        status = 206;
      }
      res.writeHead(status, {
        'Content-Type': TYPES[ext]!, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
        ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
        'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') { res.end(); return true; }
      createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
      return true;
    }
    let body: Buffer | string = await readFile(file);
    // Pages point at versioned asset URLs, so a new deploy is picked up straight away.
    if (page) body = decorate(page, body.toString('utf8')).replace(/(\/assets\/[\w/.-]+\.(?:css|js))(?=["'])/g, `$1?v=${BUILD}`);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': page || code ? 'no-cache' : 'public, max-age=86400',
      ...(!page && code ? { ETag: etag } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      ...(page ? { 'Content-Security-Policy': CSP } : {}),
      ...(page && PRIVATE.has(page) ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}

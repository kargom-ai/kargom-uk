import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SeoPrices } from './prices.ts';
import {
  calculatorPage, courierPage, couriersHub, destinationPage, destinationsHub, guidePage, guidesHub, notFoundPage,
  parcelPricesPage, privacyPage, trackPagesOn, resolve, robots, sitemap, trackHub, trackPage,
} from './render.ts';

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
  "img-src 'self' data:", "connect-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function send(res: ServerResponse, req: IncomingMessage, status: number, type: string, body: string, maxAge = 600) {
  res.writeHead(status, {
    'Content-Type': type,
    // Short browser cache, longer shared cache: pages carry live prices but change at most every few hours.
    'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=86400`,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

const OURS = /^\/(parcel-prices|couriers|track|send-parcel-to|guides|tools)(\/|$)/;

/** Public guide pages, sitemap and robots.txt. Returns false when the path is not ours. */
export function serveSeo(req: IncomingMessage, res: ServerResponse, path: string, prices: SeoPrices): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p !== path && OURS.test(p)) { res.writeHead(301, { Location: p }); res.end(); return true; } // one URL per page
  const html = (body: string) => send(res, req, 200, 'text/html; charset=utf-8', body);
  const notFound = () => send(res, req, 404, 'text/html; charset=utf-8', notFoundPage(), 60);

  if (p === '/robots.txt') return send(res, req, 200, 'text/plain; charset=utf-8', robots(), 3600);
  if (p === '/sitemap.xml') return send(res, req, 200, 'application/xml; charset=utf-8', sitemap(prices), 3600);
  const key = process.env.INDEXNOW_KEY;
  if (key && p === `/${key}.txt`) return send(res, req, 200, 'text/plain; charset=utf-8', key, 86400);

  if (p === '/privacy') return html(privacyPage());
  if (p === '/parcel-prices') return html(parcelPricesPage(prices));
  if (p === '/couriers') return html(couriersHub());
  if (p === '/track') return html(trackHub());
  if (p === '/send-parcel-to') return html(destinationsHub(prices));
  if (p === '/guides') return html(guidesHub());
  if (p === '/tools/volumetric-weight-calculator') return html(calculatorPage());

  let m = /^\/couriers\/([a-z-]+)$/.exec(p);
  if (m) { const c = resolve.carrierBySlug(m[1]!); return c ? html(courierPage(c, prices)) : notFound(); }
  m = /^\/track\/([a-z-]+)$/.exec(p);
  if (m && !trackPagesOn()) { res.writeHead(302, { Location: '/track', 'Cache-Control': 'no-store' }); res.end(); return true; }
  if (m) { const c = resolve.carrierBySlug(m[1]!); return c ? html(trackPage(c)) : notFound(); }
  m = /^\/send-parcel-to\/([a-z-]+)$/.exec(p);
  if (m) return resolve.DESTINATIONS[m[1]!] ? html(destinationPage(m[1]!, prices)) : notFound();
  m = /^\/guides\/([a-z0-9-]+)$/.exec(p);
  if (m) { const g = resolve.guideBySlug(m[1]!); return g ? html(guidePage(g, prices)) : notFound(); }
  if (/^\/(couriers|track|send-parcel-to|guides|tools)\//.test(p)) return notFound();
  return false;
}

/** Tell Bing, Yandex and others (IndexNow) that the pages exist or changed. Google reads the sitemap. */
export async function pingIndexNow(urls: string[]) {
  const key = process.env.INDEXNOW_KEY;
  const site = process.env.PUBLIC_URL;
  if (!key || !site || !urls.length) return false;
  const host = new URL(site).hostname;
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${site.replace(/\/+$/, '')}/${key}.txt`, urlList: urls.slice(0, 10000) }),
  });
  return r.ok;
}

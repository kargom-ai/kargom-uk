/*
 * Google Ads tag (AW-18548186219) with cookie consent, as UK law (PECR / UK GDPR) asks:
 * nothing from Google loads until the visitor clicks Accept. The choice is remembered for 6 months.
 * Any element with data-cookie-settings opens the banner again (e.g. a "Cookie settings" link in the footer).
 */
(function () {
  var AW = 'AW-18548186219';
  var KEY = 'kg_consent';
  var MAX_AGE = 182 * 24 * 3600 * 1000;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && Date.now() - v.at < MAX_AGE ? v.choice : null; } catch (e) { return null; }
  }
  function save(choice) { try { localStorage.setItem(KEY, JSON.stringify({ choice: choice, at: Date.now() })); } catch (e) { /* private mode */ } }

  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + AW;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', AW);
  }

  /** For later: window.kgConversion('AW-…/label', { value: 4.99, currency: 'GBP', transaction_id: 'KGM-…' }) */
  window.kgConversion = function (sendTo, extra) { if (loaded) gtag('event', 'conversion', Object.assign({ send_to: sendTo }, extra || {})); };

  function banner() {
    if (document.getElementById('kg-consent')) return;
    var box = document.createElement('div');
    box.id = 'kg-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Cookies');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;background:#17263E;color:#fff;border-radius:16px;' +
      'padding:16px 18px;box-shadow:0 12px 32px rgba(15,25,45,.28);font:500 14px/1.5 "Nunito Sans",Arial,sans-serif;display:flex;flex-wrap:wrap;gap:12px;align-items:center';
    var p = document.createElement('p');
    p.style.cssText = 'margin:0;flex:1 1 260px';
    p.innerHTML = 'We use cookies to see which of our Google ads bring visitors, so we can keep prices low. <a href="/cookies" style="color:#8EC5FF;font-weight:700">Cookie policy</a>';
    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;flex:0 0 auto';
    function btn(text, primary, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = 'min-height:42px;padding:0 18px;border-radius:10px;font:800 14px "Nunito Sans",Arial,sans-serif;cursor:pointer;' +
        (primary ? 'background:#087BFF;color:#fff;border:0' : 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.45)');
      b.addEventListener('click', function () { fn(); box.remove(); });
      return b;
    }
    btns.appendChild(btn('Reject', false, function () { save('denied'); }));
    btns.appendChild(btn('Accept', true, function () { save('granted'); load(); }));
    box.appendChild(p);
    box.appendChild(btns);
    document.body.appendChild(box);
  }

  function start() {
    var c = read();
    if (c === 'granted') load();
    else if (c === null) banner();
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-cookie-settings]');
      if (t) { e.preventDefault(); banner(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/*
 * Live chat bubble (bottom right): visitors and customers write to the Kargom team, who answer from /admin/chat.
 * The conversation's private token stays in this browser (localStorage). No cookies, nothing for ads.
 * Open it from anywhere with a link to ?chat=open or any element with data-open-chat.
 */
(function () {
  if (window.__kgLiveChat) return;
  window.__kgLiveChat = true;
  var KEY = 'kg_livechat';
  var css = '' +
    '#kg-lc-btn{position:fixed;right:18px;bottom:18px;z-index:2147482000;display:flex;align-items:center;gap:10px;height:56px;padding:0 20px 0 16px;border:0;border-radius:999px;background:#17263E;color:#fff;' +
    'font:800 15px "Nunito Sans",Arial,sans-serif;box-shadow:0 10px 28px rgba(15,25,45,.3);cursor:pointer;transition:transform .15s,bottom .2s}' +
    '#kg-lc-btn:hover{transform:translateY(-2px)}#kg-lc-btn svg{flex:none}#kg-lc-btn .dot{position:absolute;top:6px;left:38px;width:12px;height:12px;border-radius:50%;background:#E5484D;border:2px solid #17263E}' +
    '#kg-lc-btn.raised{bottom:110px}' +
    '#kg-lc,#kg-lc *{box-sizing:border-box}#kg-lc div,#kg-lc form,#kg-lc p,#kg-lc span,#kg-lc b,#kg-lc small{margin:0;float:none;position:static;width:auto;max-width:none;min-width:0}' +
    '#kg-lc .hd,#kg-lc .ft,#kg-lc .msgs{width:100%}#kg-lc .row{width:100%}#kg-lc .row>*{min-width:0}' +
    '#kg-lc{padding:0!important;margin:0;border:0;position:fixed;right:18px;bottom:18px;z-index:2147482001;width:370px;max-width:calc(100vw - 24px);height:min(560px,calc(100vh - 36px));display:flex;flex-direction:column;background:#fff;' +
    'border-radius:20px;box-shadow:0 20px 50px rgba(15,25,45,.32);overflow:hidden;font:500 14px/1.45 "Nunito Sans",Arial,sans-serif;color:#17263E}' +
    '#kg-lc .hd{background:#17263E;color:#fff;padding:16px 16px 14px;display:flex;align-items:flex-start;gap:12px}' +
    '#kg-lc .hd .t{flex:1;min-width:0}#kg-lc .hd b{display:block;font-size:17px;font-weight:800}#kg-lc .hd small{display:flex;align-items:center;gap:6px;font-size:13px;color:#C9D6EA}' +
    '#kg-lc .hd small i{width:8px;height:8px;border-radius:50%;background:#8593A8}#kg-lc .hd small i.on{background:#4ADE80}' +
    '#kg-lc .hd button{background:transparent;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:8px}#kg-lc .hd button:hover{background:rgba(255,255,255,.12)}' +
    '#kg-lc .msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#F5F7FB}' +
    '#kg-lc .m{max-width:82%;padding:9px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}' +
    '#kg-lc .m.v{align-self:flex-end;background:#087BFF;color:#fff;border-bottom-right-radius:5px}' +
    '#kg-lc .m.a{align-self:flex-start;background:#fff;border:1px solid #E1E7EF;border-bottom-left-radius:5px}' +
    '#kg-lc .m small{display:block;font-size:11px;opacity:.7;margin-top:3px}' +
    '#kg-lc .hello{background:#fff;border:1px solid #E1E7EF;border-radius:16px;padding:12px 14px;color:#3E4A5C}' +
    '#kg-lc .ft{border-top:1px solid #E6EBF2;padding:12px;display:flex;flex-direction:column;gap:8px;background:#fff}' +
    '#kg-lc .row{display:flex;gap:8px}#kg-lc input,#kg-lc textarea{width:100%;box-sizing:border-box;border:1px solid #C9D6EA;border-radius:12px;padding:10px 12px;font:500 15px "Nunito Sans",Arial,sans-serif;color:#17263E;background:#fff}' +
    '#kg-lc textarea{resize:none;height:46px;max-height:120px}#kg-lc input:focus,#kg-lc textarea:focus{outline:2px solid #087BFF;outline-offset:0;border-color:#087BFF}' +
    '#kg-lc .send{flex:none;width:46px;height:46px;border-radius:12px;border:0;background:#087BFF;color:#fff;cursor:pointer;display:grid;place-items:center}#kg-lc .send:disabled{opacity:.5;cursor:default}' +
    '#kg-lc .err{color:#B42318;font-size:13px;margin:0}#kg-lc .note{font-size:12px;color:#6B7789;margin:0}' +
    '@media (max-width:560px){#kg-lc{right:0;bottom:0;width:100vw;max-width:100vw;height:88vh;border-radius:20px 20px 0 0}' +
    '#kg-lc-btn{right:14px;bottom:14px;height:52px;padding:0 16px 0 14px}#kg-lc-btn .lbl{display:none}#kg-lc-btn .dot{left:34px}#kg-lc-btn.raised{bottom:150px}}';
  var ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.8A8 8 0 1 1 21 12z"/></svg>';
  var SEND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';

  var S = { token: null, open: false, msgs: [], online: false, me: null, meTried: false, busy: false, err: '', timer: null };
  try { S.token = (JSON.parse(localStorage.getItem(KEY) || 'null') || {}).token || null; } catch (e) { /* private mode */ }
  var saveToken = function (t) { S.token = t; try { localStorage.setItem(KEY, JSON.stringify({ token: t })); } catch (e) { /* private mode */ } };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var time = function (iso) { try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  function req(method, path, body) {
    var h = { 'X-Requested-With': 'kargom' };
    if (S.token) h['X-Chat-Token'] = S.token;
    if (body) h['Content-Type'] = 'application/json';
    return fetch(path, { method: method, headers: h, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error((j.error && j.error.message) || 'Something went wrong'); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  var btn = document.createElement('button');
  btn.id = 'kg-lc-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Chat with Kargom');
  btn.innerHTML = ICON + '<span class="lbl">Chat with us</span>';
  var panel = null;

  function setDot(n) {
    var d = btn.querySelector('.dot');
    if (n && !d) { d = document.createElement('span'); d.className = 'dot'; btn.appendChild(d); }
    if (!n && d) d.remove();
  }

  function render() {
    if (!panel) return;
    var list = panel.querySelector('.msgs');
    var hello = '<div class="hello"><b>Hi! How can we help?</b><br>Ask us anything about a parcel, a price or your account. ' +
      (S.online ? 'We are online and usually reply in a few minutes.' : 'Leave a message and we will reply here and by email.') + '</div>';
    list.innerHTML = hello + S.msgs.map(function (m) {
      return '<div class="m ' + (m.from === 'agent' ? 'a' : 'v') + '">' + esc(m.body) + '<small>' + (m.from === 'agent' ? 'Kargom · ' : '') + time(m.at) + '</small></div>';
    }).join('');
    list.scrollTop = list.scrollHeight;
    var st = panel.querySelector('.hd small');
    st.innerHTML = '<i class="' + (S.online ? 'on' : '') + '"></i>' + (S.online ? 'Online now' : 'We reply within a few hours');
    var who = panel.querySelector('.who');
    who.style.display = !S.token && !S.me ? '' : 'none';
    var e = panel.querySelector('.err'); e.textContent = S.err; e.style.display = S.err ? '' : 'none';
    panel.querySelector('.send').disabled = S.busy;
  }

  function poll() {
    if (!S.token) {
      req('GET', '/api/chat/status').then(function (r) { S.online = r.online; render(); }).catch(function () {});
      return;
    }
    var last = S.msgs.length ? S.msgs[S.msgs.length - 1].id : '';
    req('GET', '/api/chat' + (last ? '?after=' + encodeURIComponent(last) : '')).then(function (r) {
      S.online = r.online;
      if (r.messages && r.messages.length) S.msgs = S.msgs.concat(r.messages);
      render();
    }).catch(function (e) { if (e.status === 401) { saveToken(null); S.msgs = []; render(); } });
  }

  function openPanel() {
    S.open = true;
    btn.style.display = 'none'; setDot(0);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'kg-lc'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Chat with Kargom');
      panel.innerHTML = '<div class="hd"><span class="t"><b>Chat with Kargom</b><small></small></span><button type="button" aria-label="Close chat">&times;</button></div>' +
        '<div class="msgs" aria-live="polite"></div>' +
        '<form class="ft" novalidate><div class="who"><div class="row"><input name="name" placeholder="Your name" autocomplete="name" maxlength="80">' +
        '<input name="email" type="email" placeholder="Email" autocomplete="email" maxlength="200"></div></div>' +
        '<p class="err" role="alert"></p><div class="row"><textarea name="body" placeholder="Write a message…" maxlength="2000" rows="1"></textarea>' +
        '<button class="send" type="submit" aria-label="Send">' + SEND + '</button></div>' +
        '<p class="note">We use your email only to reply to you.</p></form>';
      document.body.appendChild(panel);
      panel.querySelector('.hd button').addEventListener('click', closePanel);
      var ta = panel.querySelector('textarea');
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); panel.querySelector('form').requestSubmit(); } });
      ta.addEventListener('input', function () { ta.style.height = '46px'; ta.style.height = Math.min(120, ta.scrollHeight + 2) + 'px'; });
      panel.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, body = f.body.value.trim();
        if (!body || S.busy) return;
        S.busy = true; S.err = ''; render();
        var p = S.token ? req('POST', '/api/chat/messages', { body: body })
          : req('POST', '/api/chat/start', { name: f.name.value.trim(), email: f.email.value.trim(), message: body, page: location.pathname + location.search });
        p.then(function (r) {
          if (r.token) saveToken(r.token);
          S.msgs = r.messages || S.msgs; S.online = r.online; f.body.value = ''; ta.style.height = '46px';
        }).catch(function (er) { S.err = er.message; }).then(function () { S.busy = false; render(); ta.focus(); });
      });
    }
    panel.style.display = '';
    if (!S.meTried && !S.token) {
      S.meTried = true;
      req('GET', '/api/me').then(function (me) { S.me = me; render(); }).catch(function () {});
    }
    if (S.token && !S.msgs.length) req('GET', '/api/chat').then(function (r) { S.msgs = r.messages || []; S.online = r.online; render(); }).catch(function (e) { if (e.status === 401) saveToken(null); render(); });
    else poll();
    render();
    clearInterval(S.timer);
    S.timer = setInterval(function () { if (!document.hidden) poll(); }, 4000);
    setTimeout(function () { var t = panel.querySelector(S.token || S.me ? 'textarea' : 'input'); if (t && window.innerWidth > 560) t.focus(); }, 50);
  }

  function closePanel() {
    S.open = false;
    if (panel) panel.style.display = 'none';
    btn.style.display = '';
    clearInterval(S.timer);
    S.timer = setInterval(checkUnread, 30000);
  }

  function checkUnread() {
    if (!S.token || S.open || document.hidden) return;
    req('GET', '/api/chat/unread').then(function (r) { setDot(r.unread); }).catch(function (e) { if (e.status === 401) saveToken(null); });
  }

  // keep the bubble above the cookie banner while it is showing
  function place() { btn.classList.toggle('raised', !!document.getElementById('kg-consent')); }

  function start() {
    document.body.appendChild(btn);
    btn.addEventListener('click', openPanel);
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-open-chat]');
      if (t) { e.preventDefault(); openPanel(); }
    });
    place();
    new MutationObserver(place).observe(document.body, { childList: true });
    if (/[?&]chat=open\b/.test(location.search)) openPanel();
    else { checkUnread(); S.timer = setInterval(checkUnread, 30000); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

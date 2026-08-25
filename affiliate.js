// Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
/**
 * Peakora Affiliate Tracker — lightweight client-side attribution.
 *
 * Responsibilities (zero dependencies, ~self-contained):
 *  - Parse ?via=<code> or ?ref=<code> from the landing URL.
 *  - Persist attribution in a first-party cookie (domain=.peakora.life so it
 *    survives the marketing -> app subdomain hop) and localStorage, for 90
 *    days (configurable via PEAKORA_AFF.cookieDays).
 *  - Surface a global window.PeakoraAffiliate API: getReferralCode(),
 *    getAttribution(), attachToUrl(url), and auto-attach the referral token
 *    to Dodo checkout links.
 *
 * Cross-subdomain persistence: the cookie is written with domain=.peakora.life
 * so peakora.life + app.peakora.life share it. On localhost (no apex), the
 * cookie is host-only as a fallback and localStorage carries attribution
 * within the same origin.
 *
 * The tracker only STORES a referral token. Commission is computed
 * server-side from the verified payment webhook — this script never grants
 * credit, it only helps the backend attribute clicks.
 */
(function () {
  'use strict';

  var PEAKORA_API = (function () {
    // Prefer the deployed Worker; fall back to local dev server.
    var host = window.location.hostname || '';
    if (host.indexOf('localhost') !== -1 || host.indexOf('127.0.0.1') !== -1) {
      return 'http://localhost:3000';
    }
    return 'https://peakora-api.peakora.workers.dev';
  })();

  var CFG = {
    cookieName: 'pkra_ref',
    lsKey: 'peakora_referral_attribution',
    cookieDays: 90,          // default; Elite uses 120 server-side
    tokenParams: ['via', 'ref'],
    dodoLinkMatchers: [
      /checkout\.dodopayments\.com/i
    ]
  };

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function getApexDomain(host) {
    // peakora.life, www.peakora.life, app.peakora.life -> peakora.life
    var parts = (host || '').split('.');
    if (parts.length <= 2) return host;
    return parts.slice(-2).join('.');
  }

  function setCookie(name, value, days) {
    var host = window.location.hostname || '';
    var isLocal = host.indexOf('localhost') !== -1 || host.indexOf('127.0.0.1') !== -1;
    var expires = new Date(Date.now() + days * 24 * 3600 * 1000).toUTCString();
    var cookie = name + '=' + encodeURIComponent(value) + ';expires=' + expires +
      ';path=/;SameSite=Lax' + (window.location.protocol === 'https:' ? ';Secure' : '');
    if (!isLocal) {
      cookie += ';domain=.' + getApexDomain(host);
    }
    try { document.cookie = cookie; } catch (e) {}
  }

  function getCookie(name) {
    var prefix = name + '=';
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i].trim();
      if (c.indexOf(prefix) === 0) {
        return decodeURIComponent(c.substring(prefix.length));
      }
    }
    return null;
  }

  function setLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function getLS(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  /** Read a query param from the current URL. */
  function getParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  /** Find the first present referral token from configured params. */
  function extractTokenFromUrl(urlStr) {
    try {
      var u = new URL(urlStr || window.location.href, window.location.origin);
      for (var i = 0; i < CFG.tokenParams.length; i++) {
        var v = u.searchParams.get(CFG.tokenParams[i]);
        if (v) return v;
      }
    } catch (e) {}
    return null;
  }

  function recordAttribution(code) {
    var attr = { code: code, setAt: nowSec() };
    setCookie(CFG.cookieName, code, CFG.cookieDays);
    setLS(CFG.lsKey, attr);
    return attr;
  }

  /** Fire the click-tracking pixel (GET /affiliate/click?via=CODE). */
  function trackClick(code) {
    if (!code) return;
    var url = PEAKORA_API + '/affiliate/click?via=' + encodeURIComponent(code) +
      '&landing=' + encodeURIComponent(window.location.pathname || '/') +
      '&referrer_url=' + encodeURIComponent(document.referrer || '');
    // 1x1 image pixel — no CORS preflight, no body, fire-and-forget.
    var img = new Image();
    img.src = url;
  }

  // ── On load: capture + persist + track ──────────────────────────────────
  function init() {
    var token = extractTokenFromUrl(window.location.href);
    if (token) {
      recordAttribution(token);
      trackClick(token);
      // Clean the token from the address bar so it isn't shared in copy-paste
      // of the URL, while attribution persists in storage.
      try {
        var cleanUrl = new URL(window.location.href);
        for (var i = 0; i < CFG.tokenParams.length; i++) {
          cleanUrl.searchParams.delete(CFG.tokenParams[i]);
        }
        window.history.replaceState({}, document.title, cleanUrl.toString());
      } catch (e) {}
    } else {
      // No token in URL — refresh the cookie expiry if attribution exists, so
      // a returning visitor keeps their window open.
      var existing = getAttribution();
      if (existing && existing.code) {
        setCookie(CFG.cookieName, existing.code, CFG.cookieDays);
      }
    }
    attachToDodoLinks();
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function getReferralCode() {
    var fromUrl = extractTokenFromUrl(window.location.href);
    if (fromUrl) return fromUrl;
    var fromCookie = getCookie(CFG.cookieName);
    if (fromCookie) return fromCookie;
    var fromLS = getLS(CFG.lsKey);
    return fromLS && fromLS.code ? fromLS.code : null;
  }

  function getAttribution() {
    var code = getReferralCode();
    if (!code) return null;
    var ls = getLS(CFG.lsKey) || {};
    var setAt = ls.setAt || nowSec();
    var ageDays = Math.max(0, (nowSec() - setAt) / 86400);
    return { code: code, setAt: setAt, ageDays: Math.round(ageDays) };
  }

  /** Append ?via=<code> to a URL if attribution exists and not already present. */
  function attachToUrl(url) {
    var code = getReferralCode();
    if (!code) return url;
    try {
      var u = new URL(url, window.location.origin);
      if (u.searchParams.get('via') || u.searchParams.get('ref')) return url;
      u.searchParams.set('via', code);
      return u.toString();
    } catch (e) { return url; }
  }

  /** Auto-attach referral token to Dodo checkout links as they appear. */
  function attachToDodoLinks() {
    var code = getReferralCode();
    if (!code) return;
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var isDodo = false;
      for (var m = 0; m < CFG.dodoLinkMatchers.length; m++) {
        if (CFG.dodoLinkMatchers[m].test(href)) { isDodo = true; break; }
      }
      if (!isDodo) continue;
      if (href.indexOf('via=') !== -1 || href.indexOf('ref=') !== -1) continue;
      var sep = href.indexOf('?') === -1 ? '?' : '&';
      // Dodo checkout passes metadata through the redirect_url, not the link.
      // We append &via= so the thankyou/return page carries it; the affiliate
      // token is also stashed in metadata via the server checkout flow.
      links[i].setAttribute('href', href + sep + 'via=' + encodeURIComponent(code));
    }
  }

  // Expose the API.
  window.PeakoraAffiliate = {
    getConfig: function () { return JSON.parse(JSON.stringify(CFG)); },
    getReferralCode: getReferralCode,
    getAttribution: getAttribution,
    attachToUrl: attachToUrl,
    refresh: attachToDodoLinks,
    trackClick: trackClick
  };

  // Run on DOM ready (or immediately if already loaded).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

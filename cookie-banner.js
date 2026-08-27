// Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
// Dependency-free cookie consent banner. Self-injects CSS + DOM, theme-aware.
// Shows on first visit until the user accepts or declines (localStorage flag).
(function () {
  "use strict";

  var STORAGE_KEY = "peakora_cookie_consent"; // "accepted" | "declined" | null
  if (localStorage.getItem(STORAGE_KEY)) return; // already decided -> never show again
  if (document.getElementById("peakora-cookie-consent")) return; // already injected

  // Respect the "do not track" hint as a soft default: still show, but it informs the copy.
  var css = "" +
    "#peakora-cookie-consent{position:fixed;left:12px;right:12px;bottom:16px;z-index:9500;" +
      "display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:18px;" +
      "background:rgba(21,17,34,0.96);border:1px solid var(--theme-card-border,rgba(255,255,255,0.1));" +
      "box-shadow:0 16px 48px rgba(0,0,0,0.65),0 0 28px var(--theme-card-glow,rgba(224,122,95,0.2));" +
      "backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);" +
      "animation:pkccSlide .35s cubic-bezier(.16,1,.3,1);" +
      "font-family:'Inter',system-ui,sans-serif;color:var(--theme-text-main,#f8fafc);}" +
    "@keyframes pkccSlide{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}" +
    "#peakora-cookie-consent .pkcc-text{flex:1;min-width:0;line-height:1.45;font-size:13px;}" +
    "#peakora-cookie-consent .pkcc-text strong{font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;color:#fff;display:block;margin-bottom:2px;}" +
    "#peakora-cookie-consent .pkcc-text span{color:var(--theme-text-muted,#a0aec0);overflow-wrap:break-word;}" +
    "#peakora-cookie-consent .pkcc-text a{color:var(--theme-accent,#f4a261);text-decoration:none;}" +
    "#peakora-cookie-consent .pkcc-text a:hover{text-decoration:underline;}" +
    "#peakora-cookie-consent .pkcc-actions{display:flex;gap:8px;flex-shrink:0;align-items:center;}" +
    "#peakora-cookie-consent .pkcc-btn{border:none;border-radius:10px;cursor:pointer;" +
      "font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;font-weight:700;padding:10px 16px;white-space:nowrap;}" +
    "#peakora-cookie-consent .pkcc-accept{background:var(--theme-primary-grad,linear-gradient(135deg,#e07a5f,#f4a261,#a78bfa));color:#fff;}" +
    "#peakora-cookie-consent .pkcc-decline{background:rgba(255,255,255,0.06);color:var(--theme-text-main,#f8fafc);" +
      "border:1px solid rgba(255,255,255,0.12);}" +
    "@media(max-width:560px){" +
      "#peakora-cookie-consent{flex-direction:column;align-items:stretch;gap:10px;}" +
      "#peakora-cookie-consent .pkcc-actions{justify-content:flex-end;}" +
    "}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var banner = document.createElement("div");
  banner.id = "peakora-cookie-consent";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Cookie consent");
  banner.innerHTML =
    '<div class="pkcc-text">' +
      "<strong>We value your privacy</strong>" +
      '<span>We use cookies to remember your preferences and understand how you use Peakora. See our ' +
      '<a href="privacy.html">Privacy Policy</a>.</span>' +
    "</div>" +
    '<div class="pkcc-actions">' +
      '<button class="pkcc-btn pkcc-decline" id="pkcc-decline">Decline</button>' +
      '<button class="pkcc-btn pkcc-accept" id="pkcc-accept">Accept</button>' +
    "</div>";

  function close() {
    var el = document.getElementById("peakora-cookie-consent");
    if (el) el.remove();
  }

  function decide(value) {
    localStorage.setItem(STORAGE_KEY, value);
    close();
    document.dispatchEvent(new CustomEvent("peakora:cookie-consent", { detail: { consent: value } }));
  }

  // Append after DOM is ready so the banner sits at the end of <body>.
  function mount() {
    if (document.getElementById("peakora-cookie-consent")) return;
    document.body.appendChild(banner);
    document.getElementById("pkcc-accept").addEventListener("click", function () { decide("accepted"); });
    document.getElementById("pkcc-decline").addEventListener("click", function () { decide("declined"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

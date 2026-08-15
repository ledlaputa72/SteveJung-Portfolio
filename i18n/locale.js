/**
 * Locale runtime for the bilingual site.
 *
 * One set of templates serves both languages. The URL decides which one:
 *
 *   /                 /case-study                 -> en
 *   /ko               /ko/case-study              -> ko
 *
 * The /ko routes are served by real files under ko/, generated from the same
 * templates by tools/sync-locale-pages.mjs, so the only thing that
 * distinguishes the two at runtime is what this module reports.
 * Every asset reference is root-absolute (/images/..., /pdf/...), because a
 * relative one would resolve against /ko/ and 404 on the Korean routes.
 *
 * Loaded as a classic script after the copy files and before support.js:
 * window.SITE_LOCALE and window.localePath have to exist while the page
 * boots, and reading window.SITE_COPY here lets the head tags be written
 * in the right language before anything renders.
 */
(function () {
  'use strict';

  var DEFAULT = 'en';
  var LOCALES = ['en', 'ko'];

  function detect() {
    var seg = location.pathname.split('/').filter(Boolean)[0];
    return LOCALES.indexOf(seg) >= 0 ? seg : DEFAULT;
  }

  var locale = detect();

  /**
   * Build an in-site URL that stays in the current language.
   *   localePath('/')            -> '/'      or '/ko'
   *   localePath('/case-study')  -> '/case-study' or '/ko/case-study'
   * A hash may be appended by the caller: localePath('/') + '#work'.
   */
  function localePath(path) {
    var clean = '/' + String(path || '').replace(/^\/+/, '');
    var prefix = locale === DEFAULT ? '' : '/' + locale;
    if (clean === '/') return prefix || '/';
    return prefix + clean;
  }

  /**
   * The same page in the other language, keeping the hash — the
   * case-study page identifies which case is open by #case-N, so
   * dropping it would send the reader back to the first case.
   */
  function switchPath() {
    var other = locale === DEFAULT ? 'ko' : DEFAULT;
    var parts = location.pathname.split('/').filter(Boolean);
    if (LOCALES.indexOf(parts[0]) >= 0) parts.shift();
    var rest = parts.join('/');
    var prefix = other === DEFAULT ? '' : '/' + other;
    var base = (prefix + '/' + rest).replace(/\/+$/, '') || '/';
    return base + (location.hash || '');
  }

  window.SITE_LOCALE = locale;
  window.SITE_LOCALES = LOCALES;
  window.localePath = localePath;
  window.localeSwitchPath = switchPath;
  window.localeOther = locale === DEFAULT ? 'ko' : DEFAULT;

  // The head — lang, title, description, canonical, hreflang, Open Graph —
  // is NOT set here. It is written into each HTML file at build time by
  // tools/sync-locale-pages.mjs, from the same i18n/<locale>.js head
  // sections, because the consumers cannot run JavaScript:
  //
  //   - LinkedIn, Slack and KakaoTalk preview bots never execute scripts, so
  //     Open Graph tags injected at runtime were invisible to them.
  //   - Google does not reliably honour a JS-injected hreflang; it wants the
  //     tag in the served HTML, an HTTP header, or the sitemap.
  //   - Bing and Naver largely do not render JS at all.
  //
  // Anything added here would also duplicate the static tags. Keep this file
  // to what genuinely needs the URL at runtime: locale detection and links.

  // Rewrite links the templates declare as locale-relative. Markup uses
  // data-lp="/case-study" instead of a hard href so a single template can
  // serve both languages; anything already absolute or external is left
  // alone. Runs on DOM ready and again after the app renders, since the
  // template engine replaces most of the body.
  function applyLinks(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-lp]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var target = el.getAttribute('data-lp');
      if (target === null) continue;
      var hash = el.getAttribute('data-lp-hash') || '';
      el.setAttribute('href', localePath(target) + hash);
    }
    updateSwitch();
  }

  // The switcher label names the language you would get by clicking it.
  function updateSwitch() {
    var sw = document.getElementById('lang-switch');
    if (!sw) return;
    sw.setAttribute('href', switchPath());
    sw.textContent = window.localeOther.toUpperCase();
    sw.setAttribute('hreflang', window.localeOther);
  }
  window.applyLocaleLinks = applyLinks;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyLinks(); });
  } else {
    applyLinks();
  }

  // The case-study page rewrites the hash as the reader moves between
  // cases, which is not a DOM mutation the observer below would catch.
  // Refresh on hashchange, and resolve once more at click time so the
  // destination is right even if something changed the hash in between.
  addEventListener('hashchange', updateSwitch);
  document.addEventListener('click', function (e) {
    var sw = e.target && e.target.closest && e.target.closest('#lang-switch');
    if (sw) sw.setAttribute('href', switchPath());
  }, true);
  // The template engine swaps large parts of the DOM in after boot; keep
  // newly inserted locale links pointed at the right language.
  if (window.MutationObserver) {
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; applyLinks(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();

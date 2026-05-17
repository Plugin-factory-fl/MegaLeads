/** MegaLeadsAI site — Chrome Web Store CTA tracking + shared store URL */
(function () {
  const STORE_ID = 'afcakombimmcopmdckjdjffdgnchhbpe';
  const STORE_BASE =
    'https://chromewebstore.google.com/detail/' + STORE_ID;

  window.MEGA_STORE_URL = STORE_BASE;

  /** @param {string} campaign */
  window.megaStoreUrl = function megaStoreUrl(campaign) {
    const u = new URL(STORE_BASE);
    u.searchParams.set('utm_source', 'megaleads_site');
    u.searchParams.set('utm_medium', 'website');
    if (campaign) u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  };

  function trackStoreClick(campaign, label) {
    if (typeof gtag === 'function') {
      gtag('event', 'click_store', {
        event_category: 'conversion',
        event_label: label || campaign || 'store',
        campaign: campaign || 'unknown',
      });
    }
  }

  document.addEventListener('click', function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const a = t.closest('a[data-store-cta]');
    if (!a || !(a instanceof HTMLAnchorElement)) return;
    trackStoreClick(a.getAttribute('data-store-cta') || '', a.textContent?.trim() || '');
  });
})();

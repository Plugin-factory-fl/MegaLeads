/**
 * Page world only — captures Instagram JSON responses (GraphQL) for richer fields.
 * Communicates with the content script via window.postMessage.
 */
(function () {
  if (window.__leadFlowFetchHooked) return;
  window.__leadFlowFetchHooked = true;

  function maybeEmitJson(url, json) {
    try {
      if (!url || typeof url !== 'string') return;
      if (!url.includes('instagram.com')) return;
      window.postMessage(
        {
          source: 'LEADFLOW_IG',
          kind: 'fetch_json',
          url: url.slice(0, 500),
          json: json,
        },
        '*',
      );
    } catch (e) {
      /* ignore */
    }
  }

  function isRelevantFetchUrl(u) {
    if (!u || typeof u !== 'string') return false;
    if (u.includes('instagram.com')) return true;
    return (
      u.startsWith('/') &&
      (u.includes('graphql') || u.includes('friendships') || u.includes('api/v1') || u.includes('web/'))
    );
  }

  const origFetch = window.fetch;
  window.fetch = function () {
    const args = arguments;
    const p = origFetch.apply(this, args);
    try {
      let u = '';
      if (typeof args[0] === 'string') u = args[0];
      else if (args[0] && typeof args[0].url === 'string') u = args[0].url;
      if (!isRelevantFetchUrl(u)) return p;
      p.then(function (res) {
        if (!res || typeof res.clone !== 'function' || !res.ok) return res;
        const ct = (res.headers && res.headers.get('content-type')) || '';
        const tryJson =
          ct.includes('json') ||
          (/\/api\/graphql/i.test(u) && (ct.includes('javascript') || ct.includes('json')));
        if (!tryJson) return res;
        res
          .clone()
          .json()
          .then(function (json) {
            maybeEmitJson(u, json);
          })
          .catch(function () {});
        return res;
      }).catch(function () {});
    } catch (e) {
      /* ignore */
    }
    return p;
  };
})();

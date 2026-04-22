/**
 * Runs at document_start so fetch hook is installed before Instagram's first requests.
 */
(function () {
  try {
    const url = chrome.runtime.getURL('content/inject-fetch-hook.js');
    const s = document.createElement('script');
    s.src = url;
    s.onload = function () {
      s.remove();
    };
    (document.documentElement || document.head || document.body).appendChild(s);
  } catch (e) {
    /* ignore */
  }
})();

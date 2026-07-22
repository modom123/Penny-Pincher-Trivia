/* Applies window.PPT_CONFIG to every [data-cta] link so all "Play" buttons
   point at the right destination from one config block (see <head>).
   Store buttons fall back to the web app until their store URLs are set. */
(function () {
  var cfg = window.PPT_CONFIG || {};
  var app = cfg.appUrl || '#';
  // Carries ?ref=CODE (if this page was loaded from a referral link) through
  // to the app link - otherwise a shared marketing-site link like
  // pennypinchertrivia.com/?ref=CODE would drop the code the moment someone
  // clicked "Play now", since that's a full navigation to a different origin
  // and the app only reads the code from its own URL's query string.
  var ref = new URLSearchParams(window.location.search).get('ref');
  function withRef(url) {
    if (!ref || url === '#') return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'ref=' + encodeURIComponent(ref);
  }
  var dest = {
    app: withRef(app),
    appstore: withRef(cfg.appStoreUrl || app),
    playstore: withRef(cfg.playStoreUrl || app)
  };
  var links = document.querySelectorAll('[data-cta]');
  for (var i = 0; i < links.length; i++) {
    var el = links[i];
    var url = dest[el.getAttribute('data-cta')];
    if (url) el.setAttribute('href', url);
  }
})();

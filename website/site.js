/* Applies window.PPT_CONFIG to every [data-cta] link so all "Play" buttons
   point at the right destination from one config block (see <head>).
   Store buttons fall back to the web app until their store URLs are set. */
(function () {
  var cfg = window.PPT_CONFIG || {};
  var app = cfg.appUrl || '#';
  var dest = {
    app: app,
    appstore: cfg.appStoreUrl || app,
    playstore: cfg.playStoreUrl || app
  };
  var links = document.querySelectorAll('[data-cta]');
  for (var i = 0; i < links.length; i++) {
    var el = links[i];
    var url = dest[el.getAttribute('data-cta')];
    if (url) el.setAttribute('href', url);
  }
})();

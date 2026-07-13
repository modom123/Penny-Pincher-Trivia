/* Public launch countdown (clock only — no internal checklist).
   Target comes from PPT_CONFIG.launchTargetMs; set it null to hide the band. */
(function () {
  var cfg = window.PPT_CONFIG || {};
  var target = cfg.launchTargetMs;
  var band = document.getElementById('countdown');
  if (!band || !target) return;
  band.hidden = false;

  var el = function (id) { return document.getElementById(id); };
  var dd = el('cd-dd'), hh = el('cd-hh'), mm = el('cd-mm'), ss = el('cd-ss'), when = el('cd-when'), title = document.querySelector('.cd-title');
  var pad = function (n) { return String(n).padStart(2, '0'); };

  var t = new Date(target);
  when.textContent = 'Launch — ' + t.toLocaleString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }) + ' (your time)';

  function tick() {
    var rem = target - Date.now();
    if (rem <= 0) {
      band.classList.add('is-live');
      if (title) title.textContent = '🚀 We’re live — play now!';
      return;
    }
    var s = Math.floor(rem / 1000);
    dd.textContent = pad(Math.floor(s / 86400));
    hh.textContent = pad(Math.floor((s % 86400) / 3600));
    mm.textContent = pad(Math.floor((s % 3600) / 60));
    ss.textContent = pad(s % 60);
  }
  tick();
  setInterval(tick, 1000);
})();

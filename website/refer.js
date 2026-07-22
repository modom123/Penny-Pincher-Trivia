/* Penny Pinching Trivia — "Refer a friend" link generator on the marketing
   site itself. No backend call here: a referral code is already unique and
   the app reads ?ref=CODE straight out of its own URL (see
   mobile/src/screens/UsernamePickerScreen.tsx), so this just builds that
   query string against whatever domain this page is actually served from -
   no need to know or hardcode it. */
(function () {
  var input = document.getElementById('referCodeInput');
  var btn = document.getElementById('referGenerateBtn');
  var result = document.getElementById('referLinkResult');
  var linkText = document.getElementById('referLinkText');
  var copyBtn = document.getElementById('referCopyBtn');
  if (!input || !btn || !result || !linkText || !copyBtn) return;

  function buildLink(code) {
    return window.location.origin + window.location.pathname + '?ref=' + encodeURIComponent(code);
  }

  function generate() {
    var code = input.value.trim().toUpperCase();
    if (!code) {
      input.focus();
      return;
    }
    linkText.textContent = buildLink(code);
    result.hidden = false;
  }

  btn.addEventListener('click', generate);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') generate();
  });

  copyBtn.addEventListener('click', function () {
    var text = linkText.textContent;
    var done = function () {
      var original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = original; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        window.prompt('Copy this link:', text);
      });
    } else {
      window.prompt('Copy this link:', text);
    }
  });
})();

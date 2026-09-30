/* FractalMind App prototype v2 — boot. Query parameters open review entries:
 * ?view=hosts · ?journey=J7 · ?device=phone · ?lang=en · ?theme=dark · ?reset=1 */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const q = new URLSearchParams(location.search);

  if (q.get('reset') === '1') U.resetDemo();
  if (q.get('lang')) { U.prefs.locale = q.get('lang') === 'en' ? 'en' : 'zh-CN'; U.savePrefs(); }
  if (['light', 'dark', 'system'].includes(q.get('theme'))) { U.prefs.theme = q.get('theme'); U.savePrefs(); }
  if (q.get('device') === 'phone') U.ui.framed = true;
  if (q.get('view')) location.hash = `#/${q.get('view')}`;
  if (!location.hash) location.hash = U.P() ? '#/workbench' : '#/welcome';

  U.applyTheme();
  U.render();
  if (q.get('journey')) FM.review.start(q.get('journey').toUpperCase());

  // Point first-time reviewers at the review tools once per session (desktop only).
  try {
    if (!q.get('journey') && window.innerWidth > 900 && !sessionStorage.getItem('fm-v2-review-seen')) {
      U.ui.review = true;
      sessionStorage.setItem('fm-v2-review-seen', '1');
    }
  } catch (e) { /* storage unavailable */ }
  FM.review.render();
})();

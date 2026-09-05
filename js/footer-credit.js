/* footer-credit.js — TEMPORARY. Swaps the footer's platform credit to the
 * September 2026 tool-challenge wording while the date qualifies.
 *
 * The evergreen text ("Part of the Doka Platform family of Apps") is the
 * hard-coded default in index.html; this script only ever overrides it. After
 * 30 Sep 2026 it is a dead no-op: delete this file and its <script> tag. If it
 * ever fails to run, the page shows the correct evergreen text. */
(function (global) {
  'use strict';
  // Month is 0-based: 8 = September. The cutoff day itself still counts as "during".
  var CHALLENGE_UNTIL = new Date(2026, 8, 30, 23, 59, 59, 999);
  var CHALLENGE_TEXT = 'Part of the September tool challenge 5 of 30 📅';

  function applyFooterCredit() {
    var el = document.getElementById('platformCredit');
    if (el && new Date() <= CHALLENGE_UNTIL) el.textContent = CHALLENGE_TEXT;
  }

  global.applyFooterCredit = applyFooterCredit;   // exposed so the date logic can be tested
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyFooterCredit);
  else applyFooterCredit();
})(window);

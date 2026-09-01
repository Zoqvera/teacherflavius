(function () {
  "use strict";

  const LESSON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"></path></svg>';

  function upgradeLessonTitles(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const summaries = [];

    if (scope.matches && scope.matches('.student-lessons-panel summary')) summaries.push(scope);
    scope.querySelectorAll('.student-lessons-panel summary').forEach(function (summary) {
      summaries.push(summary);
    });

    summaries.forEach(function (summary) {
      const title = summary.querySelector(':scope > span:first-child');
      if (!title || title.dataset.visualUpgraded === '1') return;
      if (!String(title.textContent || '').toUpperCase().includes('LIÇÕES')) return;

      title.dataset.visualUpgraded = '1';
      title.classList.add('student-lessons-title-icon');
      title.innerHTML = LESSON_ICON + '<span>LIÇÕES</span>';
    });
  }

  function enhanceMessages() {
    const classMessage = document.getElementById('classAssignmentMessage');
    const billingMessage = document.getElementById('studentBillingMessage');
    if (classMessage) {
      classMessage.setAttribute('role', 'status');
      classMessage.setAttribute('aria-live', 'polite');
    }
    if (billingMessage) {
      billingMessage.setAttribute('role', 'status');
      billingMessage.setAttribute('aria-live', 'polite');
    }
  }

  function init() {
    enhanceMessages();
    upgradeLessonTitles(document);

    const list = document.getElementById('studentProfilesList');
    if (!list) return;

    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) upgradeLessonTitles(node);
        });
      });
    });

    observer.observe(list, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

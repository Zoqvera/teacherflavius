(function () {
  'use strict';

  function applyTableLabels(tableWrapId) {
    const wrap = document.getElementById(tableWrapId);
    if (!wrap) return;
    const table = wrap.querySelector('table');
    if (!table) return;
    const headers = Array.from(table.querySelectorAll('thead th')).map(function (th) {
      return th.textContent.trim();
    });
    table.querySelectorAll('tbody tr').forEach(function (row) {
      Array.from(row.children).forEach(function (cell, index) {
        if (cell.tagName === 'TD') cell.dataset.label = headers[index] || '';
      });
    });
  }

  function classifySummaryCards() {
    const mappings = [
      ['statusTotalStudents', 'summary-neutral'],
      ['statusAccessedStudents', 'summary-success'],
      ['statusNeverStudents', 'summary-warning'],
      ['totalAccesses', 'summary-neutral'],
      ['activeStudents', 'summary-primary'],
      ['uniquePages', 'summary-primary']
    ];

    mappings.forEach(function (entry) {
      const value = document.getElementById(entry[0]);
      const card = value && value.closest('.summary-card');
      if (card) card.classList.add(entry[1]);
    });
  }

  function syncBusyState() {
    const button = document.getElementById('refreshAccesses');
    if (!button) return;
    button.setAttribute('aria-busy', button.disabled ? 'true' : 'false');
  }

  function enhance() {
    document.documentElement.classList.add('tf-brand-palette');
    classifySummaryCards();
    applyTableLabels('statusTableWrap');
    applyTableLabels('accessTableWrap');
    syncBusyState();
  }

  const observer = new MutationObserver(function (mutations) {
    let shouldEnhance = false;
    mutations.forEach(function (mutation) {
      if (mutation.type === 'childList' || mutation.type === 'attributes') shouldEnhance = true;
    });
    if (shouldEnhance) enhance();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      enhance();
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    }, { once: true });
  } else {
    enhance();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
  }
})();

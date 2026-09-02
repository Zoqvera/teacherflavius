(function () {
  'use strict';

  const tableWrap = document.querySelector('.table-wrap');
  const table = tableWrap ? tableWrap.querySelector('table') : null;
  const tbody = document.getElementById('errorRows');
  const refreshButton = document.getElementById('refreshButton');
  const status = document.getElementById('monitorStatus');

  if (!tableWrap || !table || !tbody) return;

  tableWrap.classList.add('tf-mobile-cards');

  function labels() {
    return Array.from(table.querySelectorAll('thead th')).map(function (th) {
      return (th.textContent || '').trim();
    });
  }

  function decorateRows() {
    const headings = labels();

    Array.from(tbody.querySelectorAll('tr')).forEach(function (row) {
      row.classList.remove('tf-severity-critical', 'tf-severity-error', 'tf-severity-warning');

      const cells = Array.from(row.children);
      cells.forEach(function (cell, index) {
        if (cell.classList.contains('empty')) return;
        cell.dataset.label = headings[index] || '';
      });

      const badge = row.querySelector('.badge');
      if (badge) {
        if (badge.classList.contains('severity-critical')) row.classList.add('tf-severity-critical');
        else if (badge.classList.contains('severity-error')) row.classList.add('tf-severity-error');
        else if (badge.classList.contains('severity-warning')) row.classList.add('tf-severity-warning');
      }

      const resolveButton = row.querySelector('.resolve');
      if (resolveButton) {
        const messageCell = row.querySelector('.message');
        const summary = messageCell ? (messageCell.textContent || '').trim() : '';
        resolveButton.setAttribute('aria-label', summary ? 'Marcar como resolvida: ' + summary : 'Marcar ocorrência como resolvida');
      }
    });
  }

  function syncBusyState() {
    if (refreshButton) refreshButton.setAttribute('aria-busy', refreshButton.disabled ? 'true' : 'false');
    Array.from(document.querySelectorAll('.resolve')).forEach(function (button) {
      button.setAttribute('aria-busy', button.disabled ? 'true' : 'false');
    });
  }

  if (status) {
    status.setAttribute('aria-atomic', 'true');
  }

  const observer = new MutationObserver(function () {
    decorateRows();
    syncBusyState();
  });

  observer.observe(tbody, { childList: true, subtree: true });
  if (refreshButton) observer.observe(refreshButton, { attributes: true, attributeFilter: ['disabled'] });

  decorateRows();
  syncBusyState();
})();

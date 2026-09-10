(function () {
  'use strict';

  function iconCheck() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  }

  function iconClock() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  }

  function ensureBaseAccessibility() {
    document.documentElement.classList.add('tf-brand-palette');

    var pageStatus = document.getElementById('pageStatus');
    if (pageStatus) {
      pageStatus.setAttribute('role', 'status');
      pageStatus.setAttribute('aria-live', 'polite');
      pageStatus.setAttribute('aria-atomic', 'true');
    }

    var messagePanel = document.getElementById('messagePanel');
    if (messagePanel) {
      messagePanel.setAttribute('role', 'status');
      messagePanel.setAttribute('aria-live', 'polite');
    }

    var list = document.getElementById('activityList');
    if (list) {
      list.setAttribute('role', 'list');
      list.setAttribute('aria-live', 'polite');
    }
  }

  function updateProgressAccessibility() {
    var track = document.querySelector('.progress-track');
    var fill = document.getElementById('progressFill');
    var percentNode = document.getElementById('percentCount');
    var panel = document.querySelector('.progress-panel');
    if (!track || !fill || !percentNode) return;

    var percent = parseInt(String(percentNode.textContent || '0').replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(percent)) percent = 0;
    percent = Math.max(0, Math.min(100, percent));

    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(percent));
    track.setAttribute('aria-valuetext', percent + '% concluído');
    if (panel) panel.classList.toggle('is-complete', percent === 100);
  }

  function updateFilterAccessibility() {
    document.querySelectorAll('.filter-button').forEach(function (button) {
      var active = button.classList.contains('active');
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateActivityPresentation() {
    var cards = document.querySelectorAll('.activity-card');
    cards.forEach(function (card) {
      card.setAttribute('role', 'listitem');
      var titleNode = card.querySelector('.activity-title');
      var title = titleNode ? titleNode.textContent.trim() : 'atividade';
      var done = card.classList.contains('done');

      card.setAttribute('aria-label', title + (done ? ', concluída' : ', pendente'));

      var badge = card.querySelector('.status-badge');
      if (badge) {
        badge.innerHTML = (done ? iconCheck() : iconClock()) + '<span>' + (done ? 'Concluída' : 'Pendente') + '</span>';
      }

      var action = card.querySelector('.activity-action');
      if (action) {
        action.setAttribute('aria-label', (done ? 'Abrir ' : 'Fazer ') + title + ' em nova aba');
      }
    });

    updateProgressAccessibility();
    updateFilterAccessibility();
  }

  function observeActivities() {
    var list = document.getElementById('activityList');
    if (!list) return;

    var observer = new MutationObserver(function () {
      updateActivityPresentation();
    });
    observer.observe(list, { childList: true });
  }

  function bindFilterEnhancement() {
    document.querySelectorAll('.filter-button').forEach(function (button) {
      button.addEventListener('click', function () {
        window.requestAnimationFrame(updateFilterAccessibility);
      });
    });
  }

  function observeDashboardVisibility() {
    var dashboard = document.getElementById('dashboard');
    if (!dashboard) return;
    var observer = new MutationObserver(function () {
      if (!dashboard.hidden) {
        updateActivityPresentation();
        updateProgressAccessibility();
      }
    });
    observer.observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
  }

  function init() {
    ensureBaseAccessibility();
    bindFilterEnhancement();
    observeActivities();
    observeDashboardVisibility();
    updateActivityPresentation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

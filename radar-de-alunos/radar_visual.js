(function () {
  const icons = {
    red: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.3 3.8 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"></path></svg>',
    yellow: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16h.01"></path></svg>',
    green: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m8.5 12 2.2 2.2 4.8-5"></path></svg>'
  };

  const labels = {
    red: 'Intervenção necessária',
    yellow: 'Atenção',
    green: 'Em dia'
  };

  function getLevel(element) {
    if (!element) return '';
    if (element.classList.contains('red')) return 'red';
    if (element.classList.contains('yellow')) return 'yellow';
    if (element.classList.contains('green')) return 'green';
    return '';
  }

  function cleanFilterOptions() {
    const select = document.getElementById('riskFilter');
    if (!select) return;
    Array.from(select.options).forEach(function (option) {
      if (!option.value || !labels[option.value]) return;
      option.textContent = labels[option.value];
    });
  }

  function enhanceBadge(badge) {
    const level = getLevel(badge);
    if (!level || badge.dataset.visualEnhanced === 'true') return;
    badge.innerHTML = icons[level] + '<span>' + labels[level] + '</span>';
    badge.setAttribute('aria-label', labels[level]);
    badge.dataset.visualEnhanced = 'true';
  }

  function syncDetailButton(button) {
    const id = button.dataset.detailId;
    if (!id) return;
    const detail = document.getElementById('detail-' + id);
    if (!detail) return;
    button.setAttribute('aria-controls', detail.id);
    button.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true');
  }

  function enhanceDetailButton(button) {
    if (button.dataset.visualEnhanced === 'true') {
      syncDetailButton(button);
      return;
    }
    syncDetailButton(button);
    button.addEventListener('click', function () {
      window.setTimeout(function () { syncDetailButton(button); }, 0);
    });
    button.dataset.visualEnhanced = 'true';
  }

  function enhanceCards() {
    document.querySelectorAll('.risk-badge').forEach(enhanceBadge);
    document.querySelectorAll('[data-detail-id]').forEach(enhanceDetailButton);
  }

  function syncRefreshState() {
    const button = document.getElementById('refreshRadar');
    if (!button) return;
    button.setAttribute('aria-busy', button.disabled ? 'true' : 'false');
  }

  function observeRadar() {
    const list = document.getElementById('radarList');
    if (list) {
      const observer = new MutationObserver(function () {
        enhanceCards();
      });
      observer.observe(list, { childList: true, subtree: true });
    }

    const refresh = document.getElementById('refreshRadar');
    if (refresh) {
      const refreshObserver = new MutationObserver(syncRefreshState);
      refreshObserver.observe(refresh, { attributes: true, attributeFilter: ['disabled'] });
    }
  }

  function initVisualLayer() {
    cleanFilterOptions();
    enhanceCards();
    syncRefreshState();
    observeRadar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVisualLayer, { once: true });
  } else {
    initVisualLayer();
  }
})();

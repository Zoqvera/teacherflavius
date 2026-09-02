(function () {
  'use strict';

  document.documentElement.classList.add('tf-brand-palette');

  const list = document.getElementById('vacancyList');
  const refreshButton = document.getElementById('refreshButton');
  const pageStatus = document.getElementById('pageStatus');
  const content = document.getElementById('content');

  if (pageStatus) {
    pageStatus.setAttribute('role', 'status');
    pageStatus.setAttribute('aria-live', 'polite');
  }

  if (content) {
    content.setAttribute('aria-label', 'Relatório de vagas das turmas');
  }

  if (list) {
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-busy', 'true');
  }

  if (refreshButton) {
    refreshButton.setAttribute('aria-label', 'Atualizar relatório de vagas');
  }

  function numberFromText(value) {
    const parsed = Number(String(value || '').replace(/[^0-9-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function enhanceSummary() {
    document.querySelectorAll('.summary-card').forEach(function (card) {
      const label = card.querySelector('span');
      const value = card.querySelector('strong');
      if (!label || !value) return;
      card.setAttribute('aria-label', label.textContent.trim() + ': ' + value.textContent.trim());
    });
  }

  function enhanceCards() {
    document.querySelectorAll('.vacancy-card').forEach(function (card) {
      if (card.dataset.tfEnhanced === 'true') return;

      const nameNode = card.querySelector('.class-name');
      const metaNode = card.querySelector('.class-meta');
      const spotsBox = card.querySelector('.spots');
      const spotsValue = spotsBox ? spotsBox.querySelector('strong') : null;
      const metaText = metaNode ? metaNode.textContent : '';
      const match = metaText.match(/(\d+)\s+de\s+(\d+)\s+alunos/i);
      const occupied = match ? Number(match[1]) : null;
      const capacity = match ? Number(match[2]) : null;
      const spots = spotsValue ? numberFromText(spotsValue.textContent) : null;
      const className = nameNode ? nameNode.textContent.trim() : 'Turma';

      if (spots === 1) card.classList.add('is-last-spot');
      else card.classList.add('is-open');

      if (spotsBox && spots !== null) {
        spotsBox.setAttribute('role', 'status');
        spotsBox.setAttribute(
          'aria-label',
          spots === 1 ? '1 vaga disponível' : spots + ' vagas disponíveis'
        );
      }

      if (occupied !== null && capacity && capacity > 0 && !card.querySelector('.occupancy')) {
        const percent = Math.max(0, Math.min(100, Math.round((occupied / capacity) * 100)));
        const occupancy = document.createElement('div');
        occupancy.className = 'occupancy';
        occupancy.innerHTML =
          '<div class="occupancy-row"><span>Ocupação da turma</span><strong>' +
          occupied + '/' + capacity +
          '</strong></div>' +
          '<div class="occupancy-track" role="progressbar" aria-label="Ocupação de ' +
          className.replace(/"/g, '&quot;') +
          '" aria-valuemin="0" aria-valuemax="' + capacity +
          '" aria-valuenow="' + occupied + '"><span style="width:' + percent + '%"></span></div>';

        if (metaNode && metaNode.parentElement) {
          metaNode.parentElement.appendChild(occupancy);
        }
      }

      const ariaParts = [className];
      if (match) ariaParts.push(occupied + ' de ' + capacity + ' alunos');
      if (spots !== null) ariaParts.push(spots === 1 ? '1 vaga disponível' : spots + ' vagas disponíveis');
      card.setAttribute('aria-label', ariaParts.join('. '));
      card.dataset.tfEnhanced = 'true';
    });

    if (list) list.setAttribute('aria-busy', 'false');
    enhanceSummary();
  }

  function syncBusyState() {
    if (!refreshButton) return;
    const busy = refreshButton.disabled;
    refreshButton.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (list && busy) list.setAttribute('aria-busy', 'true');
  }

  if (list) {
    const listObserver = new MutationObserver(function () {
      enhanceCards();
    });
    listObserver.observe(list, { childList: true, subtree: true });
  }

  if (refreshButton) {
    const buttonObserver = new MutationObserver(syncBusyState);
    buttonObserver.observe(refreshButton, { attributes: true, attributeFilter: ['disabled'] });
  }

  enhanceSummary();
  enhanceCards();
  syncBusyState();
})();

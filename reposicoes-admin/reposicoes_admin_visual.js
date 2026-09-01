(function () {
  const SLOT_SELECTOR = '#adminSlots .slot-card';

  function parseCapacity(text) {
    const match = String(text || '').match(/(\d+)\s+de\s+(\d+)\s+vagas\s+reservadas/i);
    if (!match) return null;
    const reserved = Number(match[1]);
    const capacity = Number(match[2]);
    if (!Number.isFinite(reserved) || !Number.isFinite(capacity) || capacity <= 0) return null;
    return { reserved: reserved, capacity: capacity };
  }

  function enhanceCapacity(card) {
    if (card.querySelector('.tf-capacity')) return;
    const meta = card.querySelector('.card-meta');
    if (!meta) return;
    const data = parseCapacity(meta.textContent);
    if (!data) return;

    const percent = Math.max(0, Math.min(100, Math.round((data.reserved / data.capacity) * 100)));
    const remaining = Math.max(0, data.capacity - data.reserved);
    const full = remaining === 0;
    const wrapper = document.createElement('div');
    wrapper.className = 'tf-capacity' + (full ? ' is-full' : '');
    wrapper.setAttribute('aria-label', data.reserved + ' de ' + data.capacity + ' vagas reservadas');
    wrapper.innerHTML =
      '<div class="tf-capacity-head">' +
        '<span>Ocupação</span>' +
        '<strong>' + (full ? 'Lotado' : remaining + (remaining === 1 ? ' vaga disponível' : ' vagas disponíveis')) + '</strong>' +
      '</div>' +
      '<div class="tf-capacity-track" aria-hidden="true"><div class="tf-capacity-fill" style="--tf-capacity-percent:' + percent + '%"></div></div>';
    meta.insertAdjacentElement('afterend', wrapper);

    const originalPill = meta.querySelector('.status-pill');
    if (originalPill && full) originalPill.classList.add('tf-slot-full');
  }

  function enhanceSlotStatus(card) {
    const status = card.querySelector('.card-heading .status-pill');
    if (!status) return;
    const label = status.textContent.trim().toLowerCase();
    if (label === 'encerrado') status.classList.add('tf-slot-ended');
  }

  function enhanceEmailStatus(row) {
    if (row.dataset.tfEmailEnhanced === '1') return;
    const emailLine = row.querySelector('.booking-email');
    if (!emailLine) return;
    const text = emailLine.textContent || '';
    let state = '';
    let label = '';
    if (/Falha no e-mail/i.test(text)) {
      state = 'failed';
      label = 'Falha no e-mail';
    } else if (/E-mail pendente/i.test(text)) {
      state = 'pending';
      label = 'E-mail pendente';
    } else if (/E-mail enviado/i.test(text)) {
      state = 'sent';
      label = 'E-mail enviado';
    }
    if (!state) return;

    emailLine.textContent = text.replace(/\s*·\s*(E-mail enviado|Falha no e-mail|E-mail pendente)\s*$/i, '');
    const badge = document.createElement('span');
    badge.className = 'tf-email-status ' + state;
    badge.textContent = label;
    emailLine.insertAdjacentElement('afterend', badge);
    row.dataset.tfEmailEnhanced = '1';
  }

  function enhanceCard(card) {
    enhanceSlotStatus(card);
    enhanceCapacity(card);
    card.querySelectorAll('.booking-row').forEach(enhanceEmailStatus);
  }

  function enhanceAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(SLOT_SELECTOR)) enhanceCard(scope);
    scope.querySelectorAll(SLOT_SELECTOR).forEach(enhanceCard);
  }

  function setBrandClass() {
    document.documentElement.classList.add('tf-brand-palette');
  }

  setBrandClass();
  enhanceAll(document);

  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) enhanceAll(node);
      });
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

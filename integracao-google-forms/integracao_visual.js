(function () {
  'use strict';

  function statusFromPill(pill) {
    if (!pill) return '';
    var classes = Array.from(pill.classList || []);
    var statusClass = classes.find(function (name) { return name.indexOf('status-') === 0 && name !== 'status-pill'; });
    return statusClass ? statusClass.replace('status-', '') : '';
  }

  function decorateCard(card) {
    if (!card) return;
    var pill = card.querySelector('.status-pill');
    var status = statusFromPill(pill);
    if (status) card.dataset.status = status;

    var title = card.querySelector('.integration-title');
    var titleText = title ? title.textContent.trim() : 'integração';
    if (pill) pill.setAttribute('aria-label', 'Status da integração: ' + pill.textContent.trim());

    var sheetLink = card.querySelector('.integration-url');
    if (sheetLink) sheetLink.setAttribute('aria-label', 'Abrir planilha de respostas de ' + titleText + ' em nova aba');

    var retry = card.querySelector('[data-action="retry"]');
    if (retry) retry.setAttribute('aria-label', 'Tentar novamente a integração de ' + titleText);

    var disconnect = card.querySelector('[data-action="disconnect"]');
    if (disconnect) disconnect.setAttribute('aria-label', 'Desconectar a planilha de ' + titleText);
  }

  function syncBusy(button) {
    if (!button) return;
    button.setAttribute('aria-busy', button.disabled ? 'true' : 'false');
  }

  function decorate() {
    document.documentElement.classList.add('tf-brand-palette');

    var adminStatus = document.getElementById('adminStatus');
    if (adminStatus) {
      adminStatus.setAttribute('role', 'status');
      adminStatus.setAttribute('aria-live', 'polite');
    }

    var list = document.getElementById('integrationList');
    if (list) {
      list.setAttribute('aria-live', 'polite');
      list.querySelectorAll('.integration-card').forEach(decorateCard);
    }

    ['connectButton', 'refreshButton'].forEach(function (id) {
      syncBusy(document.getElementById(id));
    });

    document.querySelectorAll('.row-button').forEach(syncBusy);
  }

  decorate();

  var observer = new MutationObserver(function () { decorate(); });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'class']
  });
})();

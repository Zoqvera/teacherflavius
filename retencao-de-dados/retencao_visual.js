(function () {
  'use strict';

  var retentionTable = document.querySelector('table[aria-label="Políticas de retenção de dados"]');
  var processorTable = document.querySelector('table[aria-label="Governança dos fornecedores externos"]');
  var retentionStatus = document.getElementById('retentionStatus');
  var processorStatus = document.getElementById('processorStatus');
  var refreshButton = document.getElementById('refreshRetention');
  var runButton = document.getElementById('runRetentionNow');

  function labelTable(table) {
    if (!table) return;
    var headers = Array.from(table.querySelectorAll('thead th')).map(function (th) {
      return (th.textContent || '').trim();
    });
    table.querySelectorAll('tbody tr').forEach(function (row) {
      Array.from(row.children).forEach(function (cell, index) {
        if (cell.classList.contains('empty')) return;
        cell.setAttribute('data-label', headers[index] || 'Campo');
      });
    });
  }

  function classifyStatus(element) {
    if (!element) return;
    var text = (element.textContent || '').toLowerCase();
    element.classList.remove('tf-status-error', 'tf-status-warning');
    if (/falhou|não foi possível|acesso negado|ações necessárias:[ ]*[1-9]|revisões vencidas:[ ]*[1-9]/.test(text)) {
      element.classList.add('tf-status-error');
    } else if (/pendente|pendentes|cron diário não está ativo|cron diário não está ativo/.test(text)) {
      element.classList.add('tf-status-warning');
    }
  }

  function syncBusyState() {
    if (refreshButton) {
      var refreshing = refreshButton.disabled;
      refreshButton.setAttribute('aria-busy', refreshing ? 'true' : 'false');
    }
    if (runButton) {
      var running = runButton.disabled && /executando/i.test(runButton.textContent || '');
      runButton.setAttribute('aria-busy', running ? 'true' : 'false');
    }
    document.querySelectorAll('.processor-action').forEach(function (button) {
      button.setAttribute('aria-busy', button.disabled ? 'true' : 'false');
      var row = button.closest('tr');
      var provider = row && row.querySelector('.processor-name strong');
      var providerName = provider ? provider.textContent.trim() : 'fornecedor';
      var action = (button.textContent || '').trim().toLowerCase();
      button.setAttribute('aria-label', action + ' — ' + providerName);
    });
  }

  function enhanceDangerAction() {
    if (!runButton) return;
    runButton.setAttribute('aria-label', 'Executar manutenção de retenção agora; remove registros elegíveis após confirmação');
    runButton.setAttribute('title', 'Ação destrutiva: remove apenas registros elegíveis das políticas automáticas, após confirmação.');
  }

  function enhance() {
    labelTable(retentionTable);
    labelTable(processorTable);
    classifyStatus(retentionStatus);
    classifyStatus(processorStatus);
    syncBusyState();
    enhanceDangerAction();
  }

  enhance();

  var observer = new MutationObserver(function () {
    enhance();
  });

  [document.getElementById('retentionRows'), document.getElementById('processorRows'), retentionStatus, processorStatus, refreshButton, runButton]
    .filter(Boolean)
    .forEach(function (node) {
      observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    });
})();

(function () {
  function enhanceButtons(root) {
    (root || document).querySelectorAll('.unarchive-button').forEach(function (button) {
      const studentName = button.dataset.studentName || 'aluno';
      button.setAttribute('aria-label', 'Desarquivar ' + studentName);
      const loading = button.disabled && /DESARQUIVANDO/i.test(button.textContent || '');
      button.classList.toggle('is-loading', loading);
      if (loading) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    });
  }

  function enhanceStaticUi() {
    const status = document.getElementById('pageStatus');
    const list = document.getElementById('archiveList');
    const count = document.getElementById('archiveCount');
    const search = document.getElementById('archiveSearch');
    const refresh = document.getElementById('refreshArchived');

    if (status) {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
    }
    if (list) {
      list.setAttribute('aria-live', 'polite');
      list.setAttribute('aria-busy', 'false');
    }
    if (count) count.setAttribute('aria-label', 'Quantidade total de alunos arquivados');
    if (search && !search.getAttribute('aria-label')) search.setAttribute('aria-label', 'Buscar aluno arquivado por nome ou e-mail');
    if (refresh) refresh.setAttribute('aria-label', 'Atualizar lista de alunos arquivados');
  }

  function observe() {
    const content = document.getElementById('content') || document.body;
    const observer = new MutationObserver(function () {
      enhanceButtons(content);
      const refresh = document.getElementById('refreshArchived');
      if (refresh) {
        if (refresh.disabled) refresh.setAttribute('aria-busy', 'true');
        else refresh.removeAttribute('aria-busy');
      }
    });
    observer.observe(content, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  }

  function init() {
    enhanceStaticUi();
    enhanceButtons(document);
    observe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

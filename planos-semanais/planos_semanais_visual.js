(function () {
  'use strict';

  const list = document.getElementById('studentList');
  const refresh = document.getElementById('refreshPlans');
  const search = document.getElementById('studentSearch');
  const filter = document.getElementById('progressFilter');
  const pageStatus = document.getElementById('pageStatus');

  document.documentElement.classList.add('tf-brand-palette');

  if (list) {
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-busy', 'false');
  }
  if (pageStatus) pageStatus.setAttribute('role', 'status');
  if (search) search.setAttribute('aria-label', 'Buscar aluno por nome, e-mail ou turma');
  if (filter) filter.setAttribute('aria-label', 'Filtrar alunos por progresso semanal');
  if (refresh) refresh.setAttribute('aria-label', 'Atualizar planos semanais dos alunos');

  function enhanceCards() {
    if (!list) return;
    list.querySelectorAll('.student-card').forEach(function (card) {
      const badge = card.querySelector('.progress-badge');
      if (!badge) return;
      const match = String(badge.textContent || '').match(/(\d{1,3})/);
      const progress = match ? Math.max(0, Math.min(100, Number(match[1]))) : 0;

      card.classList.toggle('is-complete', progress === 100);
      card.classList.toggle('is-low', progress < 50);
      card.classList.toggle('is-pending', progress >= 50 && progress < 100);
      card.setAttribute('data-progress', String(progress));

      const studentName = (card.querySelector('.student-name') || {}).textContent || 'Aluno';
      badge.setAttribute('aria-label', studentName.trim() + ': ' + progress + '% do plano semanal concluído');

      const bar = card.querySelector('.bar');
      if (bar) {
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(progress));
        bar.setAttribute('aria-label', 'Progresso semanal de ' + studentName.trim());
      }

      card.querySelectorAll('.card-actions a').forEach(function (link) {
        const label = (link.textContent || '').trim();
        link.setAttribute('aria-label', label + ' para consultar informações relacionadas a ' + studentName.trim());
      });
    });
  }

  function syncBusy() {
    const busy = !!(refresh && refresh.disabled);
    if (refresh) refresh.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (list) list.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  enhanceCards();
  syncBusy();

  if (list) {
    new MutationObserver(function () {
      enhanceCards();
      syncBusy();
    }).observe(list, { childList: true, subtree: true });
  }

  if (refresh) {
    new MutationObserver(syncBusy).observe(refresh, { attributes: true, attributeFilter: ['disabled'] });
  }
})();

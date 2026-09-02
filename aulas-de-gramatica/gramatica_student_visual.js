(function () {
  'use strict';

  function iconCheck() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  }

  function iconBook() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>';
  }

  function ensurePaletteClass() {
    document.documentElement.classList.add('tf-brand-palette');
  }

  function ensureProgressPanel() {
    if (document.querySelector('.grammar-progress')) return;
    const grid = document.getElementById('grammarLessons');
    if (!grid) return;

    const panel = document.createElement('section');
    panel.className = 'grammar-progress';
    panel.setAttribute('aria-label', 'Progresso nas aulas de gramática');
    panel.innerHTML = '<div class="grammar-progress-copy"><span class="grammar-progress-label">Seu progresso</span><strong id="grammarProgressText">Carregando aulas...</strong></div><div class="grammar-progress-track" role="progressbar" aria-label="Aulas de gramática concluídas" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span class="grammar-progress-fill"></span></div>';
    grid.parentNode.insertBefore(panel, grid);
  }

  function updateLessonPresentation() {
    const cards = Array.from(document.querySelectorAll('.grammar-card[data-lesson-id]'));

    cards.forEach(function (card) {
      const done = card.classList.contains('done');
      const heading = card.querySelector('h2');
      const title = heading ? heading.textContent.trim() : 'Lição de gramática';

      let state = card.querySelector('.lesson-state');
      if (!state && heading) {
        state = document.createElement('span');
        state.className = 'lesson-state';
        heading.parentNode.insertBefore(state, heading);
      }
      if (state) {
        state.innerHTML = (done ? iconCheck() : iconBook()) + '<span>' + (done ? 'Concluída' : 'Em estudo') + '</span>';
      }

      card.setAttribute('aria-label', title + (done ? ', concluída' : ', não concluída'));

      const exercise = card.querySelector('.exercise-link');
      if (exercise) {
        exercise.innerHTML = iconBook() + '<span>ABRIR EXERCÍCIOS</span>';
        exercise.setAttribute('aria-label', 'Abrir exercícios de ' + title + ' em nova aba');
      }

      const button = card.querySelector('.completion-button');
      if (button) {
        button.setAttribute('aria-label', (done ? 'Marcar como não feita: ' : 'Marcar como feita: ') + title);
        button.setAttribute('aria-pressed', done ? 'true' : 'false');
      }

      const status = card.querySelector('.completion-status');
      if (status) {
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
      }
    });

    updateProgress(cards);
  }

  function updateProgress(cards) {
    ensureProgressPanel();
    const panel = document.querySelector('.grammar-progress');
    const text = document.getElementById('grammarProgressText');
    const track = panel && panel.querySelector('.grammar-progress-track');
    const fill = panel && panel.querySelector('.grammar-progress-fill');
    if (!panel || !text || !track || !fill) return;

    const total = cards.length;
    const done = cards.filter(function (card) { return card.classList.contains('done'); }).length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    if (!total) {
      text.textContent = 'Nenhuma aula disponível no momento';
    } else if (done === total) {
      text.textContent = done + ' de ' + total + ' aulas concluídas';
    } else {
      text.textContent = done + ' de ' + total + ' aulas concluídas';
    }

    track.setAttribute('aria-valuemax', String(total));
    track.setAttribute('aria-valuenow', String(done));
    track.setAttribute('aria-valuetext', done + ' de ' + total + ' aulas concluídas');
    fill.style.width = percent + '%';
    panel.classList.toggle('is-complete', total > 0 && done === total);
  }

  function observeDynamicContent() {
    const grid = document.getElementById('grammarLessons');
    if (!grid) return;

    const observer = new MutationObserver(function () {
      updateLessonPresentation();
    });

    observer.observe(grid, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

  function enhanceLoadingState() {
    const grid = document.getElementById('grammarLessons');
    if (grid) {
      grid.setAttribute('aria-live', 'polite');
      grid.setAttribute('aria-busy', 'true');
    }

    const observer = new MutationObserver(function () {
      if (!grid) return;
      const hasRenderedState = grid.children.length > 0;
      if (hasRenderedState) grid.setAttribute('aria-busy', 'false');
    });
    if (grid) observer.observe(grid, { childList: true });
  }

  function init() {
    ensurePaletteClass();
    ensureProgressPanel();
    enhanceLoadingState();
    updateLessonPresentation();
    observeDynamicContent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

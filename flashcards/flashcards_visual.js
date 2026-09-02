(function () {
  'use strict';

  function icon(name) {
    const icons = {
      users: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      folder: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
      trash: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
      check: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
      clock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
    };
    return icons[name] || '';
  }

  function ensurePalette() {
    document.documentElement.classList.add('tf-brand-palette');
  }

  function replaceStaticIcons() {
    const sectionIcons = document.querySelectorAll('.section-icon');
    if (sectionIcons[0]) sectionIcons[0].innerHTML = icon('users');
    if (sectionIcons[1]) sectionIcons[1].innerHTML = icon('folder');

    const summaryIcon = document.querySelector('.summary-icon');
    if (summaryIcon) summaryIcon.innerHTML = icon('check');
  }

  function deckStatus(metaText) {
    const text = String(metaText || '').toLocaleLowerCase('pt-BR');
    const match = text.match(/(\d+)\s+para revisar hoje/);
    if (match && Number(match[1]) > 0) {
      const count = Number(match[1]);
      return {
        type: 'due',
        label: count === 1 ? '1 revisão devida hoje' : count + ' revisões devidas hoje'
      };
    }
    if (text.includes('em dia hoje')) {
      return { type: 'current', label: 'Em dia hoje' };
    }
    return null;
  }

  function enhanceDeckCard(card) {
    if (!card || card.dataset.tfVisualEnhanced === '1') return;
    card.dataset.tfVisualEnhanced = '1';

    const heading = card.querySelector('h4');
    const title = heading ? heading.textContent.trim() : 'conjunto de flashcards';
    const meta = card.querySelector('.deck-meta');
    const state = deckStatus(meta && meta.textContent);

    if (state && meta) {
      card.classList.add(state.type === 'due' ? 'is-due' : 'is-current');
      const badge = document.createElement('span');
      badge.className = 'deck-state-badge ' + (state.type === 'due' ? 'is-due' : 'is-current');
      badge.innerHTML = icon(state.type === 'due' ? 'clock' : 'check') + '<span>' + state.label + '</span>';
      meta.insertAdjacentElement('afterend', badge);
    }

    const deleteButton = card.querySelector('.icon-button[data-action="delete"]');
    if (deleteButton) {
      deleteButton.innerHTML = icon('trash');
      deleteButton.title = 'Excluir ' + title;
    }

    card.querySelectorAll('[data-action]').forEach(function (button) {
      const action = button.dataset.action;
      if (action === 'study-due') button.setAttribute('aria-label', 'Revisar cartões devidos do conjunto ' + title);
      if (action === 'study-all' || action === 'study') button.setAttribute('aria-label', 'Estudar todos os cartões do conjunto ' + title);
      if (action === 'edit') button.setAttribute('aria-label', 'Editar conjunto ' + title);
    });
  }

  function enhanceStudentGroups() {
    document.querySelectorAll('.student-group').forEach(function (group) {
      if (group.dataset.tfA11y === '1') return;
      group.dataset.tfA11y = '1';
      const name = group.querySelector('.student-identity h4');
      if (name) group.setAttribute('aria-label', 'Flashcards de ' + name.textContent.trim());
    });
  }

  function enhanceEditor() {
    document.querySelectorAll('.card-editor-row').forEach(function (row, index) {
      if (row.dataset.tfA11y === '1') return;
      row.dataset.tfA11y = '1';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Cartão ' + (index + 1));
      const remove = row.querySelector('.remove-card-button');
      if (remove) {
        remove.innerHTML = icon('trash');
        remove.setAttribute('aria-label', 'Remover cartão ' + (index + 1));
      }
    });

    const saveButton = document.getElementById('saveDeckButton');
    if (saveButton) saveButton.setAttribute('aria-busy', saveButton.disabled ? 'true' : 'false');
  }

  function enhanceGrades() {
    const labels = {
      again: 'Não lembrei. Reagendar para revisão mais cedo.',
      hard: 'Difícil. Aumentar o intervalo com cautela.',
      good: 'Lembrei. Aplicar intervalo normal de revisão.',
      easy: 'Fácil. Aplicar intervalo maior de revisão.'
    };
    document.querySelectorAll('[data-grade]').forEach(function (button) {
      const grade = button.dataset.grade;
      if (labels[grade]) button.setAttribute('aria-label', labels[grade]);
    });
  }

  function enhanceStudyProgress() {
    const track = document.querySelector('.progress-track');
    const label = document.getElementById('studyProgress');
    if (!track || !label) return;

    const match = label.textContent.match(/Cartão\s+(\d+)\s+de\s+(\d+)/i);
    track.removeAttribute('aria-hidden');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Progresso da sessão de flashcards');
    track.setAttribute('aria-valuemin', '0');
    if (match) {
      track.setAttribute('aria-valuenow', match[1]);
      track.setAttribute('aria-valuemax', match[2]);
      track.setAttribute('aria-valuetext', 'Cartão ' + match[1] + ' de ' + match[2]);
    }
  }

  function enhanceLiveRegions() {
    const answer = document.getElementById('answerFeedback');
    const summary = document.getElementById('studySummary');
    const score = document.getElementById('studyScore');
    if (answer) {
      answer.setAttribute('role', 'status');
      answer.setAttribute('aria-live', 'polite');
    }
    if (summary) {
      summary.setAttribute('role', 'status');
      summary.setAttribute('aria-live', 'polite');
    }
    if (score) score.setAttribute('aria-live', 'polite');
  }

  let scheduled = false;
  function scheduleEnhancement() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      document.querySelectorAll('.deck-card').forEach(enhanceDeckCard);
      enhanceStudentGroups();
      enhanceEditor();
      enhanceGrades();
      enhanceStudyProgress();
    });
  }

  function observeDynamicContent() {
    const targets = [
      document.getElementById('myDecks'),
      document.getElementById('studentDirectory'),
      document.getElementById('cardsEditor'),
      document.getElementById('studyContent')
    ].filter(Boolean);

    const observer = new MutationObserver(scheduleEnhancement);
    targets.forEach(function (target) {
      observer.observe(target, { childList: true, subtree: true, characterData: true });
    });

    const saveButton = document.getElementById('saveDeckButton');
    if (saveButton) {
      const buttonObserver = new MutationObserver(function () {
        saveButton.setAttribute('aria-busy', saveButton.disabled ? 'true' : 'false');
      });
      buttonObserver.observe(saveButton, { attributes: true, attributeFilter: ['disabled'] });
    }
  }

  function init() {
    ensurePalette();
    replaceStaticIcons();
    enhanceLiveRegions();
    scheduleEnhancement();
    observeDynamicContent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

(function () {
  'use strict';

  document.documentElement.classList.add('tf-brand-palette');

  const status = document.getElementById('adminStatus');
  if (status) {
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
  }

  const feedback = document.getElementById('formFeedback');
  if (feedback) {
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('aria-atomic', 'true');
  }

  const history = document.getElementById('lessonsHistory');
  if (history) {
    history.setAttribute('aria-live', 'polite');
    history.setAttribute('aria-busy', history.textContent.includes('Carregando') ? 'true' : 'false');
  }

  const form = document.getElementById('lessonForm');
  const submitButton = document.getElementById('submitButton');
  const cancelButton = document.getElementById('cancelEditButton');
  const formTitle = document.getElementById('formTitle');

  if (formTitle) formTitle.setAttribute('tabindex', '-1');
  if (form) form.setAttribute('aria-labelledby', 'formTitle');

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function enhanceResourceParagraph(paragraph, label) {
    if (!paragraph || paragraph.dataset.tfEnhanced === 'true') return;
    const bold = paragraph.querySelector('b');
    if (!bold) return;

    const raw = paragraph.textContent.replace(bold.textContent, '').trim();
    const href = safeHttpUrl(raw);
    if (!href) return;

    paragraph.dataset.tfEnhanced = 'true';
    paragraph.innerHTML = '';
    paragraph.appendChild(bold);
    paragraph.appendChild(document.createTextNode(' '));

    const link = document.createElement('a');
    link.className = 'lesson-resource-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = raw;
    link.setAttribute('aria-label', label + ': ' + raw + ' (abre em nova aba)');
    paragraph.appendChild(link);
  }

  function ensureLessonsCount(cards) {
    const panel = history && history.closest('.panel');
    if (!panel) return;

    let badge = panel.querySelector('.lessons-count');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'lessons-count';
      badge.setAttribute('aria-live', 'polite');
      history.parentNode.insertBefore(badge, history);
    }

    const count = cards.length;
    badge.textContent = count + (count === 1 ? ' lição cadastrada' : ' lições cadastradas');
    badge.hidden = count === 0;
  }

  function enhanceHistory() {
    if (!history) return;

    const cards = Array.from(history.querySelectorAll('.lesson-admin-card'));
    history.setAttribute('aria-busy', 'false');
    ensureLessonsCount(cards);

    cards.forEach(function (card, index) {
      const title = card.querySelector('strong');
      const lessonName = title ? title.textContent.trim() : 'Lição ' + (index + 1);

      if (title) {
        if (!title.id) title.id = 'grammarLessonTitle' + index;
        card.setAttribute('aria-labelledby', title.id);
      }

      const paragraphs = card.querySelectorAll('p');
      enhanceResourceParagraph(paragraphs[0], 'Abrir vídeo de ' + lessonName);
      enhanceResourceParagraph(paragraphs[1], 'Abrir exercícios de ' + lessonName);

      const editButton = card.querySelector('[data-edit-id]');
      const deleteButton = card.querySelector('[data-delete-id]');

      if (editButton) {
        editButton.setAttribute('aria-label', 'Editar lição ' + lessonName);
      }
      if (deleteButton) {
        deleteButton.setAttribute('aria-label', 'Excluir lição ' + lessonName + ' permanentemente');
      }
    });
  }

  function syncBusyStates() {
    if (submitButton) {
      submitButton.setAttribute('aria-busy', submitButton.disabled ? 'true' : 'false');
    }
  }

  function syncEditState() {
    if (!formTitle || !cancelButton) return;
    const editing = formTitle.textContent.toLowerCase().includes('editar');
    form.dataset.mode = editing ? 'edit' : 'create';
    cancelButton.setAttribute('aria-hidden', cancelButton.style.display === 'none' ? 'true' : 'false');
  }

  if (history) {
    const historyObserver = new MutationObserver(function () {
      enhanceHistory();
    });
    historyObserver.observe(history, { childList: true, subtree: true });
  }

  if (submitButton) {
    const buttonObserver = new MutationObserver(syncBusyStates);
    buttonObserver.observe(submitButton, { attributes: true, attributeFilter: ['disabled'] });
  }

  if (formTitle || cancelButton) {
    const formObserver = new MutationObserver(syncEditState);
    if (formTitle) formObserver.observe(formTitle, { childList: true, characterData: true, subtree: true });
    if (cancelButton) formObserver.observe(cancelButton, { attributes: true, attributeFilter: ['style'] });
  }

  enhanceHistory();
  syncBusyStates();
  syncEditState();
})();

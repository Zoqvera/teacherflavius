(function () {
  'use strict';

  document.documentElement.classList.add('tf-brand-palette');

  var form = document.getElementById('createExerciseForm');
  var submitButton = form && form.querySelector("button[type='submit']");
  var message = document.getElementById('createExerciseMessage');
  var list = document.getElementById('teacherExercisesList');
  var adminStatus = document.getElementById('adminStatus');
  var publishDate = document.getElementById('publishDate');
  var publishTime = document.getElementById('publishTime');
  var scheduleHelp = document.querySelector('.field-help');

  if (message) {
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    message.setAttribute('aria-atomic', 'true');
  }

  if (adminStatus) {
    adminStatus.setAttribute('role', 'status');
    adminStatus.setAttribute('aria-live', 'polite');
    adminStatus.setAttribute('aria-atomic', 'true');
  }

  if (list) {
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-busy', 'false');
  }

  if (scheduleHelp) {
    scheduleHelp.id = scheduleHelp.id || 'exerciseScheduleHelp';
    if (publishDate) publishDate.setAttribute('aria-describedby', scheduleHelp.id);
    if (publishTime) publishTime.setAttribute('aria-describedby', scheduleHelp.id);
  }

  function syncMessageState() {
    if (!message) return;
    var text = (message.textContent || '').trim().toLowerCase();
    message.classList.remove('tf-success', 'tf-error');
    if (!text) return;
    if (message.classList.contains('error') || text.indexOf('não foi possível') !== -1 || text.indexOf('erro') !== -1) {
      message.classList.add('tf-error');
      return;
    }
    if (text.indexOf('salvo') !== -1 || text.indexOf('publicado') !== -1 || text.indexOf('programado') !== -1) {
      message.classList.add('tf-success');
    }
  }

  function publicationState(card) {
    var paragraphs = Array.prototype.slice.call(card.querySelectorAll('p'));
    var statusParagraph = paragraphs.find(function (paragraph) {
      return (paragraph.textContent || '').trim().toLowerCase().indexOf('status:') === 0;
    });
    if (!statusParagraph) return null;

    var text = (statusParagraph.textContent || '').toLowerCase();
    if (text.indexOf('programado') !== -1) return { key: 'scheduled', label: 'Programado' };
    if (text.indexOf('inativo') !== -1) return { key: 'inactive', label: 'Inativo' };
    if (text.indexOf('publicado') !== -1) return { key: 'published', label: 'Publicado' };
    return null;
  }

  function enhanceCard(card) {
    if (!card) return;

    card.classList.remove('tf-status-published', 'tf-status-scheduled', 'tf-status-inactive');
    var state = publicationState(card);
    if (state) card.classList.add('tf-status-' + state.key);

    var existingBadge = card.querySelector('.tf-publication-badge');
    if (state) {
      if (!existingBadge) {
        existingBadge = document.createElement('span');
        existingBadge.className = 'tf-publication-badge';
        existingBadge.setAttribute('aria-label', 'Status de publicação');
        card.appendChild(existingBadge);
      }
      existingBadge.className = 'tf-publication-badge ' + state.key;
      existingBadge.textContent = state.label;
    } else if (existingBadge) {
      existingBadge.remove();
    }

    var title = card.querySelector('strong');
    var deleteButton = card.querySelector('.delete-exercise-button');
    if (deleteButton) {
      var exerciseName = title ? (title.textContent || '').trim() : 'exercício';
      deleteButton.setAttribute('aria-label', 'Excluir exercício: ' + exerciseName);
      deleteButton.setAttribute('aria-busy', deleteButton.disabled ? 'true' : 'false');
    }

    var externalLink = card.querySelector("a[target='_blank']");
    if (externalLink) {
      var linkLabel = title ? (title.textContent || '').trim() : 'exercício';
      externalLink.setAttribute('aria-label', 'Abrir ' + linkLabel + ' em nova aba');
    }
  }

  function enhanceCards() {
    document.querySelectorAll('.exercise-card').forEach(enhanceCard);
  }

  function syncBusyStates() {
    if (submitButton) {
      submitButton.setAttribute('aria-busy', submitButton.disabled ? 'true' : 'false');
      submitButton.setAttribute('aria-label', submitButton.disabled ? 'Salvando exercício' : 'Salvar exercício');
    }

    document.querySelectorAll('.delete-exercise-button').forEach(function (button) {
      button.setAttribute('aria-busy', button.disabled ? 'true' : 'false');
    });

    if (list) {
      var loading = list.classList.contains('empty') && /carregando/i.test(list.textContent || '');
      list.setAttribute('aria-busy', loading ? 'true' : 'false');
    }
  }

  function enhance() {
    syncMessageState();
    enhanceCards();
    syncBusyStates();
  }

  enhance();

  var observer = new MutationObserver(function () {
    enhance();
  });

  if (list) observer.observe(list, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class'] });
  if (message) observer.observe(message, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  if (submitButton) observer.observe(submitButton, { attributes: true, attributeFilter: ['disabled'] });
})();

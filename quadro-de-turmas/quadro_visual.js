(function () {
  'use strict';

  function capacityFor(card) {
    var badge = card.querySelector('.class-type-badge');
    if (!badge) return null;
    if (badge.classList.contains('individual')) return 1;
    if (badge.classList.contains('quartet')) return 4;
    if (badge.classList.contains('eight_students')) return 8;
    return null;
  }

  function enhanceCard(card, index) {
    if (!card || card.dataset.tfEnhanced === '1') return;
    card.dataset.tfEnhanced = '1';

    var title = card.querySelector('.class-title');
    var students = Array.prototype.slice.call(card.querySelectorAll('.student-name[data-ref-id]'));
    var capacity = capacityFor(card);
    var enrolled = students.length;
    var occupancy = 'unknown';
    var label = enrolled + ' aluno' + (enrolled === 1 ? '' : 's');
    var fill = 0;

    if (capacity) {
      var vacancies = Math.max(0, capacity - enrolled);
      fill = Math.min(100, Math.round((enrolled / capacity) * 100));
      occupancy = enrolled > capacity ? 'over' : (enrolled === capacity ? 'full' : 'available');
      label = enrolled + '/' + capacity + ' · ' + (vacancies === 0 ? 'sem vagas' : vacancies + ' vaga' + (vacancies === 1 ? '' : 's'));
    }

    card.dataset.occupancy = occupancy;
    var meter = document.createElement('div');
    meter.className = 'tf-occupancy';
    meter.innerHTML = '<div class="tf-occupancy-head"><span>Ocupação</span><strong>' + label + '</strong></div>' +
      '<div class="tf-meter" role="progressbar" aria-label="Ocupação da turma" aria-valuemin="0"' +
      (capacity ? ' aria-valuemax="' + capacity + '" aria-valuenow="' + enrolled + '"' : '') +
      '><span style="--tf-fill:' + fill + '%"></span></div>';

    var number = card.querySelector('.class-number');
    if (number) number.insertAdjacentElement('afterend', meter);

    card.setAttribute('aria-label', (title ? title.textContent.trim() : 'Turma ' + (index + 1)) + ', ' + label);

    students.forEach(function (student) {
      student.setAttribute('tabindex', '0');
      student.setAttribute('role', 'button');
      student.setAttribute('aria-label', 'Alternar tag pacote antigo para ' + student.childNodes[0].textContent.trim());
      student.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          student.click();
        }
      });
    });
  }

  function enhanceBoard() {
    document.documentElement.classList.add('tf-brand-palette');
    var status = document.getElementById('adminStatus');
    if (status) {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
    }
    var board = document.getElementById('boardContainer');
    if (board) board.setAttribute('aria-live', 'polite');
    document.querySelectorAll('.extra-card.class-item').forEach(enhanceCard);
  }

  var board = document.getElementById('boardContainer');
  if (board) {
    new MutationObserver(enhanceBoard).observe(board, { childList:true, subtree:true });
  }
  enhanceBoard();
})();

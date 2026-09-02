(function () {
  const iconPaths = {
    syncFrame: '<path d="M8 7h9a4 4 0 0 1 4 4v1"/><path d="m17 9 2-2 2 2"/><path d="M16 17H7a4 4 0 0 1-4-4v-1"/><path d="m7 15-2 2-2-2"/>',
    accessFrame: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    vacancyFrame: '<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 8h12"/><path d="M6 16h12"/><path d="M9 8v8"/><path d="M15 8v8"/>',
    acquisitionFrame: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><circle cx="12" cy="12" r="4"/><path d="m17.7 6.3-2.1 2.1"/><path d="m8.4 15.6-2.1 2.1"/><path d="m6.3 6.3 2.1 2.1"/><path d="m15.6 15.6 2.1 2.1"/>'
  };

  const embeddedCss = `
    html {
      background: #031a3f !important;
      color-scheme: dark !important;
    }
    body,
    input,
    select,
    textarea,
    button {
      font-family: 'Open Sans', Arial, sans-serif !important;
    }
    body {
      background: linear-gradient(160deg, #031a3f 0%, #06183b 58%, #0a2956 100%) !important;
      color: #f8fafc !important;
    }
    h1, h2, h3, .day-title, .student-name, .class-name, .metric-value,
    .summary-card strong, .panel h2, .card-title {
      font-family: 'Montserrat', Arial, sans-serif !important;
    }
    .day-card, .panel, .summary-card, .vacancy-card, .metric, .empty-panel, .empty,
    .table-wrap, .privacy-note, .card {
      background: rgba(3,26,63,.74) !important;
      border-color: rgba(78,154,236,.24) !important;
      color: #e2e8f0 !important;
      box-shadow: none !important;
    }
    .reports-note, .reports-note small, .day-meta, .muted, .intro,
    .class-meta, .metric-label, .summary-card span, td, .status {
      color: #b8c7da !important;
    }
    .day-title, .section-title, .student-name, .class-name,
    .metric-value, .summary-card strong, .panel h2, strong {
      color: #f8fafc !important;
    }
    table {
      background: rgba(2,16,43,.26) !important;
    }
    th {
      background: rgba(9,104,188,.18) !important;
      color: #dbeafe !important;
      font-family: 'Montserrat', Arial, sans-serif !important;
      font-weight: 700 !important;
    }
    th, td {
      border-bottom-color: rgba(148,163,184,.14) !important;
    }
    tbody tr:hover td {
      background: rgba(9,104,188,.08) !important;
    }
    select, input, textarea {
      background: #0b234b !important;
      color: #f8fafc !important;
      border-color: rgba(78,154,236,.38) !important;
    }
    select:focus-visible, input:focus-visible, textarea:focus-visible,
    button:focus-visible, a:focus-visible {
      outline: 3px solid rgba(191,219,254,.68) !important;
      outline-offset: 2px !important;
    }
    .refresh-button, button.top-link, .primary-button, .detail-button {
      background: rgba(9,104,188,.23) !important;
      color: #f8fafc !important;
      border: 1px solid rgba(78,154,236,.50) !important;
      font-family: 'Montserrat', Arial, sans-serif !important;
    }
    .refresh-button:hover, button.top-link:hover, .primary-button:hover, .detail-button:hover {
      background: rgba(9,104,188,.34) !important;
      border-color: rgba(147,197,253,.64) !important;
    }
    .page-link, .inline-link, .link-button {
      color: #93c5fd !important;
    }
    .spots {
      background: rgba(9,104,188,.14) !important;
      border-color: rgba(78,154,236,.34) !important;
    }
    .spots strong, .spots span {
      color: #dbeafe !important;
    }
    .status-success, .status-accessed {
      color: #bbf7d0 !important;
      background: rgba(34,197,94,.12) !important;
      border-color: rgba(34,197,94,.30) !important;
    }
    .status-partial, .status-never, .warning {
      color: #fde68a !important;
      background: rgba(245,158,11,.12) !important;
      border-color: rgba(245,158,11,.30) !important;
    }
    .status-error, .error, .error-text {
      color: #fecaca !important;
    }
    @media (max-width: 720px) {
      .container {
        padding-left: 14px !important;
        padding-right: 14px !important;
      }
      .day-card, .panel, .vacancy-card, .summary-card {
        border-radius: 15px !important;
      }
      .table-wrap {
        overflow: visible !important;
        border: 0 !important;
        background: transparent !important;
      }
      table.tf-report-mobile-cards,
      table.tf-report-mobile-cards tbody,
      table.tf-report-mobile-cards tr,
      table.tf-report-mobile-cards td {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
      }
      table.tf-report-mobile-cards {
        min-width: 0 !important;
        background: transparent !important;
      }
      table.tf-report-mobile-cards thead {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0,0,0,0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }
      table.tf-report-mobile-cards tr {
        margin: 0 0 12px !important;
        padding: 8px 12px !important;
        border: 1px solid rgba(78,154,236,.22) !important;
        border-radius: 14px !important;
        background: rgba(3,26,63,.72) !important;
      }
      table.tf-report-mobile-cards td {
        display: grid !important;
        grid-template-columns: minmax(112px, 42%) minmax(0, 1fr) !important;
        gap: 12px !important;
        padding: 9px 0 !important;
        border-bottom: 1px solid rgba(148,163,184,.12) !important;
        overflow-wrap: anywhere !important;
      }
      table.tf-report-mobile-cards td:last-child {
        border-bottom: 0 !important;
      }
      table.tf-report-mobile-cards td::before {
        content: attr(data-label);
        color: #93c5fd;
        font-family: 'Montserrat', Arial, sans-serif;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.4;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: .01ms !important;
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
      }
    }
  `;

  function svgFor(target) {
    const paths = iconPaths[target] || iconPaths.syncFrame;
    return '<span class="tf-report-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + paths + '</svg></span>';
  }

  function enhanceTabs() {
    const tabs = Array.from(document.querySelectorAll('.report-tab'));
    const frames = Array.from(document.querySelectorAll('.report-frame'));
    if (!tabs.length) return;

    tabs.forEach(function (tab, index) {
      const target = tab.dataset.target || '';
      const strong = tab.querySelector('strong');
      if (strong && !tab.querySelector('.tf-report-tab-icon')) {
        strong.textContent = strong.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim();
        tab.insertAdjacentHTML('afterbegin', svgFor(target));
      }
      tab.id = tab.id || ('report-tab-' + target);
      tab.setAttribute('aria-controls', target);
      tab.setAttribute('tabindex', tab.getAttribute('aria-selected') === 'true' ? '0' : '-1');

      const frame = frames.find(function (item) { return item.id === target; });
      if (frame) frame.setAttribute('aria-labelledby', tab.id);

      tab.addEventListener('click', function () {
        window.setTimeout(syncTabState, 0);
      });

      tab.addEventListener('keydown', function (event) {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        else next = (index - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    });

    function syncTabState() {
      tabs.forEach(function (tab) {
        tab.setAttribute('tabindex', tab.getAttribute('aria-selected') === 'true' ? '0' : '-1');
      });
    }

    syncTabState();
  }

  function labelTables(doc) {
    Array.from(doc.querySelectorAll('table')).forEach(function (table) {
      const headers = Array.from(table.querySelectorAll('thead th')).map(function (th) {
        return th.textContent.trim();
      });
      if (!headers.length) return;
      table.classList.add('tf-report-mobile-cards');
      Array.from(table.querySelectorAll('tbody tr')).forEach(function (row) {
        Array.from(row.children).forEach(function (cell, index) {
          if (cell.tagName !== 'TD') return;
          cell.setAttribute('data-label', headers[index] || 'Informação');
        });
      });
    });
  }

  function injectEmbeddedTheme(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.head || !doc.documentElement) return;

      let style = doc.getElementById('teacher-flavius-reports-design-v1');
      if (!style) {
        style = doc.createElement('style');
        style.id = 'teacher-flavius-reports-design-v1';
        style.textContent = embeddedCss;
        doc.head.appendChild(style);
      }

      labelTables(doc);

      if (!frame._tfReportsVisualObserver && doc.body && window.MutationObserver) {
        const observer = new MutationObserver(function () { labelTables(doc); });
        observer.observe(doc.body, { childList: true, subtree: true });
        frame._tfReportsVisualObserver = observer;
      }

      frame.classList.remove('tf-report-frame-ready');
      void frame.offsetWidth;
      frame.classList.add('tf-report-frame-ready');
    } catch (_error) {
      // Os relatórios são same-origin; se o navegador bloquear o acesso, mantém o tema base existente.
    }
  }

  function enhanceFrames() {
    document.querySelectorAll('.report-frame').forEach(function (frame) {
      frame.addEventListener('load', function () {
        injectEmbeddedTheme(frame);
        window.setTimeout(function () { injectEmbeddedTheme(frame); }, 120);
        window.setTimeout(function () { injectEmbeddedTheme(frame); }, 600);
      });
      injectEmbeddedTheme(frame);
    });
  }

  document.documentElement.classList.add('tf-brand-palette');
  enhanceTabs();
  enhanceFrames();
})();
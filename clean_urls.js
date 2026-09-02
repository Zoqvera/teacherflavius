(function () {
  "use strict";

  if (window.TeacherFlaviusCleanUrlsInstalled) return;
  window.TeacherFlaviusCleanUrlsInstalled = true;

  const LEGACY_TO_CLEAN = {
    "/index.html": "/",
    "/acessos_dos_alunos.html": "/acessos-dos-alunos/",
    "/area_do_estudante.html": "/area-do-estudante/",
    "/aulas-de-gramatica-interface-do-professor.html": "/aulas-de-gramatica-interface-do-professor/",
    "/aulas-de-gramatica.html": "/aulas-de-gramatica/",
    "/cadastro.html": "/cadastro/",
    "/complete-cadastro.html": "/complete-cadastro/",
    "/criar_exercicio.html": "/criar-exercicio/",
    "/editar_aluno.html": "/editar-aluno/",
    "/exercicios.diarios.html": "/exercicios-diarios/",
    "/exercicios.html": "/exercicios/",
    "/exercicios_diarios.html": "/exercicios-diarios/",
    "/exercicios_dos_alunos.html": "/exercicios-dos-alunos/",
    "/exercicios_ordenar_frases.html": "/exercicios-ordenar-frases/",
    "/explanation_in_on_at.html": "/explanation-in-on-at/",
    "/flashcards.html": "/flashcards/",
    "/frequencia_aluno.html": "/frequencia/",
    "/frequência.html": "/frequencia/",
    "/guia-do-estudante.html": "/guia-do-estudante/",
    "/in_on_at.html": "/in-on-at/",
    "/login.html": "/login/",
    "/matricula.html": "/matricula/",
    "/mensalidades.html": "/mensalidades/",
    "/meu_progresso.html": "/meu-progresso/",
    "/minha_turma.html": "/minha-turma/",
    "/ordenar_simple_present.html": "/ordenar-simple-present/",
    "/perfil.html": "/perfil/",
    "/perfil_dos_alunos.html": "/perfil-dos-alunos/",
    "/professor.html": "/professor/",
    "/quadro-de-turmas.html": "/quadro-de-turmas/",
    "/quarta-feira-15h.html": "/quarta-feira-15h/",
    "/quarta-feira-17h.html": "/quarta-feira-17h/",
    "/quarta-feira-18h.html": "/quarta-feira-18h/",
    "/quarta-feira-20h.html": "/quarta-feira-20h/",
    "/quarta-feira-21h.html": "/quarta-feira-21h/",
    "/quero_conhecer.html": "/quero-conhecer/",
    "/quinta-feira-09h.html": "/quinta-feira-09h/",
    "/quinta-feira-10h.html": "/quinta-feira-10h/",
    "/quinta-feira-12h.html": "/quinta-feira-12h/",
    "/quinta-feira-13h.html": "/quinta-feira-13h/",
    "/quinta-feira-15h.html": "/quinta-feira-15h/",
    "/quinta-feira-17h.html": "/quinta-feira-17h/",
    "/quinta-feira-18h.html": "/quinta-feira-18h/",
    "/quinta-feira-20h.html": "/quinta-feira-20h/",
    "/quinta-feira-21h.html": "/quinta-feira-21h/",
    "/quizzes.html": "/quizzes/",
    "/radar_alunos.html": "/radar-de-alunos/",
    "/relatorios.html": "/relatorios/",
    "/relatorios_vagas_turmas.html": "/relatorios-vagas-turmas/",
    "/reposicoes.html": "/reposicoes/",
    "/reposicoes_admin.html": "/reposicoes-admin/",
    "/resultados.html": "/resultados/",
    "/roteiro_de_estudos.html": "/roteiro-de-estudos/",
    "/sexta-feira-09h.html": "/sexta-feira-09h/",
    "/sexta-feira-10h.html": "/sexta-feira-10h/",
    "/sexta-feira-12h.html": "/sexta-feira-12h/",
    "/sexta-feira-13h.html": "/sexta-feira-13h/",
    "/sexta-feira-15h.html": "/sexta-feira-15h/",
    "/sexta-feira-17h.html": "/sexta-feira-17h/",
    "/sexta-feira-18h.html": "/sexta-feira-18h/",
    "/sexta-feira-20h.html": "/sexta-feira-20h/",
    "/sexta-feira-21h.html": "/sexta-feira-21h/",
    "/simple_past.html": "/simple-past/",
    "/simple_present.html": "/simple-present/",
    "/terça-feira-18h.html": "/terca-feira-18h/",
    "/there_to_be.html": "/there-to-be/",
    "/this_that_these_those.html": "/this-that-these-those/",
    "/turma.html": "/turma/",
    "/turmas.html": "/turmas/"
  };

  function decodedPath(pathname) {
    try { return decodeURIComponent(pathname); } catch (error) { return pathname; }
  }

  function cleanPath(pathname) {
    const decoded = decodedPath(pathname);
    if (LEGACY_TO_CLEAN[decoded]) return LEGACY_TO_CLEAN[decoded];
    if (/\/index\.html$/i.test(decoded)) return decoded.replace(/index\.html$/i, "");
    return null;
  }

  function cleanInternalUrl(value) {
    if (!value) return null;
    let url;
    try { url = new URL(value, document.baseURI || window.location.href); } catch (error) { return null; }
    if (url.origin !== window.location.origin) return null;

    const clean = cleanPath(url.pathname);
    if (clean) url.pathname = clean;

    const next = url.searchParams.get("next");
    if (next) {
      let nextUrl;
      try { nextUrl = new URL(next, window.location.origin + "/"); } catch (error) { nextUrl = null; }
      if (nextUrl && nextUrl.origin === window.location.origin) {
        const cleanNext = cleanPath(nextUrl.pathname);
        if (cleanNext) {
          nextUrl.pathname = cleanNext;
          url.searchParams.set("next", nextUrl.pathname + nextUrl.search + nextUrl.hash);
        }
      }
    }

    return url.pathname + url.search + url.hash;
  }

  function rewriteElement(element) {
    if (!element || element.nodeType !== 1) return;
    const candidates = [];
    if (element.matches && element.matches("a[href], iframe[src], form[action]")) candidates.push(element);
    if (element.querySelectorAll) {
      element.querySelectorAll("a[href], iframe[src], form[action]").forEach(function (node) { candidates.push(node); });
    }
    candidates.forEach(function (node) {
      const attribute = node.matches("form[action]") ? "action" : node.matches("iframe[src]") ? "src" : "href";
      const raw = node.getAttribute(attribute);
      const cleaned = cleanInternalUrl(raw);
      if (cleaned && cleaned !== raw) node.setAttribute(attribute, cleaned);
    });
  }

  function updateSeoUrls() {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      const cleaned = cleanInternalUrl(canonical.getAttribute("href"));
      if (cleaned) canonical.setAttribute("href", window.location.origin + cleaned);
    }
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) {
      const cleaned = cleanInternalUrl(ogUrl.getAttribute("content"));
      if (cleaned) ogUrl.setAttribute("content", window.location.origin + cleaned);
    }
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
      let text = script.textContent || "";
      let changed = false;
      Object.keys(LEGACY_TO_CLEAN).forEach(function (legacy) {
        const from = window.location.origin + legacy;
        const to = window.location.origin + LEGACY_TO_CLEAN[legacy];
        if (text.includes(from)) { text = text.split(from).join(to); changed = true; }
      });
      if (changed) script.textContent = text;
    });
  }

  function normalizeCurrentAddress() {
    const clean = cleanPath(window.location.pathname);
    if (clean) {
      const current = new URL(window.location.href);
      current.pathname = clean;
      const next = current.searchParams.get("next");
      if (next) {
        let nextUrl;
        try { nextUrl = new URL(next, window.location.origin + "/"); } catch (error) { nextUrl = null; }
        if (nextUrl && nextUrl.origin === window.location.origin) {
          const cleanNext = cleanPath(nextUrl.pathname);
          if (cleanNext) {
            nextUrl.pathname = cleanNext;
            current.searchParams.set("next", nextUrl.pathname + nextUrl.search + nextUrl.hash);
          }
        }
      }
      window.history.replaceState(window.history.state, "", current.pathname + current.search + current.hash);
    }
    updateSeoUrls();
  }

  function install() {
    rewriteElement(document.documentElement);
    normalizeCurrentAddress();
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) { mutation.addedNodes.forEach(rewriteElement); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("click", function (event) {
      const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!link) return;
      const cleaned = cleanInternalUrl(link.getAttribute("href"));
      if (cleaned) link.setAttribute("href", cleaned);
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
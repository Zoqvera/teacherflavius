(function () {
  "use strict";

  const ROUTES = {
    "/acesso-por-senha/": "/acesso-por-senha/index.html",
    "/aulas-de-gramatica-interface-do-professor/": "/aulas-de-gramatica-interface-do-professor.html",
    "/aulas-de-gramatica/": "/aulas-de-gramatica.html",
    "/cadastro/": "/cadastro.html",
    "/exercicios-ordenar-frases/": "/exercicios_ordenar_frases.html",
    "/exercicios/": "/exercicios.html",
    "/explanation-in-on-at/": "/explanation_in_on_at.html",
    "/guia-do-estudante/": "/guia-do-estudante.html",
    "/in-on-at/": "/in_on_at.html",
    "/meu-progresso/": "/meu_progresso.html",
    "/ordenar-simple-present/": "/ordenar_simple_present.html",
    "/perfil/": "/perfil.html",
    "/quadro-de-turmas/": "/quadro-de-turmas.html",
    "/quarta-feira-15h/": "/quarta-feira-15h.html",
    "/quarta-feira-17h/": "/quarta-feira-17h.html",
    "/quarta-feira-18h/": "/quarta-feira-18h.html",
    "/quarta-feira-20h/": "/quarta-feira-20h.html",
    "/quarta-feira-21h/": "/quarta-feira-21h.html",
    "/quinta-feira-09h/": "/quinta-feira-09h.html",
    "/quinta-feira-10h/": "/quinta-feira-10h.html",
    "/quinta-feira-12h/": "/quinta-feira-12h.html",
    "/quinta-feira-13h/": "/quinta-feira-13h.html",
    "/quinta-feira-15h/": "/quinta-feira-15h.html",
    "/quinta-feira-17h/": "/quinta-feira-17h.html",
    "/quinta-feira-18h/": "/quinta-feira-18h.html",
    "/quinta-feira-20h/": "/quinta-feira-20h.html",
    "/quinta-feira-21h/": "/quinta-feira-21h.html",
    "/quizzes/": "/quizzes.html",
    "/relatorios-vagas-turmas/": "/relatorios_vagas_turmas.html",
    "/resultados/": "/resultados.html",
    "/sexta-feira-09h/": "/sexta-feira-09h.html",
    "/sexta-feira-10h/": "/sexta-feira-10h.html",
    "/sexta-feira-12h/": "/sexta-feira-12h.html",
    "/sexta-feira-13h/": "/sexta-feira-13h.html",
    "/sexta-feira-15h/": "/sexta-feira-15h.html",
    "/sexta-feira-17h/": "/sexta-feira-17h.html",
    "/sexta-feira-18h/": "/sexta-feira-18h.html",
    "/sexta-feira-20h/": "/sexta-feira-20h.html",
    "/sexta-feira-21h/": "/sexta-feira-21h.html",
    "/simple-past/": "/simple_past.html",
    "/simple-present/": "/simple_present.html",
    "/terca-feira-18h/": "/terça-feira-18h.html",
    "/there-to-be/": "/there_to_be.html",
    "/this-that-these-those/": "/this_that_these_those.html",
    "/turma/": "/turma.html"
  };


  function customizeProfileHtml(html) {
    return html
      .replace(
        '          <script src="/module_loader.js?v=20260902-2"></script>\n<script src="auth.js?v=20260819-1"></script>',
        '<script src="auth.js?v=20260912-1"></script>\n  <script src="/student_profile_optional.js?v=20260902-1"></script>'
      )
      .replace(
        '<label for="pixKey">Chave PIX</label>',
        '<label for="pixKey">Chave PIX <span style="color:#94a3b8;font-weight:normal">(opcional)</span></label>'
      )
      .replace(
        '<input id="pixKey" type="text" required />',
        '<input id="pixKey" type="text" />'
      )
      .replace(
        "A chave PIX é usada apenas em situações em que o professor precise fazer reembolso de algum valor para o aluno.",
        "Opcional. Informe apenas se quiser deixar uma chave disponível para eventuais reembolsos."
      )
      .replace(
        '<div class="availability-block">',
        '<div id="disponibilidade" class="availability-block">'
      )
      .replace(
        "Marque todos os dias e horários, de segunda a sexta, em que você estará disponível para fazer aulas de inglês.",
        "Informe os dias e horários em que você costuma estar disponível. Você pode alterar essa informação quando quiser."
      );
  }

  const ROUTE_TRANSFORMS = {
    "/perfil/": customizeProfileHtml,
  };

  function routeKey(pathname) {
    let key = pathname || "/";
    if (!key.endsWith("/")) key += "/";
    return key;
  }

  async function load() {
    const key = routeKey(window.location.pathname);
    const source = ROUTES[key];
    if (!source) return;

    try {
      const response = await fetch(source, { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      let html = await response.text();
      const transform = ROUTE_TRANSFORMS[key];
      if (transform) html = transform(html);
      if (/<head[\s>]/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1><base href="/">');
      else html = '<base href="/">' + html;
      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      console.error("Não foi possível recuperar a rota limpa:", error);
    }
  }

  load();
})();

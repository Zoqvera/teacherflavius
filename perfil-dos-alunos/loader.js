(async function () {
  "use strict";

  try {
    const sourceUrl = "/perfil_dos_alunos";
    const response = await fetch(sourceUrl, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("Não foi possível carregar a página de perfis.");

    const html = await response.text();
    const enhancedHtml = html
      .replace("<head>", "<head>\n  <base href=\"/\">")
      .replace("</head>", "<link rel=\"stylesheet\" href=\"/perfil-dos-alunos/perfil_dos_alunos_visual.css?v=20260901-1\">\n</head>")
      .replace('href="professor.html"', 'href="/professor/"')
      .replace('href="index.html"', 'href="/"')
      .replace("supabase_config.js?v=20260429-8", "supabase_config.js?v=20260826-1")
      .replace("</body>", '<script src="/tipo_turma_alunos.js?v=20260807-1"><\/script>\n<script src="/perfil_dos_alunos_vencimento.js?v=20260901-1"><\/script>\n<script src="/perfil-dos-alunos/perfil_dos_alunos_visual.js?v=20260901-1"><\/script>\n</body>');

    document.open();
    document.write(enhancedHtml);
    document.close();
  } catch (error) {
    console.error(error);
    const loading = document.getElementById("profileLoadingMessage");
    if (loading) {
      loading.textContent = "Não foi possível carregar os perfis. Atualize a página.";
    }
  }
})();

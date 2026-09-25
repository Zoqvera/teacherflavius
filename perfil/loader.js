"use strict";

const PROFILE_SOURCE_URL = "/perfil.html";
const PROFILE_FETCH_OPTIONS = { cache: "no-store" };

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

function injectBaseUrl(html) {
  return html.replace("<head>", '<head>\n  <base href="/">');
}

function renderProfile(html) {
  document.open();
  document.write(injectBaseUrl(customizeProfileHtml(html)));
  document.close();
}

function showLoadError(error) {
  console.error("Falha ao carregar o perfil:", error);
  const message = document.getElementById("profileLoadingMessage");
  if (message) {
    message.textContent = "Não foi possível carregar o perfil. Atualize a página e tente novamente.";
  }
}

async function loadProfilePage() {
  try {
    const response = await fetch(PROFILE_SOURCE_URL, PROFILE_FETCH_OPTIONS);
    if (!response.ok) {
      throw new Error(`Falha ao buscar perfil.html: HTTP ${response.status}`);
    }

    const html = await response.text();
    renderProfile(html);
  } catch (error) {
    showLoadError(error);
  }
}

loadProfilePage();

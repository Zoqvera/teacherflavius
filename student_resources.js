(function () {
  "use strict";

  const AUTH_RESOURCE_MAX_ATTEMPTS = 10;
  const AUTH_RESOURCE_RETRY_DELAY_MS = 150;

  const APP_RESOURCES = Object.freeze([
    Object.freeze({
      name: "MEC Idiomas",
      accessLabel: "100% gratuito",
      description: "Plataforma oficial do Ministério da Educação com cursos de inglês do nível básico ao avançado, exercícios e trilhas estruturadas.",
      differential: "Teste de nivelamento, cerca de 800 aulas, certificado por nível e prática de conversação com inteligência artificial.",
      url: "https://mecidiomas.mec.gov.br/"
    }),
    Object.freeze({
      name: "Duolingo",
      accessLabel: "Plano gratuito",
      description: "Lições curtas e gamificadas para desenvolver vocabulário, leitura, escrita, compreensão auditiva e fala.",
      differential: "Excelente para criar constância diária com metas, níveis, sequência de estudos e feedback imediato.",
      url: "https://pt.duolingo.com/"
    }),
    Object.freeze({
      name: "Cake",
      accessLabel: "Plano gratuito",
      description: "Aplicativo focado em inglês usado na vida real, com vídeos curtos, expressões frequentes, escuta e repetição.",
      differential: "Treina frases naturais a partir de conteúdo audiovisual e facilita a prática de pronúncia por imitação.",
      url: "https://cake.day/"
    }),
    Object.freeze({
      name: "Busuu",
      accessLabel: "Plano gratuito",
      description: "Curso organizado por níveis com lições de vocabulário, gramática, compreensão e produção em situações comunicativas.",
      differential: "Combina uma trilha progressiva de estudos com exercícios curtos e foco em uso prático do idioma.",
      url: "https://www.busuu.com/pt"
    }),
    Object.freeze({
      name: "Memrise",
      accessLabel: "Plano gratuito",
      description: "Aplicativo para aprender e revisar inglês com vocabulário, frases úteis, vídeos e exercícios de memorização.",
      differential: "Usa revisão espaçada e vídeos com falantes reais para aproximar o aluno do inglês cotidiano.",
      url: "https://www.memrise.com/en/learn-english"
    }),
    Object.freeze({
      name: "ELSA Speak",
      accessLabel: "Versão gratuita",
      description: "Aplicativo especializado em pronúncia e fala, com exercícios de sons, palavras, frases e situações comunicativas.",
      differential: "Fornece feedback automatizado sobre pronúncia e ajuda o aluno a identificar pontos específicos para melhorar.",
      url: "https://elsaspeak.com/en/download/"
    }),
    Object.freeze({
      name: "LearnEnglish Sounds Right",
      accessLabel: "100% gratuito",
      description: "Aplicativo de pronúncia do British Council para explorar e praticar os sons do inglês de forma visual e organizada.",
      differential: "Apresenta o quadro fonético com exemplos de palavras e áudio, sendo especialmente útil para treinar sons difíceis.",
      url: "https://learnenglish.britishcouncil.org/apps"
    }),
    Object.freeze({
      name: "HelloTalk",
      accessLabel: "Plano gratuito",
      description: "Comunidade de intercâmbio linguístico para praticar inglês por mensagens, áudio e conversas com pessoas de outros países.",
      differential: "Permite usar inglês em interações reais com falantes nativos e outros estudantes, com ferramentas de correção e apoio.",
      url: "https://www.hellotalk.com/pt-br"
    }),
    Object.freeze({
      name: "Tandem",
      accessLabel: "Plano gratuito",
      description: "Aplicativo de intercâmbio de idiomas que conecta estudantes a parceiros para conversar e praticar inglês.",
      differential: "Foco em comunicação real por chat, áudio e vídeo, com possibilidade de receber correções durante a interação.",
      url: "https://tandem.net/pt-br"
    }),
    Object.freeze({
      name: "Beelinguapp",
      accessLabel: "Plano gratuito",
      description: "Aplicativo para estudar inglês por meio de histórias, notícias, música e audiolivros com texto e áudio.",
      differential: "Exibe textos em dois idiomas em paralelo, o que facilita leitura, compreensão auditiva e aquisição de vocabulário em contexto.",
      url: "https://beelinguapp.com/pt/"
    })
  ]);

  const WEBSITE_RESOURCES = Object.freeze([
    Object.freeze({
      name: "British Council LearnEnglish",
      accessLabel: "Gratuito",
      description: "Biblioteca de atividades de listening, reading, writing, speaking, grammar, vocabulary e inglês profissional.",
      differential: "Conteúdo organizado por nível e habilidade, produzido por uma das instituições mais reconhecidas no ensino de inglês.",
      url: "https://learnenglish.britishcouncil.org/free-resources"
    }),
    Object.freeze({
      name: "Cambridge English",
      accessLabel: "Gratuito",
      description: "Atividades online de inglês para diferentes níveis, com exercícios rápidos de gramática, vocabulário e habilidades comunicativas.",
      differential: "Permite filtrar atividades por nível e tempo disponível, incluindo prática de escrita com feedback automatizado.",
      url: "https://www.cambridgeenglish.org/learning-english/"
    }),
    Object.freeze({
      name: "BBC Learning English",
      accessLabel: "Gratuito",
      description: "Aulas, vídeos, áudios, notícias e séries para aprender inglês com linguagem atual e situações reais de comunicação.",
      differential: "Excelente para listening e vocabulário em contexto, com forte exposição a diferentes temas e ao inglês britânico.",
      url: "https://www.bbc.co.uk/learningenglish/"
    }),
    Object.freeze({
      name: "VOA Learning English",
      accessLabel: "Gratuito",
      description: "Notícias, vídeos, áudios e programas preparados para estudantes de inglês em diferentes níveis de proficiência.",
      differential: "Combina notícias reais com linguagem adaptada e áudio claro, favorecendo leitura e compreensão auditiva.",
      url: "https://learningenglish.voanews.com/"
    }),
    Object.freeze({
      name: "Perfect English Grammar",
      accessLabel: "Gratuito",
      description: "Explicações objetivas e muitos exercícios de gramática inglesa para praticar estruturas específicas.",
      differential: "Muito útil para revisar um ponto gramatical isolado e praticá-lo imediatamente com exercícios focados.",
      url: "https://www.perfect-english-grammar.com/"
    }),
    Object.freeze({
      name: "Breaking News English",
      accessLabel: "Gratuito",
      description: "Lições de inglês construídas a partir de notícias atuais, com textos, áudio, vocabulário e exercícios variados.",
      differential: "Cada notícia gera uma sequência extensa de atividades que integra leitura, listening, vocabulário, discussão e escrita.",
      url: "https://breakingnewsenglish.com/"
    }),
    Object.freeze({
      name: "News in Levels",
      accessLabel: "Gratuito",
      description: "Notícias em inglês apresentadas em versões de dificuldade progressiva para leitura, listening e ampliação de vocabulário.",
      differential: "O mesmo tema aparece em níveis diferentes, permitindo aumentar gradualmente a complexidade do texto e do áudio.",
      url: "https://www.newsinlevels.com/"
    }),
    Object.freeze({
      name: "Randall's ESL Cyber Listening Lab",
      accessLabel: "Gratuito",
      description: "Grande coleção de atividades de compreensão auditiva com situações do cotidiano, quizzes e materiais por nível.",
      differential: "Especialização em listening, com trilhas de estudo e atividades do nível básico ao avançado baseadas em comunicação real.",
      url: "https://www.esl-lab.com/"
    }),
    Object.freeze({
      name: "AgendaWeb",
      accessLabel: "Gratuito",
      description: "Portal com centenas de exercícios de gramática, vocabulário, leitura, listening, verbos e outros tópicos de inglês.",
      differential: "Funciona como um grande banco de exercícios rápidos, ideal para reforçar conteúdos específicos de forma autônoma.",
      url: "https://agendaweb.org/"
    }),
    Object.freeze({
      name: "Engoo Materials",
      accessLabel: "Materiais gratuitos",
      description: "Coleção ampla de materiais de estudo por nível e tema, incluindo conversação, gramática, viagens, negócios e notícias diárias.",
      differential: "Oferece milhares de materiais e notícias atualizadas que podem ser usados gratuitamente para leitura e conversation practice.",
      url: "https://engoo.com/app/materials/en"
    })
  ]);

  const PODCAST_RESOURCES = Object.freeze([
    Object.freeze({
      name: "Learning English Conversations",
      accessLabel: "Spotify",
      description: "Podcast da BBC Radio com conversas, expressões cotidianas e episódios voltados ao uso natural do inglês falado.",
      differential: "Episódios curtos e objetivos ajudam a incorporar expressões úteis para situações reais de conversation.",
      url: "https://open.spotify.com/show/33450hhCQdEEqRpd4w1TBe"
    }),
    Object.freeze({
      name: "All Ears English Podcast",
      accessLabel: "Spotify",
      description: "Podcast de inglês americano com foco em listening, fluência, vocabulário e comunicação natural no dia a dia.",
      differential: "Explora expressões atuais e estratégias para falar com mais confiança em situações sociais e profissionais.",
      url: "https://open.spotify.com/show/6qXldSz1Ulq1Nvj2JK5kSR"
    }),
    Object.freeze({
      name: "Luke's ENGLISH Podcast",
      accessLabel: "Spotify",
      description: "Podcast apresentado pelo professor Luke Thompson para estudantes que querem desenvolver compreensão do inglês britânico natural.",
      differential: "Episódios extensos e descontraídos oferecem exposição prolongada a vocabulário, humor, cultura e fala espontânea.",
      url: "https://open.spotify.com/show/2LgQSA21R1KykxsXNWvQmc"
    }),
    Object.freeze({
      name: "Espresso English Podcast",
      accessLabel: "Spotify",
      description: "Lições rápidas sobre vocabulário, gramática, frases, expressões e outros aspectos práticos da língua inglesa.",
      differential: "O formato curto facilita encaixar pequenos momentos de estudo na rotina diária.",
      url: "https://open.spotify.com/show/3apZ4F9LH9oI6DIjiQl6zR"
    }),
    Object.freeze({
      name: "RealLife English",
      accessLabel: "Spotify",
      description: "Podcast voltado à compreensão e ao uso de inglês natural em situações reais, com temas de fluência e comunicação.",
      differential: "Ajuda o aluno a sair do inglês exclusivamente didático e se acostumar com expressões e ritmo de conversas autênticas.",
      url: "https://open.spotify.com/show/0xBw3oEE9tW79gKd9pQHdN"
    }),
    Object.freeze({
      name: "Thinking in English",
      accessLabel: "Spotify",
      description: "Podcast para alunos intermediários e avançados que desenvolve listening e vocabulário por meio de temas culturais, históricos e atuais.",
      differential: "Combina aprendizagem de inglês com conteúdo informativo, favorecendo compreensão de textos orais mais complexos.",
      url: "https://open.spotify.com/show/2OwAg0ckS0mUDPi6HW8FNt"
    }),
    Object.freeze({
      name: "ESL Pod Official",
      accessLabel: "Spotify",
      description: "Podcast de English as a Second Language com episódios baseados em situações comunicativas e compreensão do inglês falado.",
      differential: "A abordagem enfatiza compreender o que se ouve antes de avançar para usos mais complexos do idioma.",
      url: "https://open.spotify.com/show/0J4qOTETN4I9J4SLyopSZw"
    }),
    Object.freeze({
      name: "Let's Master English!",
      accessLabel: "Spotify",
      description: "Podcast para estudantes de inglês com notícias, perguntas e respostas, orientação de estudos e seções variadas.",
      differential: "Mistura prática linguística com conteúdo leve e diferentes formatos, reduzindo a monotonia do estudo de listening.",
      url: "https://open.spotify.com/show/6MrDwfnwcFcZRidfyak9Uu"
    }),
    Object.freeze({
      name: "Simple English News Daily",
      accessLabel: "Spotify",
      description: "Notícias internacionais apresentadas em inglês acessível para estudantes que querem praticar listening com acontecimentos reais.",
      differential: "Permite desenvolver compreensão auditiva e vocabulário enquanto o aluno acompanha temas atuais.",
      url: "https://open.spotify.com/show/4QctJjCUuHefLzeZWDoXqc"
    }),
    Object.freeze({
      name: "Teacher Joseph Podcast",
      accessLabel: "Spotify",
      description: "Podcast para estudantes de inglês com notícias, listening, pronúncia, vocabulário e prática de inglês britânico.",
      differential: "É especialmente útil para shadowing, ritmo, entonação e contato frequente com pronúncia britânica clara.",
      url: "https://open.spotify.com/show/3fO3bkt56OMexK6PnJCJT6"
    })
  ]);

  function sleep(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitForAuthResources() {
    for (let attempt = 0; attempt < AUTH_RESOURCE_MAX_ATTEMPTS; attempt += 1) {
      if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
      await sleep(AUTH_RESOURCE_RETRY_DELAY_MS);
    }
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
  }

  function setStatus(message, state) {
    const status = document.getElementById("loginStatus");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.state = state || "";
    status.hidden = !message;
  }

  function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function createResourceCard(resource, buttonLabel) {
    const article = document.createElement("article");
    article.className = "resource-card";

    const headingRow = document.createElement("div");
    headingRow.className = "resource-card-heading";
    headingRow.appendChild(createTextElement("h3", "resource-name", resource.name));
    headingRow.appendChild(createTextElement("span", "resource-access", resource.accessLabel));

    const description = createTextElement("p", "resource-description", resource.description);

    const differential = document.createElement("p");
    differential.className = "resource-differential";
    differential.appendChild(createTextElement("strong", "", "Diferencial: "));
    differential.appendChild(document.createTextNode(resource.differential));

    const link = document.createElement("a");
    link.className = "resource-link";
    link.href = resource.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = buttonLabel;
    link.setAttribute("aria-label", buttonLabel + ": " + resource.name);

    article.appendChild(headingRow);
    article.appendChild(description);
    article.appendChild(differential);
    article.appendChild(link);

    return article;
  }

  function renderResourceList(containerId, resources, buttonLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const fragment = document.createDocumentFragment();
    resources.forEach(function (resource) {
      fragment.appendChild(createResourceCard(resource, buttonLabel));
    });

    container.replaceChildren(fragment);
  }

  function renderResources() {
    renderResourceList("appsGrid", APP_RESOURCES, "ACESSAR APLICATIVO");
    renderResourceList("sitesGrid", WEBSITE_RESOURCES, "ACESSAR SITE");
    renderResourceList("podcastsGrid", PODCAST_RESOURCES, "OUVIR NO SPOTIFY");
  }

  async function initializePage() {
    const resourcesReady = await waitForAuthResources();
    if (!resourcesReady) {
      document.body.classList.remove("auth-checking");
      setStatus("Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador.", "error");
      return;
    }

    const user = await Auth.requireAuth();
    if (!user) return;

    renderResources();
    document.body.classList.remove("auth-checking");
    setStatus("", "ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePage, { once: true });
  } else {
    initializePage();
  }
})();

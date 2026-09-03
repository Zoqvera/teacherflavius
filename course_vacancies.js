(function () {
  "use strict";

  var ACADEMIC_PROOF = [
    {
      title: "Speech-to-speech translation — USP",
      description: "Artigo publicado em 2017 na revista TradTerm, da Universidade de São Paulo, sobre conceitos e arquitetura de sistemas de tradução automática de fala.",
      link: "https://revistas.usp.br/tradterm/pt_BR/article/view/134416",
      linkLabel: "Ver publicação na USP"
    },
    {
      title: "Pesquisa de mestrado — UFU",
      description: "Dissertação em Estudos Linguísticos sobre aplicativos móveis de interpretação automática e a experiência de usuários brasileiros, disponível no Repositório Institucional da UFU.",
      link: "https://repositorio.ufu.br/handle/123456789/35038",
      linkLabel: "Ver pesquisa na UFU"
    },
    {
      title: "Produção internacional — Diacrítica",
      description: "Coautor de estudo sobre a evolução da pesquisa em machine interpreting, publicado na revista Diacrítica, do Centro de Estudos Humanísticos da Universidade do Minho.",
      link: "https://doaj.org/article/09e6d2630519401db695819da13ef6e2",
      linkLabel: "Ver publicação internacional"
    },
    {
      title: "Tradução automática — IBICT",
      description: "Coautor de estudo cienciométrico sobre desenvolvimentos tecnológicos em tradução automática publicado na revista Ciência da Informação.",
      link: "https://revista.ibict.br/ciinf/article/view/5542",
      linkLabel: "Ver publicação no IBICT"
    }
  ];

  function createExternalLink(url, label, className) {
    var link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    if (className) link.className = className;
    return link;
  }

  function updateAcademicStructuredData() {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
      try {
        var data = JSON.parse(script.textContent || "{}");
        var graph = Array.isArray(data["@graph"]) ? data["@graph"] : [];
        var person = graph.find(function (item) {
          return item && item["@type"] === "Person" && item.name === "Flávio de Sousa Freitas";
        });
        if (!person) return;

        person.description = "Professor de inglês, Doutor e Mestre em Linguística, Bacharel em Tradução, certificado CELTA e pesquisador na interface entre linguagem, tradução e tecnologias de inteligência artificial.";
        person.sameAs = Array.from(new Set((person.sameAs || []).concat([
          "https://www.instagram.com/teacher.flavius",
          "https://orcid.org/0000-0002-8972-5870"
        ])));
        person.knowsAbout = [
          "Língua inglesa",
          "Linguística",
          "Tradução",
          "Speech-to-speech translation",
          "Machine interpreting",
          "Machine translation"
        ];
        script.textContent = JSON.stringify(data);
      } catch (error) {
        // Structured data from another component must not block the funnel.
      }
    });
  }

  function addCredential(list, html) {
    if (!list || list.querySelector('[data-authority-credential="' + html + '"]')) return;
    var item = document.createElement("li");
    item.setAttribute("data-authority-credential", html);
    item.innerHTML = html;
    list.insertBefore(item, list.lastElementChild || null);
  }

  function createAcademicProofCard(item) {
    var card = document.createElement("article");
    card.className = "authority-proof-card";

    var title = document.createElement("h3");
    title.textContent = item.title;

    var description = document.createElement("p");
    description.textContent = item.description;

    var linkParagraph = document.createElement("p");
    linkParagraph.appendChild(createExternalLink(item.link, item.linkLabel, "authority-proof-link"));

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(linkParagraph);
    return card;
  }

  function ensureAcademicAuthoritySection() {
    var teacherTitle = document.getElementById("teacher-title");
    var teacherSection = teacherTitle && teacherTitle.closest("section");
    if (!teacherSection) return;

    var teacherCopy = teacherSection.querySelector(".teacher-copy");
    var intro = teacherCopy && teacherCopy.querySelector("p:not(.eyebrow)");
    if (intro) {
      intro.innerHTML = "Professor de inglês com mais de 15 anos de experiência e formação acadêmica em linguagem. Além da docência, Flávio de Sousa Freitas desenvolve pesquisa na interface entre Linguística, Tradução e inteligência artificial, com produção científica sobre <em>speech-to-speech translation</em>, interpretação automática e tradução automática. O curso combina essa formação acadêmica com uma proposta prática: aulas ao vivo, turmas reduzidas e acompanhamento contínuo.";
    }

    var credentials = teacherCopy && teacherCopy.querySelector(".credentials");
    addCredential(credentials, "Pesquisador de <em>speech-to-speech translation</em> e tecnologias da linguagem");
    addCredential(credentials, "Publicações científicas no Brasil e no exterior");

    if (document.getElementById("academicAuthorityProof")) return;

    var proof = document.createElement("div");
    proof.id = "academicAuthorityProof";
    proof.className = "shell authority-proof";
    proof.setAttribute("aria-labelledby", "research-evidence-title");

    var heading = document.createElement("div");
    heading.className = "section-head";
    heading.innerHTML = [
      '<p class="eyebrow">Pesquisa e publicações</p>',
      '<h2 id="research-evidence-title">Formação acadêmica respaldada por produção científica.</h2>',
      '<p>A trajetória de pesquisa do professor inclui trabalhos publicados por universidades e periódicos acadêmicos sobre linguagem, tradução e tecnologias de inteligência artificial.</p>'
    ].join("");

    var grid = document.createElement("div");
    grid.className = "authority-proof-grid";
    ACADEMIC_PROOF.forEach(function (item) {
      grid.appendChild(createAcademicProofCard(item));
    });

    var book = document.createElement("p");
    book.className = "authority-book";
    book.appendChild(document.createTextNode("Flávio também é coautor do livro "));
    var bookTitle = document.createElement("strong");
    bookTitle.textContent = "Tradução e interpretação automáticas: origens";
    book.appendChild(bookTitle);
    book.appendChild(document.createTextNode(", publicado pela Editora CRV em 2020. "));
    book.appendChild(createExternalLink(
      "https://loja.editoracrv.com.br/produtos/traducao-e-interpretacao-automaticas-origens/?srsltid=AfmBOoo_shGtXTWv5ZvmBk4-_vXBpPXyMGESp6VFMOdRFHMaJ4vTrbQY",
      "Conheça o livro aqui"
    ));
    book.appendChild(document.createTextNode("."));

    proof.appendChild(heading);
    proof.appendChild(grid);
    proof.appendChild(book);
    teacherSection.appendChild(proof);
  }

  function refreshCourseStylesheet() {
    var stylesheet = document.querySelector('link[href^="/course_funnel.css"]');
    if (stylesheet) stylesheet.href = "/course_funnel.css?v=20260902-2";
  }

  updateAcademicStructuredData();
  ensureAcademicAuthoritySection();
  refreshCourseStylesheet();

  var list = document.getElementById("liveVacanciesList");
  var summary = document.getElementById("liveVacanciesSummary");
  if (!list || !summary) return;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function weekdayLabel(value) {
    return ({
      1: "Segunda-feira",
      2: "Terça-feira",
      3: "Quarta-feira",
      4: "Quinta-feira",
      5: "Sexta-feira",
      6: "Sábado",
      7: "Domingo"
    })[Number(value)] || "Dia a confirmar";
  }

  function timeLabel(value) {
    var match = String(value || "").match(/^(\d{2}):(\d{2})/);
    if (!match) return "horário a confirmar";
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    return minute === 0 ? hour + "h" : hour + "h" + String(minute).padStart(2, "0");
  }

  function render(rows) {
    if (!rows.length) {
      summary.textContent = "No momento, não há turmas em grupo dentro dos critérios de exibição com vagas abertas.";
      list.innerHTML = '<div class="vacancy-empty">Novas vagas aparecem aqui automaticamente conforme as turmas são atualizadas.</div>';
      return;
    }

    var totalSpots = rows.reduce(function (sum, row) {
      return sum + Number(row.available_spots || 0);
    }, 0);

    summary.textContent = rows.length + (rows.length === 1 ? " turma com vaga" : " turmas com vagas") + " · " + totalSpots + (totalSpots === 1 ? " vaga disponível" : " vagas disponíveis") + ".";

    list.innerHTML = rows.map(function (row) {
      var spots = Number(row.available_spots || 0);
      return '<article class="vacancy-public-card">' +
        '<div><strong>' + escapeHtml(weekdayLabel(row.class_weekday)) + '</strong><span>' + escapeHtml(timeLabel(row.class_start_time)) + ' · aula de 60 minutos</span></div>' +
        '<div class="vacancy-public-count"><b>' + spots + '</b><span>' + (spots === 1 ? 'vaga' : 'vagas') + '</span></div>' +
      '</article>';
    }).join("");
  }

  async function loadVacancies() {
    var config = window.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey) throw new Error("Configuração indisponível");

    var response = await fetch(config.url + "/rest/v1/rpc/get_public_quartet_vacancies", {
      method: "POST",
      cache: "no-store",
      headers: {
        "apikey": config.anonKey,
        "Authorization": "Bearer " + config.anonKey,
        "Content-Type": "application/json"
      },
      body: "{}"
    });

    if (!response.ok) throw new Error("Não foi possível consultar as vagas");
    return response.json();
  }

  loadVacancies().then(render).catch(function () {
    summary.textContent = "As vagas são atualizadas automaticamente a partir das matrículas registradas no sistema.";
    list.innerHTML = '<div class="vacancy-empty">Não foi possível carregar a disponibilidade agora. Consulte os horários pelo WhatsApp.</div>';
  });
})();

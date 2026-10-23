# Página pública de metodologia e conteúdo programático — Etapa 2

## Implantação

URL prevista: \`/metodologia-e-conteudo-programatico/\`.

Componentes:
- \`index.html\`: metodologia, página pública e catálogo.
- \`style.css\`: layout responsivo alinhado à identidade visual do site.
- \`catalog_service.mjs\`: consulta, validação, pesquisa e agrupamento do catálogo.
- \`app.mjs\`: atualização da interface, carregamento, estados de erro e revalidação periódica.

A página consulta \`public-study-catalog\` diretamente e lê apenas \`number\`, \`title\` e \`objective\`. Nenhum novo cadastro ou espelhamento de conteúdos é necessário: a lição vinculada no Roteiro de Estudos aparece na próxima leitura da API. Enquanto a página está aberta, o catálogo é revalidado a cada dois minutos quando a aba estiver visível e ao retornar à aba após esse intervalo. **Não há garantia de atualização instantânea por push.**

As faixas temáticas são 1–12, 13–27 e 28 em diante. Novas lições numeradas acima de 40 são incluídas automaticamente no último grupo. O terceiro grupo utiliza o maior número real para exibir o intervalo sem limite fixo. Os grupos não são equivalentes a níveis CEFR.

A interface usa exclusivamente \`textContent\` para inserir títulos e objetivos recebidos do banco e não contém links para os textos integrais, traduções ou produções dos alunos. Em erro, mostra um botão de repetição. Se falhar uma atualização após uma consulta anterior bem-sucedida, preserva o conteúdo já carregado.

## Decisão pendente de SEO

Durante a Etapa 2, a página usa \`<meta name="robots" content="noindex, follow">\`, não recebe canonical e **não entra no sitemap**. Também não é linkada pelo menu principal ou pelas páginas comerciais existentes. A página pode ser acessada diretamente por quem souber a URL, mas não se solicita sua indexação.

A Etapa 4 deverá decidir: liberação de indexação, definição de canonical, inclusão no sitemap e inserção de links na navegação. Esses pontos exigem comunicação prévia ao responsável.

## Testes

\`node --test tests/public_curriculum_page.test.mjs tests/site_page_context.test.js\`

\`python3 -m unittest discover -s tests -p 'test_methodology_public_page.py'\`

Workflow: \`.github/workflows/methodology-public-page.yml\`.

## Próxima etapa

Etapa 3: selecionar apresentações públicas e perguntas demonstrativas, criando um mecanismo editorial explícito de seleção antes de disponibilizar materiais integrais.

# Catálogo público de lições — etapa 1

## Fonte de dados

A função pública \`public-study-catalog\` lê \`public.study_lesson_pages\` sob credencial de serviço **apenas no servidor**. A consulta usa explicitamente \`roadmap_lesson_number,title,objective\` e inclui somente lições ligadas a um card do Roteiro de Estudos.

Nenhuma coluna com texto integral, tradução, exercícios, autoria, dados de alunos ou registro de apresentações é selecionada. A resposta pública inclui \`{total, lessons:[{number,title,objective}]}\`.

Cada requisição lê os dados atuais. A resposta usa \`Cache-Control: no-store\`, portanto uma nova lição ou uma alteração na lição aparece na próxima carga da página, sem editar uma lista estática. A paginação suporta até 10 mil lições, com falha explícita se o limite for excedido.

## Segurança

- Publicação somente via método GET e HEAD; OPTIONS atende à política CORS.
- Navegadores podem ler a resposta a partir do domínio oficial e, para testes locais, de localhost.
- A função é pública (\`verify_jwt=false\`) apenas porque os três campos retornados são conteúdo pedagógico destinado à divulgação.
- Chaves secretas nunca são devolvidas no JSON nem incluídas no site.
- Falhas de banco resultam em HTTP 503 sem detalhes sensíveis.
- A URL é: \`https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/public-study-catalog\`.

## Validação

Executar: \`node --test tests/public_study_catalog.test.js\`.

Para confirmar o catálogo, usar uma requisição GET à função e comparar a contagem com as lições vinculadas no banco. **Não inserir uma lição fictícia em produção para testar.**

## Etapas seguintes

- Etapa 2: criar a página visual com seções de metodologia e conteúdo programático alimentado pela função.
- Etapa 3: acrescentar demonstrações escolhidas pelo professor e perguntas selecionadas.
- Etapa 4: integrar na navegação. Decidir indexação, sitemap, canonical e possíveis efeitos de SEO antes de publicar alterações relacionadas.
- Etapa 5: realizar testes integrados da página e da sincronização.

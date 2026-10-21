# Descontinuação do Criar Exercício — 21/10/2026

O botão **Criar Exercício** na Área do Professor e as páginas `/criar-exercicio/` e `/criar_exercicio.html` deixam de oferecer cadastro e exclusão. As URLs continuam válidas e mostram um aviso estático.

A migração de produção `20261021224424_retire_teacher_exercise_creation.sql` revoga `EXECUTE` das RPCs de criação e exclusão para os papéis de cliente, assim como `INSERT`, `UPDATE` e `DELETE` diretos na tabela `teacher_exercises`. Consultas administrativas, tabelas históricas e registros de conclusão permanecem preservados. Os módulos **Criar Lição**, **Exercícios Feitos pelos Alunos** e **Integração Google Forms** não são descontinuados por esta alteração.

O JavaScript de navegação remove também cards antigos identificados por `criar-exercicio` que persistam no HTML em cache.

**SEO:** `robots.txt`, sitemap e textos comerciais permanecem inalterados. A rota limpa conserva `canonical=/criar-exercicio/`, e a rota legada não recebe nova diretiva de indexação. Qualquer redirecionamento ou alteração editorial será objeto de decisão separada.

**Verificação de produção (21/10/2026):** os papéis autenticados não possuem `EXECUTE` nas duas RPCs de escrita nem `INSERT/UPDATE/DELETE` na tabela. A função de consulta e o `SELECT` continuam acessíveis.

Esta medida não revoga links de Google Forms que eventualmente tenham sido compartilhados fora da plataforma.

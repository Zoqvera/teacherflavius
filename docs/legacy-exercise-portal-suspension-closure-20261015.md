# Encerramento da suspensão do Portal de Exercícios antigo

**Data da homologação:** 15/10/2026 (horário de Brasília)  
**Estado operacional:** suspensão concluída e validada no aplicativo PWA pelo responsável pelo sistema.  
**Escopo:** apenas o Portal de Exercícios legado (Google Forms); não abrange o módulo Tarefas para Casa.

## Implementação e rastreabilidade

- [PR #707](https://github.com/Zoqvera/teacherflavius/pull/707): restringe o catálogo antigo no banco; substitui as três páginas de entrada por aviso de suspensão; remove atalhos, avisos de exercícios atrasados e tarefas antigas do painel Minha Semana.
- Migração de produção: `20261015135322_suspend_legacy_student_exercise_portal.sql`. A leitura de `public.teacher_exercises` e a função `public.get_public_teacher_exercises()` ficam restritas ao professor. Os registros e o histórico não foram excluídos.
- [PR #714](https://github.com/Zoqvera/teacherflavius/pull/714): corrige a permanência de um card antigo no PWA da Área do Estudante com atualização versionada do HTML/JavaScript e remoção defensiva de atalhos residuais.
- [Deploy do GitHub Pages](https://github.com/Zoqvera/teacherflavius/actions/runs/38756962975): concluído com sucesso em 15/10/2026.
- Testes de regressão: `tests/legacy_exercise_portal_suspension.test.js` e `tests/minha_semana_roadmap_progress.test.js`, além dos workflows de validação obrigatórios.

## Critérios de aceite observados

1. A leitura do catálogo antigo por uma sessão autenticada sem privilégios de professor retorna zero registros na tabela e na função pública.
2. As URLs `/exercicios-diarios/`, `/exercicios.diarios.html` e `/exercicios_diarios.html` exibem a indisponibilidade e não carregam o catálogo antigo.
3. O dashboard **Minha Semana** não carrega atividades do antigo portal nem as contabiliza no progresso.
4. O atalho antigo e os avisos de atraso não aparecem mais na Área do Estudante.
5. O responsável pelo sistema confirmou em 15/10/2026, após a PR #714, que o card antigo deixou de aparecer no PWA.
6. As demais funcionalidades do aluno, inclusive **Tarefas para Casa**, permanecem fora do escopo dessa suspensão.

## Limitações e decisões em aberto

- Links diretos de Google Forms compartilhados anteriormente podem continuar acessíveis fora da plataforma. A suspensão impede sua oferta pelo site e pelo catálogo autenticado, mas não revoga permissões no serviço externo.
- **SEO:** conteúdo das páginas antigas mudou para um aviso de suspensão, preservando o `canonical`, `robots.txt` e o sitemap. Qualquer alteração de indexação ou redirecionamento requer decisão específica.
- **Decisão de comunicação pública de 15/10/2026:** o responsável determinou manter a página de apresentação do curso mencionando o Portal de Exercícios como recurso disponível, inclusive no card de recursos e na seção de perguntas frequentes. Não remover, substituir, ocultar nem reescrever essas referências sem uma nova decisão explícita. A suspensão operacional para os alunos permanece vigente e não é afetada por essa decisão editorial.
- **SEO da página de divulgação:** nenhum ajuste de texto público, `title`, descrição, `canonical`, diretrizes de indexação, `robots.txt` ou sitemap é autorizado nesta etapa. Eventual modificação futura deve ser apresentada previamente para decisão do responsável.

## Reativação futura

A reativação **não é automática**. Depende de solicitação explícita, revisão das permissões de acesso e da função SQL, restauração dos links e das tarefas planejadas, novos testes automatizados e homologação de site e PWA. Não reabrir acesso aos alunos apenas substituindo o aviso visual: a proteção no banco também deverá ser revisada.

**Conclusão:** suspensão operacional concluída; não há tarefas obrigatórias de implementação pendentes para manter o Portal de Exercícios legado indisponível aos alunos.

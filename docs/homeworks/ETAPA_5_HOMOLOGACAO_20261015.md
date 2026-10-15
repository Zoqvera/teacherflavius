# TAREFAS PARA CASA — ETAPA 5: Homologação Integrada e Liberação Controlada

Auditoria inicial: 15/10/2026. Estado: EM HOMOLOGAÇÃO. O recurso continua bloqueado para alunos.

## Restrições obrigatórias
- Portal de Exercícios anterior permanece ativo, sem substituição.
- Sequência Reading → Writing → Grammar, atividades numeradas.
- Writing deve retornar nota 0–10, comentário, original, corrigido e explicações em português logo após Enviar; nunca incluir “O que estudar agora?”.
- Nenhuma liberação automática. Ativação estudantil depende de autorização expressa do professor.

## Evidências de produção (somente leitura)
- A migração de banco da Etapa 2 tem versão 20261015043416; a da Etapa 4, 20261015052321. A PR #682 conciliou a versão real sem editar a migração histórica.
- A Edge Function homework-student está ACTIVE na versão 1 com verificação de JWT ligada.
- homework_release_control.enabled = false.
- O banco tem zero exercises, exercise_versions, exercise_assignments, exercise_attempts e exercise_feedback.
- As oito tabelas do módulo têm RLS habilitada e o papel anon não recebe leitura.
- As RPCs homework_submit, homework_claim_writing, homework_complete_writing e homework_release_writing_lease não são executáveis por anon/authenticated. Service_role tem execução.
- O controle de lançamento não concede leitura nem escrita a anon/authenticated.

Limitação: metadados, SQL read-only e testes simulados NÃO equivalem à homologação ponta a ponta com usuários e provedor de IA reais. Não foram enviadas respostas, usados dados de alunos, acessadas chaves nem alterado o bloqueio.

## Integração simulada adicionada ao CI
Executar: node --test tests/homework_stage5_integration.test.js.

A suíte executa a Edge Function real em VM isolada, substituindo Supabase, autenticação e API de IA por simuladores. Exercita recusa por origem, método e sessão inválidos; feature flag desligado; perfil arquivado; isolamento e não vazamento de gabaritos; submissão e progresso em Writing; correção simulada; falha e recuperação idempotente; chave de IA ausente. O caso simulado com released=true é exclusivamente local ao teste.

## Critérios ainda pendentes para o aceite integral
- [ ] Construir e homologar a experiência estudantil completa, incluindo Enviar, progresso, recuperação e navegação numerada, sem disponibilizar páginas a alunos antes da autorização.
- [ ] Exercitar aluno A/B fictícios, tentativa e reenvio, atribuição held versus assigned, RLS, concorrência e versões publicadas em banco/Edge isolados, sem cópia de dados de produção.
- [ ] Corrigir Writing com credencial válida, texto fictício e API de IA REAL, comprovando rubrica 40%/30%/30%, correção imediatamente após Enviar, latência, falhas, limites e custo.
- [ ] Implementar e homologar revisão pedagógica manual para respostas abertas divergentes em Reading/Grammar, sem atribuir nota final prematura.
- [ ] Realizar testes práticos em Android/iOS/desktop, navegação por teclado, leitores de tela, foco, responsividade, contraste e conectividade intermitente.
- [ ] Aprovar aviso de privacidade/retenção para textos, orçamento/alertas de IA, observabilidade e procedimento de bloqueio emergencial.
- [ ] Obter aceite editorial do professor e, em momento separado, autorização expressa de lançamento.

## Segurança de lançamento e SEO
Não alterar enabled=false, não promover atribuições held para assigned, não inserir menu ou rotas abertas a estudantes durante esta PR. Um lançamento futuro exige nova avaliação da configuração efetivamente implantada, controles administrativos auditáveis e autorização separada.

Esta PR não muda SEO: preview mantém noindex, nofollow, noarchive; nenhuma mudança de sitemap, robots.txt, canonical ou páginas comerciais. A indexação de quaisquer rotas futuras será submetida previamente ao proprietário.

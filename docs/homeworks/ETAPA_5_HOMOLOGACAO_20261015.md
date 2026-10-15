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
- [ ] Homologar a correção **automática** de Reading e Grammar por comparação normalizada ao gabarito, com alternativas aceitas, notas ponderadas e reenvio idempotente. Não usar revisão manual.
- [ ] Realizar testes práticos em Android/iOS/desktop, navegação por teclado, leitores de tela, foco, responsividade, contraste e conectividade intermitente.
- [ ] Aprovar aviso de privacidade/retenção para textos, orçamento/alertas de IA, observabilidade e procedimento de bloqueio emergencial.
- [ ] Obter aceite editorial do professor e, em momento separado, autorização expressa de lançamento.

## Segurança de lançamento e SEO
Não alterar enabled=false, não promover atribuições held para assigned, não inserir menu ou rotas abertas a estudantes durante esta PR. Um lançamento futuro exige nova avaliação da configuração efetivamente implantada, controles administrativos auditáveis e autorização separada.

Esta PR não muda SEO: preview mantém noindex, nofollow, noarchive; nenhuma mudança de sitemap, robots.txt, canonical ou páginas comerciais. A indexação de quaisquer rotas futuras será submetida previamente ao proprietário.

## Atualização — 15/10/2026: migração da correção de Writing

O professor autorizou a substituição de `gpt-4.1-mini` por `gpt-6-luna`. O avaliador usa a Responses API com JSON Schema estrito e `reasoning.effort=none` para reduzir latência. A lógica de avaliação de A1/A2, o intervalo 0–10, os pesos pedagógicos 40/30/30, `store:false`, chave exclusivamente no servidor, limite de solicitações, idempotência e comportamento fail-safe são preservados. A configuração funcional deve ser verificada com resposta real usando textos fictícios e comparação pedagógica antes do aceite. Nenhum dado de aluno é enviado durante a homologação simulada. A mudança não publica rotas estudantis, não modifica `homework_release_control.enabled=false` nem altera SEO. A ativação permanece sujeita a autorização explícita.

## Registro da migração de revisão
A migração foi aplicada ao Supabase principal com registro de versão atribuído pelo servidor `20261015063815`, alias exato do arquivo `20261015065000_homeworks_stage5_teacher_review.sql`. O checksum SHA-256 normalizado está fixado em `scripts/check_supabase_migration_drift.sh` para prevenir divergência futura. As funções novas não concedem EXECUTE a anon; apenas o professor autenticado com MFA AAL2 passa pela checagem interna. Verificação pós-migração confirmou `homework_release_control.enabled=false`, zero atividades, zero atribuições e zero tentativas.

## Incremento: fila de revisão pedagógica de Reading e Grammar

Foi implementado o fluxo de revisão humana em separado da nota automática:

- RPC `homework_review_queue`: lista somente respostas abertas divergentes, pendentes e vinculadas à versão aprovada e publicada da atividade.
- RPC `homework_review_answer`: exige `is_teacher_admin()`, autenticação e MFA AAL2. Registra nota 0–10 por resposta e justificativa pedagógica; cada avaliação é registrada no histórico `exercise_feedback`.
- A transação trava a tentativa antes da nota e impede avaliações concorrentes ou duplicadas, pontuação de múltipla escolha e acesso por alunos.
- A nota final é calculada pela média ponderada pelos pontos das questões, somente quando nenhuma resposta ainda está pendente.
- Formulário de revisão na rota administrativa existente, condicionado à mesma autorização de professor. O conteúdo dos alunos aparece apenas via RPC protegida, nunca em HTML estático.

**Homologação:** testes de contrato e interface simulada no CI não substituem transações reais em banco isolado. Nenhuma revisão manual real ou resposta de aluno foi criada nesta alteração. A chave global de liberação permanece desligada. Ao revisar o processo, validar matrícula fictícia, transações concorrentes, comportamento com MFA ausente e revisão de 10 questões de Reading.

**SEO:** o ambiente administrativo continua `noindex, nofollow, noarchive`; nenhuma rota de aluno foi aberta, nenhuma página comercial, sitemap, canonical ou robots.txt foi modificada. Esta alteração não afeta SEO externo.

## Correção de orientação — 15/10/2026: Reading e Grammar sem revisão manual

O professor rejeitou expressamente a revisão humana de Reading/Grammar. Portanto, a PR #688 e seu registro histórico de migração são documentados apenas como histórico, não como requisito ativo. A migração incremental `20261015071000_homeworks_auto_grade_reading_grammar.sql` substitui a função de submissão e remove as RPCs `homework_review_queue` e `homework_review_answer`. A página administrativa deixa de carregar seus componentes e os respectivos arquivos de interface são retirados do código ativo.

O fluxo definitivo é: cada resposta do aluno é comparada no servidor com o gabarito da versão aprovada; ignoram-se diferenças de letras maiúsculas/minúsculas e de espaços repetidos; aceitam-se variantes explicitamente definidas no gabarito; cada resposta recebe 10 se corresponder e 0 caso contrário; a nota final de 0 a 10 é uma média ponderada pelos pontos de todas as questões e é registrada imediatamente como `evaluated`. Respostas abertas divergentes recebem 0, sem qualquer revisão humana. O professor pode prever grafias alternativas no próprio gabarito, mas o sistema não atribui equivalência semântica livre.

O Writing permanece independente com avaliação GPT-6 Luna no servidor.

**Liberação:** o bloqueio `homework_release_control.enabled=false` não é alterado, a página de alunos não é aberta, o portal de atividades antigo continua intacto e os testes ponta a ponta ainda são exigidos. **SEO:** mudanças apenas na área administrativa privada, mantendo `noindex, nofollow, noarchive`; nenhum sitemap, canonical ou robots.txt alterado.

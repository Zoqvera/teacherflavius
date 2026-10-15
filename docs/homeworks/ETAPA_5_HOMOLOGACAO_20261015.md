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

## Evidência de implantação da correção exclusivamente automática

A migração foi aplicada ao Supabase com a versão registrada pelo servidor `20261015065527` para o arquivo versionado `20261015071000_homeworks_auto_grade_reading_grammar.sql`. O checksum SHA-256 da declaração implantada é `4d47c634ced700ae8d0e53e8c84e0cdeca83bf6bec079819eec2a68c3b9c2cbb`; ambos estão reconciliados em `scripts/check_supabase_migration_drift.sh`, sem editar histórico já aplicado.

Após a implantação, a RPC `homework_submit` contém pontuação 10/0 e não contém pendência de avaliação manual. As funções `homework_review_queue` e `homework_review_answer` não existem mais. `anon` e `authenticated` não possuem EXECUTE na RPC de envio; o servidor continua usando `service_role`. O bloqueio `homework_release_control.enabled=false` foi confirmado com zero atividades e tentativas.

Permanece pendente o teste com contas fictícias e atribuições em ambiente isolado; esta alteração substitui o mecanismo de pontuação, mas **não conclui** a homologação integrada da ETAPA 5 nem libera alunos.

## Incremento de homologação — recuperação de Writing após interrupção

Para cumprir o requisito de correção imediata com tolerância a falhas, a Edge Function passa a admitir `retry_correction`. A operação valida novamente o JWT, perfil matriculado ativo, bloqueio global, propriedade da atribuição e tipo Writing. A consulta de `exercise_attempts` restringe `assignment_id` e `student_id`. Somente tentativas já enviadas podem solicitar nova correção. O texto não é reenviado pelo navegador: o RPC existente `homework_claim_writing` lê a produção original salva no banco e utiliza lease de avaliação para evitar duplicação.

O retorno `evaluated` é idempotente e recupera o feedback armazenado, sem nova chamada à IA. Se o provedor falhar ou a chave estiver ausente, o serviço não inventa pontuação. Testes com API/Supabase simulados exercitam bloqueio global, acesso cruzado entre alunos, atribuição inexistente, Reading impedido de solicitar correção IA, idempotência e falha/recuperação. A interface inclui `Tentar corrigir novamente` apenas para Writing com estado `submitted`, inclusive depois de recarregar a atividade.

As notas já devolvidas pelo backend no momento do envio permanecem visíveis mesmo quando a consulta de progresso falha logo em seguida. Reading e Grammar continuam recebendo somente correção automática por gabarito, sem revisão humana.

**Limitações do aceite:** os testes automatizados não comprovam conectividade real com o provedor OpenAI nem uso de credencial válida. Permanecem pendentes os testes isolados de banco/Edge com alunos fictícios e a validação pedagógica de Writing com chamadas reais. A chave `homework_release_control.enabled=false` segue inalterada. Não foram criadas novas rotas nem alterados sitemap, robots, canonicals ou indexação.

## Homologação adicional: transações reais em PostgreSQL isolado

A suíte `tests/sql/homeworks_stage5_postgres_e2e.sql` utiliza o banco descartável do GitHub Actions (`validate-supabase-baseline.yml`), aplica explicitamente as migrações existentes de Homeworks e executa a função **real** `public.homework_submit` com dois estudantes fictícios e atividades Reading/Grammar. Não existe uso de dados de produção, chave OpenAI ou envio de mensagens.

Critérios automatizados: liberação inicialmente `false`; bloqueio com atribuição `held`; isolamento entre estudantes; respostas incompletas com rollback; normalização de maiúsculas/minúsculas e espaços; pontuação por questão e ponderação da nota; submissão oficial idempotente; impedimento de reenvio com outra chave; ausência de revisão manual; RLS do papel `authenticated` para tentativas, feedback e gabaritos; ausência de permissão direta de executar a RPC; verificação pós-teste de base vazia e bloqueada. O teste é totalmente revertido via `ROLLBACK` no banco efêmero.

O check de restauração histórica existente permanece intacto: essa homologação adicional acontece **depois** da comparação do fingerprint de recuperação e antes da destruição da pilha temporária, sem modificar o banco produtivo.

Conclusão: testes SQL reais são evidência necessária, mas não substituem testes E2E completos com Edge autenticada e sessões reais isoladas, correção Writing com provedor OpenAI real, validação manual de dispositivos e aceite editorial do professor. A ETAPA 5 não deve ser encerrada somente com esses checks.

## Complemento: protocolo transacional de Writing no PostgreSQL isolado

A homologação SQL da Etapa 5 passa a incluir a atividade **2 — Writing** (entre Reading e Grammar). O próprio PostgreSQL recebe o texto fictício e verifica todas as RPCs reais sem chamada a provedores externos:

- `homework_submit` persiste texto original, deixa a tentativa `submitted` sem inventar nota e rejeita submissão oficial duplicada;
- `homework_claim_writing` valida atribuição, versão, tipo, propriedade, bloqueio global e devolve um token de avaliação; segunda reivindicação dentro da janela de lease recebe `processing`;
- `homework_complete_writing` rejeita token forjado, grava o retorno fictício da IA uma única vez com nota 8/10 e preserva o texto original e o corrigido;
- `homework_release_writing_lease` volta a `submitted` diante de falha, e a reivindicação seguinte emite um token diferente;
- tentativa de completar novamente com token consumido falha; reenvio com a mesma chave recupera a nota oficial, e outro identificador não duplica a tentativa;
- as duas tentativas do aluno fictício A (Reading e Writing) são visíveis apenas para A; o aluno B vê exclusivamente Grammar, com políticas RLS reais;
- todos os registros, usuários, atribuições e alterações temporárias do controle de lançamento são descartados por `ROLLBACK` no banco do CI.

Esse incremento testa o armazenamento, o controle transacional e a passagem de feedback de Writing, **não** a qualidade de respostas reais do GPT-6 Luna. As chamadas à API da OpenAI, a avaliação de latência e custos, o fluxo completo via Edge autenticada e os testes práticos de dispositivos permanecem critérios pendentes. A ETAPA 5 continua aberta e a liberação de alunos continua expressamente proibida.

## Complemento: rubrica de Writing verificável pelo servidor

Na integração anterior, a instrução do modelo indicava pesos pedagógicos de 40/30/30, mas a nota total era fornecida diretamente pela IA. Para permitir auditoria matemática, a resposta estruturada passa a exigir **três subnotas independentes** (0–10): cumprimento do enunciado, precisão linguística e clareza/vocabulário. A nota oficial não vem da resposta da IA: é calculada pela Edge Function `0.4 × cumprimento + 0.3 × precisão + 0.3 × clareza`, com arredondamento a duas casas decimais.

A interface já exibe `explanations` da avaliação, então o servidor acrescenta as três subnotas e seus respectivos pesos no próprio feedback; o restante das explicações continua em português. O limite anterior de 12 explicações é preservado: o modelo pode fornecer até nove, além das três entradas de rubrica geradas no servidor.

A saída passa por JSON Schema estrito, incluindo subnotas numéricas limitadas ao intervalo 0–10. Respostas incompletas, fora da faixa ou fora do formato não geram nota: a tentativa Writing continua recuperável para nova correção. O contrato foi conferido na documentação de Structured Outputs da OpenAI; um teste com provedor e credenciais reais ainda é **obrigatório** antes de concluir a etapa.

Os pesos acordados não mudaram. Esta alteração não libera alunos, não modifica o SQL, não atinge dados preexistentes nem altera SEO. A ETAPA 5 continua em homologação.

## Complemento: chamadas HTTP reais à Edge Function no Supabase descartável

A validação SQL isolada é ampliada com `tests/homeworks_stage5_http_integration.cjs` e a fixture `tests/sql/homeworks_stage5_http_fixture.sql`. O GitHub Actions sobe a Edge Function **real** `homework-student` no Supabase local e cria dois usuários sintéticos via Supabase Auth com sessões JWT reais. Não reutiliza o projeto, as chaves ou os alunos de produção.

A suíte valida: bloqueio global antes de qualquer liberação; sessão inválida e origem estrangeira; lista individualizada A/B; atividade Reading sem gabarito nem conteúdo secreto; recusa de acesso cruzado; submissão automática e nota 9/10 em Reading; idempotência e progresso salvo; Grammar com nota imediata 10/10; persistência de Writing sem nota quando não há chave OpenAI local; recuperação de Writing com `retry_correction` sem reenviar texto; desativação da liberação e nova negativa da Edge Function.

A chave da OpenAI local fica explicitamente vazia no CI. O teste não realiza chamada à API nem valida a chave secreta do Supabase de produção. A liberação transitória ocorre somente no banco efêmero do CI, é revertida ao final do teste HTTP e toda a instância é destruída pelo job. A ETAPA 5 continua pendente de avaliação com credencial real, testes pedagógicos, dispositivos e aceite final.

## Isolamento de teste real de provedor — bloqueio de migrações e alternativa sem branch remota

Em 15/10/2026, após autorização do custo de US$ 0,01344/h, foi criada a branch Supabase `homeworks-stage5-isolated-20261015` (`ndbihnyeitnkebvkcnsi`), com dados de produção desabilitados. A aplicação do histórico de migrações falhou imediatamente: a primeira tentativa de criar `site_content_updated_by_idx` referenciou `public.site_content`, ainda inexistente. A branch foi removida no mesmo atendimento e sua exclusão confirmada pela listagem do Supabase; **a migração produtiva não foi reparada nem modificada**.

Como alternativa, `.github/workflows/homeworks-writing-provider-smoke.yml` executa normalmente apenas testes de contrato com provedor simulado durante PRs e oferece `workflow_dispatch` manual para **uma única chamada** à OpenAI Responses API em runner efêmero, sem Supabase remoto e sem dados dos estudantes.

O script `scripts/homework_stage5_provider_smoke.mjs` usa duas frases sintéticas (enunciado e exemplo com erros simples), `model=gpt-6-luna`, `reasoning.effort=none`, `store=false`, saída JSON Schema estrita de três subnotas, `max_output_tokens=1400`, timeout de 45 s e calcula a nota oficial com pesos 40/30/30. O teste rejeita grades ou feedback fora de faixa; os logs não contêm textos, respostas brutas ou chaves, apenas sucesso/falha, critérios numéricos, nota e latência. A execução só acontece quando o professor adiciona manualmente o segredo `OPENAI_API_KEY` em **GitHub → Settings → Secrets and variables → Actions** e dispara o workflow. A chave já configurada na produção Supabase não é copiada, lida ou compartilhada.

**Limites:** teste real de provedor ainda pendente até configuração do segredo no GitHub e disparo manual. A credencial de produção Supabase não pode ser inspecionada por essas ferramentas, e este teste não homologa o armazenamento transacional nem a chamada real via Edge na produção. A ETAPA 5 só encerra após validação pedagógica, privacidade e dispositivos. Nenhum acesso estudantil foi habilitado. Nenhuma alteração de SEO.

## Evidência de execução real da OpenAI — 15/10/2026

**Critério de conectividade e contrato com provedor: APROVADO.**

O workflow manual **Homeworks Writing provider smoke**, execução [#38739059955](https://github.com/Zoqvera/teacherflavius/actions/runs/38739059955), foi disparado em 15/10/2026 às 13:00 UTC, no commit `36fd1aad0ade405806853f38bddbe59115b911d4` (`main`). Ambos os jobs concluíram com sucesso, incluindo **One synthetic OpenAI request (manual only)**. A verificação `OPENAI_API_KEY` confirmou a presença do segredo no GitHub Actions; seu valor não foi exposto.

O resultado observado no log da chamada **real** à API Responses foi:

```json
{
  "result": "PASS",
  "model": "gpt-6-luna",
  "score": 7.7,
  "criteria": {
    "task_completion": 8,
    "linguistic_accuracy": 6,
    "clarity_vocabulary": 9
  },
  "duration_ms": 4439,
  "response_storage_opt_out": true,
  "synthetic_only": true
}
```

A nota foi calculada pelo código de teste, independentemente do modelo: `8 × 0.4 + 6 × 0.3 + 9 × 0.3 = 7.70`. O retorno estruturado passou pela validação dos três critérios, comentário, texto corrigido e explicações. `response_storage_opt_out` registra `store:false` na solicitação, **não** garantia de retenção zero. Nenhum texto real de aluno foi enviado.

A confirmação de conectividade com o provedor **não equivale à homologação do fluxo de Writing completo na Edge Function de produção**, pois o smoke não criou tentativas no Supabase. A implantação `homework-student` segue na versão 5, `verify_jwt=true`. Verificação de produção após o teste: `homework_release_control.enabled=false`, zero exercícios, atribuições, tentativas e feedbacks. O módulo permanece fechado, com o portal antigo preservado.

### Critérios restantes para encerrar a ETAPA 5

- **Integração produtiva segura**: confirmar que a função Edge consegue usar o segredo próprio do Supabase e salvar uma avaliação real, sem habilitar acesso dos estudantes; obter ambiente isolado com bootstrap íntegro ou outro ensaio de integração igualmente isolado e seguro.
- **Aceite pedagógico**: professor avaliar clareza do feedback, fidelidade das correções, adequação A1/A2 e justificativa das notas com exemplos de respostas fictícias; não permitir publicação antes desse aceite.
- **Experiência em dispositivos**: homologar manualmente a interface de Reading, Writing e Grammar em telefone Android e desktop, inclusive envio, retomada, estado de progresso e acessibilidade.
- **Privacidade e operação**: confirmar a política de dados e limites de uso/custo antes da ativação.

**Status global: ETAPA 5 EM ANDAMENTO.** Não abrir a liberação aos alunos até aprovação expressa. Nenhuma mudança nesta atualização afeta SEO, esquema SQL, conteúdo pedagógico publicado, credenciais ou fluxo de produção.

**Próxima etapa planejada, ainda não iniciada: ETAPA 6 — Operação Assistida, Monitoramento e Evolução Pedagógica.**

## Preparação da homologação integrada real — HTTP Edge + OpenAI + PostgreSQL isolados

Após o smoke real de provedor, foi preparado um teste end-to-end da correção Writing no próprio workflow `Validate Supabase baseline restore`, reutilizando a pilha Supabase **local descartável** que já tinha sido aprovada com JWTs autênticos e dados exclusivamente sintéticos.

O workflow agora admite acionamento **manual** com o campo `live_writing=true`. A execução normal de PRs e o valor padrão `false` não acionam a OpenAI, nem recebem o segredo. No modo manual, o GitHub Actions fornece `OPENAI_API_KEY` somente ao passo de homologação, grava uma cópia efêmera de permissões restritas para `supabase functions serve --env-file` e apaga o arquivo ao terminar. O Supabase produtivo não recebe operações; nenhuma branch paga será criada. O gateway do Supabase local inicia com `--no-verify-jwt`, mas a própria Edge Function valida o token real do usuário por `auth.getUser`; na produção continua `verify_jwt=true`.

A preparação extrai **somente** o RPC `consume_api_rate_limit` e sua tabela da migração de segurança já aprovada, para garantir que o teste local percorra também o limite de uso implementado. Os alunos, atribuições, gabaritos e textos são fictícios e permanecem apenas no banco do CI.

No modo `live_writing=true`, o ensaio realiza uma única submissão Writing através da Edge Function HTTP, usa a credencial de GitHub Actions com um texto sintético e verifica:
- resposta `evaluated`, com nota dentro de 0 a 10, feedback `ai`, texto original intacto e texto corrigido não vazio;
- decomposição dos critérios de 40/30/30 e igualdade entre a nota armazenada e a média ponderada calculada independentemente no teste;
- um único registro em `exercise_feedback` com `evaluator_model='gpt-6-luna'`;
- uma única concessão de correção, contabilizada nos buckets de rate limit horário e diário;
- retorno idempotente em `retry_correction` sem enviar outro texto à OpenAI, com `progress` refletindo a nota persistida;
- Reading e Grammar continuam corrigidos automaticamente por gabarito, e bloqueios JWT, RLS, origem, atribuição e feature flag continuam intactos.

A execução **não** será automática; requer selecionar `Run workflow` em `Validate Supabase baseline restore`, branch `main`, `live_writing=true`. Isso provoca exatamente uma solicitação faturável à OpenAI em caso de sucesso. A aprovação desses testes ainda precisa ser observada em uma execução manual antes de atestar o E2E real. O sucesso isolado não substitui a revisão pedagógica humana e de privacidade, tampouco a verificação visual Android/desktop.

Nenhuma página, indexação, `robots`, sitemap ou SEO será alterado. O portal atual e o bloqueio global dos estudantes permanecem.

## Aceite técnico integrado de Writing — execução real no CI, 15/10/2026

**Resultado: APROVADO, sem liberação de alunos.** O professor acionou manualmente o workflow [Validate Supabase baseline restore — execução #38744294482](https://github.com/Zoqvera/teacherflavius/actions/runs/38744294482) com `live_writing=true`, branch `main`, commit `1ee1778533f5f8e6d4c0a793613c0669bc2c4140`. O job `restore-test` concluiu com sucesso, incluindo `Exercise Homeworks through actual local Supabase Auth and Edge HTTP`. O log confirma explicitamente `HOMEWORKS_LIVE_WRITING: true` e o resultado `Live Writing stored/recovered with canonical 40/30/30 score; idempotency and block restoration`.

A evidência deste teste usa **JWTs reais do Supabase Auth local**, submissão HTTP à função `homework-student` real, a API Responses real do `gpt-6-luna` e armazenamento/consulta das RPCs reais em PostgreSQL descartável. Valida:
- texto Writing fictício persistido e retorno `evaluated` com `exercise_feedback.source='ai'`;
- texto original preservado, correção textual não vazia, comentário e explicações presentes, subnotas extraídas das explicações e nota final armazenada igual ao cálculo independente 40/30/30;
- exatamente um feedback do modelo `gpt-6-luna` persistido, com contador de limite de uma avaliação (buckets horário e diário);
- `retry_correction` idempotente após avaliação concluída, recuperando o resultado anterior, sem requisitar segunda correção;
- status de progresso, Reading/Grammar corrigidos por gabarito, JWT, isolamento entre alunos, origem permitida, gabaritos ocultos e desligamento da chave global ao final;
- encerramento e remoção da pilha Supabase local no workflow.

A aprovação do E2E permite encerrar o **critério técnico de integração de Writing**, mas **não** comprova que a Edge Function produtiva possua um segredo OpenAI utilizável, uma vez que o teste usa o segredo do GitHub Actions e banco local. A produção não foi invocada para gerar correções e não recebeu dados fictícios.

Após a execução, uma consulta somente leitura confirmou `homework_release_control.enabled=false`, zero atividades, atribuições, tentativas e feedbacks, com a Edge Function ativa (versão 5) e `verify_jwt=true`. Não existem branches Supabase pagas abertas.

### Aceites remanescentes da ETAPA 5

- **Pedagógico:** analisar exemplos de feedback e pontuação de Writing para A1/A2, verificando fidelidade sem introdução de conteúdo inventado, clareza, proporcionalidade da nota e coerência dos três critérios. A execução automática não substitui o aceite do professor.
- **Privacidade e custos:** aprovar as informações sobre envio de textos dos alunos ao provedor, tratamento/retensão de dados, limites de requisições e eventual cobrança por correção; `store=false` não representa garantia de retenção zero.
- **Interface:** validar em Android e desktop as páginas Reading/Writing/Grammar, os estados antes/depois do envio, a apresentação do feedback, a recuperação após recarregar e os recursos de acessibilidade.
- **Configuração de produção:** confirmar a presença/validade do segredo `OPENAI_API_KEY` na Edge Function de produção por meio de procedimento que não abra o recurso nem envie dados reais; o E2E local usa o segredo GitHub Actions e não verifica o do Supabase.

A liberação dos alunos, a substituição do portal antigo e a transição à **ETAPA 6 — Operação Assistida, Monitoramento e Evolução Pedagógica** continuam condicionadas à autorização expressa do professor. Não houve mudança de SEO.

## ETAPA 5 — Paridade pedagógica e transparência antes da submissão

A revisão encontrou uma divergência de resultados entre a simulação do professor e o sistema oficial de correção de Reading/Grammar:

- O simulador anterior removia acentos e pontuação, aceitando respostas que o PostgreSQL considerava diferentes.
- A nota simulada tratava todas as perguntas com o mesmo peso, mas a RPC `public.homework_submit` calcula nota ponderada por `exercise_questions.points`.
- Respostas incompletas ou questões com gabarito/pontuação inválidos podiam gerar uma nota simulada mesmo quando o backend recusaria a submissão.

A prévia foi alinhada à regra oficial: normalização de caixa e espaços repetidos; pontuação e acentuação preservadas. Respostas alternativas continuam permitidas **somente** quando constam explicitamente do gabarito `accepted`. A pontuação é ponderada pelos pesos aprovados e arredondada a duas casas. Se faltar resposta, alternativa válida, gabarito ou peso, a prévia não inventa nota; a inspeção editorial sinaliza pesos inválidos.

Esta mudança **não** altera as regras oficiais da correção em PostgreSQL, o gabarito publicado, a ausência de revisão manual nem as pontuações dos alunos. Ajusta apenas a simulação pedagógica para refletir o resultado que o aluno receberá.

Também foi incluída no formulário de Writing uma informação clara, antes do botão de envio: o texto será enviado à OpenAI para correção automática, com orientação para não informar nomes completos, telefones, endereços ou outros dados pessoais. Trata-se de informação de transparência, **não** de uma declaração de consentimento ou aprovação da política de privacidade. As decisões sobre fundamento legal, prazos de retenção, comunicação e custo devem ser tomadas pelo responsável antes da liberação pública.

Os testes abrangem pesos desiguais, caracteres acentuados, pontuação, campos vazios, opções não cadastradas, gabaritos e pesos inválidos e presença do aviso apenas no Writing. Acesso dos alunos permanece bloqueado. Nenhuma alteração em `robots`, `sitemap`, `canonical` ou indexação; a prévia do professor continua protegida por `noindex, nofollow, noarchive`.

**Estado:** ETAPA 5 em curso; critérios de aceite pedagógico, dispositivos e privacidade ainda pendentes. **Próxima:** ETAPA 6 — Operação Assistida, Monitoramento e Evolução Pedagógica, somente após autorização expressa.

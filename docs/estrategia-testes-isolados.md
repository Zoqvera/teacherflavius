# Estratégia de testes isolados — TeacherFlavius

## Objetivo e ambientes

Evitar que mudanças arriscadas no Supabase afetem matrículas, dados dos alunos,
mensalidades, créditos, autenticação, notificações ou permissões em produção.

| Ambiente | Finalidade | Dados | Cobranças |
| --- | --- | --- | --- |
| Produção — `wnigzpvgsbpjdxvjzugt` | Atender alunos e professor | Reais | Permitidas |
| CI do GitHub — Supabase local descartável | Contratos SQL, reconstrução do banco, segurança e regressões | Vazios/fictícios | Proibidas |
| Preview Supabase — branch efêmera | Fluxos completos de mudanças relevantes | Apenas sintéticos | Proibidas |
| Testes unitários | Comportamento isolado de JS, Python e Edge Functions | Mocks | Proibidas |

Não existe projeto permanente de staging. As branches remotas são criadas **sob
demanda** e apagadas após validação e merge ou cancelamento da PR.

## Política para cada pull request

A Action `Isolated testing policy` examina os caminhos alterados. Ela
**bloqueia o check da PR** quando arquivos sensíveis não incluem a evidência
padronizada de teste numa branch temporária.

- **Preview obrigatória:** migrações e baseline SQL; Auth/RLS; Edge Functions;
  rotas de login e recuperação; código de matrículas, mensalidades, pagamentos,
  créditos, reposições e vínculos de turma.
- **CI normal:** conteúdo institucional, CSS, documentação, testes sem mudança
  de regra de negócio e mudanças visuais sem dependências críticas.
- **Impacto SEO:** alterações em sitemap, robots, canonical, metadata,
  schema.org e HTML indexável exigem análise e decisão expressa do professor.
  A classificação de branch **não substitui** a revisão de SEO.

O script `scripts/check_isolated_testing_policy.py` implementa a classificação.
O gate confere **o formato da evidência**, não o estado real do servidor; quem
faz o merge deve consultar o Supabase e os registros de execução para confirmar
que o teste realmente passou. Um campo preenchido na PR não prova segurança.

## Fluxo para alterações relevantes

1. Criar branch de código no GitHub e abrir PR com alterações pequenas, testes
   e migrações versionadas. Não aplicar o SQL diretamente em produção antes de
   validar o ambiente isolado.
2. Executar contratos unitários, testes de segurança e reconstrução SQL
   descartável no GitHub. Corrigir toda falha antes de abrir a preview remota.
3. Verificar se já existe branch temporária para a mesma PR. Criar **uma**
   branch Supabase não persistente, de nome `pr-NUMERO-assunto`, somente após
   verificar o custo. Cada branch recebe novo `project_ref`, credenciais e
   banco próprios. Nunca habilitar a opção de copiar dados de produção.
4. Confirmar no Supabase que a branch **não é** a `main`; comparar a estrutura
   com a necessária ao recurso e conferir o estado das migrações. Sem schema
   íntegro, o teste fica reprovado e não é válido seguir ao merge.
5. **Antes de criar contas fictícias**, verificar `cron.job`, Edge Functions
   implantadas, Secrets/Vault e endpoints externos. Desativar quaisquer jobs
   ou integrações capazes de emitir mensagens reais, acessar provedores
   produtivos ou registrar transações. Usar mocks/ambientes sandbox e segredos
   próprios da preview; nunca compartilhar credenciais reais.
6. Criar somente dados sintéticos: professor de teste, dois alunos fictícios
   distintos, uma turma quinteto, uma individual, mensalidades sem pagamentos
   reais e créditos de reposição de teste. Não copiar auth.users, e-mails,
   CPF, WhatsApp, Pix ou cobranças da produção, mesmo para depuração.
7. Testar cenários pertinentes e casos negativos: login e recuperação por
   e-mail de teste; RLS entre alunos; professor autorizado; matrícula/
   arquivamento/vagas; cobrança e estorno **simulados**; reflexo em créditos;
   impedimento de cobrança duplicada; cancelamento e reposição; alertas sem
   disparo de mensagens externas. Registrar evidência do resultado.
8. Verificar desvios de esquema, segurança, privilégios e logs na branch.
   Confirmar que o `project_ref` de todos os testes é da preview, nunca de
   produção. Registrar o link do GitHub Actions e o endereço do dashboard
   dessa preview na descrição da PR.
9. Fazer merge **do código pelo fluxo habitual de GitHub** após os checks e a
   verificação efetiva da preview. Não executar também um merge separado de
   Supabase se isso duplicar a aplicação das migrações.
10. Excluir a branch Supabase ao concluir ou cancelar a PR, confirmar sua
    ausência na lista de branches e revisar o consumo na organização.

### Registro de evidência exigido na PR

Copiar para a descrição da pull request e preencher **depois** do teste real:

```text
Preview project ref: <20 caracteres da branch; nunca o ref de produção>
Preview dashboard: https://supabase.com/dashboard/project/<ref-da-branch>
Test evidence: https://github.com/Zoqvera/teacherflavius/actions/runs/<id>
Preview result: PASS
Test data: SYNTHETIC
External integrations: MOCKED
```

Nunca colocar tokens, chaves privadas, connection strings, CPF, e-mail real ou
dados de pagamento nesses campos. A conta administrativa fictícia e o segredo
dos testes ficam apenas nos secrets do ambiente de preview, fora do Git.

## Regras de isolamento verificáveis

- **Não copiar dados:** usar branch sem dados e seeds fictícios. Branch
  `with_data` / `Include data` fica proibida para essa rotina.
- **Não integrar produção:** funções capazes de usar Mercado Pago, Resend,
  Google Forms/Sheets, Analytics, Web Push ou cron externo ficam desabilitadas,
  mockadas ou apontadas para ambiente sandbox antes de testar.
- **Credenciais restritas:** nenhuma chave `service_role` ou segredo de preview
  no frontend público, logs abertos ou artefatos do GitHub.
- **Restrições ao banco:** migrações devem ser reaplicáveis em ambiente limpo,
  preservar histórico financeiro e não ampliar políticas RLS indevidamente.
- **Prova negativa:** aluno de teste A não acessa aluno B; login sem autorização
  não acessa funções administrativas; operações duplicadas não geram créditos
  nem cobranças adicionais.
- **Preservar auditabilidade:** logs sintéticos de teste podem ser descartados
  com a branch. Nunca apagar logs financeiros reais de produção.

## Atenção especial ao histórico de migrações deste projeto

O TeacherFlavius possui migrations históricas que, isoladamente, **não
reconstroem toda a estrutura de um banco vazio**. Já existe um baseline
reconstrutivo em `supabase/baseline/`, validado no GitHub.

Por isso, **não habilitar ainda a integração GitHub com criação automática de
uma branch Supabase para cada PR**: a integração pode tentar executar somente
as migrations de `supabase/migrations/` num banco vazio e falhar por objetos
ausentes. Primeiro validar a criação e integridade de uma preview via dashboard
e resolver qualquer incompatibilidade do esquema/ledger. A branch do dashboard
também exige inspeção do esquema, pois pode utilizar as migrations disponíveis
na produção.

Até essa validação, o CI de reconstrução local é obrigatório para cada mudança
relevante, mas **não substitui** os testes de Auth, APIs e integrações reais
numa preview funcional. Se a preview não conseguir ser criada corretamente,
a PR fica pendente — não tratá-la como aprovada.

## Limites operacionais e gastos

- Manter no máximo **uma** preview remota ativa por vez; reusar somente se
  estiver vinculada à mesma PR e sem esquema desatualizado.
- Planejar a janela de testes para apagar a branch no mesmo dia. Meta interna
  de vida útil: até **24 horas** (não é cancelamento automático).
- A cobrança de Branching Compute começa na criação e **não está coberta
  pelo Spend Cap**. Micro parte de US$ 0,01344/hora, além de eventual tráfego,
  disco e outros recursos. Os créditos de compute do plano Pro não abatem
  Branching Compute.
- Conferir o preço e exigir confirmação de custo **antes** de criar uma branch.
  Não habilitar branches persistentes, cópia de dados ou add-ons por padrão.
- Se o PR fechar sem merge, excluir a preview igualmente. A exclusão deve ser
  verificada; não basta apenas solicitar ao provedor.

## Responsabilidades

- **GitHub Actions**: testes unitários, reconstrução descartável do banco,
  política de evidência e regressões; todos executados antes do merge.
- **Supabase Preview**: ensaios funcionais com dados sintéticos e configuração
  de terceiros simulada, somente para alterações relevantes.
- **Executor do merge**: verificar a branch, os logs e os resultados reais
  (o gate de texto é insuficiente isoladamente), fazer merge do GitHub apenas
  com resultado aprovado e confirmar a limpeza da preview.
- **Professor**: decide alterações de SEO, políticas comerciais e qualquer
  custo adicional que ultrapasse o plano atualmente contratado.

Referências:
- https://supabase.com/docs/guides/deployment/branching
- https://supabase.com/docs/guides/deployment/branching/github-integration
- https://supabase.com/docs/guides/platform/manage-your-usage/branching

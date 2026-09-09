# Segurança do Supabase

## Fase 1 — permissões de funções

O arquivo `supabase_seguranca_fase1.sql` fecha duas classes de alertas do
Security Advisor sem alterar tabelas nem dados:

- remove de `anon` a execução das funções do schema `public`;
- concede a `authenticated` somente as RPCs usadas pelo site;
- mantém `service_role` disponível para Edge Functions e rotinas confiáveis;
- define um `search_path` seguro nas seis funções de trigger sinalizadas;
- altera os privilégios padrão para que funções novas não nasçam públicas;
- valida os invariantes antes do `commit`.

O script não altera RLS, usuários, matrículas, turmas, lições, exercícios,
reposições ou mensalidades.

## Como aplicar

1. Faça o merge da PR que contém estes arquivos.
2. No painel do Supabase, abra **SQL Editor** e crie uma consulta nova.
3. Copie todo o conteúdo de `supabase_seguranca_fase1.sql`.
4. Execute uma única vez.
5. Confirme que o resultado final mostra:
   - `anon_security_definer_executable = 0`
   - `mutable_search_path_targets = 0`

Se qualquer função necessária estiver ausente, a verificação gera um erro e a
transação é desfeita por inteiro.

## Teste rápido depois da aplicação

Teste em uma janela anônima para evitar uma sessão antiga:

1. Aluno:
   - entrar no portal;
   - abrir o roteiro de estudos e o portal de exercícios;
   - consultar e agendar uma reposição;
   - cancelar uma reposição permitida;
   - abrir o próprio perfil.
2. Professor:
   - abrir turmas e uma turma;
   - consultar alunos, lições e acessos;
   - abrir reposições, questionários e mensalidades;
   - salvar uma alteração simples e reversível.
3. Sair da conta e confirmar que as páginas protegidas continuam exigindo login.

## Rollback emergencial

Se uma área autenticada retornar `permission denied for function ...`, execute
`supabase_seguranca_fase1_rollback.sql`. Ele restaura temporariamente a execução
das funções para `authenticated`, sem reabrir o acesso de `anon`.

Depois, registre o nome exato da função no erro para adicioná-la à lista
explícita da Fase 1 antes de reaplicar o script principal.

## Próximas fases

- revisar as políticas RLS duplicadas e limitar políticas que ainda usam o papel
  `public`;
- ativar proteção contra senhas comprometidas no Supabase Auth;
- revisar as Edge Functions públicas e desativar funções antigas após confirmar
  que não recebem mais eventos;
- corrigir índices ausentes e consultas apontadas pelo Performance Advisor.

## Fase 2 — políticas RLS

O arquivo `supabase_seguranca_fase2_rls.sql`:

- substitui `public` por `authenticated` nas políticas de acesso do site;
- consolida políticas permissivas que hoje são combinadas implicitamente com
  lógica `OR`;
- mantém alunos limitados aos próprios registros;
- mantém professores com acesso administrativo;
- usa `(select auth.uid())`, `(select auth.jwt())` e
  `(select is_teacher_admin())` para evitar reavaliação por linha;
- valida que não restaram políticas atribuídas a `public` nem grupos
  permissivos duplicados.

### Como aplicar

1. Faça o merge da PR da Fase 2.
2. No SQL Editor, execute todo o arquivo
   `supabase_seguranca_fase2_rls.sql`.
3. Confirme que o relatório final mostra:
   - `policies_for_public = 0`
   - `duplicate_permissive_groups = 0`
4. Abra o Database Advisor e confirme a remoção dos alertas
   `auth_rls_initplan` e `multiple_permissive_policies`.

### Checklist da Fase 2

Use uma conta de aluno:

1. Entrar no site e abrir o próprio perfil.
2. Abrir o roteiro de estudos, consultar o próprio progresso e confirmar que não existem controles para registrar ou alterar lições concluídas.
3. Marcar um exercício diário como concluído.
4. Abrir os recursos da própria turma.
5. Confirmar que não é possível visualizar dados de outro aluno.

Use uma conta de professor:

1. Abrir a lista de alunos e os perfis.
2. Abrir uma turma e consultar alunos, recursos e lições.
3. Salvar e remover um recurso de teste da turma.
4. Criar ou editar um exercício de teste.
5. Confirmar que mensalidades, questionários e reposições continuam acessíveis.

### Rollback emergencial

Se uma operação autorizada retornar erro de RLS ou deixar de encontrar registros,
execute `supabase_seguranca_fase2_rls_rollback.sql`. O rollback restaura somente
as políticas anteriores; as proteções da Fase 1 permanecem ativas.
